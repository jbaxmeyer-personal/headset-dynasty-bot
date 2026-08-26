// index.js - CFB27 multi-server dynasty bot
require('dotenv').config();
const http = require('http');

// health server for Fly.io / Render
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
  }, 4 * 60 * 1000);
  console.log('Self-pinger enabled for', process.env.SELF_PING_URL);
}

// ---------------------------------------------------------
// DISCORD + SUPABASE
// ---------------------------------------------------------
const {
  Client,
  GatewayIntentBits,
  ChannelType,
  PermissionFlagsBits,
  Partials,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ChannelSelectMenuBuilder,
  RoleSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildMessageReactions
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.GuildMember, Partials.User]
});


/* ---------------------------------------------------------
 * INLINE GUILD COMMAND REGISTRATION (commented out)
 * Commands are now registered globally via deploy-commands.js.
 * Run `node deploy-commands.js` once to push commands to Discord.
 * Global commands take up to 1 hour to propagate to all servers.
 * ---------------------------------------------------------
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
    .addBooleanOption(opt => opt.setName('public').setDescription('Post to #general (default: private)').setRequired(false)),

  new SlashCommandBuilder()
    .setName('ranking-all-time')
    .setDescription('Show all-time rankings across seasons (commissioner only)')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addBooleanOption(opt => opt.setName('public').setDescription('Post to #general (default: private)').setRequired(false)),

  new SlashCommandBuilder()
    .setName('move-coach')
    .setDescription('Move a coach to a new team (commissioner only)')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(opt => opt.setName('coach').setDescription('Select the coach to move').setRequired(true).setAutocomplete(true))
    .addStringOption(opt => opt.setName('new_team').setDescription('Select the new team').setRequired(true).setAutocomplete(true)),

  new SlashCommandBuilder()
    .setName('any-game-result')
    .setDescription('Enter a game result for any team (commissioner only)')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(option => option.setName('home_team').setDescription('Home team').setRequired(true).setAutocomplete(true))
    .addStringOption(option => option.setName('away_team').setDescription('Away team').setRequired(true).setAutocomplete(true))
    .addIntegerOption(option => option.setName('home_score').setDescription('Home team score').setRequired(true))
    .addIntegerOption(option => option.setName('away_score').setDescription('Away team score').setRequired(true))
    .addIntegerOption(option => option.setName('week').setDescription('Week number').setRequired(true))
    .addStringOption(option => option.setName('summary').setDescription('Game summary').setRequired(true))
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
*/

/* ---------------------------------------------------------
 * READY HANDLER - single-guild role permission setup (commented out)
 * Replaced by setDefaultMemberPermissions in deploy-commands.js.
 * ---------------------------------------------------------
client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  if (!process.env.CLIENT_SECRET) {
    console.log("Skipping automatic command-permission setup: no CLIENT_SECRET provided.");
    return;
  }
  try {
    const guild = client.guilds.cache.first();
    if (!guild) { console.warn("No guild found in cache. Skipping permission setup."); return; }
    const headCoachRole = guild.roles.cache.find(r => r.name === 'head coach');
    if (!headCoachRole) { console.warn("'head coach' role not found. Skipping permission setup."); return; }
    const guildCommands = await guild.commands.fetch();
    if (guildCommands.size === 0) { console.warn("No guild commands found."); return; }
    const publicCommands = ['game-result', 'press-release'];
    for (const cmd of guildCommands.values()) {
      if (publicCommands.includes(cmd.name)) {
        try {
          await rest.put(
            Routes.applicationCommandPermissions(process.env.CLIENT_ID, process.env.GUILD_ID, cmd.id),
            { body: { permissions: [
              { id: headCoachRole.id, type: 1, permission: true },
              { id: guild.id, type: 1, permission: false }
            ]}}
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
*/

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

// ---------------------------------------------------------
// HELPERS
// ---------------------------------------------------------

function pickRandom(arr, n) {
  const copy = [...arr];
  const out = [];
  for (let i = 0; i < n && copy.length > 0; i++) {
    const idx = Math.floor(Math.random() * copy.length);
    out.push(copy.splice(idx, 1)[0]);
  }
  return out;
}

// ---------------------------------------------------------
// CFB27 SCHEME DATA (game-defined — do not edit without checking in-game)
// ---------------------------------------------------------
const OFFENSE_SCHEMES = [
  'Option', 'Spread', 'Veer and Shoot', 'Air Raid',
  'Pro Style', 'Power Spread', 'Run and Shoot', 'Pistol'
];

const DEFENSE_SCHEMES = [
  '3-2-6', '3-3-5', '3-3-5 Tite', '3-4',
  '3-4 Multiple', '4-2-5', '4-3', '4-3 Multiple'
];

// Compatible schools for each preferred scheme (includes self + adjacent + Multiple).
// "Multiple" as a school's scheme is always compatible with any preference.
const OFFENSE_COMPATIBLE = {
  'Option':         ['Option', 'Spread', 'Pistol', 'Multiple'],
  'Spread':         ['Spread', 'Air Raid', 'Veer and Shoot', 'Multiple'],
  'Veer and Shoot': ['Veer and Shoot', 'Spread', 'Pistol', 'Multiple'],
  'Air Raid':       ['Air Raid', 'Spread', 'Run and Shoot', 'Multiple'],
  'Pro Style':      ['Pro Style', 'Power Spread', 'Pistol', 'Multiple'],
  'Power Spread':   ['Power Spread', 'Pro Style', 'Spread', 'Multiple'],
  'Run and Shoot':  ['Run and Shoot', 'Spread', 'Air Raid', 'Multiple'],
  'Pistol':         ['Pistol', 'Pro Style', 'Option', 'Multiple'],
};

const DEFENSE_COMPATIBLE = {
  '3-2-6':       ['3-2-6', '3-3-5', '4-2-5', 'Multiple'],
  '3-3-5':       ['3-3-5', '3-3-5 Tite', '3-2-6', 'Multiple'],
  '3-3-5 Tite':  ['3-3-5 Tite', '3-3-5', '3-2-6', 'Multiple'],
  '3-4':         ['3-4', '3-4 Multiple', '3-3-5', 'Multiple'],
  '3-4 Multiple':['3-4 Multiple', '3-4', '3-3-5', 'Multiple'],
  '4-2-5':       ['4-2-5', '4-3', '4-3 Multiple', 'Multiple'],
  '4-3':         ['4-3', '4-3 Multiple', '4-2-5', 'Multiple'],
  '4-3 Multiple':['4-3 Multiple', '4-3', '4-2-5', 'Multiple'],
};

// ---------------------------------------------------------
// HELP TEXT (shared between /help and guildCreate DM)
// ---------------------------------------------------------
const HELP_TEXT =
  `## CFB27 Job Offer Bot — Setup Guide\n\n` +
  `**Step 1: Run \`/setup\`**\n` +
  `First you'll see a channel & role picker:\n` +
  `- Select your existing **#general**, **#rules**, **#team-list** channels and **@coach** role from the dropdowns\n` +
  `- Or click **Auto-create missing** to have the bot create any that don't exist yet\n` +
  `- Then click **Continue to settings →**\n\n` +
  `The settings panel lets you configure:\n` +
  `- **Coaching Roles** — which roles coaches can hold: HC, OC+DC, or all three\n` +
  `- **Conferences** — limit schools by conference, or leave blank for all\n` +
  `- **Star Range** — school prestige filter (pick your min and max)\n` +
  `- **Offer Count** — how many job offers each user receives (1–5)\n` +
  `- **Scheme Filtering** — only offer schools that match a coach's scheme preference\n\n` +
  `**Step 2: Post a message in #rules**\n` +
  `Tell your members to react ✅ to a pinned message in #rules to get job offers. ` +
  `When someone reacts, the bot DMs them their job offers automatically.\n\n` +
  `**How the offer flow works:**\n` +
  `1. User reacts ✅ in #rules\n` +
  `2. Bot DMs them a list of available schools\n` +
  `3. User replies with a number to pick their school\n` +
  `4. If multiple roles are enabled, bot asks which role they want\n` +
  `5. Bot assigns nickname, creates a private team channel, gives @coach role, and announces in #general\n\n` +
  `**Admin commands:**\n` +
  `\`/setup\` — Run again anytime to update settings\n` +
  `\`/joboffers @user\` — Manually send job offers to a specific user\n` +
  `\`/resetteam @user\` — Remove a coach (deletes channel, clears nickname, removes @coach role)\n` +
  `\`/move-coach @user\` — Move a coach to a different school\n` +
  `\`/listteams\` — Refresh the #team-list channel\n\n` +
  `**Need help?** Run \`/help\` anytime in your server.`;

// ---------------------------------------------------------
// LEAGUE CONFIG CACHE (one entry per guild ID)
// ---------------------------------------------------------
const leagueCache = new Map();

async function getLeague(guildId) {
  if (leagueCache.has(guildId)) return leagueCache.get(guildId);
  const { data, error } = await supabase
    .from('leagues')
    .select('*')
    .eq('guild_id', guildId)
    .maybeSingle();
  if (error) { console.error('getLeague error:', error); return null; }
  if (data) leagueCache.set(guildId, data);
  return data || null;
}

function invalidateLeagueCache(guildId) {
  leagueCache.delete(guildId);
}

// ---------------------------------------------------------
// AUTHORIZATION HELPER
// Allows server admins OR anyone with a role named "Commissioner".
// ---------------------------------------------------------
function isAuthorized(member) {
  if (!member) return false;
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  return member.roles.cache.some(r => r.name.toLowerCase() === 'commissioner');
}

// 7-day offer expiry — offers older than this get regenerated on next react
const OFFER_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------
// FLOW STATE PERSISTENCE (feature 9)
// Saves the user's current DM flow step to user_offers so a bot
// restart doesn't silently drop them mid-conversation.
// ---------------------------------------------------------
async function persistFlowState(leagueId, userId, offerData) {
  await supabase.from('user_offers').update({
    step: offerData.step || null,
    role: offerData.role || null,
    offense_scheme: offerData.preferredOffenseScheme || null,
    defense_scheme: offerData.preferredDefenseScheme || null,
    chosen_school_id: offerData.chosenTeam?.id || null,
  }).eq('league_id', leagueId).eq('user_id', userId);
}

async function restoreFlowFromDB(userId) {
  const { data } = await supabase
    .from('user_offers')
    .select('*, leagues!inner(guild_id)')
    .eq('user_id', userId)
    .not('step', 'is', null)
    .maybeSingle();

  if (!data || !data.leagues) return false;

  const guildId = data.leagues.guild_id;
  let availableSchools = [];
  let chosenSchool = null;

  if (data.school_ids && data.school_ids.length > 0) {
    const { data: schools } = await supabase.from('schools').select('*').in('id', data.school_ids);
    const { data: claimed } = await supabase.from('league_teams').select('school_id').eq('league_id', data.league_id).in('school_id', data.school_ids);
    const claimedIds = new Set((claimed || []).map(r => r.school_id));
    availableSchools = (schools || []).filter(s => !claimedIds.has(s.id));
    if (data.chosen_school_id) chosenSchool = (schools || []).find(s => s.id === data.chosen_school_id) || null;
  }

  if (!client.userOffers) client.userOffers = {};
  client.userOffers[userId] = {
    guildId,
    step: data.step,
    teams: availableSchools,
    chosenTeam: chosenSchool,
    role: data.role || null,
    preferredOffenseScheme: data.offense_scheme || null,
    preferredDefenseScheme: data.defense_scheme || null,
    savedSchoolIds: data.school_ids || null,
  };

  return true;
}

async function resendFlowPrompt(user, league, offerData) {
  const roles = (league.allowed_roles || 'HC').split(',').map(r => r.trim());

  if (offerData.step === 'choose_team') {
    if (offerData.teams.length === 0) {
      await user.send('*(Picking up where we left off — but all your offers were claimed while you were away. Contact a league admin for a fresh set.)*');
      return;
    }
    await user.send('*(Picking up where we left off — here are your job offers:)*');
    await sendOfferDM(user, offerData.teams);
  } else if (offerData.step === 'choose_role_after_team') {
    const school = offerData.chosenTeam;
    await user.send(`*(Picking up where we left off)*\nYou selected **${school?.name || 'your team'}**! What role would you like?\nReply with one of: **${roles.join(', ')}**`);
  }
}

// ---------------------------------------------------------
// AVAILABLE SCHOOLS QUERY
// Returns up to `count` random schools matching league filters,
// scheme preferences (if provided), and not yet claimed.
// schemePrefs: { offenseScheme, defenseScheme }
// ---------------------------------------------------------
async function getAvailableSchools(league, count, schemePrefs = {}) {
  let q = supabase.from('schools').select('*')
    .gte('stars', league.min_stars ?? 0)
    .lte('stars', league.max_stars ?? 5);

  if (league.allowed_conferences) {
    const confs = league.allowed_conferences.split(',').map(c => c.trim()).filter(Boolean);
    q = q.in('conference', confs);
  }

  // Scheme compatibility filtering
  if (schemePrefs.offenseScheme && OFFENSE_COMPATIBLE[schemePrefs.offenseScheme]) {
    q = q.in('offense_scheme', OFFENSE_COMPATIBLE[schemePrefs.offenseScheme]);
  }
  if (schemePrefs.defenseScheme && DEFENSE_COMPATIBLE[schemePrefs.defenseScheme]) {
    q = q.in('defense_scheme', DEFENSE_COMPATIBLE[schemePrefs.defenseScheme]);
  }

  // Exclude already-claimed schools in this league
  const { data: claimed } = await supabase
    .from('league_teams')
    .select('school_id')
    .eq('league_id', league.id);

  const claimedIds = (claimed || []).map(r => r.school_id);
  if (claimedIds.length) {
    q = q.not('id', 'in', `(${claimedIds.join(',')})`);
  }

  const { data, error } = await q;
  if (error) throw error;
  return pickRandom(data || [], count);
}

// ---------------------------------------------------------
// SETUP UI HELPERS
// Builds the ephemeral dropdown panel for /setup.
// ---------------------------------------------------------
const STAR_VALUES = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];

const CFB_CONFERENCES_FALLBACK = [
  'SEC','Big Ten','ACC','Big 12','Pac-12',
  'American Athletic','Mountain West','Sun Belt','MAC','Conference USA','Independents'
];

async function getConferencesForDropdown() {
  const { data } = await supabase.from('schools').select('conference').not('conference', 'is', null);
  const fromDb = [...new Set((data || []).map(r => r.conference).filter(Boolean))].sort();
  return fromDb.length > 0 ? fromDb : CFB_CONFERENCES_FALLBACK;
}

function buildSetupComponents(cfg, conferences) {
  const selectedConfs = cfg.allowedConferences ? cfg.allowedConferences.split(',').map(c => c.trim()) : [];

  const rolesMenu = new StringSelectMenuBuilder()
    .setCustomId('setup_roles')
    .setPlaceholder('Coaching roles available in this league')
    .addOptions(
      new StringSelectMenuOptionBuilder().setLabel('HC only').setValue('HC').setDescription('Head Coach only').setDefault(cfg.allowedRoles === 'HC'),
      new StringSelectMenuOptionBuilder().setLabel('OC & DC only').setValue('OC,DC').setDescription('Offensive and Defensive Coordinators only').setDefault(cfg.allowedRoles === 'OC,DC'),
      new StringSelectMenuOptionBuilder().setLabel('HC, OC & DC').setValue('HC,OC,DC').setDescription('All three coaching roles available').setDefault(cfg.allowedRoles === 'HC,OC,DC'),
    );

  const confOptions = conferences.map(c =>
    new StringSelectMenuOptionBuilder().setLabel(c).setValue(c).setDefault(selectedConfs.includes(c))
  );
  const confMenu = new StringSelectMenuBuilder()
    .setCustomId('setup_conferences')
    .setPlaceholder(selectedConfs.length > 0 ? `${selectedConfs.length} conference(s) selected` : 'All conferences (default — leave blank for all)')
    .setMinValues(0)
    .setMaxValues(conferences.length)
    .addOptions(confOptions);

  const starsMenu = new StringSelectMenuBuilder()
    .setCustomId('setup_star_range')
    .setPlaceholder('Prestige range — pick 2 values (lower = min, higher = max)')
    .setMinValues(2)
    .setMaxValues(2)
    .addOptions(STAR_VALUES.map(v =>
      new StringSelectMenuOptionBuilder()
        .setLabel(`${v} ⭐`)
        .setValue(String(v))
        .setDefault(v === cfg.minStars || v === cfg.maxStars)
    ));

  const offerMenu = new StringSelectMenuBuilder()
    .setCustomId('setup_offer_count')
    .setPlaceholder('How many job offers per user?')
    .addOptions([1,2,3,4,5].map(n =>
      new StringSelectMenuOptionBuilder().setLabel(`${n} offer${n > 1 ? 's' : ''} per user`).setValue(String(n)).setDefault(cfg.offerCount === n)
    ));

  const schemeMenu = new StringSelectMenuBuilder()
    .setCustomId('setup_scheme')
    .setPlaceholder('Scheme compatibility filtering')
    .addOptions(
      new StringSelectMenuOptionBuilder().setLabel('No scheme filtering').setValue('false').setDescription('Offer any schools matching other filters').setDefault(!cfg.schemeFilter),
      new StringSelectMenuOptionBuilder().setLabel('Filter by scheme preference').setValue('true').setDescription('Only offer schools that match the coach\'s scheme').setDefault(cfg.schemeFilter),
    );

  return [
    new ActionRowBuilder().addComponents(rolesMenu),
    new ActionRowBuilder().addComponents(confMenu),
    new ActionRowBuilder().addComponents(starsMenu),
    new ActionRowBuilder().addComponents(offerMenu),
    new ActionRowBuilder().addComponents(schemeMenu),
  ];
}

function buildSetupContent(cfg, guildName, channelLine) {
  const confDisplay = cfg.allowedConferences || 'All conferences';
  return (
    `## 🏈 Dynasty League Setup — ${guildName || 'this server'}\n` +
    `${channelLine}\n` +
    `**Current settings** (selections save automatically):\n` +
    `- Coaching roles: **${cfg.allowedRoles}**\n` +
    `- Conferences: **${confDisplay}**\n` +
    `- Prestige range: **${cfg.minStars}–${cfg.maxStars} ⭐**\n` +
    `- Offers per user: **${cfg.offerCount}**\n` +
    `- Scheme filtering: **${cfg.schemeFilter ? 'On' : 'Off'}**`
  );
}

function buildChannelPanel(saved = false) {
  return {
    content:
      `## 🏈 Dynasty League Setup — Channels & Role\n` +
      `Pick your existing channels and coach role below, or click **Auto-create missing** to create any that are blank.\n` +
      `When done, click **Continue to settings →**.\n` +
      `*(Channel/role selections save automatically)*` +
      (saved ? '\n\n✅ Saved!' : ''),
    components: [
      new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId('setup_channel_general')
          .setPlaceholder('📢 #general — announcement channel')
          .addChannelTypes(ChannelType.GuildText)
      ),
      new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId('setup_channel_rules')
          .setPlaceholder('📋 #rules — users react ✅ here to get job offers')
          .addChannelTypes(ChannelType.GuildText)
      ),
      new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId('setup_channel_teamlist')
          .setPlaceholder('📊 #team-list — available/taken schools')
          .addChannelTypes(ChannelType.GuildText)
      ),
      new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder()
          .setCustomId('setup_role_coach')
          .setPlaceholder('🏷️ @coach role — assigned to all coaches')
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('setup_autocreate')
          .setLabel('Auto-create missing channels & role')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('setup_continue')
          .setLabel('Continue to settings →')
          .setStyle(ButtonStyle.Secondary)
      ),
    ]
  };
}

async function sendSettingsPanelFollowUp(interaction) {
  const league = await getLeague(interaction.guildId);
  if (!league) return;
  const cfg = {
    allowedRoles: league.allowed_roles || 'HC',
    allowedConferences: league.allowed_conferences || null,
    minStars: league.min_stars ?? 0,
    maxStars: league.max_stars ?? 5,
    offerCount: league.offer_count || 5,
    schemeFilter: league.scheme_filter || false,
  };
  const general = league.general_channel_id ? await client.channels.fetch(league.general_channel_id).catch(() => null) : null;
  const rules = league.rules_channel_id ? await client.channels.fetch(league.rules_channel_id).catch(() => null) : null;
  const teamList = league.team_list_channel_id ? await client.channels.fetch(league.team_list_channel_id).catch(() => null) : null;
  const coachRole = league.coach_role_id ? interaction.guild.roles.cache.get(league.coach_role_id) : null;
  const channelLine = `${general || '*(not set)*'} | ${rules || '*(not set)*'} (react ✅ for offers) | ${teamList || '*(not set)*'} | ${coachRole || '*(not set)*'}`;
  const conferences = await getConferencesForDropdown();
  await interaction.followUp({ ephemeral: true, content: buildSetupContent(cfg, league.name || interaction.guild.name, channelLine), components: buildSetupComponents(cfg, conferences) });
}

// ---------------------------------------------------------
// TEAM LIST DISPLAY
// Posts the full available/taken school list to the #team-list channel.
// ---------------------------------------------------------
async function runListTeamsDisplay(league) {
  try {
    // All claimed slots for this league (must always show regardless of filters)
    const { data: claimedTeams, error: claimedErr } = await supabase
      .from('league_teams')
      .select('school_id, taken_by, taken_by_name, role')
      .eq('league_id', league.id);
    if (claimedErr) throw claimedErr;

    const claimedMap = {};
    const claimedSchoolIds = new Set();
    for (const c of (claimedTeams || [])) {
      claimedMap[c.school_id] = c;
      claimedSchoolIds.add(c.school_id);
    }

    // Available schools within league filters
    let q = supabase.from('schools').select('*')
      .gte('stars', league.min_stars ?? 0)
      .lte('stars', league.max_stars ?? 5)
      .order('conference', { ascending: true })
      .order('name', { ascending: true });

    if (league.allowed_conferences) {
      const confs = league.allowed_conferences.split(',').map(c => c.trim()).filter(Boolean);
      q = q.in('conference', confs);
    }

    const { data: filteredSchools } = await q;

    // Fetch full records for any claimed schools outside the filters
    const outsideIds = [...claimedSchoolIds].filter(id => !(filteredSchools || []).some(s => s.id === id));
    let outsideSchools = [];
    if (outsideIds.length > 0) {
      const { data } = await supabase.from('schools').select('*').in('id', outsideIds);
      outsideSchools = data || [];
    }

    // Merge: all filtered schools + any claimed schools outside the filters
    const schoolMap = {};
    for (const s of [...(filteredSchools || []), ...outsideSchools]) schoolMap[s.id] = s;
    const allSchools = Object.values(schoolMap).sort((a, b) =>
      (a.conference || '').localeCompare(b.conference || '') || a.name.localeCompare(b.name));

    const channel = await client.channels.fetch(league.team_list_channel_id).catch(() => null);
    if (!channel) return false;

    // Delete old bot messages in the channel
    try {
      const messages = await channel.messages.fetch({ limit: 100 });
      const botMessages = messages.filter(m => m.author.id === client.user.id);
      for (const m of botMessages.values()) {
        try { await m.delete(); } catch {}
      }
    } catch (err) {
      console.error('Error deleting old team-list messages:', err);
    }

    // Group by conference
    const confMap = {};
    for (const school of allSchools) {
      const conf = school.conference || 'Independent';
      if (!confMap[conf]) confMap[conf] = [];
      confMap[conf].push(school);
    }

    if (Object.keys(confMap).length === 0) {
      await channel.send('No schools configured for this league yet. An admin must run /setup to configure school filters.');
      return true;
    }

    // One embed per conference to stay well under Discord's 4096-char embed limit
    for (const [conf, schools] of Object.entries(confMap)) {
      let text = '';
      for (const school of schools) {
        const claim = claimedMap[school.id];
        if (claim) {
          const roleLabel = claim.role ? ` (${claim.role})` : '';
          text += `🏈 **${school.name}** — ${claim.taken_by_name || `<@${claim.taken_by}>`}${roleLabel}\n`;
        } else {
          text += `🟢 **${school.name}** — Available\n`;
        }
      }
      await channel.send({ embeds: [{ title: conf, description: text, color: 0x2b2d31 }] });
    }

    return true;
  } catch (err) {
    console.error('runListTeamsDisplay error:', err);
    return false;
  }
}

// ---------------------------------------------------------
// JOB OFFER FLOW
// Handles the multi-step DM conversation: role → schemes → team pick
// ---------------------------------------------------------

// Called on ✅ reaction or /joboffers to kick off the flow.
async function startOfferFlow(user, guildId) {
  const league = await getLeague(guildId);
  if (!league) throw new Error('This server has not been configured yet. An admin must run /setup first.');

  // Block if user already has a team in this league
  const { data: existingTeam } = await supabase
    .from('league_teams').select('id').eq('league_id', league.id).eq('taken_by', user.id).maybeSingle();
  if (existingTeam) {
    await user.send(`⛔ You already have a team in **${league.name || 'this league'}**. Contact an admin if you need to make a change.`);
    return false;
  }

  // Block if user already has an active offer flow from a different server
  if (!client.userOffers) client.userOffers = {};
  const existing = client.userOffers[user.id];
  if (existing && existing.guildId !== guildId) {
    const otherGuild = client.guilds.cache.get(existing.guildId);
    const otherName = otherGuild ? otherGuild.name : 'another server';
    await user.send(`⛔ You already have a pending job offer from **${otherName}**. Please finish that flow first, then react again here.`);
    return false;
  }

  const { data: savedOfferRow } = await supabase
    .from('user_offers')
    .select('school_ids, created_at')
    .eq('league_id', league.id)
    .eq('user_id', user.id)
    .maybeSingle();

  let savedSchoolIds = null;
  if (savedOfferRow?.school_ids) {
    const ageMs = savedOfferRow.created_at
      ? Date.now() - new Date(savedOfferRow.created_at).getTime()
      : Infinity;
    if (ageMs <= OFFER_EXPIRY_MS) savedSchoolIds = savedOfferRow.school_ids;
  }

  client.userOffers[user.id] = {
    guildId,
    step: null,
    teams: [],
    chosenTeam: null,
    role: null,
    preferredOffenseScheme: null,
    preferredDefenseScheme: null,
    savedSchoolIds,
  };

  await advanceOfferFlow(user, league, client.userOffers[user.id]);
  return true;
}

// Sends the next prompt in the flow based on what info is still missing.
async function advanceOfferFlow(user, league, offerData) {
  const roles = (league.allowed_roles || 'HC').split(',').map(r => r.trim());

  // Assign role automatically when only one is configured
  if (!offerData.role && roles.length === 1) offerData.role = roles[0];

  // Step: ask for role (only when multiple are available and scheme filter is on,
  // so we know which scheme questions to ask)
  if (!offerData.role && league.scheme_filter) {
    offerData.step = 'choose_role';
    await user.send(
      `Welcome! Before we show you available schools, what role are you applying for?\n` +
      `Reply with one of: **${roles.join(', ')}**`
    );
    return;
  }

  const role = offerData.role || roles[0];

  // Step: ask for preferred offensive scheme (HC or OC, scheme filter on)
  if (league.scheme_filter && (role === 'HC' || role === 'OC') && !offerData.preferredOffenseScheme) {
    offerData.step = 'choose_offense_scheme';
    const list = OFFENSE_SCHEMES.map((s, i) => `${i + 1}. ${s}`).join('\n');
    await user.send(`What is your preferred **offensive** scheme?\nReply with the number:\n${list}`);
    return;
  }

  // Step: ask for preferred defensive scheme (HC or DC, scheme filter on)
  if (league.scheme_filter && (role === 'HC' || role === 'DC') && !offerData.preferredDefenseScheme) {
    offerData.step = 'choose_defense_scheme';
    const list = DEFENSE_SCHEMES.map((s, i) => `${i + 1}. ${s}`).join('\n');
    await user.send(`What is your preferred **defensive** scheme?\nReply with the number:\n${list}`);
    return;
  }

  // All preferences collected — fetch and send filtered offers
  const schemePrefs = {
    offenseScheme: offerData.preferredOffenseScheme,
    defenseScheme: offerData.preferredDefenseScheme
  };

  let offers;
  if (offerData.savedSchoolIds && offerData.savedSchoolIds.length > 0) {
    // Load saved offer set, excluding any schools now claimed by others
    const { data: schools } = await supabase.from('schools').select('*').in('id', offerData.savedSchoolIds);
    const { data: nowClaimed } = await supabase.from('league_teams').select('school_id').eq('league_id', league.id).in('school_id', offerData.savedSchoolIds);
    const claimedIds = new Set((nowClaimed || []).map(r => r.school_id));
    offers = (schools || []).filter(s => !claimedIds.has(s.id));

    if (offers.length === 0) {
      // All saved offers were taken — generate a fresh set
      offers = await getAvailableSchools(league, league.offer_count ?? 5, schemePrefs);
      if (offers && offers.length > 0) {
        offerData.savedSchoolIds = offers.map(s => s.id);
        const { error: upsertErr } = await supabase.from('user_offers').upsert({ league_id: league.id, user_id: user.id, school_ids: offers.map(s => s.id), created_at: new Date().toISOString() }, { onConflict: 'league_id,user_id' });
        if (upsertErr) console.error('user_offers upsert error (refresh):', upsertErr);
      }
    }
  } else {
    // First time — generate fresh offers and persist them
    offers = await getAvailableSchools(league, league.offer_count ?? 5, schemePrefs);
    if (offers && offers.length > 0) {
      offerData.savedSchoolIds = offers.map(s => s.id);
      const { error: upsertErr } = await supabase.from('user_offers').upsert({ league_id: league.id, user_id: user.id, school_ids: offers.map(s => s.id), created_at: new Date().toISOString() }, { onConflict: 'league_id,user_id' });
      if (upsertErr) console.error('user_offers upsert error (fresh):', upsertErr);
    }
  }

  if (!offers || offers.length === 0) {
    delete client.userOffers[user.id];
    const schemeNote = (schemePrefs.offenseScheme || schemePrefs.defenseScheme)
      ? ' that match your scheme preferences' : '';
    await user.send(`No available schools${schemeNote} right now. Contact a league admin.`);
    return;
  }

  offerData.teams = offers;
  offerData.step = 'choose_team';
  await persistFlowState(league.id, user.id, offerData);

  await sendOfferDM(user, offers);
}

function buildOfferDMText(offers) {
  let dmText = 'Your CFB27 job offers:\n\n';
  const grouped = {};
  for (let idx = 0; idx < offers.length; idx++) {
    const t = offers[idx];
    const conf = t.conference || 'Independent';
    if (!grouped[conf]) grouped[conf] = [];
    grouped[conf].push({ number: idx + 1, school: t });
  }
  for (const conf of Object.keys(grouped)) {
    dmText += `**${conf}**\n`;
    for (const item of grouped[conf]) {
      const schemes = (item.school.offense_scheme || item.school.defense_scheme)
        ? ` (${item.school.offense_scheme || '?'} / ${item.school.defense_scheme || '?'})` : '';
      dmText += `${item.number}️⃣ ${item.school.name}${schemes}\n`;
    }
    dmText += '\n';
  }
  dmText += 'Reply with the number of the team you want to accept.';
  return dmText;
}

async function sendOfferDM(user, offers) {
  await user.send(buildOfferDMText(offers));
}

// ---------------------------------------------------------
// REFRESH OFFERS when a chosen school was already claimed
// ---------------------------------------------------------
async function refreshOffers(msg, userId, league, offerData, takenSchoolName) {
  const targetCount = league.offer_count ?? 5;

  // Check which of the existing offers are still available
  const offeredIds = offerData.teams.map(s => s.id);
  const { data: stillClaimed } = await supabase
    .from('league_teams')
    .select('school_id')
    .eq('league_id', league.id)
    .in('school_id', offeredIds);

  const claimedIds = new Set((stillClaimed || []).map(r => r.school_id));
  const stillAvailable = offerData.teams.filter(s => !claimedIds.has(s.id));

  // Top up with fresh schools if needed
  const needed = targetCount - stillAvailable.length;
  if (needed > 0) {
    const schemePrefs = {
      offenseScheme: offerData.preferredOffenseScheme,
      defenseScheme: offerData.preferredDefenseScheme,
    };
    const fresh = await getAvailableSchools(league, needed + 5, schemePrefs);
    const existingIds = new Set(offerData.teams.map(s => s.id));
    const newPicks = fresh.filter(s => !existingIds.has(s.id)).slice(0, needed);
    stillAvailable.push(...newPicks);
  }

  if (stillAvailable.length === 0) {
    delete client.userOffers[userId];
    return msg.reply(`**${takenSchoolName}** was just claimed by someone else and there are no other available schools right now. Contact a league admin.`);
  }

  offerData.teams = stillAvailable;
  offerData.chosenTeam = null;
  offerData.savedSchoolIds = stillAvailable.map(s => s.id);
  await supabase.from('user_offers').upsert({ league_id: league.id, user_id: userId, school_ids: stillAvailable.map(s => s.id) }, { onConflict: 'league_id,user_id' });
  await msg.reply(`**${takenSchoolName}** was just claimed by someone else! Here are your updated offers:`);
  await sendOfferDM(msg.author, stillAvailable);
}

// ---------------------------------------------------------
// CLAIM TEAM (shared between DM accept steps)
// ---------------------------------------------------------
async function claimTeam(msg, offerData, school, role) {
  const userId = msg.author.id;
  const league = await getLeague(offerData.guildId);
  if (!league) return msg.reply('League configuration not found. Please contact an admin.');

  // Verify school isn't claimed between offer and accept
  const { data: existingClaim } = await supabase
    .from('league_teams')
    .select('id')
    .eq('league_id', league.id)
    .eq('school_id', school.id)
    .maybeSingle();

  if (existingClaim) {
    return refreshOffers(msg, userId, league, offerData, school.name);
  }

  // Insert claim record
  const { error: insertErr } = await supabase.from('league_teams').insert({
    league_id: league.id,
    school_id: school.id,
    taken_by: userId,
    taken_by_name: msg.author.username,
    role,
    preferred_offense_scheme: offerData.preferredOffenseScheme || null,
    preferred_defense_scheme: offerData.preferredDefenseScheme || null
  });

  if (insertErr) {
    console.error('Failed to claim team:', insertErr);
    if (insertErr.code === '23505') {
      return refreshOffers(msg, userId, league, offerData, school.name);
    }
    return msg.reply(`Failed to claim **${school.name}**: ${insertErr.message}`);
  }

  await msg.reply(`You accepted the job offer from **${school.name}** as **${role}**!`);
  delete client.userOffers[userId];
  await supabase.from('user_offers').update({ step: null, role: null, offense_scheme: null, defense_scheme: null, chosen_school_id: null }).eq('league_id', league.id).eq('user_id', userId);

  const guild = client.guilds.cache.get(offerData.guildId);
  if (!guild) return;

  // Announce in #general
  const general = await client.channels.fetch(league.general_channel_id).catch(() => null);
  if (general) {
    general.send(`🏈 <@${userId}> has accepted a job offer from **${school.name}** as **${role}**!`).catch(() => {});
  }

  // Create team channel under 'Team Channels' category
  let newChannelId = null;
  try {
    const channelName = school.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    let teamChannelsCategory = guild.channels.cache.find(c => c.name === 'Team Channels' && c.type === ChannelType.GuildCategory);
    if (!teamChannelsCategory) {
      teamChannelsCategory = await guild.channels.create({ name: 'Team Channels', type: ChannelType.GuildCategory });
    }
    const newChannel = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: teamChannelsCategory.id,
      reason: `Team channel for ${school.name}`
    });
    newChannelId = newChannel.id;
    const roleTitle = role === 'HC' ? 'Head Coach' : role === 'OC' ? 'Offensive Coordinator' : 'Defensive Coordinator';
    await newChannel.send(`Welcome to **${school.name}**! <@${userId}> is the ${roleTitle}.`);
  } catch (err) {
    console.error(`Failed to create channel for ${school.name}:`, err);
  }

  // Store channel ID for future reference
  if (newChannelId) {
    await supabase.from('league_teams')
      .update({ channel_id: newChannelId })
      .eq('league_id', league.id)
      .eq('school_id', school.id);
  }

  // Assign coach role and set nickname
  try {
    const member = await guild.members.fetch(userId);
    const coachRole = guild.roles.cache.get(league.coach_role_id);
    if (coachRole) await member.roles.add(coachRole, 'Claimed team');
    const nickname = `${school.name} - ${role}`.substring(0, 32);
    await member.setNickname(nickname, 'Claimed team').catch(err => console.error('setNickname failed:', err.message));
  } catch (err) {
    console.error(`Failed to assign role/nickname to ${userId}:`, err);
  }

  await runListTeamsDisplay(league);
}

// ---------------------------------------------------------
// AUTOCOMPLETE & COMMAND HANDLING
// ---------------------------------------------------------
client.on('interactionCreate', async interaction => {
  try {
    if (interaction.isAutocomplete()) {
      const focused = interaction.options.getFocused(true);

      /* Autocomplete for /game-result opponent (commented out)
      if (focused.name === 'opponent') {
        const search = (focused.value || '').toLowerCase();
        const { data: teamsData, error } = await supabase.from('teams').select('name').limit(200);
        if (error) {
          console.error("Autocomplete supabase error:", error);
          try { await interaction.respond([]); } catch (e) { console.error('Failed to respond to autocomplete (empty):', e); }
          return;
        }
        const list = (teamsData || []).map(r => r.name).filter(n => n.toLowerCase().includes(search));
        list.sort((a, b) => a.localeCompare(b));
        try {
          await interaction.respond(list.slice(0, 25).map(n => ({ name: n, value: n })));
        } catch (e) {
          console.error('Failed to respond to autocomplete:', e);
        }
        return;
      }
      */

      /* Autocomplete for /move-coach coach by name (commented out - now uses user option)
      if (focused.name === 'coach') {
        const search = (focused.value || '').toLowerCase();
        const { data: teamsData, error } = await supabase.from('teams').select('taken_by_name').not('taken_by', 'is', null).limit(200);
        if (error) {
          console.error("Autocomplete coach error:", error);
          try { await interaction.respond([]); } catch (e) {}
          return;
        }
        const coachList = (teamsData || []).map(r => r.taken_by_name).filter(n => n && n.toLowerCase().includes(search));
        const uniqueCoaches = [...new Set(coachList)];
        uniqueCoaches.sort((a, b) => a.localeCompare(b));
        try {
          await interaction.respond(uniqueCoaches.slice(0, 25).map(n => ({ name: n, value: n })));
        } catch (e) {}
        return;
      }
      */

      // Autocomplete for /move-coach new_team (schools in this league)
      if (focused.name === 'new_team') {
        const league = await getLeague(interaction.guildId);
        if (!league) { try { await interaction.respond([]); } catch {} return; }

        const search = (focused.value || '').toLowerCase();

        const { data: allSchools } = await supabase.from('schools').select('id, name');

        const { data: claimed } = await supabase
          .from('league_teams')
          .select('school_id, taken_by_name')
          .eq('league_id', league.id);
        const claimedMap = {};
        for (const c of (claimed || [])) claimedMap[c.school_id] = c.taken_by_name;

        const list = (allSchools || [])
          .filter(s => s.name.toLowerCase().includes(search))
          .map(s => {
            const takenBy = claimedMap[s.id];
            const status = takenBy ? ` (${takenBy})` : ' (available)';
            return { name: `${s.name}${status}`, value: String(s.id) };
          })
          .sort((a, b) => a.name.localeCompare(b.name));

        try { await interaction.respond(list.slice(0, 25)); } catch {}
        return;
      }

      /* Autocomplete for /any-game-result home_team / away_team (commented out)
      if (focused.name === 'home_team' || focused.name === 'away_team') {
        const search = (focused.value || '').toLowerCase();
        const { data: teamsData, error } = await supabase.from('teams').select('name').limit(200);
        if (error) {
          console.error("Autocomplete any-game-result error:", error);
          try { await interaction.respond([]); } catch (e) {}
          return;
        }
        const list = (teamsData || []).map(r => r.name).filter(n => n.toLowerCase().includes(search));
        list.sort((a, b) => a.localeCompare(b));
        try {
          await interaction.respond(list.slice(0, 25).map(n => ({ name: n, value: n })));
        } catch (e) {}
        return;
      }
      */

      return;
    }

    // ---------------------------
    // /setup select menu interactions (auto-save on each change)
    // ---------------------------
    if (interaction.isStringSelectMenu && interaction.isStringSelectMenu() && interaction.customId.startsWith('setup_')) {
      await interaction.deferUpdate();

      const league = await getLeague(interaction.guildId);
      if (!league) return;

      let updatePayload = {};
      if (interaction.customId === 'setup_roles') {
        updatePayload.allowed_roles = interaction.values[0];
      } else if (interaction.customId === 'setup_conferences') {
        updatePayload.allowed_conferences = interaction.values.length > 0 ? interaction.values.join(',') : null;
      } else if (interaction.customId === 'setup_star_range') {
        const vals = interaction.values.map(parseFloat);
        updatePayload.min_stars = Math.min(...vals);
        updatePayload.max_stars = Math.max(...vals);
      } else if (interaction.customId === 'setup_offer_count') {
        updatePayload.offer_count = parseInt(interaction.values[0]);
      } else if (interaction.customId === 'setup_scheme') {
        updatePayload.scheme_filter = interaction.values[0] === 'true';
      }

      const { error } = await supabase.from('leagues').update(updatePayload).eq('guild_id', interaction.guildId);
      if (error) { console.error('Setup update error:', error); return; }
      invalidateLeagueCache(interaction.guildId);

      const updated = await getLeague(interaction.guildId);
      if (!updated) return;
      const cfg = { allowedRoles: updated.allowed_roles, allowedConferences: updated.allowed_conferences, minStars: updated.min_stars, maxStars: updated.max_stars, offerCount: updated.offer_count, schemeFilter: updated.scheme_filter };
      const conferences = await getConferencesForDropdown();

      const general = await client.channels.fetch(updated.general_channel_id).catch(() => null);
      const rules = await client.channels.fetch(updated.rules_channel_id).catch(() => null);
      const teamList = await client.channels.fetch(updated.team_list_channel_id).catch(() => null);
      const coachRole = interaction.guild.roles.cache.get(updated.coach_role_id);
      const channelLine = `${general || '#general'} | ${rules || '#rules'} (react ✅ for offers) | ${teamList || '#team-list'} | ${coachRole || '@coach'}`;

      return interaction.editReply({ content: buildSetupContent(cfg, updated.name || interaction.guild.name, channelLine) + '\n\n✅ Saved!', components: buildSetupComponents(cfg, conferences) });
    }

    // ---------------------------
    // /setup channel & role pickers (second panel)
    // ---------------------------
    if ((interaction.isChannelSelectMenu && interaction.isChannelSelectMenu()) || (interaction.isRoleSelectMenu && interaction.isRoleSelectMenu())) {
      const id = interaction.customId;
      if (!['setup_channel_general','setup_channel_rules','setup_channel_teamlist','setup_role_coach'].includes(id)) return;

      await interaction.deferUpdate();
      const league = await getLeague(interaction.guildId);
      if (!league) return;

      let updatePayload = {};
      if (id === 'setup_channel_general')   updatePayload.general_channel_id   = interaction.values[0];
      if (id === 'setup_channel_rules')     updatePayload.rules_channel_id     = interaction.values[0];
      if (id === 'setup_channel_teamlist')  updatePayload.team_list_channel_id = interaction.values[0];
      if (id === 'setup_role_coach')        updatePayload.coach_role_id        = interaction.values[0];

      const { error } = await supabase.from('leagues').update(updatePayload).eq('guild_id', interaction.guildId);
      if (error) { console.error('Channel/role update error:', error); return; }
      invalidateLeagueCache(interaction.guildId);

      return interaction.editReply(buildChannelPanel(true));
    }

    // ---------------------------
    // /setup "Auto-create missing" button
    // ---------------------------
    if (interaction.isButton && interaction.isButton() && interaction.customId === 'setup_autocreate') {
      await interaction.deferUpdate();
      const guild = interaction.guild;
      let league = await getLeague(interaction.guildId);
      if (!league) league = await getLeague(interaction.guildId);
      if (!league) return interaction.editReply({ content: '⚠️ Run `/setup` first to configure your league.', components: [] });

      const updates = {};
      const created = [];

      if (!league.general_channel_id) {
        let ch = guild.channels.cache.find(c => c.name === 'general' && c.isTextBased());
        if (!ch) { ch = await guild.channels.create({ name: 'general', type: ChannelType.GuildText, reason: 'Dynasty bot setup' }); created.push('#general (created)'); }
        else created.push('#general (linked existing)');
        updates.general_channel_id = ch.id;
      }
      if (!league.rules_channel_id) {
        let ch = guild.channels.cache.find(c => c.name === 'rules' && c.isTextBased());
        if (!ch) { ch = await guild.channels.create({ name: 'rules', type: ChannelType.GuildText, reason: 'Dynasty bot setup' }); created.push('#rules (created)'); }
        else created.push('#rules (linked existing)');
        updates.rules_channel_id = ch.id;
      }
      if (!league.team_list_channel_id) {
        let ch = guild.channels.cache.find(c => c.name === 'team-list' && c.isTextBased());
        if (!ch) { ch = await guild.channels.create({ name: 'team-list', type: ChannelType.GuildText, reason: 'Dynasty bot setup' }); created.push('#team-list (created)'); }
        else created.push('#team-list (linked existing)');
        updates.team_list_channel_id = ch.id;
      }
      if (!league.coach_role_id) {
        let role = guild.roles.cache.find(r => r.name === 'coach');
        if (!role) { role = await guild.roles.create({ name: 'coach', reason: 'Dynasty bot setup' }); created.push('@coach (created)'); }
        else created.push('@coach (linked existing)');
        updates.coach_role_id = role.id;
      }

      if (Object.keys(updates).length) {
        const { error } = await supabase.from('leagues').update(updates).eq('guild_id', interaction.guildId);
        if (error) { console.error('Auto-create update error:', error); return; }
        invalidateLeagueCache(interaction.guildId);
      }

      const summary = created.length
        ? `✅ Done: ${created.join(', ')}`
        : '✅ All channels and role are already configured — nothing to create.';
      await interaction.editReply({ content: `## 🏈 Dynasty League Setup — Channels & Role\n${summary}\n\n*(Use the dropdowns above to point to different channels/roles at any time)*`, components: buildChannelPanel().components });
      await sendSettingsPanelFollowUp(interaction);
      return;
    }

    if (interaction.isButton && interaction.isButton() && interaction.customId === 'setup_continue') {
      await interaction.deferUpdate();
      await sendSettingsPanelFollowUp(interaction);
      return;
    }

    if (!interaction.isCommand()) return;
    const name = interaction.commandName;

    // ---------------------------
    // /setup — sends ephemeral dropdown panel
    // ---------------------------
    if (name === 'setup') {
      await interaction.deferReply({ ephemeral: true });
      const guild = interaction.guild;

      const existing = await getLeague(interaction.guildId);
      if (!existing) {
        const { error } = await supabase.from('leagues').insert({ guild_id: interaction.guildId, name: guild.name, allowed_roles: 'HC', min_stars: 0, max_stars: 5, scheme_filter: false, offer_count: 5 });
        if (error) { console.error('Setup error:', error); return interaction.editReply(`Setup failed: ${error.message}`); }
        invalidateLeagueCache(interaction.guildId);
      }

      await interaction.editReply(buildChannelPanel());
    }

    // ---------------------------
    // /help
    // ---------------------------
    if (name === 'help') {
      return interaction.reply({ ephemeral: true, content: HELP_TEXT });
    }

    // ---------------------------
    // /invite
    // ---------------------------
    if (name === 'invite') {
      // Permissions: manage channels, manage roles, manage nicknames, send messages,
      // embed links, read message history, manage messages, add reactions, view channels
      const permissions = '402746448';
      const inviteUrl = `https://discord.com/oauth2/authorize?client_id=${client.user.id}&permissions=${permissions}&scope=bot%20applications.commands`;
      return interaction.reply({
        ephemeral: true,
        content:
          `**Add Headset Dynasty Bot to your server:**\n${inviteUrl}\n\n` +
          `After adding the bot, run \`/setup\` in your server — it takes about 30 seconds and the bot handles the rest.`
      });
    }

    // ---------------------------
    // /joboffers (admin sends to a specific user)
    // ---------------------------
    if (name === 'joboffers') {
      if (!isAuthorized(interaction.member)) return interaction.reply({ ephemeral: true, content: '⛔ You need to be a server admin or have the Commissioner role.' });
      await interaction.deferReply({ ephemeral: true });
      const targetUser = interaction.options.getUser('user');

      const league = await getLeague(interaction.guildId);
      if (!league) return interaction.editReply('League not configured. Run /setup first.');

      // Admin-triggered offers always start fresh — clear any saved offer set and in-progress flow
      if (client.userOffers && client.userOffers[targetUser.id]) delete client.userOffers[targetUser.id];
      await supabase.from('user_offers').delete().eq('league_id', league.id).eq('user_id', targetUser.id);

      let started;
      try {
        started = await startOfferFlow(targetUser, interaction.guildId);
      } catch (err) {
        console.error('Failed to start offer flow:', err);
        return interaction.editReply(`Error: ${err.message}`);
      }

      if (started === false) {
        return interaction.editReply(`⛔ **${targetUser.username}** already has a team in this league. Use /resetteam first if you want to reassign them.`);
      }
      return interaction.editReply(`✅ Job offer flow started for **${targetUser.username}** via DM.`);
    }

    // ---------------------------
    // /resetteam
    // ---------------------------
    if (name === 'resetteam') {
      if (!isAuthorized(interaction.member)) return interaction.reply({ ephemeral: true, content: '⛔ You need to be a server admin or have the Commissioner role.' });
      await interaction.deferReply({ ephemeral: true });

      const league = await getLeague(interaction.guildId);
      if (!league) return interaction.editReply('League not configured. Run /setup first.');

      const targetUser = interaction.options.getUser('user');
      const userId = targetUser.id;

      const { data: teamData, error } = await supabase
        .from('league_teams')
        .select('*, schools(name)')
        .eq('league_id', league.id)
        .eq('taken_by', userId)
        .maybeSingle();

      if (error) return interaction.editReply(`Error: ${error.message}`);
      if (!teamData) return interaction.editReply(`${targetUser.username} has no team in this league.`);

      const schoolName = teamData.schools?.name || 'their team';

      await supabase.from('league_teams').delete().eq('id', teamData.id);
      await supabase.from('user_offers').delete().eq('league_id', league.id).eq('user_id', userId);
      if (client.userOffers && client.userOffers[userId]) delete client.userOffers[userId];

      // Delete team channel by stored ID
      if (teamData.channel_id) {
        const ch = await interaction.guild.channels.fetch(teamData.channel_id).catch(() => null);
        if (ch) await ch.delete('Team reset').catch(() => {});
      }

      // Remove coach role and clear nickname
      try {
        const member = await interaction.guild.members.fetch(userId);
        const coachRole = interaction.guild.roles.cache.get(league.coach_role_id);
        if (coachRole) await member.roles.remove(coachRole, 'Team reset').catch(() => {});
        await member.setNickname(null, 'Team reset').catch(() => {});
      } catch (err) {
        console.log(`Could not update member ${userId} (may have left server):`, err.message);
      }

      await runListTeamsDisplay(league);
      return interaction.editReply(`✅ Reset **${schoolName}**. Channel deleted, role removed, nickname cleared.`);
    }

    // ---------------------------
    // /listteams
    // ---------------------------
    if (name === 'listteams') {
      if (!isAuthorized(interaction.member)) return interaction.reply({ ephemeral: true, content: '⛔ You need to be a server admin or have the Commissioner role.' });
      await interaction.deferReply({ ephemeral: true });

      const league = await getLeague(interaction.guildId);
      if (!league) return interaction.editReply('League not configured. Run /setup first.');

      const success = await runListTeamsDisplay(league);
      return interaction.editReply(success
        ? 'Team list refreshed in #team-list.'
        : 'Error posting team list. Check bot permissions and that the team-list channel is still accessible.'
      );
    }

    /* ---------------------------
     * /game-result (commented out)
     * ---------------------------
    if (name === 'game-result') {
      const opponentName = interaction.options.getString('opponent');
      const userScore = interaction.options.getInteger('your_score');
      const opponentScore = interaction.options.getInteger('opponent_score');
      const summary = interaction.options.getString('summary');

      const seasonResp = await supabase.from('meta').select('value').eq('key', 'current_season').maybeSingle();
      const weekResp = await supabase.from('meta').select('value').eq('key','current_week').maybeSingle();
      const currentSeason = seasonResp.data?.value != null ? Number(seasonResp.data.value) : 1;
      const currentWeek = weekResp.data?.value != null ? Number(weekResp.data.value) : 0;

      const { data: userTeam, error: userTeamErr } = await supabase.from('teams').select('*').eq('taken_by', interaction.user.id).maybeSingle();
      if (userTeamErr) {
        console.error("game-result userTeamErr:", userTeamErr);
        return interaction.reply({ ephemeral: true, content: `Error: ${userTeamErr.message}` });
      }
      if (!userTeam) return interaction.reply({ ephemeral: true, content: "You don't control a team." });

      const { data: existingUserResult } = await supabase
        .from('results')
        .select('*')
        .eq('season', currentSeason)
        .eq('week', currentWeek)
        .eq('user_team_id', userTeam.id)
        .maybeSingle();

      if (existingUserResult) {
        return interaction.reply({
          ephemeral: true,
          content: `You already submitted a result this week (vs ${existingUserResult.opponent_team_name}). You can only submit one result per week.`
        });
      }

      let opponentTeam = null;
      try {
        const { data: teamsData, error: teamsErr } = await supabase.from('teams').select('*').limit(1000);
        if (teamsErr) {
          console.error('game-result teams fetch error:', teamsErr);
          return interaction.reply({ ephemeral: true, content: `Error fetching teams: ${teamsErr.message}` });
        }
        const needle = (opponentName || '').toLowerCase().trim();
        if (teamsData && teamsData.length > 0) {
          opponentTeam = teamsData.find(t => (t.name || '').toLowerCase() === needle);
          if (!opponentTeam) opponentTeam = teamsData.find(t => (t.name || '').toLowerCase().includes(needle));
        }
      } catch (err) {
        console.error('game-result opponent lookup error:', err);
        return interaction.reply({ ephemeral: true, content: `Error looking up opponent: ${err.message}` });
      }

      if (!opponentTeam) return interaction.reply({ ephemeral: true, content: `Opponent "${opponentName}" not found.` });

      const isOpponentUserControlled = opponentTeam.taken_by != null;
      if (isOpponentUserControlled) {
        const { data: existingOpponentResult } = await supabase
          .from('results')
          .select('*')
          .eq('season', currentSeason)
          .eq('week', currentWeek)
          .eq('user_team_id', opponentTeam.id)
          .eq('opponent_team_id', userTeam.id)
          .maybeSingle();

        if (existingOpponentResult) {
          return interaction.reply({
            ephemeral: true,
            content: `${opponentTeam.name} already submitted this game result. Only the home team (first to submit) can enter the result.`
          });
        }
      }

      const resultText = userScore > opponentScore ? 'W' : 'L';

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

      try {
        const { data: existingRecord } = await supabase
          .from('records')
          .select('*')
          .eq('season', currentSeason)
          .eq('team_id', userTeam.id)
          .maybeSingle();

        const newWins = (existingRecord?.wins || 0) + (resultText === 'W' ? 1 : 0);
        const newLosses = (existingRecord?.losses || 0) + (resultText === 'L' ? 1 : 0);
        const newUserWins = (existingRecord?.user_wins || 0) + (isOpponentUserControlled && resultText === 'W' ? 1 : 0);
        const newUserLosses = (existingRecord?.user_losses || 0) + (isOpponentUserControlled && resultText === 'L' ? 1 : 0);

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

      const guild = client.guilds.cache.first();
      if (guild) {
        const newsChannel = guild.channels.cache.find(c => c.name === 'news-feed' && c.isTextBased());
        if (newsChannel) {
          try {
            const recordResp = await supabase.from('records').select('wins,losses').eq('season', currentSeason).eq('team_id', userTeam.id).maybeSingle();
            const wins = recordResp.data?.wins || 0;
            const losses = recordResp.data?.losses || 0;
            let recordText = `Record: ${userTeam.name} ${wins}-${losses}`;
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
    */

    /* ---------------------------
     * /any-game-result (commented out)
     * ---------------------------
    if (name === 'any-game-result') {
      if (!interaction.member || !interaction.member.permissions || !interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ ephemeral: true, content: "Only the commissioner can use this command." });
      }

      const homeTeamName = interaction.options.getString('home_team');
      const awayTeamName = interaction.options.getString('away_team');
      const homeScore = interaction.options.getInteger('home_score');
      const awayScore = interaction.options.getInteger('away_score');
      const week = interaction.options.getInteger('week');
      const summary = interaction.options.getString('summary');

      const seasonResp = await supabase.from('meta').select('value').eq('key', 'current_season').maybeSingle();
      const currentSeason = seasonResp.data?.value != null ? Number(seasonResp.data.value) : 1;

      let homeTeam = null;
      let awayTeam = null;
      try {
        const { data: teamsData, error: teamsErr } = await supabase.from('teams').select('*').limit(1000);
        if (teamsErr) throw teamsErr;
        const homeNeedle = (homeTeamName || '').toLowerCase().trim();
        const awayNeedle = (awayTeamName || '').toLowerCase().trim();
        homeTeam = teamsData.find(t => (t.name || '').toLowerCase() === homeNeedle);
        if (!homeTeam) homeTeam = teamsData.find(t => (t.name || '').toLowerCase().includes(homeNeedle));
        awayTeam = teamsData.find(t => (t.name || '').toLowerCase() === awayNeedle);
        if (!awayTeam) awayTeam = teamsData.find(t => (t.name || '').toLowerCase().includes(awayNeedle));
      } catch (err) {
        console.error('any-game-result team lookup error:', err);
        return interaction.reply({ ephemeral: true, content: `Error looking up teams: ${err.message}` });
      }

      if (!homeTeam) return interaction.reply({ ephemeral: true, content: `Home team "${homeTeamName}" not found.` });
      if (!awayTeam) return interaction.reply({ ephemeral: true, content: `Away team "${awayTeamName}" not found.` });

      const homeResult = homeScore > awayScore ? 'W' : 'L';
      const awayResult = homeScore > awayScore ? 'L' : 'W';

      const insertResp = await supabase.from('results').insert([
        {
          season: currentSeason, week,
          user_team_id: homeTeam.id, user_team_name: homeTeam.name,
          opponent_team_id: awayTeam.id, opponent_team_name: awayTeam.name,
          user_score: homeScore, opponent_score: awayScore,
          summary, result: homeResult,
          taken_by: homeTeam.taken_by, taken_by_name: homeTeam.taken_by_name || 'CPU'
        },
        {
          season: currentSeason, week,
          user_team_id: awayTeam.id, user_team_name: awayTeam.name,
          opponent_team_id: homeTeam.id, opponent_team_name: homeTeam.name,
          user_score: awayScore, opponent_score: homeScore,
          summary, result: awayResult,
          taken_by: awayTeam.taken_by, taken_by_name: awayTeam.taken_by_name || 'CPU'
        }
      ]);

      if (insertResp.error) {
        return interaction.reply({ ephemeral: true, content: `Failed to save result: ${insertResp.error.message}` });
      }

      try {
        for (const [team, result] of [[homeTeam, homeResult], [awayTeam, awayResult]]) {
          const { data: existingRecord } = await supabase.from('records').select('*').eq('season', currentSeason).eq('team_id', team.id).maybeSingle();
          await supabase.from('records').upsert({
            season: currentSeason,
            team_id: team.id,
            team_name: team.name,
            taken_by: team.taken_by,
            taken_by_name: team.taken_by_name || 'CPU',
            wins: (existingRecord?.wins || 0) + (result === 'W' ? 1 : 0),
            losses: (existingRecord?.losses || 0) + (result === 'L' ? 1 : 0),
            user_wins: existingRecord?.user_wins || 0,
            user_losses: existingRecord?.user_losses || 0
          }, { onConflict: 'season,team_id' });
        }
      } catch (err) {
        console.error('Failed to update records for any-game-result:', err);
      }

      return interaction.reply({
        ephemeral: true,
        content: `Result recorded for Week ${week}: ${homeTeam.name} ${homeScore} - ${awayTeam.name} ${awayScore}`
      });
    }
    */

    /* ---------------------------
     * /press-release (commented out)
     * ---------------------------
    if (name === 'press-release') {
      const text = interaction.options.getString('text');
      const seasonResp = await supabase.from('meta').select('value').eq('key','current_season').maybeSingle();
      const weekResp = await supabase.from('meta').select('value').eq('key','current_week').maybeSingle();
      const season = seasonResp.data?.value != null ? Number(seasonResp.data.value) : 1;
      const week = weekResp.data?.value != null ? Number(weekResp.data.value) : 0;

      const insert = await supabase.from('news_feed').insert([{ season, week, text }]);
      if (insert.error) {
        console.error("press-release insert error:", insert.error);
        return interaction.reply({ ephemeral: true, content: `Error: ${insert.error.message}` });
      }

      const guild = client.guilds.cache.first();
      if (guild) {
        const newsChannel = guild.channels.cache.find(c => c.name === 'news-feed' && c.isTextBased());
        if (newsChannel) {
          const embed = { title: 'Press Release', color: 0xffa500, description: text, timestamp: new Date() };
          await newsChannel.send({ embeds: [embed] }).catch(() => {});
        }
      }

      return interaction.reply({ ephemeral: true, content: "Press release posted." });
    }
    */

    /* ---------------------------
     * /advance (commented out)
     * ---------------------------
    if (name === 'advance') {
      try { await interaction.deferReply({ ephemeral: true }); } catch (err) { console.error("Failed to defer /advance:", err); return; }

      if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
        return interaction.editReply("Only the commissioner can advance the week.");
      }

      const weekResp = await supabase.from('meta').select('value').eq('key','current_week').maybeSingle();
      const currentWeek = weekResp.data?.value != null ? Number(weekResp.data.value) : 0;
      const seasonResp = await supabase.from('meta').select('value').eq('key','current_season').maybeSingle();
      const currentSeason = seasonResp.data?.value != null ? Number(seasonResp.data.value) : 1;

      const guild = client.guilds.cache.first();
      if (guild) {
        const advanceChannel = guild.channels.cache.find(c => c.name === 'advance' && c.isTextBased());
        if (advanceChannel) await advanceChannel.send("We have advanced to the next week").catch(() => {});
      }

      const newsResp = await supabase.from('news_feed').select('text').eq('week', currentWeek).eq('season', currentSeason);
      let pressReleaseBullets = [];
      if (newsResp.data && newsResp.data.length > 0) {
        pressReleaseBullets = newsResp.data.map(n => `• ${n.text}`);
      }

      let weeklyResultsText = "";
      try {
        const allSeasonResp = await supabase.from('results').select('*').eq('season', currentSeason);
        const weeklyResp = await supabase.from('results').select('*').eq('season', currentSeason).eq('week', currentWeek);
        const records = {};
        if (allSeasonResp.data) {
          for (const r of allSeasonResp.data) {
            if (!records[r.user_team_id]) records[r.user_team_id] = { name: r.user_team_name, wins: 0, losses: 0 };
            if (!records[r.opponent_team_id]) records[r.opponent_team_id] = { name: r.opponent_team_name, wins: 0, losses: 0 };
            if (r.result === 'W') { records[r.user_team_id].wins++; records[r.opponent_team_id].losses++; }
            else { records[r.user_team_id].losses++; records[r.opponent_team_id].wins++; }
          }
        }
        if (weeklyResp.data && weeklyResp.data.length > 0) {
          const { data: teamsData } = await supabase.from('teams').select('id,taken_by');
          const teamsMap = {};
          if (teamsData) { for (const t of teamsData) teamsMap[t.id] = t.taken_by; }
          weeklyResultsText = weeklyResp.data.map(r => {
            const userRec = records[r.user_team_id] || { wins: 0, losses: 0 };
            const oppRec = records[r.opponent_team_id] || { wins: 0, losses: 0 };
            const isOppUserControlled = teamsMap[r.opponent_team_id] != null;
            let result = `${r.user_team_name} ${r.user_score} - ${r.opponent_team_name} ${r.opponent_score}\n${r.user_team_name} (${userRec.wins}-${userRec.losses})`;
            if (isOppUserControlled) result += `\n${r.opponent_team_name} (${oppRec.wins}-${oppRec.losses})`;
            return result;
          }).join('\n\n');
        }
      } catch (err) {
        console.error('Failed to fetch weekly results for summary:', err);
      }

      if (guild) {
        const newsFeedChannel = guild.channels.cache.find(c => c.name === 'news-feed' && c.isTextBased());
        if (newsFeedChannel) {
          const weekLabel = Math.max(0, currentWeek - 1);
          const title = `Weekly Summary (Season ${currentSeason} — Week ${weekLabel})`;
          const bodyParts = [];
          if (pressReleaseBullets.length > 0) bodyParts.push(pressReleaseBullets.join('\n'));
          if (weeklyResultsText) bodyParts.push(`**Game Results:**\n${weeklyResultsText}`);
          const body = bodyParts.length > 0 ? bodyParts.join('\n\n') : 'No news this week.';
          const embed = { title, description: body, color: 0x1e90ff, timestamp: new Date() };
          await newsFeedChannel.send({ embeds: [embed] }).catch(() => {});
          const generalChannel = guild.channels.cache.find(c => c.name === 'general' && c.isTextBased());
          if (generalChannel) await generalChannel.send({ embeds: [embed] }).catch(() => {});
        }
      }

      const newWeek = currentWeek + 1;
      await supabase.from('meta').update({ value: newWeek }).eq('key', 'current_week');
      return interaction.editReply(`Advanced week to ${newWeek}.`);
    }
    */

    /* ---------------------------
     * /season-advance (commented out)
     * ---------------------------
    if (name === 'season-advance') {
      if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ ephemeral: true, content: "Only the commissioner can advance the season." });
      }

      const seasonResp = await supabase.from('meta').select('value').eq('key','current_season').maybeSingle();
      const currentSeason = seasonResp.data?.value ? Number(seasonResp.data.value) : 1;

      await supabase.from('meta').update({ value: currentSeason + 1 }).eq('key','current_season');
      await supabase.from('meta').update({ value: 0 }).eq('key','current_week');

      try {
        const guild = client.guilds.cache.first();
        if (guild) {
          const advanceChannel = guild.channels.cache.find(c => c.name === 'advance' && c.isTextBased());
          if (advanceChannel) await advanceChannel.send(`We have advanced to Season ${currentSeason + 1}`).catch(() => {});
        }
      } catch (err) {
        console.error('Failed to post season advance message:', err);
      }

      return interaction.reply({ ephemeral: true, content: `Season advanced to ${currentSeason + 1}, week reset to 0.` });
    }
    */

    /* ---------------------------
     * /ranking (commented out)
     * ---------------------------
    if (name === 'ranking') {
      if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ ephemeral: true, content: "Only the commissioner can view rankings." });
      }
      const isPublic = interaction.options.getBoolean('public') || false;
      try { await interaction.deferReply({ flags: isPublic ? 0 : 64 }); } catch (err) { console.error("Failed to defer /ranking:", err); return; }

      try {
        const seasonResp = await supabase.from('meta').select('value').eq('key', 'current_season').maybeSingle();
        const currentSeason = seasonResp.data?.value != null ? Number(seasonResp.data.value) : 1;
        const { data: records, error: recordsErr } = await supabase.from('records').select('*').eq('season', currentSeason);
        if (recordsErr) throw recordsErr;
        const { data: currentUsers, error: usersErr } = await supabase.from('teams').select('taken_by').not('taken_by', 'is', null);
        if (usersErr) throw usersErr;
        const currentUserIds = new Set((currentUsers || []).map(u => u.taken_by));
        const filteredRecords = (records || []).filter(r => currentUserIds.has(r.taken_by));
        const { data: results, error: resultsErr } = await supabase.from('results').select('*').eq('season', currentSeason);
        if (resultsErr) throw resultsErr;
        const h2hMap = {};
        if (results) {
          for (const r of results) {
            if (r.taken_by && r.opponent_team_id) {
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
        const getH2HWinPct = (userAId, userBId) => {
          const key = `${userAId}_vs_${userBId}`;
          if (!h2hMap[key]) return 0;
          const { wins, losses } = h2hMap[key];
          return (wins + losses) > 0 ? wins / (wins + losses) : 0;
        };
        const sorted = filteredRecords.sort((a, b) => {
          const winDiff = Math.abs(a.wins - b.wins);
          if (winDiff <= 1) {
            const aWinPct = (a.wins + a.losses) > 0 ? a.wins / (a.wins + a.losses) : 0;
            const bWinPct = (b.wins + b.losses) > 0 ? b.wins / (b.wins + b.losses) : 0;
            if (aWinPct !== bWinPct) return bWinPct - aWinPct;
          } else {
            return b.wins - a.wins;
          }
          const aUserPct = (a.user_wins + a.user_losses) > 0 ? a.user_wins / (a.user_wins + a.user_losses) : 0;
          const bUserPct = (b.user_wins + b.user_losses) > 0 ? b.user_wins / (b.user_wins + b.user_losses) : 0;
          if (aUserPct !== bUserPct) return bUserPct - aUserPct;
          const aH2H = getH2HWinPct(a.taken_by, b.taken_by);
          const bH2H = getH2HWinPct(b.taken_by, a.taken_by);
          if (aH2H !== bH2H) return bH2H - aH2H;
          return 0;
        });
        let description = '';
        for (let i = 0; i < sorted.length; i++) {
          const r = sorted[i];
          description += `${(i+1).toString().padStart(2, ' ')}.  ${r.taken_by_name || r.team_name}\n`;
          description += `    ${r.team_name}\n`;
          description += `    ${r.wins}-${r.losses} (${r.user_wins}-${r.user_losses})\n\n`;
        }
        if (!description) description = 'No user teams found.';
        else description += `*Record in parentheses is vs user teams only*`;
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
    */

    /* ---------------------------
     * /ranking-all-time (commented out)
     * ---------------------------
    if (name === 'ranking-all-time') {
      if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ ephemeral: true, content: "Only the commissioner can view rankings." });
      }
      const isPublic = interaction.options.getBoolean('public') || false;
      try { await interaction.deferReply({ flags: isPublic ? 0 : 64 }); } catch (err) { console.error("Failed to defer /ranking-all-time:", err); return; }

      try {
        const { data: allRecords, error: recordsErr } = await supabase.from('records').select('*');
        if (recordsErr) throw recordsErr;
        const { data: results, error: resultsErr } = await supabase.from('results').select('*');
        if (resultsErr) throw resultsErr;
        const h2hMap = {};
        if (results) {
          for (const r of results) {
            if (r.taken_by) {
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
        const getH2HWinPct = (userAId, userBId) => {
          const key = `${userAId}_vs_${userBId}`;
          if (!h2hMap[key]) return 0;
          const { wins, losses } = h2hMap[key];
          return (wins + losses) > 0 ? wins / (wins + losses) : 0;
        };
        const { data: currentUsers, error: usersErr } = await supabase.from('teams').select('taken_by, name').not('taken_by', 'is', null);
        if (usersErr) throw usersErr;
        const currentUserIds = new Set((currentUsers || []).map(u => u.taken_by));
        const userTeamMap = {};
        if (currentUsers) { for (const u of currentUsers) userTeamMap[u.taken_by] = u.name; }
        const userAggregates = {};
        if (allRecords) {
          for (const r of allRecords) {
            const userId = r.taken_by;
            if (!currentUserIds.has(userId)) continue;
            if (!userAggregates[userId]) {
              userAggregates[userId] = {
                taken_by: userId,
                taken_by_name: r.taken_by_name || 'Unknown',
                team_name: userTeamMap[userId] || 'No Team',
                wins: 0, losses: 0, user_wins: 0, user_losses: 0
              };
            }
            userAggregates[userId].wins += r.wins;
            userAggregates[userId].losses += r.losses;
            userAggregates[userId].user_wins += r.user_wins;
            userAggregates[userId].user_losses += r.user_losses;
          }
        }
        const sorted = Object.values(userAggregates).sort((a, b) => {
          const winDiff = Math.abs(a.wins - b.wins);
          if (winDiff <= 1) {
            const aWinPct = (a.wins + a.losses) > 0 ? a.wins / (a.wins + a.losses) : 0;
            const bWinPct = (b.wins + b.losses) > 0 ? b.wins / (b.wins + b.losses) : 0;
            if (aWinPct !== bWinPct) return bWinPct - aWinPct;
          } else {
            return b.wins - a.wins;
          }
          const aUserPct = (a.user_wins + a.user_losses) > 0 ? a.user_wins / (a.user_wins + a.user_losses) : 0;
          const bUserPct = (b.user_wins + b.user_losses) > 0 ? b.user_wins / (b.user_wins + b.user_losses) : 0;
          if (aUserPct !== bUserPct) return bUserPct - aUserPct;
          const aH2H = getH2HWinPct(a.taken_by, b.taken_by);
          const bH2H = getH2HWinPct(b.taken_by, a.taken_by);
          if (aH2H !== bH2H) return bH2H - aH2H;
          return 0;
        });
        let description = '';
        for (let i = 0; i < sorted.length; i++) {
          const r = sorted[i];
          description += `${(i+1).toString().padStart(2, ' ')}.  ${r.taken_by_name}\n`;
          description += `    ${r.team_name}\n`;
          description += `    ${r.wins}-${r.losses} (${r.user_wins}-${r.user_losses})\n\n`;
        }
        if (!description) description = 'No records found.';
        else description += `*Record in parentheses is vs user teams only*`;
        const embed = {
          title: '🏆 Headset Dynasty All-Time Rankings',
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
    */

    // ---------------------------
    // /move-coach
    // ---------------------------
    if (name === 'move-coach') {
      if (!isAuthorized(interaction.member)) return interaction.reply({ ephemeral: true, content: '⛔ You need to be a server admin or have the Commissioner role.' });
      await interaction.deferReply({ ephemeral: true });

      const league = await getLeague(interaction.guildId);
      if (!league) return interaction.editReply('League not configured. Run /setup first.');

      const coachUser = interaction.options.getUser('coach');
      const newSchoolId = parseInt(interaction.options.getString('new_team'));
      const newRoleOption = interaction.options.getString('role');

      // Find coach's current team
      const { data: currentTeam, error: currentErr } = await supabase
        .from('league_teams')
        .select('*, schools(name)')
        .eq('league_id', league.id)
        .eq('taken_by', coachUser.id)
        .maybeSingle();

      if (currentErr) return interaction.editReply(`Error: ${currentErr.message}`);
      if (!currentTeam) return interaction.editReply(`${coachUser.username} has no team in this league.`);

      // Validate new school
      const { data: newSchool } = await supabase
        .from('schools')
        .select('*')
        .eq('id', newSchoolId)
        .maybeSingle();

      if (!newSchool) return interaction.editReply('New school not found.');

      const { data: existingClaim } = await supabase
        .from('league_teams')
        .select('id, taken_by_name')
        .eq('league_id', league.id)
        .eq('school_id', newSchoolId)
        .maybeSingle();

      if (existingClaim) {
        return interaction.editReply(`**${newSchool.name}** is already taken by ${existingClaim.taken_by_name}.`);
      }

      const newRole = newRoleOption || currentTeam.role || 'HC';

      // Update league_teams: point to new school and set role
      await supabase.from('league_teams')
        .update({ school_id: newSchoolId, role: newRole })
        .eq('id', currentTeam.id);

      const oldSchoolName = currentTeam.schools?.name || 'old team';
      const guild = interaction.guild;

      // Rename team channel
      if (currentTeam.channel_id) {
        const ch = await guild.channels.fetch(currentTeam.channel_id).catch(() => null);
        if (ch) {
          const newChannelName = newSchool.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
          await ch.setName(newChannelName).catch(() => {});
        }
      }

      // Update nickname
      try {
        const member = await guild.members.fetch(coachUser.id);
        const nickname = `${newSchool.name} - ${newRole}`.substring(0, 32);
        await member.setNickname(nickname, 'Coach moved').catch(() => {});
      } catch (err) {
        console.log(`Could not update nickname for ${coachUser.id}:`, err.message);
      }

      // Announce in general
      const general = await client.channels.fetch(league.general_channel_id).catch(() => null);
      if (general) {
        general.send(`🔁 <@${coachUser.id}> has moved from **${oldSchoolName}** to **${newSchool.name}** (${newRole}).`).catch(() => {});
      }

      await runListTeamsDisplay(league);
      return interaction.editReply(`✅ Moved **${coachUser.username}** from **${oldSchoolName}** to **${newSchool.name}** (${newRole}).`);
    }

  } catch (err) {
    console.error('interactionCreate error:', err);
    try {
      if (interaction.replied || interaction.deferred) {
        await interaction.editReply(`Error: ${err.message}`);
      } else {
        await interaction.reply({ ephemeral: true, content: `Error: ${err.message}` });
      }
    } catch {}
  }
});

// ---------------------------------------------------------
// GUILD MEMBER REMOVE (auto-reset when user leaves)
// ---------------------------------------------------------
client.on('guildMemberRemove', async (member) => {
  try {
    const userId = member.id;
    const league = await getLeague(member.guild.id);
    if (!league) return;

    const { data: teamData, error } = await supabase
      .from('league_teams')
      .select('*, schools(name)')
      .eq('league_id', league.id)
      .eq('taken_by', userId)
      .maybeSingle();

    if (error || !teamData) return;

    const schoolName = teamData.schools?.name || 'their team';
    console.log(`User ${userId} left. Resetting ${schoolName}...`);

    await supabase.from('league_teams').delete().eq('id', teamData.id);

    if (teamData.channel_id) {
      const ch = await member.guild.channels.fetch(teamData.channel_id).catch(() => null);
      if (ch) await ch.delete('User left server').catch(() => {});
    }

    const general = await client.channels.fetch(league.general_channel_id).catch(() => null);
    if (general) {
      const coachName = teamData.taken_by_name || 'A coach';
      general.send(`👋 **${coachName}** has left the server. **${schoolName}** is now available.`).catch(() => {});
    }

    await runListTeamsDisplay(league);
    console.log(`Reset ${schoolName} for departed user ${userId}`);
  } catch (err) {
    console.error('guildMemberRemove error:', err);
  }
});

// ---------------------------------------------------------
// REACTION HANDLER (✅ in configured rules channel -> job offers)
// ---------------------------------------------------------
client.on('messageReactionAdd', async (reaction, user) => {
  try {
    if (user.partial) await user.fetch();
    if (user.bot) return;
    if (reaction.partial) await reaction.fetch();
    if (reaction.message.partial) await reaction.message.fetch();

    if (reaction.emoji.name !== '✅') return;

    const guildId = reaction.message.guildId;
    if (!guildId) return;

    const league = await getLeague(guildId);
    if (!league) return;

    // Only trigger in the configured rules channel
    if (reaction.message.channelId !== league.rules_channel_id) return;

    // Block if already has an active offer flow for this league
    if (client.userOffers && client.userOffers[user.id] && client.userOffers[user.id].guildId === guildId) {
      try { await user.send("You already have pending job offers — reply to my previous DM to continue."); } catch {}
      return;
    }

    try {
      await startOfferFlow(user, guildId);
    } catch (err) {
      console.error('startOfferFlow error:', err);
      try { await user.send(`Error starting job offers: ${err.message}`); } catch {}
    }
  } catch (err) {
    console.error('messageReactionAdd error:', err);
  }
});

// ---------------------------------------------------------
// DM ACCEPT OFFER (user replies to bot DM)
// Full flow (steps vary by league config):
//   choose_role           — ask HC/OC/DC (only when scheme_filter on + multiple roles)
//   choose_offense_scheme — ask offensive scheme (HC or OC, scheme_filter on)
//   choose_defense_scheme — ask defensive scheme (HC or DC, scheme_filter on)
//   choose_team           — show filtered offers, user picks number 1-N
//   (role may also be asked after team pick when scheme_filter is off + multiple roles)
// ---------------------------------------------------------
client.on('messageCreate', async msg => {
  try {
    if (msg.guild || msg.author.bot) return;

    const userId = msg.author.id;
    if (!client.userOffers || !client.userOffers[userId]) {
      // Try to restore a pending flow from DB (handles bot restarts mid-conversation)
      const restored = await restoreFlowFromDB(userId);
      if (!restored) return;
      const league = await getLeague(client.userOffers[userId].guildId);
      if (league) await resendFlowPrompt(msg.author, league, client.userOffers[userId]);
      return;
    }

    const offerData = client.userOffers[userId];
    const league = await getLeague(offerData.guildId);
    if (!league) return msg.reply('League configuration not found. Contact an admin.');

    // Role selection (pre-offer, only when scheme_filter is on)
    if (offerData.step === 'choose_role') {
      const roles = (league.allowed_roles || 'HC').split(',').map(r => r.trim().toUpperCase());
      const input = msg.content.trim().toUpperCase();
      if (!roles.includes(input)) {
        return msg.reply(`Invalid role. Reply with one of: **${roles.join(', ')}**`);
      }
      offerData.role = input;
      await advanceOfferFlow(msg.author, league, offerData);
      return;
    }

    // Offensive scheme selection
    if (offerData.step === 'choose_offense_scheme') {
      const choice = parseInt(msg.content.trim());
      if (isNaN(choice) || choice < 1 || choice > OFFENSE_SCHEMES.length) {
        return msg.reply(`Reply with a number between 1 and ${OFFENSE_SCHEMES.length}.`);
      }
      offerData.preferredOffenseScheme = OFFENSE_SCHEMES[choice - 1];
      await msg.reply(`Got it — **${offerData.preferredOffenseScheme}** offense.`);
      await advanceOfferFlow(msg.author, league, offerData);
      return;
    }

    // Defensive scheme selection
    if (offerData.step === 'choose_defense_scheme') {
      const choice = parseInt(msg.content.trim());
      if (isNaN(choice) || choice < 1 || choice > DEFENSE_SCHEMES.length) {
        return msg.reply(`Reply with a number between 1 and ${DEFENSE_SCHEMES.length}.`);
      }
      offerData.preferredDefenseScheme = DEFENSE_SCHEMES[choice - 1];
      await msg.reply(`Got it — **${offerData.preferredDefenseScheme}** defense.`);
      await advanceOfferFlow(msg.author, league, offerData);
      return;
    }

    // Team selection
    if (offerData.step === 'choose_team') {
      const offers = offerData.teams;
      const choice = parseInt(msg.content.trim());
      if (isNaN(choice) || choice < 1 || choice > offers.length) {
        return msg.reply(`Reply with a number between 1 and ${offers.length} to choose your team.`);
      }

      const school = offers[choice - 1];
      offerData.chosenTeam = school;

      // If role not set yet (scheme_filter off + multiple roles), ask now
      if (!offerData.role) {
        const roles = (league.allowed_roles || 'HC').split(',').map(r => r.trim()).filter(Boolean);
        if (roles.length === 1) {
          offerData.role = roles[0];
          await claimTeam(msg, offerData, school, offerData.role);
        } else {
          offerData.step = 'choose_role_after_team';
          offerData.chosenTeam = school;
          await persistFlowState(league.id, userId, offerData);
          await msg.reply(`You selected **${school.name}**! What role would you like?\nReply with one of: **${roles.join(', ')}**`);
        }
        return;
      }

      await claimTeam(msg, offerData, school, offerData.role);
      return;
    }

    // Role selection (post-offer, only when scheme_filter is off + multiple roles)
    if (offerData.step === 'choose_role_after_team') {
      const roles = (league.allowed_roles || 'HC').split(',').map(r => r.trim().toUpperCase());
      const input = msg.content.trim().toUpperCase();
      if (!roles.includes(input)) {
        return msg.reply(`Invalid role. Reply with one of: **${roles.join(', ')}**`);
      }
      offerData.role = input;
      await claimTeam(msg, offerData, offerData.chosenTeam, input);
    }
  } catch (err) {
    console.error('DM accept offer error:', err);
    try { await msg.reply('An error occurred. Please contact an admin.'); } catch {}
  }
});

// ---------------------------------------------------------
// START BOT
// ---------------------------------------------------------
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', async (err) => {
  console.error('Uncaught Exception:', err);
  try {
    if (client && client.destroy) await client.destroy();
  } catch {}
  process.exit(1);
});

client.on('guildCreate', async guild => {
  try {
    const owner = await guild.fetchOwner();
    await owner.send(`👋 Thanks for adding **Headset Dynasty Bot** to **${guild.name}**!\n\n${HELP_TEXT}`);
  } catch (err) {
    console.error(`guildCreate: could not DM owner of ${guild.name}:`, err.message);
  }
});

client.on('error', (err) => console.error('Discord client error:', err));
client.on('warn', (info) => console.warn('Discord client warning:', info));
client.on('shardError', (error) => console.error('Discord shardError:', error));

const _shutdown = async (signal) => {
  console.log(`Received ${signal} - shutting down gracefully...`);
  try {
    if (client && client.destroy) await client.destroy();
  } catch {}
  setTimeout(() => process.exit(0), 500);
};

process.on('SIGTERM', () => _shutdown('SIGTERM'));
process.on('SIGINT', () => _shutdown('SIGINT'));

client.login(process.env.DISCORD_TOKEN).catch(e => {
  console.error('Failed to login:', e);
});
