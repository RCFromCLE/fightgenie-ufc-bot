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
        .setDescription('Compare prediction accuracy between Claude and GPT models')
        .addStringOption(option =>
            option.setName('fighter')
                .setDescription('Fighter name to check stats for')
                .setRequired(false)),
    
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
        .setName('sub')
        .setDescription('Check bot status and learn about supporting Fight Genie'),
    
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
                .setDescription('Advance to the next event'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('forceupdate')
                .setDescription('Force update current event'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('updatefighterstats')
                .setDescription('Update all fighter stats for current event'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('runallpredictions')
                .setDescription('Generate all predictions for current event'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('syncpredictions')
                .setDescription('Sync predictions from database'))
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
