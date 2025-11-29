require('dotenv').config();

const http = require('http');

const PORT = process.env.PORT || 3000;  // Render injects PORT automatically

http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("OK");
}).listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});


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

const jobOfferUsed = new Set();
const fs = require('fs');
let teams = JSON.parse(fs.readFileSync('./teams.json'));

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

const commands = [
    new SlashCommandBuilder()
        .setName('joboffers')
        .setDescription('Get your Headset Dynasty job offers'),
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
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

client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}`);
});

// ---------------------------------------------------------
// SLASH COMMANDS
// ---------------------------------------------------------

client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;

    const { commandName } = interaction;

    // Soft-lock for slash command
    if (commandName === 'joboffers') {

        if (jobOfferUsed.has(interaction.user.id)) {
            return interaction.reply({
                content: "⛔ You’ve already received your job offer.",
                ephemeral: true
            });
        }

        jobOfferUsed.add(interaction.user.id);

        const availableTeams = teams.filter(t => !t.takenBy);

        if (availableTeams.length === 0) {
            await interaction.reply({ content: 'No teams are currently available!', ephemeral: true });
            return;
        }

        let offers = [];
        let tempTeams = [...availableTeams];

        for (let i = 0; i < 4; i++) {
            if (tempTeams.length === 0) break;
            const index = Math.floor(Math.random() * tempTeams.length);
            offers.push(tempTeams[index]);
            tempTeams.splice(index, 1);
        }

        if (!client.userOffers) client.userOffers = {};
        client.userOffers[interaction.user.id] = offers;

        try {
            await interaction.user.send(
                `Your Headset Dynasty job offers:\n\n` +
                offers.map((t, i) => `${i + 1}️⃣ ${t.name}`).join('\n') +
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

        const team = teams.find(t => t.takenBy === coach.id);

        if (!team) {
            await interaction.reply({ content: `${coach.username} does not control a team.`, ephemeral: true });
            return;
        }

        team.takenBy = null;
        jobOfferUsed.delete(coach.id);
        fs.writeFileSync('./teams.json', JSON.stringify(teams, null, 2));

        const role = guild.roles.cache.find(r => r.name === "Head Coach");
        if (role && member.roles.cache.has(role.id)) {
            await member.roles.remove(role);
        }

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

// ---------------------------------------------------------
// REACTION HANDLER
// ---------------------------------------------------------

client.on("messageReactionAdd", async (reaction, user) => {
    try {
        if (user.bot) return;

        if (reaction.partial) await reaction.fetch();
        if (reaction.message.partial) await reaction.message.fetch();

        if (reaction.message.channel.id !== '1437485874190225548') return;

        if (reaction.emoji.name !== "✅") return;

        handleJobOffer(user, reaction.message.guild);

    } catch (err) {
        console.error("Reaction handler error:", err);
    }
});

// ---------------------------------------------------------
// JOB OFFER DM LOGIC
// ---------------------------------------------------------

async function sendJobOffers(user) {
    const availableTeams = teams.filter(t => !t.takenBy);
    if (availableTeams.length === 0) {
        try {
            await user.send('No teams are currently available!');
        } catch { }
        return;
    }

    let offers = [];
    let tempTeams = [...availableTeams];

    for (let i = 0; i < 4; i++) {
        if (tempTeams.length === 0) break;
        const index = Math.floor(Math.random() * tempTeams.length);
        offers.push(tempTeams[index]);
        tempTeams.splice(index, 1);
    }

    if (!client.userOffers) client.userOffers = {};
    client.userOffers[user.id] = offers;

    try {
        await user.send(
            `Your Headset Dynasty job offers:\n\n` +
            offers.map((t, i) => `${i + 1}️⃣ ${t.name}`).join('\n') +
            `\n\nReply with the number of the team you want to accept.`
        );
    } catch (err) {
        console.error(`Could not DM ${user.username}`, err);
    }
}

// ---------------------------------------------------------
// SOFT-LOCK LOGIC FOR REACTION
// ---------------------------------------------------------

async function handleJobOffer(user, guild, interaction = null) {
    const userId = user.id;

    if (jobOfferUsed.has(userId)) {
        if (interaction) {
            return interaction.reply({
                content: "⛔ You’ve already received your job offer.",
                ephemeral: true
            });
        } else {
            try {
                await user.send("⛔ You’ve already received your job offer.");
            } catch (e) {
                console.log("Failed to DM user:", e);
            }
            return;
        }
    }

    jobOfferUsed.add(userId);

    await sendJobOffers(user);
}

// ---------------------------------------------------------
// DM RESPONSE HANDLER
// ---------------------------------------------------------

client.on('messageCreate', async message => {
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

    const teamObj = teams.find(t => t.name === team.name);
    if (teamObj.takenBy) {
        await message.reply('Sorry, that team was just taken by someone else.');
        delete client.userOffers[userId];
        return;
    }

    teamObj.takenBy = userId;
    fs.writeFileSync('./teams.json', JSON.stringify(teams, null, 2));

    const guilds = client.guilds.cache;
    guilds.forEach(async guild => {
        const member = await guild.members.fetch(userId);

        const role = guild.roles.cache.find(r => r.name === "Head Coach");
        if (role) await member.roles.add(role);

        let category = guild.channels.cache.find(
            c => c.name === "Text Channels" && c.type === 4
        );

        const channelName = team.name.toLowerCase().replace(/\s+/g, '-');

        let channel = await guild.channels.create({
            name: channelName,
            type: ChannelType.GuildText,
            parent: category?.id || null
        });

        await channel.send(
            `Welcome Coach **${member.user.displayName}**!\n\n` +
            `This is your channel for **${team.name}**.\n` +
            `Use this space to post your game video streams and anything else you want about your team.\n\n` +
            `Good luck this season! 🏈🔥`
        );
    });

    await message.reply(
        `Congratulations! You have accepted the team: **${team.name}**. Your private channel and role have been created.`
    );

    delete client.userOffers[userId];

    await announceInGeneral(
        client,
        `🏈 **${message.author.displayName}** has claimed **${team.name}**!`
    );

    await sendTeamList(client);
});

// ---------------------------------------------------------
// SUPPORTING FUNCTIONS
// ---------------------------------------------------------

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
        c => c.name === "member-list" && c.type === 0
    );
    if (!channel) return;

    const messages = await channel.messages.fetch({ limit: 20 });
    const botMessages = messages.filter(m => m.author.id === client.user.id);

    for (const msg of botMessages.values()) {
        await msg.delete().catch(() => {});
    }

    const takenTeams = [];
    for (const t of teams.filter(t => t.takenBy)) {
        let coach;
        try {
            coach = await guild.members.fetch(t.takenBy);
        } catch {
            coach = null;
        }

        takenTeams.push(
            `🏈 **${t.name}** — ${coach ? `<@${coach.id}>` : "Unknown Coach"}`
        );
    }

    const taken = takenTeams.length ? takenTeams.join('\n') : "None";

    const available = teams
        .filter(t => !t.takenBy)
        .map(t => `🟢 ${t.name}`)
        .join('\n') || "None";

    const embed = {
        title: "🏈 Headset Dynasty – Team Availability",
        color: 0x2b2d31,
        fields: [
            { name: "Taken Teams", value: taken },
            { name: "Available Teams", value: available }
        ],
        timestamp: new Date()
    };

    const newMsg = await channel.send({ embeds: [embed] });
    await newMsg.pin().catch(() => {});
}

client.login(process.env.DISCORD_TOKEN);
