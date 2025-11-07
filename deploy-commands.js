const { REST, Routes, SlashCommandBuilder } = require('discord.js');
require('dotenv').config();

const commands = [
    new SlashCommandBuilder()
        .setName('upcoming')
        .setDescription('Show the next upcoming UFC event with predictions & analysis'),
    
    new SlashCommandBuilder()
        .setName('predict')
        .setDescription('Generate or view fight predictions')
        .addStringOption(option =>
            option.setName('fighter1')
                .setDescription('First fighter name')
                .setRequired(false))
        .addStringOption(option =>
            option.setName('fighter2')
                .setDescription('Second fighter name')
                .setRequired(false))
        .addStringOption(option =>
            option.setName('card')
                .setDescription('Card type')
                .addChoices(
                    { name: 'Main Card', value: 'main' },
                    { name: 'Preliminary Card', value: 'prelims' }
                )
                .setRequired(false))
        .addStringOption(option =>
            option.setName('model')
                .setDescription('AI model to use')
                .addChoices(
                    { name: 'GPT', value: 'gpt' },
                    { name: 'Claude', value: 'claude' }
                )
                .setRequired(false)),
    
    new SlashCommandBuilder()
        .setName('stats')
        .setDescription('Compare prediction accuracy between Claude and GPT models'),
    
    new SlashCommandBuilder()
        .setName('model')
        .setDescription('Switch between Claude and GPT for predictions')
        .addStringOption(option =>
            option.setName('type')
                .setDescription('AI model to use')
                .addChoices(
                    { name: 'GPT', value: 'gpt' },
                    { name: 'Claude', value: 'claude' }
                )
                .setRequired(true)),
    
    new SlashCommandBuilder()
        .setName('checkstats')
        .setDescription('View fighter stats used for prediction analysis')
        .addStringOption(option =>
            option.setName('fighter')
                .setDescription('Fighter name')
                .setRequired(true)),
    
    new SlashCommandBuilder()
        .setName('donate')
        .setDescription('Support Fight Genie\'s development and server costs'),
    
    new SlashCommandBuilder()
        .setName('status')
        .setDescription('View bot status, stats, and helpful information'),
    
    new SlashCommandBuilder()
        .setName('help')
        .setDescription('Show all available commands and how to use them'),

    // Admin commands
    new SlashCommandBuilder()
        .setName('admin')
        .setDescription('Admin commands for Fight Genie')
        .addSubcommand(subcommand =>
            subcommand
                .setName('advance')
                .setDescription('Advance to the next event')
                .addStringOption(option =>
                    option.setName('password')
                        .setDescription('Admin password')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('forceupdate')
                .setDescription('Force update current event')
                .addStringOption(option =>
                    option.setName('password')
                        .setDescription('Admin password')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('updatefighterstats')
                .setDescription('Update all fighter stats for current event')
                .addStringOption(option =>
                    option.setName('password')
                        .setDescription('Admin password')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('runallpredictions')
                .setDescription('Generate all predictions for current event')
                .addStringOption(option =>
                    option.setName('password')
                        .setDescription('Admin password')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('syncpredictions')
                .setDescription('Sync predictions from database')
                .addStringOption(option =>
                    option.setName('password')
                        .setDescription('Admin password')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('rollback')
                .setDescription('Rollback to a previous event')
                .addStringOption(option =>
                    option.setName('password')
                        .setDescription('Admin password')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('enableadminmode')
                .setDescription('Enable admin mode - restrict bot to admin server only')
                .addStringOption(option =>
                    option.setName('password')
                        .setDescription('Admin password')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('disableadminmode')
                .setDescription('Disable admin mode - allow bot to respond to all servers')
                .addStringOption(option =>
                    option.setName('password')
                        .setDescription('Admin password')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('adminstatus')
                .setDescription('Check current admin mode status')
                .addStringOption(option =>
                    option.setName('password')
                        .setDescription('Admin password')
                        .setRequired(true)))
];

const rest = new REST().setToken(process.env.DISCORD_TOKEN);

(async () => {
    try {
        console.log('Started refreshing application (/) commands.');

        await rest.put(
            Routes.applicationCommands(process.env.DISCORD_CLIENT_ID),
            { body: commands },
        );

        console.log('Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error(error);
    }
})();
