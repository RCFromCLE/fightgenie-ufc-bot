const { EmbedBuilder, ButtonBuilder, ActionRowBuilder, ButtonStyle } = require('discord.js');

class ModelCommand {
    static currentModel = 'gpt';  // Default model

    static async handleModelCommand(interaction, args) {
        try {
            const model = args[0]?.toLowerCase();

            if (!['claude', 'gpt'].includes(model)) {
                await interaction.editReply('Please specify a valid model: `/model claude` or `/model gpt`');
                return;
            }

            this.currentModel = model;
            const modelEmoji = model === 'gpt' ? '🧠' : '🤖';
            const modelName = model === 'gpt' ? 'GPT' : 'Claude'; // Updated display name

            const embed = new EmbedBuilder()
                .setColor('#0099ff')
                .setTitle('Model Selection')
                .setDescription(`Prediction model set to ${modelName} ${modelEmoji}`)
                .addFields({
                    name: 'Current Settings',
                    value: `Model: ${modelName}\nUse with upcoming fights for predictions.`
                });

            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            console.error('Model command error:', error);
            await interaction.editReply('An error occurred while setting the model.');
        }
    }

    static async handleModelInteraction(interaction) {
        try {
            const [_, model, eventId] = interaction.customId.split('_');

            if (!['Claude', 'gpt'].includes(model)) {
                // For button interactions that are already deferred, use editReply
                if (interaction.deferred) {
                    await interaction.editReply({
                        content: 'Invalid model selection.',
                        ephemeral: true
                    });
                } else {
                    await interaction.reply({
                        content: 'Invalid model selection.',
                        ephemeral: true
                    });
                }
                return;
            }

            this.currentModel = model;
            const modelEmoji = model === 'gpt' ? '🧠' : '🤖';
            const modelName = model === 'gpt' ? 'GPT' : 'Claude'; // Updated display name

            // For button interactions that are already deferred, use editReply
            if (interaction.deferred) {
                await interaction.editReply({
                    content: `Model switched to ${modelName} ${modelEmoji}`,
                    ephemeral: true
                });
            } else {
                await interaction.reply({
                    content: `Model switched to ${modelName} ${modelEmoji}`,
                    ephemeral: true
                });
            }
        } catch (error) {
            console.error('Model interaction error:', error);
            // For button interactions that are already deferred, use editReply
            if (interaction.deferred) {
                await interaction.editReply({
                    content: 'Error changing model. Please try again.',
                    ephemeral: true
                });
            } else {
                await interaction.reply({
                    content: 'Error changing model. Please try again.',
                    ephemeral: true
                });
            }
        }
    }

    static getCurrentModel() {
        return this.currentModel || 'gpt'; // default to gpt if not set
    }
}
module.exports = ModelCommand;
