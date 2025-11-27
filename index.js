require('dotenv').config();
const { Client, GatewayIntentBits, SlashCommandBuilder, Routes } = require('discord.js');
const { REST } = require('@discordjs/rest');

const fs = require('fs');
let teams = JSON.parse(fs.readFileSync('./teams.json'));

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages
    ],
});

const commands = [
    new SlashCommandBuilder()
        .setName('joboffers')
        .setDescription('Get your Headset Dynasty job offers')
        .toJSON()
];

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

// Register the slash command for your server
(async () => {
    try {
        console.log('Started refreshing application (/) commands.');
        await rest.put(
            Routes.applicationCommands('1443468715126685900'),
            { body: commands },
        );
        console.log('Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error(error);
    }
})();

// Ready event
client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}`);
});

// Handle slash commands
client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;

    const { commandName } = interaction;

    if (commandName === 'joboffers') {
    // Filter only available teams
    const availableTeams = teams.filter(t => !t.takenBy);

    if (availableTeams.length === 0) {
        await interaction.reply({ content: 'No teams are currently available!', ephemeral: true });
        return;
    }

    // Pick 3 unique random teams
    let offers = [];
    let tempTeams = [...availableTeams];

    for (let i = 0; i < 3; i++) {
        if (tempTeams.length === 0) break;
        const index = Math.floor(Math.random() * tempTeams.length);
        offers.push(tempTeams[index]);
        tempTeams.splice(index, 1);
    }

    // Store offers in memory for this user (we’ll need it to validate their reply)
    if (!client.userOffers) client.userOffers = {};
    client.userOffers[interaction.user.id] = offers;

    // DM the user
    try {
        await interaction.user.send(
            `Your Headset Dynasty job offers:\n\n` +
            offers.map((t, i) => `${i+1}️⃣ ${t.name}`).join('\n') +
            `\n\nReply with the number of the team you want to accept.`
        );
        await interaction.reply({ content: 'Check your DMs for your job offers!', ephemeral: true });
    } catch (error) {
        console.error('Could not DM user:', error);
        await interaction.reply({ content: 'I could not DM you. Do you have DMs disabled?', ephemeral: true });
    }
}


});

client.on('messageCreate', async message => {
    // Only process DMs, ignore bot messages
    if (message.author.bot || message.guild) return;

    const userId = message.author.id;

    if (!client.userOffers || !client.userOffers[userId]) return;

    const offers = client.userOffers[userId];
    const choice = parseInt(message.content);

    if (!choice || choice < 1 || choice > offers.length) {
        await message.reply('Please reply with the number corresponding to the team you want to accept.');
        return;
    }

    const team = offers[choice - 1];

    // Check if team is still available
    const teamObj = teams.find(t => t.name === team.name);
    if (teamObj.takenBy) {
        await message.reply('Sorry, that team was just taken by someone else.');
        delete client.userOffers[userId];
        return;
    }

    // Assign the team to the user
    teamObj.takenBy = userId;
    fs.writeFileSync('./teams.json', JSON.stringify(teams, null, 2));

    // Assign Discord role
    const guilds = client.guilds.cache;
    guilds.forEach(async guild => {
        const member = await guild.members.fetch(userId);
        let role = guild.roles.cache.find(r => r.name === team.name);
        if (!role) {
            // Create role if it doesn’t exist
            role = await guild.roles.create({ name: team.name });
        }
        await member.roles.add(role);

        // Create private channel
        let channelName = team.name.toLowerCase().replace(/\s/g, '-');
        let channel = guild.channels.cache.find(c => c.name === channelName && c.type === 0);
        if (!channel) {
            channel = await guild.channels.create({
                name: channelName,
                type: 0, // GUILD_TEXT
                permissionOverwrites: [
                    {
                        id: guild.roles.everyone.id,
                        deny: ['ViewChannel']
                    },
                    {
                        id: role.id,
                        allow: ['ViewChannel', 'SendMessages']
                    }
                ]
            });
        }
    });

    await message.reply(`Congratulations! You have accepted the team: ${team.name}. Your private channel and role have been created.`);
    delete client.userOffers[userId];
});


client.login(process.env.DISCORD_TOKEN);
