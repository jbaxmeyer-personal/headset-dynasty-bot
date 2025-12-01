// index.js - fully updated for Supabase + Discord
require('dotenv').config();
const http = require('http');

// health server for Render
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("OK");
}).listen(PORT, () => {
  console.log(`Health server running on port ${PORT}`);
});

// ---------------------------------------------------------
// DISCORD + SUPABASE
// ---------------------------------------------------------

const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  Routes,
  REST,
  ChannelType,
  PermissionFlagsBits,
  Partials
} = require('discord.js');

const { createClient } = require('@supabase/supabase-js');

// Create Supabase client (make sure RENDER env vars are set)
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildMessageReactions
  ],
  partials: [ Partials.Message, Partials.Channel, Partials.Reaction ]
});

const jobOfferUsed = new Set(); // soft-lock so users don't spam requests
if (!globalThis.jobOfferUsedGlobal) globalThis.jobOfferUsedGlobal = jobOfferUsed; // aid debugging across reloads

// ---------------------------------------------------------
// REGISTER GUILD (TESTING) COMMANDS
// ---------------------------------------------------------
// Note: only register in your testing guild to iterate quickly
const commands = [
  new SlashCommandBuilder()
    .setName('joboffers')
    .setDescription('Get your Headset Dynasty job offers'),

  new SlashCommandBuilder()
    .setName('resetteam')
    .setDescription('Reset a user’s team')
    .addUserOption(o => o.setName('coach').setDescription('The coach to reset').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('listteams')
    .setDescription('Post a list of taken and available teams'),

  new SlashCommandBuilder()
    .setName('game-result')
    .setDescription('Submit a game result')
    .addStringOption(option => option.setName('opponent').setDescription('Opponent team').setRequired(true).setAutocomplete(true))
    .addIntegerOption(option => option.setName('your_score').setDescription('Your team score').setRequired(true))
    .addIntegerOption(option => option.setName('opponent_score').setDescription('Opponent score').setRequired(true))
    .addStringOption(option => option.setName('summary').setDescription('Game summary').setRequired(true)),

  new SlashCommandBuilder()
    .setName('press-release')
    .setDescription('Post a press release')
    .addStringOption(option => option.setName('text').setDescription('Text to post').setRequired(true)),

  new SlashCommandBuilder()
    .setName('advance')
    .setDescription('Advance to next week (commissioner only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('season-advance')
    .setDescription('Advance to next season (commissioner only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
].map(c => c.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log("Registering guild commands...");
    await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), { body: commands });
    console.log("Slash commands registered.");
  } catch (err) {
    console.error("Failed to register commands:", err);
  }
})();

// ---------------------------------------------------------
// BOT READY
// ---------------------------------------------------------
client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

// ---------------------------------------------------------
// HELPERS
// ---------------------------------------------------------

/**
 * Pick N random items from an array (non-destructive copy)
 */
function pickRandom(arr, n) {
  const copy = [...arr];
  const out = [];
  for (let i = 0; i < n && copy.length > 0; i++) {
    const idx = Math.floor(Math.random() * copy.length);
    out.push(copy.splice(idx, 1)[0]);
  }
  return out;
}

/**
 * Build a DM message grouped by conference for offers
 * offers: array of team rows from supabase
 */
function buildOffersGroupedByConference(offers) {
  // Group
  const map = {};
  for (const t of offers) {
    const conf = t.conference || 'Independent';
    if (!map[conf]) map[conf] = [];
    map[conf].push(t);
  }

  // Build string
  let out = '';
  for (const conf of Object.keys(map)) {
    out += `**${conf}**\n`;
    for (let i = 0; i < map[conf].length; i++) {
      const t = map[conf][i];
      out += `${i + 1}. ${t.name}\n`;
    }
    out += '\n';
  }
  return out.trim();
}

/**
 * Run the listteams display logic (posts to member-list channel)
 * Called both by /listteams command and by team claim/reset flows
 */
async function runListTeamsDisplay() {
  try {
    const { data: teamsData, error } = await supabase.from('teams').select('*').order('conference', { ascending: true }).limit(1000);
    if (error) throw error;

    // Group by conference
    const confMap = {};
    for (const t of teamsData) {
      const conf = t.conference || 'Independent';
      if (!confMap[conf]) confMap[conf] = [];
      confMap[conf].push(t);
    }

    const guild = client.guilds.cache.first();
    if (!guild) return false;

    const channel = guild.channels.cache.find(c => c.name === 'member-list' && c.isTextBased());
    if (!channel) return false;

    // delete old bot messages FIRST
    try {
      const messages = await channel.messages.fetch({ limit: 100 });
      const botMessages = messages.filter(m => m.author.id === client.user.id);
      for (const m of botMessages.values()) {
        try { await m.delete(); } catch {}
      }
    } catch (err) {
      console.error("Error fetching/deleting old messages:", err);
    }

    let text = "";
    for (const [conf, tList] of Object.entries(confMap)) {
      // only show teams with stars <= 2.0
      const low = tList.filter(t => t.stars !== null && parseFloat(t.stars) <= 2.0);
      if (low.length === 0) continue;

      // Sort teams alphabetically within the conference
      low.sort((a, b) => a.name.localeCompare(b.name));

      text += `\n__**${conf}**__\n`;
      for (const t of low) {
        if (t.taken_by) {
          // mention the owner so it's clickable
          text += `🏈 **${t.name}** — <@${t.taken_by}> (${t.taken_by_name || 'Coach'})\n`;
        } else {
          text += `🟢 **${t.name}** — Available\n`;
        }
      }
    }

    if (!text) text = "No 2★ or below teams available.";

    const embed = {
      title: "2★ and Below Teams",
      description: text,
      color: 0x2b2d31,
      timestamp: new Date()
    };

    // send fresh list
    try {
      await channel.send({ embeds: [embed] });
    } catch (err) {
      console.error("Error sending team list:", err);
      return false;
    }
    return true;
  } catch (err) {
    console.error("runListTeamsDisplay error:", err);
    return false;
  }
}

/**
 * Send job offers DM to user (used by slash and reaction flows)
 * returns the array of offered teams (objects) or throws.
 */
async function sendJobOffersToUser(user, count = 5) {
  // Query Supabase for teams with stars <= 2.0 and not taken (assumes numeric column 'stars' and 'taken_by' col)
  const { data: available, error } = await supabase
    .from('teams')
    .select('*')
    .lte('stars', 2.0)
    .is('taken_by', null);

  if (error) throw error;
  if (!available || available.length === 0) return [];

  const offers = pickRandom(available, count);

  // save into ephemeral in-memory map for DM accept flow
  if (!client.userOffers) client.userOffers = {};
  client.userOffers[user.id] = offers;

  // Build grouped message by conference
  // We want the numbered list per message; because we used pickRandom across conferences,
  // create a unified list with numbers 1..N but still show conferences headers.
  // To make numbering consistent with user's reply, flatten offers and show number prefix.
  let dmText = `Your Headset Dynasty job offers:\n\n`;
  // group for visual context
  const grouped = {};
  for (let idx = 0; idx < offers.length; idx++) {
    const t = offers[idx];
    const conf = t.conference || 'Independent';
    if (!grouped[conf]) grouped[conf] = [];
    grouped[conf].push({ number: idx + 1, team: t });
  }
  for (const conf of Object.keys(grouped)) {
    dmText += `**${conf}**\n`;
    for (const item of grouped[conf]) {
      dmText += `${item.number}️⃣ ${item.team.name}\n`;
    }
    dmText += `\n`;
  }
  dmText += `Reply with the number of the team you want to accept.`;

  await user.send(dmText);
  return offers;
}

// ---------------------------------------------------------
// AUTOCOMPLETE & COMMAND HANDLING
// ---------------------------------------------------------
client.on('interactionCreate', async interaction => {
  try {
    // Autocomplete for opponent using supabase
    if (interaction.isAutocomplete()) {
      const focused = interaction.options.getFocused(true);
      if (focused.name === 'opponent') {
        const search = (focused.value || '').toLowerCase();
        const { data: teamsData, error } = await supabase.from('teams').select('name').limit(100);
        if (error) {
          console.error("Autocomplete supabase error:", error);
          return interaction.respond([]);
        }
        const list = (teamsData || []).map(r => r.name).filter(n => n.toLowerCase().includes(search));
        // sort alphabetically
        list.sort((a, b) => a.localeCompare(b));
        return interaction.respond(list.slice(0, 25).map(n => ({ name: n, value: n })));
      }
    }

    if (!interaction.isCommand()) return;
    const name = interaction.commandName;

    // ---------------------------
    // /joboffers
    // ---------------------------
    if (name === 'joboffers') {
      if (jobOfferUsed.has(interaction.user.id)) {
        return interaction.reply({ ephemeral: true, content: "⛔ You already received a job offer." });
      }
      jobOfferUsed.add(interaction.user.id);

      let offers;
      try {
        offers = await sendJobOffersToUser(interaction.user, 5);
      } catch (err) {
        console.error("Failed to fetch/send offers:", err);
        jobOfferUsed.delete(interaction.user.id);
        return interaction.reply({ ephemeral: true, content: `Error fetching offers: ${err.message}` });
      }

      if (!offers || offers.length === 0) {
        jobOfferUsed.delete(interaction.user.id);
        return interaction.reply({ ephemeral: true, content: "No teams available at the moment." });
      }

      await interaction.reply({ ephemeral: true, content: "Check your DMs for job offers!" });
      return;
    }

    // ---------------------------
    // /resetteam
    // ---------------------------
    if (name === 'resetteam') {
      // Defer reply immediately since this operation takes time
      await interaction.deferReply({ ephemeral: true });

      const coach = interaction.options.getUser('coach');
      // find team by taken_by
      const { data: teamData, error } = await supabase.from('teams').select('*').eq('taken_by', coach.id).limit(1).maybeSingle();
      if (error) {
        console.error("resetteam query error:", error);
        return interaction.editReply(`Error: ${error.message}`);
      }
      if (!teamData) {
        return interaction.editReply(`${coach.username} has no team.`);
      }

      // Remove from teams table
      await supabase.from('teams').update({ taken_by: null, taken_by_name: null }).eq('id', teamData.id);
      jobOfferUsed.delete(coach.id);

      // Delete team-specific channel
      const guild = client.guilds.cache.first();
      if (guild) {
        try {
          const textChannelsCategory = guild.channels.cache.find(c => c.name === 'Text Channels' && c.type === ChannelType.GuildCategory);
          if (textChannelsCategory) {
            const teamChannel = guild.channels.cache.find(c => c.name === teamData.name.toLowerCase().replace(/\s+/g, '-') && c.isTextBased() && c.parentId === textChannelsCategory.id);
            if (teamChannel) {
              await teamChannel.delete("Team reset - removing team");
              console.log(`Deleted channel for ${teamData.name}`);
            }
          }
        } catch (err) {
          console.error(`Failed to delete channel for ${teamData.name}:`, err);
        }

        // Remove Head Coach role
        try {
          const member = await guild.members.fetch(coach.id);
          const headCoachRole = guild.roles.cache.find(r => r.name === 'head coach');
          if (headCoachRole && member) {
            await member.roles.remove(headCoachRole, "Team reset - removing coach role");
            console.log(`Removed Head Coach role from ${coach.username}`);
          }
        } catch (err) {
          console.error(`Failed to remove Head Coach role from ${coach.username}:`, err);
        }
      }

      // Trigger listteams update
      await runListTeamsDisplay();

      return interaction.editReply(`Reset team ${teamData.name}. Channel deleted and role removed.`);
    }

    // ---------------------------
    // /listteams
    // ---------------------------
    if (name === 'listteams') {
      await interaction.deferReply({ ephemeral: true });

      const success = await runListTeamsDisplay();
      if (!success) {
        return interaction.editReply("Error posting team list.");
      }

      return interaction.editReply("Team list posted to #member-list.");
    }

    // ---------------------------
    // /game-result
    // ---------------------------
    if (name === 'game-result') {
      const opponentName = interaction.options.getString('opponent');
      const userScore = interaction.options.getInteger('your_score');
      const opponentScore = interaction.options.getInteger('opponent_score');
      const summary = interaction.options.getString('summary');

      // get current season and week from meta table (keys = 'current_season','current_week'), fallback to 1 and 1
      const seasonResp = await supabase.from('meta').select('value').eq('key', 'current_season').maybeSingle();
      const weekResp = await supabase.from('meta').select('value').eq('key','current_week').maybeSingle();
      const currentSeason = seasonResp.data?.value ? Number(seasonResp.data.value) : 1;
      const currentWeek = weekResp.data?.value ? Number(weekResp.data.value) : 1;

      // find user's team
      const { data: userTeam, error: userTeamErr } = await supabase.from('teams').select('*').eq('taken_by', interaction.user.id).maybeSingle();
      if (userTeamErr) {
        console.error("game-result userTeamErr:", userTeamErr);
        return interaction.reply({ ephemeral: true, content: `Error: ${userTeamErr.message}` });
      }
      if (!userTeam) return interaction.reply({ ephemeral: true, content: "You don't control a team." });

      // find opponent team by name
      const { data: opponentTeam, error: oppErr } = await supabase.from('teams').select('*').eq('name', opponentName).maybeSingle();
      if (oppErr) {
        console.error("game-result oppErr:", oppErr);
        return interaction.reply({ ephemeral: true, content: `Error: ${oppErr.message}` });
      }
      if (!opponentTeam) return interaction.reply({ ephemeral: true, content: `Opponent "${opponentName}" not found.` });

      const resultText = userScore > opponentScore ? 'W' : 'L';

      // include current week when inserting results so weekly summaries can query by week
      const insertResp = await supabase.from('results').insert([{
        season: currentSeason,
        week: currentWeek,
        user_team_id: userTeam.id,
        user_team_name: userTeam.name,
        opponent_team_id: opponentTeam.id,
        opponent_team_name: opponentTeam.name,
        user_score: userScore,
        opponent_score: opponentScore,
        summary,
        result: resultText
      }]);

      if (insertResp.error) {
        console.error("results insert error:", insertResp.error);
        return interaction.reply({ ephemeral: true, content: `Failed to save result: ${insertResp.error.message}` });
      }

      // post a quick box score in news-feed, showing the user's current season record instead of a single-letter result
      const guild = client.guilds.cache.first();
      if (guild) {
        const newsChannel = guild.channels.cache.find(c => c.name === 'news-feed' && c.isTextBased());
        if (newsChannel) {
          // compute the user's record for the current season
          try {
            const seasonResultsResp = await supabase.from('results').select('*').eq('season', currentSeason).or(`user_team_id.eq.${userTeam.id},opponent_team_id.eq.${userTeam.id}`);
            let wins = 0, losses = 0;
            if (seasonResultsResp.data) {
              for (const r of seasonResultsResp.data) {
                if (r.user_team_id === userTeam.id) {
                  if (r.result === 'W') wins++; else losses++;
                } else if (r.opponent_team_id === userTeam.id) {
                  if (r.result === 'W') losses++; else wins++;
                }
              }
            }

            const boxScore = `${userTeam.name.padEnd(15)} ${userScore}\n ${opponentTeam.name.padEnd(15)} ${opponentScore}\n Record: ${userTeam.name} ${wins}-${losses}\n Summary: ${summary}`;
            const embed = {
              title: `Game Result: ${userTeam.name} vs ${opponentTeam.name}`,
              color: resultText === 'W' ? 0x00ff00 : 0xff0000,
              description: boxScore,
              timestamp: new Date()
            };
            await newsChannel.send({ embeds: [embed] }).catch(e => console.error("failed to post news-feed:", e));
          } catch (err) {
            console.error('Failed to compute/send record for news-feed:', err);
          }
        }
      }

      return interaction.reply({ ephemeral: true, content: `Result recorded: ${userTeam.name} vs ${opponentTeam.name}` });
    }

    // ---------------------------
    // /press-release
    // ---------------------------
    if (name === 'press-release') {
      const text = interaction.options.getString('text');
      // get season/week
      const seasonResp = await supabase.from('meta').select('value').eq('key','current_season').maybeSingle();
      const weekResp = await supabase.from('meta').select('value').eq('key','current_week').maybeSingle();
      const season = seasonResp.data?.value ? Number(seasonResp.data.value) : 1;
      const week = weekResp.data?.value ? Number(weekResp.data.value) : 1;

      const insert = await supabase.from('news_feed').insert([{ season, week, text }]);
      if (insert.error) {
        console.error("press-release insert error:", insert.error);
        return interaction.reply({ ephemeral: true, content: `Error: ${insert.error.message}` });
      }

      // also post to news-feed channel as a styled embed
      const guild = client.guilds.cache.first();
      if (guild) {
        const newsChannel = guild.channels.cache.find(c => c.name === 'news-feed' && c.isTextBased());
        if (newsChannel) {
          const prBox = '${text}';
          const embed = {
            title: `Press Release`,
            color: 0xffa500,
            description: prBox,
            timestamp: new Date()
          };
          await newsChannel.send({ embeds: [embed] }).catch(() => {});
        }
      }

      return interaction.reply({ ephemeral: true, content: "Press release posted." });
    }

    // ---------------------------
    // /advance (commissioner only)
    // ---------------------------
    if (name === 'advance') {
      // commissioner check
      if (!interaction.member || !interaction.member.permissions || !interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ ephemeral: true, content: "Only the commissioner can advance the week." });
      }

      // get current week
      const weekResp = await supabase.from('meta').select('value').eq('key','current_week').maybeSingle();
      const currentWeek = weekResp.data?.value ? Number(weekResp.data.value) : 1;
      // get current season (needed for weekly summaries and records)
      const seasonResp = await supabase.from('meta').select('value').eq('key','current_season').maybeSingle();
      const currentSeason = seasonResp.data?.value ? Number(seasonResp.data.value) : 1;

      // post advance message in advance channel
      const guild = client.guilds.cache.first();
      if (guild) {
        const advanceChannel = guild.channels.cache.find(c => c.name === 'advance' && c.isTextBased());
        if (advanceChannel) await advanceChannel.send("We have advanced to the next week").catch(() => {});
      }

      // fetch news_feed posts since last advance (week == currentWeek)
      // fetch news_feed posts since last advance (week == currentWeek)
      const newsResp = await supabase.from('news_feed').select('text').eq('week', currentWeek);
      let pressReleaseBullets = [];
      if (newsResp.data && newsResp.data.length > 0) {
        pressReleaseBullets = newsResp.data.map(n => `• ${n.text}`);
      }

      // Also include game results for this week (if results table has week column)
      let weeklyResultsText = "";
      try {
        const allSeasonResp = await supabase.from('results').select('*').eq('season', currentSeason);
        const weeklyResp = await supabase.from('results').select('*').eq('season', currentSeason).eq('week', currentWeek);
        const records = {};
        if (allSeasonResp.data) {
          for (const r of allSeasonResp.data) {
            if (!records[r.user_team_id]) records[r.user_team_id] = { name: r.user_team_name, wins: 0, losses: 0 };
            if (!records[r.opponent_team_id]) records[r.opponent_team_id] = { name: r.opponent_team_name, wins: 0, losses: 0 };
            if (r.result === 'W') {
              records[r.user_team_id].wins++;
              records[r.opponent_team_id].losses++;
            } else {
              records[r.user_team_id].losses++;
              records[r.opponent_team_id].wins++;
            }
          }
        }

        if (weeklyResp.data && weeklyResp.data.length > 0) {
          weeklyResultsText = weeklyResp.data.map(r => {
            const rec = records[r.user_team_id] || { wins: 0, losses: 0 };
            return `${r.user_team_name} ${r.user_score} - ${r.opponent_team_name} ${r.opponent_score}\n${r.user_team_name} (${rec.wins}-${rec.losses})`;
          }).join('\n');
        }
      } catch (err) {
        console.error('Failed to fetch weekly results for summary:', err);
      }

      // post weekly summary in news-feed (label week starting at 0)
      if (guild) {
        const newsFeedChannel = guild.channels.cache.find(c => c.name === 'news-feed' && c.isTextBased());
        if (newsFeedChannel) {
          const weekLabel = Math.max(0, currentWeek - 1);
          const header = `**Weekly Summary (Season ${currentSeason} — Week ${weekLabel})**`;
          const bodyParts = [];
          
          // Add press releases as bullet points
          if (pressReleaseBullets.length > 0) {
            bodyParts.push(pressReleaseBullets.join('\n'));
          }
          
          // Add game results
          if (weeklyResultsText) {
            bodyParts.push(`**Game Results:**\n${weeklyResultsText}`);
          }
          
          const body = bodyParts.length > 0 ? bodyParts.join('\n\n') : 'No news this week.';
          await newsFeedChannel.send(`${header}\n\n${body}`).catch(() => {});
        }
      }

      // increment week in meta table
      const newWeek = currentWeek + 1;
      await supabase.from('meta').update({ value: newWeek }).eq('key', 'current_week');

      return interaction.reply({ ephemeral: true, content: `Advanced week to ${newWeek}.` });
    }

    // ---------------------------
    // /season-advance (commissioner only)
    // ---------------------------
    if (name === 'season-advance') {
      // commissioner check
      if (!interaction.member || !interaction.member.permissions || !interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ ephemeral: true, content: "Only the commissioner can advance the season." });
      }

      const seasonResp = await supabase.from('meta').select('value').eq('key','current_season').maybeSingle();
      const currentSeason = seasonResp.data?.value ? Number(seasonResp.data.value) : 1;

      // increment season, reset week to 0 (week numbering starts at 0)
      await supabase.from('meta').update({ value: currentSeason + 1 }).eq('key','current_season');
      await supabase.from('meta').update({ value: 0 }).eq('key','current_week');

      // announce season advance in advance channel
      try {
        const guild = client.guilds.cache.first();
        if (guild) {
          const advanceChannel = guild.channels.cache.find(c => c.name === 'advance' && c.isTextBased());
          if (advanceChannel) {
            await advanceChannel.send(`We have advanced to Season ${currentSeason + 1}`).catch(() => {});
          }
        }
      } catch (err) {
        console.error('Failed to post season advance message:', err);
      }

      return interaction.reply({ ephemeral: true, content: `Season advanced to ${currentSeason + 1}, week reset to 0.` });
    }

  } catch (err) {
    console.error("interactionCreate error:", err);
    try {
      if (interaction.replied || interaction.deferred) {
        await interaction.editReply(`Error: ${err.message}`);
      } else {
        await interaction.reply({ ephemeral: true, content: `Error: ${err.message}` });
      }
    } catch (e) { /* ignore reply errors */ }
  }
});

// ---------------------------------------------------------
// REACTION HANDLER (for rules reaction -> trigger job offers)
// ---------------------------------------------------------
// Behavior: when a user reacts with ✅ in the "rules" channel, send them job offers
// Adjust channel name or message id if you prefer a different trigger
client.on('messageReactionAdd', async (reaction, user) => {
  try {
    if (user.bot) return;

    if (reaction.partial) await reaction.fetch();
    if (reaction.message.partial) await reaction.message.fetch();

    // only watch for ✅
    if (reaction.emoji.name !== '✅') return;

    // optionally restrict to a specific message ID or channel name
    // if you want to restrict to the rules channel, check:
    const channel = reaction.message.channel;
    // CHANGE 'rules' to the exact channel name you use for the rules message
    if (!channel || channel.name !== 'rules') return;

    // soft-lock
    if (jobOfferUsed.has(user.id)) {
      // optionally DM user about why they didn't get offers
      try { await user.send("⛔ You've already received your job offers."); } catch (e) {}
      return;
    }

    jobOfferUsed.add(user.id);

    try {
      const offers = await sendJobOffersToUser(user, 5);
      if (!offers || offers.length === 0) {
        jobOfferUsed.delete(user.id);
        try { await user.send("No teams available right now."); } catch (e) {}
      }
    } catch (err) {
      console.error("sendJobOffersToUser error:", err);
      jobOfferUsed.delete(user.id);
      try { await user.send(`Error fetching offers: ${err.message}`); } catch (e) {}
    }
  } catch (err) {
    console.error("messageReactionAdd handler error:", err);
  }
});

// ---------------------------------------------------------
// DM ACCEPT OFFER (user replies to bot DM with a number)
// ---------------------------------------------------------
client.on('messageCreate', async msg => {
  try {
    if (msg.guild || msg.author.bot) return;

    const userId = msg.author.id;
    if (!client.userOffers || !client.userOffers[userId]) return;

    const offers = client.userOffers[userId];
    const choice = parseInt(msg.content);
    if (isNaN(choice) || choice < 1 || choice > offers.length) {
      return msg.reply("Reply with the number of the team you choose (from the DM list).");
    }

    const team = offers[choice - 1];

    // Write taken_by and taken_by_name into supabase teams table
    const updateResp = await supabase.from('teams').update({
      taken_by: userId,
      taken_by_name: msg.author.username
    }).eq('id', team.id);

    if (updateResp.error) {
      console.error("Failed to claim team:", updateResp.error);
      return msg.reply(`Failed to claim ${team.name}: ${updateResp.error.message}`);
    }

    msg.reply(`You accepted the job offer from **${team.name}**!`);
    delete client.userOffers[userId];

    // announce in general channel and perform setup
    const guild = client.guilds.cache.first();
    if (guild) {
      const general = guild.channels.cache.find(c => c.name === 'general' && c.isTextBased());
      if (general) general.send(`🏈 <@${userId}> has accepted a job offer from **${team.name}**!`).catch(() => {});

      // Create team-specific channel (named after school name)
      try {
        const channelName = team.name.toLowerCase().replace(/\s+/g, '-');
        // Find or create the Text Channels category
        let textChannelsCategory = guild.channels.cache.find(c => c.name === 'Text Channels' && c.type === ChannelType.GuildCategory);
        if (!textChannelsCategory) {
          textChannelsCategory = await guild.channels.create({
            name: 'Text Channels',
            type: ChannelType.GuildCategory
          });
        }
        const newChannel = await guild.channels.create({
          name: channelName,
          type: ChannelType.GuildText,
          parent: textChannelsCategory.id,
          reason: `Team channel for ${team.name}`
        });
        console.log(`Created channel #${channelName} for ${team.name}`);

        // Send welcome message
        await newChannel.send(`Welcome to **${team.name}**! <@${userId}> is the Head Coach.`);
      } catch (err) {
        console.error(`Failed to create channel for ${team.name}:`, err);
      }

      // Assign Head Coach role to user
      try {
        const member = await guild.members.fetch(userId);
        let headCoachRole = guild.roles.cache.find(r => r.name === 'head coach');
        if (!headCoachRole) {
          headCoachRole = await guild.roles.create({
            name: 'head coach',
            reason: 'Role for team heads'
          });
        }
        await member.roles.add(headCoachRole, "Claimed team");
        console.log(`Assigned Head Coach role to ${msg.author.username}`);
      } catch (err) {
        console.error(`Failed to assign Head Coach role to ${msg.author.username}:`, err);
      }
    }

    // Trigger listteams update
    await runListTeamsDisplay();
  } catch (err) {
    console.error("DM accept offer error:", err);
    try { await msg.reply("An error occurred processing your request."); } catch (e) {}
  }
});

// ---------------------------------------------------------
// START BOT
// ---------------------------------------------------------
client.login(process.env.DISCORD_TOKEN).catch(e => {
  console.error("Failed to login:", e);
});
