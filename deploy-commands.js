require('dotenv').config();
const { REST, Routes, SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

const commands = [
  new SlashCommandBuilder()
    .setName('setup')
    .setDescription("Configure this server's dynasty league (admin only)")
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption(o => o.setName('general').setDescription('General announcements channel').setRequired(true))
    .addChannelOption(o => o.setName('rules').setDescription('Rules channel (✅ reaction triggers job offers)').setRequired(true))
    .addChannelOption(o => o.setName('team_list').setDescription('#team-list channel').setRequired(true))
    .addRoleOption(o => o.setName('coach_role').setDescription('The coach role to assign to new coaches').setRequired(true))
    .addStringOption(o => o
      .setName('allowed_roles')
      .setDescription('Which coaching roles are available in this league')
      .setRequired(true)
      .addChoices(
        { name: 'HC only', value: 'HC' },
        { name: 'OC and DC only', value: 'OC,DC' },
        { name: 'All (HC, OC, DC)', value: 'HC,OC,DC' }
      ))
    .addStringOption(o => o
      .setName('conferences')
      .setDescription('Comma-separated conferences, or ALL (e.g. "SEC,Big Ten,ACC"). Default: ALL')
      .setRequired(false))
    .addNumberOption(o => o
      .setName('min_stars')
      .setDescription('Minimum school prestige 0.0-5.0 (default 0.0)')
      .setMinValue(0)
      .setMaxValue(5)
      .setRequired(false))
    .addNumberOption(o => o
      .setName('max_stars')
      .setDescription('Maximum school prestige 0.0-5.0 (default 5.0)')
      .setMinValue(0)
      .setMaxValue(5)
      .setRequired(false)),

  new SlashCommandBuilder()
    .setName('joboffers')
    .setDescription('Send job offers to a user (admin only)')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption(o => o.setName('user').setDescription('The user to send offers to').setRequired(true)),

  new SlashCommandBuilder()
    .setName('listteams')
    .setDescription('Refresh the #team-list channel (admin only)')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('resetteam')
    .setDescription('Remove a coach from their team (admin only)')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption(o => o.setName('user').setDescription('The coach to remove').setRequired(true)),

  new SlashCommandBuilder()
    .setName('move-coach')
    .setDescription('Move a coach to a different school (admin only)')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption(o => o.setName('coach').setDescription('The coach to move').setRequired(true))
    .addStringOption(o => o
      .setName('new_team')
      .setDescription('The new school')
      .setRequired(true)
      .setAutocomplete(true)),

].map(c => c.toJSON());

(async () => {
  try {
    console.log('Registering global commands (may take up to 1 hour to propagate to all servers)...');
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
    console.log('Global commands registered successfully.');
  } catch (err) {
    console.error('Failed to register commands:', err);
  }
})();
