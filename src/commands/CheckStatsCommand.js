const { EmbedBuilder, ButtonBuilder, ActionRowBuilder, ButtonStyle } = require('discord.js');
const database = require('../database');
const ModelCommand = require('./ModelCommand');
const FighterStats = require('../utils/fighterStats');

class CheckStatsCommand {
    static async handleCheckStats(message, args) {
        try {
            const fighter = args.join(" ");
            if (!fighter) {
                await message.reply("Please provide a fighter name. Usage: $checkstats Fighter Name");
                return;
            }

            const embed = await this.createStatsEmbed(fighter);
            if (embed.error) {
                await message.reply(embed.error);
                return;
            }

            await message.reply(embed);
        } catch (error) {
            console.error('Error in checkstats command:', error);
            await message.reply('Error retrieving fighter stats from database.');
        }
    }

    static async handleStatSelectInteraction(interaction) {
        try {
            const selectedValue = interaction.values[0];
            if (selectedValue === 'all_data_status') {
                await EventHandlers.handleShowFighterDataStatus(interaction);
                return;
            }

            const fighter = selectedValue.split(':')[1];
            if (!fighter) {
                await interaction.editReply('Invalid fighter selection.');
                return;
            }

            const embed = await this.createStatsEmbed(fighter);
            if (embed.error) {
                await interaction.editReply({ content: embed.error });
                return;
            }

            await interaction.editReply(embed);
        } catch (error) {
            console.error('Error handling stats selection:', error);
            await interaction.editReply({ 
                content: 'Error retrieving fighter statistics.', 
                ephemeral: true 
            });
        }
    }

    static async createStatsEmbed(fighter) {
        try {
            const [stats, currentEvent] = await Promise.all([
                database.query(
                    "SELECT *, datetime(last_updated) as updated_at FROM fighters WHERE Name = ?",
                    [fighter]
                ),
                database.query(
                    `SELECT event_id FROM events WHERE Date >= date('now') ORDER BY Date ASC LIMIT 1`
                )
            ]);

            if (!stats || stats.length === 0) {
                const row = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId(`scrape_stats_${fighter}`)
                            .setLabel('Search & Add Fighter')
                            .setEmoji('🔎')
                            .setStyle(ButtonStyle.Success)
                    );

                return {
                    content: `No stats found in database for "${fighter}". Would you like to search for and add this fighter?`,
                    components: [row]
                };
            }

            const stat = stats[0];
            let lastUpdatedText = this.formatLastUpdated(stat.updated_at);
            const fights = await database.query(`
                SELECT COUNT(*) as count
                FROM events 
                WHERE Winner = ? OR Loser = ?
            `, [fighter, fighter]);
            
            const embed = new EmbedBuilder()
                .setColor('#0099ff')
                .setTitle(`Fighter Stats Database Check`)
                .setDescription(`Stats for ${fighter}\nUFC Fights: ${fights[0]?.count || 0}\nLast Updated: ${lastUpdatedText}`)                
                .addFields(
                    {
                        name: '📏 Physical Stats',
                        value: [
                            `Height: ${stat.Height || 'N/A'}`,
                            `Weight: ${stat.Weight || 'N/A'}`,
                            `Reach: ${stat.Reach || 'N/A'}`,
                            `Stance: ${stat.Stance || 'N/A'}`
                        ].join('\n'),
                        inline: true
                    },
                    {
                        name: '👊 Striking Stats',
                        value: [
                            `Strikes Landed per Min: ${stat.SLPM?.toFixed(2) || 'N/A'}`,
                            `Strikes Absorbed per Min: ${stat.SApM?.toFixed(2) || 'N/A'}`,
                            `Strike Accuracy: ${stat.StrAcc || 'N/A'}`,
                            `Strike Defense: ${stat.StrDef || 'N/A'}`
                        ].join('\n'),
                        inline: true
                    },
                    {
                        name: '🤼 Grappling Stats',
                        value: [
                            `Takedowns Avg: ${stat.TDAvg?.toFixed(2) || 'N/A'}/15min`,
                            `Takedown Accuracy: ${stat.TDAcc || 'N/A'}`,
                            `Takedown Defense: ${stat.TDDef || 'N/A'}`,
                            `Submission Avg: ${stat.SubAvg?.toFixed(2) || 'N/A'}/15min`
                        ].join('\n'),
                        inline: true
                    }
                )
                .setFooter({
                    text: `Current Model: ${ModelCommand.getCurrentModel().toUpperCase()} | Stats from UFCStats.com`,
                    iconURL: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/92/UFC_Logo.svg/2560px-UFC_Logo.svg.png'
                });const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`update_stats_${fighter}`)
                        .setLabel('Update Fighter Stats')
                        .setEmoji('🔄')
                        .setStyle(ButtonStyle.Primary),
                    new ButtonBuilder()
                        .setCustomId('show_event')
                        .setLabel('Back to Event')
                        .setEmoji('↩️')
                        .setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder()
                        .setCustomId(`predict_main_${ModelCommand.getCurrentModel()}_${currentEvent[0]?.event_id || 'latest'}`)
                        .setLabel('Back to Predictions')
                        .setEmoji('📊')
                        .setStyle(ButtonStyle.Secondary)
                );

            return { 
                embeds: [embed],
                components: [row]
            };
        } catch (error) {
            console.error('Error creating stats embed:', error);
            return { error: 'Error retrieving fighter statistics.' };
        }
    }

    static formatLastUpdated(timestamp) {
        if (!timestamp) return 'Never';
        
        const updateDate = new Date(timestamp);
        const now = new Date();
        const diffSeconds = Math.floor((now - updateDate) / 1000);
        
        if (diffSeconds < 60) {
            return 'Just now';
        } else if (diffSeconds < 3600) {
            const minutes = Math.floor(diffSeconds / 60);
            return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
        } else if (diffSeconds < 86400) {
            const hours = Math.floor(diffSeconds / 3600);
            return `${hours} hour${hours > 1 ? 's' : ''} ago`;
        }
        return updateDate.toLocaleString();
    }

    static async handleStatsButton(interaction, fighterName) {
        try {
            if (!interaction.deferred && !interaction.replied) {
                await interaction.deferUpdate();
            }
    
            const loadingEmbed = new EmbedBuilder()
                .setColor('#ffff00')
                .setTitle('🔄 Updating Fighter Stats')
                .setDescription(`Fetching latest stats for ${fighterName}...\nPlease wait while we update the database.`);
    
            await interaction.editReply({
                embeds: [loadingEmbed],
                components: []
            });
    
            const updatedStats = await FighterStats.updateFighterStats(fighterName);
            if (!updatedStats) {
                await interaction.editReply({
                    content: `Failed to update stats for ${fighterName}. Please try again later.`,
                    embeds: [],
                    components: []
                });
                return;
            }

            const embed = await this.createStatsEmbed(fighterName);
            await interaction.editReply(embed);

        } catch (error) {
            console.error('Error updating fighter stats:', error);
            await interaction.followUp({
                content: 'Error updating fighter stats. Please try again later.',
                ephemeral: true
            });
        }
    }

    static async handleScrapeButton(interaction, fighterName) {
        try {
            if (!interaction.deferred && !interaction.replied) {
                await interaction.deferUpdate();
            }
            
            const loadingEmbed = new EmbedBuilder()
                .setColor('#ffff00')
                .setTitle('🔎 Searching for Fighter')
                .setDescription(`Searching for ${fighterName}...\nPlease wait while we fetch the stats.`);

            await interaction.editReply({
                embeds: [loadingEmbed],
                components: []
            });

            const stats = await FighterStats.scrapeFighterStats(fighterName);
            if (!stats) {
                await interaction.editReply({
                    content: `Could not find stats for "${fighterName}". Please check the spelling and try again.`,
                    embeds: [],
                    components: []
                });
                return;
            }

            await FighterStats.updateFighterStats(fighterName);
            const embed = await this.createStatsEmbed(fighterName);
            await interaction.editReply(embed);

        } catch (error) {
            console.error('Error searching for fighter:', error);
            await interaction.followUp({
                content: 'Error searching for fighter stats. Please try again later.',
                ephemeral: true
            });
        }
    }
}

module.exports = CheckStatsCommand;