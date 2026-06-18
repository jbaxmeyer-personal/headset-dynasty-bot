require('dotenv').config();
const { REST, Routes, SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

const commands = [
  new SlashCommandBuilder()
    .setName('setup')
    .setDescription("Configure this server's dynasty league (admin only)")
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

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

  new SlashCommandBuilder()
    .setName('help')
    .setDescription('Show available commands and how to set up this bot')
    .setDMPermission(false),

  new SlashCommandBuilder()
    .setName('invite')
    .setDescription('Get the link to add this bot to another server')
    .setDMPermission(false),

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
