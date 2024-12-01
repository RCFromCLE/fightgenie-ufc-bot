const { EmbedBuilder, ButtonBuilder, ActionRowBuilder, ButtonStyle } = require('discord.js');

class ModelCommand {
    static currentModel = 'gpt';  // Default model

    static async handleModelCommand(message, args) {
        try {
            const model = args[0]?.toLowerCase();

            if (!['claude', 'gpt'].includes(model)) {
                await message.reply('Please specify a valid model: `$model claude` or `$model gpt`');
                return;
            }

            this.currentModel = model;
            const modelEmoji = model === 'gpt' ? '🧠' : '🤖';
            const modelName = model === 'gpt' ? 'GPT-4o' : 'Claude-3.5';

            const embed = new EmbedBuilder()
                .setColor('#0099ff')
                .setTitle('Model Selection')
                .setDescription(`Prediction model set to ${modelName} ${modelEmoji}`)
                .addFields({
                    name: 'Current Settings',
                    value: `Model: ${modelName}\nUse with upcoming fights for predictions.`
                });

            await message.reply({ embeds: [embed] });
        } catch (error) {
            console.error('Model command error:', error);
            await message.reply('An error occurred while setting the model.');
        }
    }

    static async handleModelInteraction(interaction) {
        try {
            const [_, model, eventId] = interaction.customId.split('_');

            if (!['Claude-3.5', 'gpt'].includes(model)) {
                await interaction.reply({
                    content: 'Invalid model selection.',
                    ephemeral: true
                });
                return;
            }

            this.currentModel = model;
            const modelEmoji = model === 'gpt' ? '🧠' : '🤖';
            const modelName = model === 'gpt' ? 'GPT-4o' : 'Claude-3.5';

            await interaction.reply({
                content: `Model switched to ${modelName} ${modelEmoji}`,
                ephemeral: true
            });
        } catch (error) {
            console.error('Model interaction error:', error);
            await interaction.reply({
                content: 'Error changing model. Please try again.',
                ephemeral: true
            });
        }
    }

    static getCurrentModel() {
        return this.currentModel || 'gpt'; // default to gpt if not set
    }
}
module.exports = ModelCommand;