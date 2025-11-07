const { EmbedBuilder, ButtonBuilder, ActionRowBuilder, ButtonStyle } = require('discord.js');

class ModelCommand {
    static serverModels = new Map();  // Store models per server

    static async handleModelCommand(interaction, args) {
        try {
            const model = args[0]?.toLowerCase();
            const serverId = interaction.guild?.id;

            if (!['claude', 'gpt'].includes(model)) {
                await interaction.editReply('Please specify a valid model: `/model claude` or `/model gpt`');
                return;
            }

            // Set model for this specific server
            this.serverModels.set(serverId, model);
            const modelEmoji = model === 'gpt' ? '🧠' : '🤖';
            const modelName = model === 'gpt' ? 'GPT' : 'Claude'; // Updated display name

            const embed = new EmbedBuilder()
                .setColor('#0099ff')
                .setTitle('Model Selection')
                .setDescription(`Prediction model set to ${modelName} ${modelEmoji} for this server`)
                .addFields({
                    name: 'Current Settings',
                    value: `Model: ${modelName}\nServer: ${interaction.guild?.name || 'Unknown'}\nUse with upcoming fights for predictions.`
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
            const serverId = interaction.guild?.id;

            if (!['claude', 'gpt'].includes(model)) {
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

            // Set model for this specific server
            this.serverModels.set(serverId, model);
            const modelEmoji = model === 'gpt' ? '🧠' : '🤖';
            const modelName = model === 'gpt' ? 'GPT' : 'Claude'; // Updated display name

            // For button interactions that are already deferred, use editReply
            if (interaction.deferred) {
                await interaction.editReply({
                    content: `Model switched to ${modelName} ${modelEmoji} for this server`,
                    ephemeral: true
                });
            } else {
                await interaction.reply({
                    content: `Model switched to ${modelName} ${modelEmoji} for this server`,
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

    static getCurrentModel(serverId) {
        return this.serverModels.get(serverId) || 'gpt'; // default to gpt if not set for this server
    }
}
module.exports = ModelCommand;
