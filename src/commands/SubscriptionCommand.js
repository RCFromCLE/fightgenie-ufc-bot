const { EmbedBuilder } = require('discord.js');
const database = require('../database'); 
const EventHandlers = require('../utils/eventHandlers');

class SubscriptionCommand {
    static async handleSubscriptionStatus(interaction) {
        try {
            const guildName = interaction.guild ? interaction.guild.name : "this server";
            const client = interaction.client;
            
            // Get bot stats
            const serverCount = client.guilds.cache.size;
            const userCount = client.users.cache.size;
            
            // Get current event info
            let currentEventInfo = "No upcoming event";
            try {
                const event = await EventHandlers.getUpcomingEvent();
                if (event) {
                    currentEventInfo = `${event.Event} - ${new Date(event.Date).toLocaleDateString()}`;
                }
            } catch (err) {
                console.error('Error fetching event for status:', err);
            }
            
            // Get prediction stats
            let predictionStats = { total: 0, gpt: 0, claude: 0 };
            try {
                const stats = await database.query(`
                    SELECT 
                        COUNT(*) as total,
                        SUM(CASE WHEN model_used = 'gpt' THEN 1 ELSE 0 END) as gpt,
                        SUM(CASE WHEN model_used = 'claude' THEN 1 ELSE 0 END) as claude
                    FROM stored_predictions
                    WHERE created_at > datetime('now', '-30 days')
                `);
                if (stats?.[0]) {
                    predictionStats = stats[0];
                }
            } catch (err) {
                console.error('Error fetching prediction stats:', err);
            }

            const infoEmbed = new EmbedBuilder()
                .setColor('#0099ff')
                .setTitle('📊 Fight Genie Status & Information')
                .setDescription([
                    `**Welcome to Fight Genie in ${guildName}!**`,
                    "",
                    "Fight Genie is your premier AI-powered UFC prediction bot, providing comprehensive fight analysis and betting insights."
                ].join('\n'))
                .addFields(
                    {
                        name: '🤖 Bot Status',
                        value: [
                            `**Status:** ✅ Online`,
                            `**Servers:** ${serverCount}`,
                            `**Users:** ${userCount}`,
                            `**Version:** 2.0.0`
                        ].join('\n'),
                        inline: true
                    },
                    {
                        name: '🥊 Current Event',
                        value: currentEventInfo,
                        inline: true
                    },
                    {
                        name: '📈 30-Day Stats',
                        value: [
                            `**Total Predictions:** ${predictionStats.total || 0}`,
                            `**GPT Predictions:** ${predictionStats.gpt || 0}`,
                            `**Claude Predictions:** ${predictionStats.claude || 0}`
                        ].join('\n'),
                        inline: true
                    },
                    {
                        name: '✨ Features',
                        value: [
                            '• Dual AI models (GPT-4 & Claude-3)',
                            '• Real-time betting odds analysis',
                            '• Comprehensive fighter statistics',
                            '• Market intelligence reports',
                            '• Historical accuracy tracking'
                        ].join('\n'),
                        inline: false
                    },
                    {
                        name: '💡 Quick Tips',
                        value: [
                            '• Use `/upcoming` to see the next UFC event',
                            '• Generate predictions with the interactive buttons',
                            '• Switch models with `/model [gpt/claude]`',
                            '• View accuracy stats with `/stats`',
                            '• Check fighter data with `/checkstats [fighter]`'
                        ].join('\n'),
                        inline: false
                    },
                    {
                        name: '💖 Support Fight Genie',
                        value: [
                            'Fight Genie is **FREE** for everyone!',
                            'Help keep it running with a donation.',
                            'Use `/donate` to contribute.'
                        ].join('\n'),
                        inline: false
                    }
                )
                .setThumbnail('attachment://FightGenie_Logo_1.PNG')
                .setFooter({
                    text: 'Fight Genie - AI-Powered UFC Predictions',
                    iconURL: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/92/UFC_Logo.svg/2560px-UFC_Logo.svg.png'
                })
                .setTimestamp();

            await interaction.editReply({ 
                embeds: [infoEmbed],
                files: [{
                    attachment: './src/images/FightGenie_Logo_1.PNG',
                    name: 'FightGenie_Logo_1.PNG'
                }]
            });

        } catch (error) {
            console.error('Error handling subscription status command:', error);
            try {
                await interaction.editReply({
                    content: 'An error occurred while fetching bot status. Please try again later.',
                    ephemeral: true 
                });
            } catch (replyError) {
                 console.error("Failed to send error reply for sub command:", replyError);
            }
        }
    }
}

module.exports = SubscriptionCommand;
