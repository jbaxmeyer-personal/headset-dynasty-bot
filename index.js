require('dotenv').config();
const http = require('http');

const PORT = process.env.PORT || 3000;

// Minimal health server for Render
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

const { createClient } = require("@supabase/supabase-js");

// Create Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildMessageReactions
  ],
  partials: [
    Partials.Message,
    Partials.Channel,
    Partials.Reaction
  ]
});

const jobOfferUsed = new Set();

// ---------------------------------------------------------
// REGISTER GUILD COMMANDS
// ---------------------------------------------------------

const commands = [
  new SlashCommandBuilder()
    .setName('joboffers')
    .setDescription('Get your Headset Dynasty job offers')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('resetteam')
    .setDescription('Reset a user’s team')
    .addUserOption(option =>
      option
        .setName('coach')
        .setDescription('The coach to reset')
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('listteams')
    .setDescription('Post a list of taken and available teams'),

  new SlashCommandBuilder()
    .setName('game-result')
    .setDescription('Submit a game result')
    .addStringOption(option =>
      option.setName('opponent')
        .setDescription('Opponent team')
        .setRequired(true)
        .setAutocomplete(true)
    )
    .addIntegerOption(option =>
      option.setName('your_score')
        .setDescription('Your team score')
        .setRequired(true)
    )
    .addIntegerOption(option =>
      option.setName('opponent_score')
        .setDescription('Opponent score')
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('summary')
        .setDescription('Game summary')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('press-release')
    .setDescription('Post a press release')
    .addStringOption(option =>
      option.setName('text')
        .setDescription('Press release text')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('advance')
    .setDescription('Advance the week (commissioner only)'),

  new SlashCommandBuilder()
    .setName('season-advance')
    .setDescription('Advance the season (commissioner only)')
].map(c => c.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log("Registering slash commands...");
    await rest.put(
      Routes.applicationGuildCommands(
        process.env.CLIENT_ID,
        process.env.GUILD_ID
      ),
      { body: commands }
    );
    console.log("Commands registered.");
  } catch (err) {
    console.error(err);
  }
})();

// ---------------------------------------------------------
// BOT READY
// ---------------------------------------------------------

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

// ---------------------------------------------------------
// AUTOCOMPLETE
// ---------------------------------------------------------

client.on('interactionCreate', async interaction => {
  if (interaction.isAutocomplete()) {
    const focused = interaction.options.getFocused(true);
    if (focused.name === "opponent") {
      const search = focused.value.toLowerCase();
      const { data: teamsData, error } = await supabase.from('teams').select('*');
      if (error) console.error(error);

      const list = teamsData.filter(t => t.name.toLowerCase().includes(search));
      return interaction.respond(
        list.slice(0, 25).map(x => ({ name: x.name, value: x.name }))
      );
    }
  }

  if (!interaction.isCommand()) return;
  const name = interaction.commandName;

  // ---------------------------------------------------------
  // /joboffers
  // ---------------------------------------------------------
  if (name === "joboffers") {
    if (jobOfferUsed.has(interaction.user.id)) {
      return interaction.reply({ ephemeral: true, content: "⛔ You already received a job offer." });
    }

    jobOfferUsed.add(interaction.user.id);

    const { data: available, error } = await supabase
      .from('teams')
      .select('*')
      .lte('stars', 2.0)
      .is('takenBy', null);

    if (error) return interaction.reply({ ephemeral: true, content: `Error: ${error.message}` });
    if (!available || available.length === 0) return interaction.reply({ ephemeral: true, content: "No teams available." });

    const options = [...available];
    const offers = [];
    for (let i = 0; i < 5 && options.length > 0; i++) {
      const idx = Math.floor(Math.random() * options.length);
      offers.push(options[idx]);
      options.splice(idx, 1);
    }

    if (!client.userOffers) client.userOffers = {};
    client.userOffers[interaction.user.id] = offers;

    try {
      await interaction.user.send(
        `Your job offers:\n\n` +
        offers.map((t, i) => `${i + 1}️⃣ ${t.name}`).join("\n\n") +
        "\n\nReply with the number to accept."
      );
      return interaction.reply({ ephemeral: true, content: "Check your DMs!" });
    } catch (err) {
      return interaction.reply({ ephemeral: true, content: "I cannot DM you. Enable DMs." });
    }
  }

  // ---------------------------------------------------------
  // /resetteam
  // ---------------------------------------------------------
  if (name === "resetteam") {
    const coach = interaction.options.getUser("coach");
    const { data: teamData, error } = await supabase
      .from('teams')
      .select('*')
      .eq('takenBy', coach.id)
      .limit(1)
      .single();

    if (error || !teamData) return interaction.reply({ ephemeral: true, content: `${coach.username} has no team.` });

    await supabase.from('teams').update({ takenBy: null }).eq('id', teamData.id);
    jobOfferUsed.delete(coach.id);

    return interaction.reply({ ephemeral: true, content: `Reset team ${teamData.name}.` });
  }

  // ---------------------------------------------------------
  // /listteams
  // ---------------------------------------------------------
  if (name === "listteams") {
    await interaction.deferReply({ ephemeral: true });
    const { data: teamsData, error } = await supabase.from('teams').select('*');
    if (error) return interaction.editReply(`Error: ${error.message}`);

    // Group by conference
    const confMap = {};
    teamsData.forEach(t => {
      if (!confMap[t.conference]) confMap[t.conference] = [];
      confMap[t.conference].push(t);
    });

    const guild = client.guilds.cache.first();
    if (!guild) return;

    const channel = guild.channels.cache.find(c => c.name === "member-list");
    if (!channel) return;

    let text = "";
    for (const [conf, tList] of Object.entries(confMap)) {
      text += `\n__**${conf}**__\n`;
      const low = tList.filter(t => t.stars <= 2.0);
      for (const t of low) {
        text += t.takenBy ? `❌ **${t.name}** — <@${t.takenBy}>\n` : `🟢 **${t.name}** — Available\n`;
      }
    }

    const embed = { title: "2★ and Below Teams", description: text, color: 0x2b2d31, timestamp: new Date() };
    await channel.send({ embeds: [embed] });
    return interaction.editReply("Team list updated.");
  }

  // ---------------------------------------------------------
  // /game-result
  // ---------------------------------------------------------
  if (name === "game-result") {
    const opponentName = interaction.options.getString("opponent");
    const userScore = interaction.options.getInteger("your_score");
    const opponentScore = interaction.options.getInteger("opponent_score");
    const summary = interaction.options.getString("summary");

    const seasonResp = await supabase.from('meta').select('value').eq('key','current_season').single();
    const currentSeason = seasonResp.data?.value || 1;

    const { data: userTeam } = await supabase.from('teams').select('*').eq('takenBy', interaction.user.id).single();
    const { data: opponentTeam } = await supabase.from('teams').select('*').eq('name', opponentName).single();

    if (!userTeam || !opponentTeam) return interaction.reply({ ephemeral: true, content: "Teams not found." });

    const resultText = userScore > opponentScore ? "win" : "loss";

    await supabase.from('results').insert([{
      season: currentSeason,
      user_team_id: userTeam.id,
      user_team_name: userTeam.name,
      opponent_team_id: opponentTeam.id,
      opponent_team_name: opponentTeam.name,
      user_score: userScore,
      opponent_score: opponentScore,
      result: resultText,
      summary
    }]);

    return interaction.reply({ ephemeral: true, content: `Result recorded: **${userTeam.name}** ${resultText} vs ${opponentTeam.name}` });
  }

  // ---------------------------------------------------------
  // /press-release
  // ---------------------------------------------------------
  if (name === "press-release") {
    const text = interaction.options.getString("text");
    const seasonResp = await supabase.from('meta').select('value').eq('key','current_season').single();
    const weekResp = await supabase.from('meta').select('value').eq('key','current_week').single();
    const season = seasonResp.data?.value || 1;
    const week = weekResp.data?.value || 1;

    await supabase.from('news_feed').insert([{ season, week, text }]);
    return interaction.reply({ ephemeral: true, content: "Press release posted." });
  }

  // ---------------------------------------------------------
  // /advance
  // ---------------------------------------------------------
  if (name === "advance") {
    if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ ephemeral: true, content: "Only the commissioner can advance the week." });
    }

    const weekResp = await supabase.from('meta').select('value').eq('key','current_week').single();
    const currentWeek = weekResp.data?.value || 1;

    // Post advance message
    const guild = client.guilds.cache.first();
    const advanceChannel = guild.channels.cache.find(c => c.name === 'advance');
    if (advanceChannel) await advanceChannel.send("We have advanced to the next week");

    // Weekly Summary
    const newsResp = await supabase.from('news_feed').select('*').eq('week', currentWeek);
    const summaryText = newsResp.data.map(n => n.text).join("\n") || "No news this week.";

    const newsFeedChannel = guild.channels.cache.find(c => c.name === 'news-feed');
    if (newsFeedChannel) await newsFeedChannel.send(`**Weekly Summary (Week ${currentWeek})**\n\n${summaryText}`);

    // Increment week
    await supabase.from('meta').update({ value: currentWeek + 1 }).eq('key','current_week');

    return interaction.reply({ ephemeral: true, content: `Week ${currentWeek} advanced.` });
  }

  // ---------------------------------------------------------
  // /season-advance
  // ---------------------------------------------------------
  if (name === "season-advance") {
    if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ ephemeral: true, content: "Only the commissioner can advance the season." });
    }

    const seasonResp = await supabase.from('meta').select('value').eq('key','current_season').single();
    const currentSeason = seasonResp.data?.value || 1;

    const weekResp = await supabase.from('meta').select('value').eq('key','current_week').single();
    const currentWeek = weekResp.data?.value || 1;

    await supabase.from('meta').update({ value: currentSeason + 1 }).eq('key','current_season');
    await supabase.from('meta').update({ value: 1 }).eq('key','current_week'); // Reset week to 1

    return interaction.reply({ ephemeral: true, content: `Season advanced to ${currentSeason + 1}, week reset to 1.` });
  }
});

// ---------------------------------------------------------
// DM ACCEPT OFFER
// ---------------------------------------------------------
client.on("messageCreate", async msg => {
  if (msg.guild || msg.author.bot) return;

  const userId = msg.author.id;
  if (!client.userOffers || !client.userOffers[userId]) return;

  const offers = client.userOffers[userId];
  const choice = parseInt(msg.content);

  if (isNaN(choice) || choice < 1 || choice > offers.length) {
    return msg.reply("Reply with the number of the team you choose.");
  }

  const team = offers[choice - 1];

  await supabase.from('teams').update({ takenBy: userId }).eq('id', team.id);

  msg.reply(`You claimed **${team.name}**!`);
  delete client.userOffers[userId];
});

client.login(process.env.DISCORD_TOKEN);
