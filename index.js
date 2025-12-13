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
// SELF-PINGER (optional: keeps service warm on idle platforms)
// ---------------------------------------------------------
const httpGet = (url) => {
  return new Promise((resolve) => {
    try {
      const req = require('http').get(url, (res) => {
        res.on('data', () => {});
        res.on('end', () => resolve({ status: res.statusCode }));
      });
      req.on('error', (e) => resolve({ error: e.message }));
      req.setTimeout(5000, () => { req.abort(); resolve({ error: 'timeout' }); });
    } catch (e) {
      resolve({ error: e.message });
    }
  });
};

if (process.env.SELF_PING_URL) {
  setInterval(async () => {
    try {
      const r = await httpGet(process.env.SELF_PING_URL);
      if (r.error) console.debug('self-ping failed:', r.error);
      else console.debug('self-ping status:', r.status);
    } catch (e) {
      console.debug('self-ping exception:', e);
    }
  }, 4 * 60 * 1000); // every 4 minutes
  console.log('Self-pinger enabled for', process.env.SELF_PING_URL);
}

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
    .setDescription('Get your Headset Dynasty job offers')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('resetteam')
    .setDescription('Reset a user\'s team')
    .addStringOption(o => o.setName('userid').setDescription('The Discord user ID of the coach to reset').setRequired(true))
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('listteams')
    .setDescription('Post a list of taken and available teams')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('game-result')
    .setDescription('Submit a game result')
    .addStringOption(option => option.setName('opponent').setDescription('Opponent team').setRequired(true).setAutocomplete(true))
    .addIntegerOption(option => option.setName('your_score').setDescription('Your team score').setRequired(true))
    .addIntegerOption(option => option.setName('opponent_score').setDescription('Opponent score').setRequired(true))
    .addStringOption(option => option.setName('summary').setDescription('Game summary').setRequired(true))
    .setDMPermission(false),

  new SlashCommandBuilder()
    .setName('press-release')
    .setDescription('Post a press release')
    .addStringOption(option => option.setName('text').setDescription('Text to post').setRequired(true))
    .setDMPermission(false),

  new SlashCommandBuilder()
    .setName('advance')
    .setDescription('Advance to next week (commissioner only)')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('season-advance')
    .setDescription('Advance to next season (commissioner only)')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('ranking')
    .setDescription('Show current season rankings (commissioner only)')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addBooleanOption(opt => opt
      .setName('public')
      .setDescription('Post to #general (default: private)')
      .setRequired(false)),

  new SlashCommandBuilder()
    .setName('ranking-all-time')
    .setDescription('Show all-time rankings across seasons (commissioner only)')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addBooleanOption(opt => opt
      .setName('public')
      .setDescription('Post to #general (default: private)')
      .setRequired(false)),

  new SlashCommandBuilder()
    .setName('move-coach')
    .setDescription('Move a coach to a new team (commissioner only)')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(opt => opt
      .setName('coach')
      .setDescription('Select the coach to move')
      .setRequired(true)
      .setAutocomplete(true))
    .addStringOption(opt => opt
      .setName('new_team')
      .setDescription('Select the new team')
      .setRequired(true)
      .setAutocomplete(true))
].map(c => c.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log("Clearing old global commands...");
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: [] });
    console.log("Registering guild commands...");
    await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), { body: commands });
    console.log("Slash commands registered to guild.");
  } catch (err) {
    console.error("Failed to register commands:", err);
  }
})();

// ---------------------------------------------------------
// BOT READY
// ---------------------------------------------------------
client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);

  // Set up role-based permissions after bot is ready
  // If CLIENT_SECRET isn't provided we cannot obtain an OAuth2 application
  // bearer token required for the application permissions endpoint. In
  // that case skip automatic permission setup and ask the user to set
  // command permissions manually in the Discord UI.
  if (!process.env.CLIENT_SECRET) {
    console.log("Skipping automatic command-permission setup: no CLIENT_SECRET provided. Configure command permissions manually in your server settings if needed.");
    return;
  }

  try {
    const guild = client.guilds.cache.first();
    if (!guild) {
      console.warn("No guild found in cache. Skipping permission setup.");
      return;
    }

    const headCoachRole = guild.roles.cache.find(r => r.name === 'head coach');
    if (!headCoachRole) {
      console.warn("'head coach' role not found. Skipping permission setup.");
      return;
    }

    // Fetch all guild commands
    const guildCommands = await guild.commands.fetch();
    
    if (guildCommands.size === 0) {
      console.warn("No guild commands found.");
      return;
    }

    // Commands that should be visible to 'head coach' only
    const publicCommands = ['game-result', 'press-release'];

    for (const cmd of guildCommands.values()) {
      if (publicCommands.includes(cmd.name)) {
        // Set permissions using REST API (requires bot token, not OAuth2)
        try {
          await rest.put(
            Routes.applicationCommandPermissions(process.env.CLIENT_ID, process.env.GUILD_ID, cmd.id),
            {
              body: {
                permissions: [
                  {
                    id: headCoachRole.id,
                    type: 1, // ROLE
                    permission: true
                  },
                  {
                    id: guild.id, // @everyone
                    type: 1, // ROLE
                    permission: false
                  }
                ]
              }
            }
          );
          console.log(`✓ Set permissions for /${cmd.name}: head coach only`);
        } catch (permErr) {
          console.error(`Failed to set permissions for /${cmd.name}:`, permErr.message);
        }
      }
    }

    console.log("Command permissions configured.");
  } catch (err) {
    console.error("Failed to set command permissions:", err);
  }
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
    // Autocomplete handling
    if (interaction.isAutocomplete()) {
      const focused = interaction.options.getFocused(true);
      
      // Autocomplete for /game-result opponent
      if (focused.name === 'opponent') {
        const search = (focused.value || '').toLowerCase();
        const { data: teamsData, error } = await supabase.from('teams').select('name').limit(200);
        if (error) {
          console.error("Autocomplete supabase error:", error);
          try { await interaction.respond([]); } catch (e) { console.error('Failed to respond to autocomplete (empty):', e); }
          return;
        }
        const list = (teamsData || []).map(r => r.name).filter(n => n.toLowerCase().includes(search));
        // sort alphabetically
        list.sort((a, b) => a.localeCompare(b));
        try {
          await interaction.respond(list.slice(0, 25).map(n => ({ name: n, value: n })));
        } catch (e) {
          console.error('Failed to respond to autocomplete:', e);
        }
        return;
      }

      // Autocomplete for /move-coach coach (list users with teams)
      if (focused.name === 'coach') {
        const search = (focused.value || '').toLowerCase();
        const { data: teamsData, error } = await supabase.from('teams').select('taken_by_name').where('taken_by.is.not', null).limit(200);
        if (error) {
          console.error("Autocomplete coach error:", error);
          try { await interaction.respond([]); } catch (e) { console.error('Failed to respond to autocomplete (empty):', e); }
          return;
        }
        const coachList = (teamsData || []).map(r => r.taken_by_name).filter(n => n && n.toLowerCase().includes(search));
        // remove duplicates and sort
        const uniqueCoaches = [...new Set(coachList)];
        uniqueCoaches.sort((a, b) => a.localeCompare(b));
        try {
          await interaction.respond(uniqueCoaches.slice(0, 25).map(n => ({ name: n, value: n })));
        } catch (e) {
          console.error('Failed to respond to autocomplete:', e);
        }
        return;
      }

      // Autocomplete for /move-coach new_team (list all teams)
      if (focused.name === 'new_team') {
        const search = (focused.value || '').toLowerCase();
        const { data: teamsData, error } = await supabase.from('teams').select('id, name, taken_by_name').limit(200);
        if (error) {
          console.error("Autocomplete new_team error:", error);
          try { await interaction.respond([]); } catch (e) { console.error('Failed to respond to autocomplete (empty):', e); }
          return;
        }
        const list = (teamsData || []).filter(t => t.name.toLowerCase().includes(search)).map(t => {
          const status = t.taken_by_name ? ` (${t.taken_by_name})` : ' (available)';
          return { name: `${t.name}${status}`, value: t.id };
        });
        list.sort((a, b) => a.name.localeCompare(b.name));
        try {
          await interaction.respond(list.slice(0, 25));
        } catch (e) {
          console.error('Failed to respond to autocomplete:', e);
        }
        return;
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

      const userId = interaction.options.getString('userid');
      
      // Validate that it looks like a Discord ID (numeric string)
      if (!/^\d+$/.test(userId)) {
        return interaction.editReply('Invalid user ID. Please provide a valid Discord user ID (numbers only).');
      }

      // find team by taken_by
      const { data: teamData, error } = await supabase.from('teams').select('*').eq('taken_by', userId).limit(1).maybeSingle();
      if (error) {
        console.error("resetteam query error:", error);
        return interaction.editReply(`Error: ${error.message}`);
      }
      if (!teamData) {
        return interaction.editReply(`User ID ${userId} has no team.`);
      }

      // Remove from teams table
      await supabase.from('teams').update({ taken_by: null, taken_by_name: null }).eq('id', teamData.id);
      jobOfferUsed.delete(userId);

      // Delete team-specific channel
      const guild = client.guilds.cache.first();
      if (guild) {
        try {
          const teamChannelsCategory = guild.channels.cache.find(c => c.name === 'Team Channels' && c.type === ChannelType.GuildCategory);
          if (teamChannelsCategory) {
            const teamChannel = guild.channels.cache.find(c => c.name === teamData.name.toLowerCase().replace(/\s+/g, '-') && c.isTextBased() && c.parentId === teamChannelsCategory.id);
            if (teamChannel) {
              await teamChannel.delete("Team reset - removing team");
              console.log(`Deleted channel for ${teamData.name}`);
            }
          }
        } catch (err) {
          console.error(`Failed to delete channel for ${teamData.name}:`, err);
        }

        // Remove Head Coach role (only if user is still in server)
        try {
          const member = await guild.members.fetch(userId);
          const headCoachRole = guild.roles.cache.find(r => r.name === 'head coach');
          if (headCoachRole && member) {
            await member.roles.remove(headCoachRole, "Team reset - removing coach role");
            console.log(`Removed Head Coach role from user ${userId}`);
          }
        } catch (err) {
          // User may have left the server, that's okay
          console.log(`Could not remove Head Coach role from ${userId} (user may have left server):`, err.message);
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

      // get current season and week from meta table (keys = 'current_season','current_week')
      // Use nullish checks so a stored 0 is honored (week starts at 0)
      const seasonResp = await supabase.from('meta').select('value').eq('key', 'current_season').maybeSingle();
      const weekResp = await supabase.from('meta').select('value').eq('key','current_week').maybeSingle();
      const currentSeason = seasonResp.data?.value != null ? Number(seasonResp.data.value) : 1;
      const currentWeek = weekResp.data?.value != null ? Number(weekResp.data.value) : 0;

      // find user's team
      const { data: userTeam, error: userTeamErr } = await supabase.from('teams').select('*').eq('taken_by', interaction.user.id).maybeSingle();
      if (userTeamErr) {
        console.error("game-result userTeamErr:", userTeamErr);
        return interaction.reply({ ephemeral: true, content: `Error: ${userTeamErr.message}` });
      }
      if (!userTeam) return interaction.reply({ ephemeral: true, content: "You don't control a team." });

      // find opponent team by name
      // Do a case-insensitive lookup with sensible fallbacks so users can
      // enter names with different casing or partial names (e.g. "fiu" vs "FIU").
      let opponentTeam = null;
      try {
        const { data: teamsData, error: teamsErr } = await supabase.from('teams').select('*').limit(1000);
        if (teamsErr) {
          console.error('game-result teams fetch error:', teamsErr);
          return interaction.reply({ ephemeral: true, content: `Error fetching teams: ${teamsErr.message}` });
        }

        const needle = (opponentName || '').toLowerCase().trim();
        if (teamsData && teamsData.length > 0) {
          // 1) exact case-insensitive match
          opponentTeam = teamsData.find(t => (t.name || '').toLowerCase() === needle);
          // 2) fallback: substring match
          if (!opponentTeam) opponentTeam = teamsData.find(t => (t.name || '').toLowerCase().includes(needle));
        }
      } catch (err) {
        console.error('game-result opponent lookup error:', err);
        return interaction.reply({ ephemeral: true, content: `Error looking up opponent: ${err.message}` });
      }

      if (!opponentTeam) return interaction.reply({ ephemeral: true, content: `Opponent "${opponentName}" not found.` });

      const resultText = userScore > opponentScore ? 'W' : 'L';

      // include current week when inserting results so weekly summaries can query by week
      // Also capture taken_by and taken_by_name to track which user owned the team at this time
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
        result: resultText,
        taken_by: userTeam.taken_by,
        taken_by_name: userTeam.taken_by_name || interaction.user.username
      }]);

      if (insertResp.error) {
        console.error("results insert error:", insertResp.error);
        return interaction.reply({ ephemeral: true, content: `Failed to save result: ${insertResp.error.message}` });
      }

      // Check if opponent is user-controlled (needed for both records update and news-feed post)
      const isOpponentUserControlled = opponentTeam.taken_by != null;

      // Update records table for both users (if applicable)
      try {

        // Fetch existing record for submitting user
        const { data: existingRecord } = await supabase
          .from('records')
          .select('*')
          .eq('season', currentSeason)
          .eq('team_id', userTeam.id)
          .maybeSingle();

        // Calculate new totals by incrementing existing values
        const newWins = (existingRecord?.wins || 0) + (resultText === 'W' ? 1 : 0);
        const newLosses = (existingRecord?.losses || 0) + (resultText === 'L' ? 1 : 0);
        const newUserWins = (existingRecord?.user_wins || 0) + (isOpponentUserControlled && resultText === 'W' ? 1 : 0);
        const newUserLosses = (existingRecord?.user_losses || 0) + (isOpponentUserControlled && resultText === 'L' ? 1 : 0);

        // Upsert with incremented values
        await supabase.from('records').upsert({
          season: currentSeason,
          team_id: userTeam.id,
          team_name: userTeam.name,
          taken_by: userTeam.taken_by,
          taken_by_name: userTeam.taken_by_name || interaction.user.username,
          wins: newWins,
          losses: newLosses,
          user_wins: newUserWins,
          user_losses: newUserLosses
        }, { onConflict: 'season,team_id' });

        // If opponent is user-controlled, update their record too
        if (isOpponentUserControlled) {
          const { data: existingOppRecord } = await supabase
            .from('records')
            .select('*')
            .eq('season', currentSeason)
            .eq('team_id', opponentTeam.id)
            .maybeSingle();

          const oppResultText = resultText === 'W' ? 'L' : 'W';
          const newOppWins = (existingOppRecord?.wins || 0) + (oppResultText === 'W' ? 1 : 0);
          const newOppLosses = (existingOppRecord?.losses || 0) + (oppResultText === 'L' ? 1 : 0);
          const newOppUserWins = (existingOppRecord?.user_wins || 0) + (oppResultText === 'W' ? 1 : 0);
          const newOppUserLosses = (existingOppRecord?.user_losses || 0) + (oppResultText === 'L' ? 1 : 0);

          await supabase.from('records').upsert({
            season: currentSeason,
            team_id: opponentTeam.id,
            team_name: opponentTeam.name,
            taken_by: opponentTeam.taken_by,
            taken_by_name: opponentTeam.taken_by_name || 'Unknown',
            wins: newOppWins,
            losses: newOppLosses,
            user_wins: newOppUserWins,
            user_losses: newOppUserLosses
          }, { onConflict: 'season,team_id' });
        }
      } catch (err) {
        console.error('Failed to update records table:', err);
      }

      // post a quick box score in news-feed, showing the user's current season record instead of a single-letter result
      const guild = client.guilds.cache.first();
      if (guild) {
        const newsChannel = guild.channels.cache.find(c => c.name === 'news-feed' && c.isTextBased());
        if (newsChannel) {
          // compute the user's record for the current season from records table
          try {
            const recordResp = await supabase.from('records').select('wins,losses').eq('season', currentSeason).eq('team_id', userTeam.id).maybeSingle();
            const wins = recordResp.data?.wins || 0;
            const losses = recordResp.data?.losses || 0;

            let recordText = `Record: ${userTeam.name} ${wins}-${losses}`;
            
            // If opponent is user-controlled, show their record too
            if (isOpponentUserControlled) {
              const oppRecordResp = await supabase.from('records').select('wins,losses').eq('season', currentSeason).eq('team_id', opponentTeam.id).maybeSingle();
              const oppWins = oppRecordResp.data?.wins || 0;
              const oppLosses = oppRecordResp.data?.losses || 0;
              recordText += `, ${opponentTeam.name} ${oppWins}-${oppLosses}`;
            }

            const boxScore = `${userTeam.name.padEnd(15)} ${userScore}\n ${opponentTeam.name.padEnd(15)} ${opponentScore}\n ${recordText}\n Summary: ${summary}`;
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
      // get season/week (allow week 0)
      const seasonResp = await supabase.from('meta').select('value').eq('key','current_season').maybeSingle();
      const weekResp = await supabase.from('meta').select('value').eq('key','current_week').maybeSingle();
      const season = seasonResp.data?.value != null ? Number(seasonResp.data.value) : 1;
      const week = weekResp.data?.value != null ? Number(weekResp.data.value) : 0;

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
          const embed = {
            title: `Press Release`,
            color: 0xffa500,
            description: text,
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
      // Defer reply immediately to avoid interaction timeout
      await interaction.deferReply({ ephemeral: true });

      // commissioner check
      if (!interaction.member || !interaction.member.permissions || !interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.editReply("Only the commissioner can advance the week.");
      }

      // get current week and season (allow week 0)
      const weekResp = await supabase.from('meta').select('value').eq('key','current_week').maybeSingle();
      const currentWeek = weekResp.data?.value != null ? Number(weekResp.data.value) : 0;
      // get current season (needed for weekly summaries and records)
      const seasonResp = await supabase.from('meta').select('value').eq('key','current_season').maybeSingle();
      const currentSeason = seasonResp.data?.value != null ? Number(seasonResp.data.value) : 1;

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
          // Fetch teams to check if opponent is user-controlled
          const { data: teamsData } = await supabase.from('teams').select('id,taken_by');
          const teamsMap = {};
          if (teamsData) {
            for (const t of teamsData) {
              teamsMap[t.id] = t.taken_by;
            }
          }

          weeklyResultsText = weeklyResp.data.map(r => {
            const userRec = records[r.user_team_id] || { wins: 0, losses: 0 };
            const oppRec = records[r.opponent_team_id] || { wins: 0, losses: 0 };
            const isOppUserControlled = teamsMap[r.opponent_team_id] != null;
            
            let result = `${r.user_team_name} ${r.user_score} - ${r.opponent_team_name} ${r.opponent_score}\n${r.user_team_name} (${userRec.wins}-${userRec.losses})`;
            
            // If opponent is user-controlled, add their record too
            if (isOppUserControlled) {
              result += `\n${r.opponent_team_name} (${oppRec.wins}-${oppRec.losses})`;
            }
            
            return result;
          }).join('\n\n');
        }
      } catch (err) {
        console.error('Failed to fetch weekly results for summary:', err);
      }

      // post weekly summary in news-feed (label week starting at 0)
      if (guild) {
        const newsFeedChannel = guild.channels.cache.find(c => c.name === 'news-feed' && c.isTextBased());
        if (newsFeedChannel) {
          const weekLabel = Math.max(0, currentWeek - 1);
          const title = `Weekly Summary (Season ${currentSeason} — Week ${weekLabel})`;
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

          const embed = {
            title,
            description: body,
            color: 0x1e90ff,
            timestamp: new Date()
          };

          // Post to news-feed
          await newsFeedChannel.send({ embeds: [embed] }).catch(() => {});

          // Also post the weekly summary embed to #general
          const generalChannel = guild.channels.cache.find(c => c.name === 'general' && c.isTextBased());
          if (generalChannel) {
            await generalChannel.send({ embeds: [embed] }).catch(() => {});
          }
        }
      }

      // increment week in meta table
      const newWeek = currentWeek + 1;
      await supabase.from('meta').update({ value: newWeek }).eq('key', 'current_week');

      return interaction.editReply(`Advanced week to ${newWeek}.`);
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

    // ---------------------------
    // /ranking (current season)
    // ---------------------------
    if (name === 'ranking') {
      if (!interaction.member || !interaction.member.permissions || !interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ ephemeral: true, content: "Only the commissioner can view rankings." });
      }

      const isPublic = interaction.options.getBoolean('public') || false;
      await interaction.deferReply({ flags: isPublic ? 0 : 64 }); // 0 = public, 64 = ephemeral

      try {
        const seasonResp = await supabase.from('meta').select('value').eq('key', 'current_season').maybeSingle();
        const currentSeason = seasonResp.data?.value != null ? Number(seasonResp.data.value) : 1;

        // Fetch records for current season
        const { data: records, error: recordsErr } = await supabase.from('records').select('*').eq('season', currentSeason);
        if (recordsErr) throw recordsErr;

        // Fetch current users (only those with teams)
        const { data: currentUsers, error: usersErr } = await supabase.from('teams').select('taken_by').not('taken_by', 'is', null);
        if (usersErr) throw usersErr;
        const currentUserIds = new Set((currentUsers || []).map(u => u.taken_by));

        // Filter records to only include current users
        const filteredRecords = (records || []).filter(r => currentUserIds.has(r.taken_by));

        // Fetch all user vs user results for H2H tiebreaking
        const { data: results, error: resultsErr } = await supabase.from('results').select('*').eq('season', currentSeason);
        if (resultsErr) throw resultsErr;

        // Build map of H2H records: "userA_vs_userB" => wins for userA
        const h2hMap = {};
        if (results) {
          for (const r of results) {
            // Only count user vs user matches
            if (r.taken_by && r.opponent_team_id) {
              // Try to find opponent's taken_by from records
              const oppRecord = (records || []).find(rec => rec.team_id === r.opponent_team_id);
              if (oppRecord && oppRecord.taken_by) {
                const key = `${r.taken_by}_vs_${oppRecord.taken_by}`;
                if (!h2hMap[key]) h2hMap[key] = { wins: 0, losses: 0 };
                if (r.result === 'W') h2hMap[key].wins++;
                else h2hMap[key].losses++;
              }
            }
          }
        }

        // Helper to calculate H2H win% between two users
        const getH2HWinPct = (userAId, userBId) => {
          const key = `${userAId}_vs_${userBId}`;
          if (!h2hMap[key]) return 0;
          const { wins, losses } = h2hMap[key];
          return (wins + losses) > 0 ? wins / (wins + losses) : 0;
        };

        // Sort by: total wins (unless within 1 win, then win%), then user-vs-user win%, then H2H win%
        const sorted = filteredRecords.sort((a, b) => {
          // First: check if wins are within 1 of each other
          const winDiff = Math.abs(a.wins - b.wins);
          
          if (winDiff <= 1) {
            // Within 1 win: use win percentage as primary
            const aWinPct = (a.wins + a.losses) > 0 ? a.wins / (a.wins + a.losses) : 0;
            const bWinPct = (b.wins + b.losses) > 0 ? b.wins / (b.wins + b.losses) : 0;
            if (aWinPct !== bWinPct) return bWinPct - aWinPct;
          } else {
            // More than 1 win difference: use total wins
            return b.wins - a.wins;
          }

          // Third: user-vs-user win percentage (descending)
          const aUserPct = (a.user_wins + a.user_losses) > 0 ? a.user_wins / (a.user_wins + a.user_losses) : 0;
          const bUserPct = (b.user_wins + b.user_losses) > 0 ? b.user_wins / (b.user_wins + b.user_losses) : 0;
          if (aUserPct !== bUserPct) return bUserPct - aUserPct;

          // Fourth: H2H tiebreaker (between the two users)
          const aH2H = getH2HWinPct(a.taken_by, b.taken_by);
          const bH2H = getH2HWinPct(b.taken_by, a.taken_by);
          if (aH2H !== bH2H) return bH2H - aH2H;

          // Fallback: stability
          return 0;
        });

        // Build embed description
        let description = '';
        for (let i = 0; i < sorted.length; i++) {
          const r = sorted[i];
          const rank = i + 1;
          const record = `${r.wins}-${r.losses}`;
          const userRecord = `${r.user_wins}-${r.user_losses}`;
          const displayName = r.taken_by_name || r.team_name;
          const teamName = r.team_name;
          
          // Format: "1. displayName teamName record (vsUserRecord)"
          description += `${rank.toString().padEnd(2)} ${displayName.padEnd(21)} ${teamName.padEnd(19)} ${record.padEnd(4)} (${userRecord})\n`;
        }

        if (!description) description = 'No user teams found.';
        else description += `\n*Record in parentheses is vs user teams only*`;

        const embed = {
          title: `🏆 Headset Dynasty Rankings – Season ${currentSeason}`,
          description: '```\n' + description + '\n```',
          color: 0xffd700,
          timestamp: new Date()
        };

        if (isPublic) {
          const generalChannel = interaction.guild.channels.cache.find(ch => ch.name === 'general');
          if (generalChannel && generalChannel.isTextBased()) {
            await generalChannel.send({ embeds: [embed] });
            return interaction.editReply({ content: 'Rankings posted to #general.' });
          } else {
            return interaction.editReply({ content: 'Error: Could not find #general channel.' });
          }
        } else {
          return interaction.editReply({ embeds: [embed] });
        }
      } catch (err) {
        console.error('ranking command error:', err);
        return interaction.editReply(`Error generating rankings: ${err.message}`);
      }
    }

    // ---------------------------
    // /ranking-all-time
    // ---------------------------
    if (name === 'ranking-all-time') {
      if (!interaction.member || !interaction.member.permissions || !interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ ephemeral: true, content: "Only the commissioner can view rankings." });
      }

      const isPublic = interaction.options.getBoolean('public') || false;
      await interaction.deferReply({ flags: isPublic ? 0 : 64 }); // 64 = ephemeral

      try {
        // Fetch all records (all seasons) and aggregate by user
        const { data: allRecords, error: recordsErr } = await supabase.from('records').select('*');
        if (recordsErr) throw recordsErr;

        // Fetch all results (all seasons) for H2H
        const { data: results, error: resultsErr } = await supabase.from('results').select('*');
        if (resultsErr) throw resultsErr;

        // Build map of H2H records by user
        const h2hMap = {};
        if (results) {
          for (const r of results) {
            if (r.taken_by) {
              // Try to find opponent's taken_by from records
              const oppRecord = (allRecords || []).find(rec => rec.team_id === r.opponent_team_id);
              if (oppRecord && oppRecord.taken_by) {
                const key = `${r.taken_by}_vs_${oppRecord.taken_by}`;
                if (!h2hMap[key]) h2hMap[key] = { wins: 0, losses: 0 };
                if (r.result === 'W') h2hMap[key].wins++;
                else h2hMap[key].losses++;
              }
            }
          }
        }

        // Helper to calculate H2H win%
        const getH2HWinPct = (userAId, userBId) => {
          const key = `${userAId}_vs_${userBId}`;
          if (!h2hMap[key]) return 0;
          const { wins, losses } = h2hMap[key];
          return (wins + losses) > 0 ? wins / (wins + losses) : 0;
        };

        // Fetch current users (only those with teams)
        const { data: currentUsers, error: usersErr } = await supabase.from('teams').select('taken_by').not('taken_by', 'is', null);
        if (usersErr) throw usersErr;
        const currentUserIds = new Set((currentUsers || []).map(u => u.taken_by));

        // Aggregate records by user (sum across all seasons) - only for current users
        const userAggregates = {};
        if (allRecords) {
          for (const r of allRecords) {
            const userId = r.taken_by;
            // Only include users who currently have a team
            if (!currentUserIds.has(userId)) continue;
            
            if (!userAggregates[userId]) {
              userAggregates[userId] = {
                taken_by: userId,
                taken_by_name: r.taken_by_name || 'Unknown',
                team_name: r.team_name,
                wins: 0,
                losses: 0,
                user_wins: 0,
                user_losses: 0
              };
            }
            userAggregates[userId].wins += r.wins;
            userAggregates[userId].losses += r.losses;
            userAggregates[userId].user_wins += r.user_wins;
            userAggregates[userId].user_losses += r.user_losses;
          }
        }

        // Sort by: total wins (unless within 1 win, then win%), then user-vs-user win%, then H2H
        const sorted = Object.values(userAggregates).sort((a, b) => {
          // First: check if wins are within 1 of each other
          const winDiff = Math.abs(a.wins - b.wins);
          
          if (winDiff <= 1) {
            // Within 1 win: use win percentage as primary
            const aWinPct = (a.wins + a.losses) > 0 ? a.wins / (a.wins + a.losses) : 0;
            const bWinPct = (b.wins + b.losses) > 0 ? b.wins / (b.wins + b.losses) : 0;
            if (aWinPct !== bWinPct) return bWinPct - aWinPct;
          } else {
            // More than 1 win difference: use total wins
            return b.wins - a.wins;
          }

          // Third: user-vs-user win percentage (descending)
          const aUserPct = (a.user_wins + a.user_losses) > 0 ? a.user_wins / (a.user_wins + a.user_losses) : 0;
          const bUserPct = (b.user_wins + b.user_losses) > 0 ? b.user_wins / (b.user_wins + b.user_losses) : 0;
          if (aUserPct !== bUserPct) return bUserPct - aUserPct;

          // Fourth: H2H tiebreaker
          const aH2H = getH2HWinPct(a.taken_by, b.taken_by);
          const bH2H = getH2HWinPct(b.taken_by, a.taken_by);
          if (aH2H !== bH2H) return bH2H - aH2H;

          return 0;
        });

        // Build embed
        let description = '';
        for (let i = 0; i < sorted.length; i++) {
          const r = sorted[i];
          const rank = i + 1;
          const record = `${r.wins}-${r.losses}`;
          const userRecord = `${r.user_wins}-${r.user_losses}`;
          const displayName = r.taken_by_name || 'Unknown';
          
          // Format: "1. displayName record (vsUserRecord)" - no team name for all-time
          description += `${rank.toString().padEnd(3, ' ')} ${displayName.padEnd(20, ' ')} ${record.padEnd(6, ' ')} (${userRecord})\n`;
        }

        if (!description) description = 'No user teams found.';
        else description += `\n*Record in parentheses is vs user teams only*`;

        const embed = {
          title: `👑 Headset Dynasty All-Time Rankings`,
          description: '```\n' + description + '\n```',
          color: 0xffd700,
          timestamp: new Date()
        };

        if (isPublic) {
          const generalChannel = interaction.guild.channels.cache.find(ch => ch.name === 'general');
          if (generalChannel && generalChannel.isTextBased()) {
            await generalChannel.send({ embeds: [embed] });
            return interaction.editReply({ content: 'All-time rankings posted to #general.' });
          } else {
            return interaction.editReply({ content: 'Error: Could not find #general channel.' });
          }
        } else {
          return interaction.editReply({ embeds: [embed] });
        }
      } catch (err) {
        console.error('ranking-all-time command error:', err);
        return interaction.editReply(`Error generating all-time rankings: ${err.message}`);
      }
    }

    // ---------------------------
    // /move-coach
    // ---------------------------
    if (name === 'move-coach') {
      if (!interaction.member || !interaction.member.permissions || !interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ ephemeral: true, content: "Only the commissioner can move coaches." });
      }

      await interaction.deferReply({ flags: 64 }); // ephemeral

      try {
        const coachName = interaction.options.getString('coach');
        const newTeamId = interaction.options.getString('new_team');

        // Find the coach's current team by taken_by_name
        const { data: coachTeams, error: coachErr } = await supabase
          .from('teams')
          .select('*')
          .eq('taken_by_name', coachName);
        if (coachErr) throw coachErr;

        if (!coachTeams || coachTeams.length === 0) {
          return interaction.editReply(`Coach "${coachName}" not found.`);
        }

        const oldTeam = coachTeams[0];
        const coachUserId = oldTeam.taken_by;

        // Fetch new team details
        const { data: newTeam, error: newTeamErr } = await supabase
          .from('teams')
          .select('*')
          .eq('id', newTeamId)
          .maybeSingle();
        if (newTeamErr) throw newTeamErr;

        if (!newTeam) {
          return interaction.editReply(`New team not found.`);
        }

        // Update old team: remove coach
        const { error: oldUpdateErr } = await supabase
          .from('teams')
          .update({ taken_by: null, taken_by_name: null })
          .eq('id', oldTeam.id);
        if (oldUpdateErr) throw oldUpdateErr;

        // Update new team: add coach
        const { error: newUpdateErr } = await supabase
          .from('teams')
          .update({ taken_by: coachUserId, taken_by_name: coachName })
          .eq('id', newTeamId);
        if (newUpdateErr) throw newUpdateErr;

        // Find and rename the team channel
        const guild = interaction.guild;
        if (guild) {
          const teamChannelCategory = guild.channels.cache.find(ch => ch.name === 'Team Channels' && ch.isCategory());
          if (teamChannelCategory) {
            // Look for a channel with the old team name
            const oldChannel = guild.channels.cache.find(
              ch => ch.parent?.id === teamChannelCategory.id && ch.name.toLowerCase() === oldTeam.name.toLowerCase()
            );
            if (oldChannel) {
              await oldChannel.setName(newTeam.name);
            }
          }
        }

        return interaction.editReply(
          `✅ Moved **${coachName}** from **${oldTeam.name}** to **${newTeam.name}**. Channel renamed.`
        );
      } catch (err) {
        console.error('move-coach command error:', err);
        return interaction.editReply(`Error moving coach: ${err.message}`);
      }
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
        // Find or create the Team Channels category
        let teamChannelsCategory = guild.channels.cache.find(c => c.name === 'Team Channels' && c.type === ChannelType.GuildCategory);
        if (!teamChannelsCategory) {
          teamChannelsCategory = await guild.channels.create({
            name: 'Team Channels',
            type: ChannelType.GuildCategory
          });
        }
        const newChannel = await guild.channels.create({
          name: channelName,
          type: ChannelType.GuildText,
          parent: teamChannelsCategory.id,
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
// Global error handlers and graceful shutdown
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', async (err) => {
  console.error('Uncaught Exception:', err);
  try {
    if (client && client.destroy) await client.destroy();
  } catch (e) {
    console.error('Error during client.destroy() after uncaughtException:', e);
  }
  // Exit with failure - let the hosting platform restart the process
  process.exit(1);
});

client.on('error', (err) => console.error('Discord client error:', err));
client.on('warn', (info) => console.warn('Discord client warning:', info));
client.on('shardError', (error) => console.error('Discord client shardError:', error));

const _shutdown = async (signal) => {
  console.log(`Received ${signal} - shutting down gracefully...`);
  try {
    if (client && client.destroy) await client.destroy();
  } catch (e) {
    console.error('Error during client.destroy() in shutdown:', e);
  }
  // Give logs a moment to flush
  setTimeout(() => process.exit(0), 500);
};

process.on('SIGTERM', () => _shutdown('SIGTERM'));
process.on('SIGINT', () => _shutdown('SIGINT'));

client.login(process.env.DISCORD_TOKEN).catch(e => {
  console.error("Failed to login:", e);
});
