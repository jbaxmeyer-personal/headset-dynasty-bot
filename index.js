require('dotenv').config();
const { Client, GatewayIntentBits, SlashCommandBuilder, Routes } = require('discord.js');
const { REST } = require('@discordjs/rest');
const { ChannelType, PermissionFlagsBits } = require('discord.js');
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
        .setDescription('Get your Headset Dynasty job offers'),
    new SlashCommandBuilder()
        .setName('resetteam')
        .setDescription('Reset a user’s team and free it back up')
        .addUserOption(option =>
            option.setName('coach')
            .setDescription('The coach to reset')
            .setRequired(true)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    new SlashCommandBuilder()
        .setName('listteams')
        .setDescription('Post a list of taken and available teams to the member-list channel')
].map(cmd => cmd.toJSON());

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

    if (commandName === 'resetteam') {
        const coach = interaction.options.getUser('coach');
        const guild = interaction.guild;
        const member = await guild.members.fetch(coach.id);

        // Find which team they have
        const team = teams.find(t => t.takenBy === coach.id);

        if (!team) {
            await interaction.reply({ content: `${coach.username} does not control a team.`, ephemeral: true });
            return;
        }

        // Free team
        team.takenBy = null;
        fs.writeFileSync('./teams.json', JSON.stringify(teams, null, 2));

        // Remove Head Coach role
        const role = guild.roles.cache.find(r => r.name === "Head Coach");
        if (role && member.roles.cache.has(role.id)) {
            await member.roles.remove(role);
        }

        // Reset nickname
        await member.setNickname(null).catch(() => {});

        // Delete team channel
        const channelName = team.name.toLowerCase().replace(/\s+/g, '-');
        const channel = guild.channels.cache.find(c => c.name === channelName);
        if (channel) await channel.delete().catch(() => {});

        await interaction.reply({ content: `Team ${team.name} has been reset and freed up.`, ephemeral: true });
        await sendTeamList(interaction.client);
    }

    if (commandName === 'listteams') {
        await interaction.deferReply({ ephemeral: true });

        await sendTeamList(client);

        await interaction.editReply("Team list updated in **#member-list**.");
    }

});

async function announceInGeneral(client, message) {
    const guild = client.guilds.cache.first();
    if (!guild) return;

    const channel = guild.channels.cache.find(
        c => c.name === "general" && c.isTextBased()
    );
    if (!channel) return;

    await channel.send(message);
}

async function sendTeamList(client) {
    const guild = client.guilds.cache.first();
    if (!guild) return;

    const channel = guild.channels.cache.find(
        c => c.name === "member-list" && c.type === 0 // GuildText
    );
    if (!channel) return;

    // Delete prior bot messages
    const messages = await channel.messages.fetch({ limit: 20 });
    const botMessages = messages.filter(m => m.author.id === client.user.id);

    for (const msg of botMessages.values()) {
        await msg.delete().catch(() => {});
    }

    // Build taken teams list
    const takenTeams = [];
    for (const t of teams.filter(t => t.takenBy)) {
        let coach;
        try {
            coach = await guild.members.fetch(t.takenBy);
        } catch {
            coach = null;
        }
        takenTeams.push(
            `🏈 **${t.name}** — ${coach ? coach.user.username : "Unknown Coach"}`
        );
    }
    const taken = takenTeams.length ? takenTeams.join('\n') : "None";

    // Build available list
    const available = teams
        .filter(t => !t.takenBy)
        .map(t => `🟢 ${t.name}`)
        .join('\n') || "None";

    // Build embed
    const embed = {
        title: "🏈 Headset Dynasty – Team Availability",
        color: 0x2b2d31,
        fields: [
            { name: "Taken Teams", value: taken },
            { name: "Available Teams", value: available }
        ],
        timestamp: new Date()
    };

    // Post new embed and pin it
    const newMsg = await channel.send({ embeds: [embed] });
    await newMsg.pin().catch(() => {});
}


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

    // Assign Discord role + create channel + set nickname
    const guilds = client.guilds.cache;
    guilds.forEach(async guild => {
        const member = await guild.members.fetch(userId);

        // Give Head Coach role
        const role = guild.roles.cache.find(r => r.name === "Head Coach");
        if (role) await member.roles.add(role);

        // OPTIONAL: Change nickname to team name
        await member.setNickname(team.name).catch(err => console.log("Could not change nickname:", err));

        // Find the category named "Text Channels"
        let category = guild.channels.cache.find(
            c => c.name === "Text Channels" && c.type === 4
        );
        if (!category) {
            console.log("Category 'Text Channels' not found!");
        }

        // Channel name (replace spaces with dashes)
        const channelName = team.name.toLowerCase().replace(/\s+/g, '-');

        // Create the team channel (inherits permissions from category)
        let channel = await guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        parent: category.id
        });

        // Post welcome message
        const welcome = await channel.send(
            `Welcome Coach **${member.user.username}**!\n\n` +
            `This is your channel for **${team.name}**.\n` +
            `Use this space to post your game video streams and anything else you want about your team.\n\n` +
            `Good luck this season! 🏈🔥`
        );

    });


    await message.reply(`Congratulations! You have accepted the team: ${team.name}. Your private channel and role have been created.`);
    delete client.userOffers[userId];
    await announceInGeneral(interaction.client, `🏈 **${interaction.user.username}** has claimed **${team}**!`);
    await sendTeamList(interaction.client);
});


client.login(process.env.DISCORD_TOKEN);
