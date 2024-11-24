const { EmbedBuilder, ButtonBuilder, ActionRowBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const database = require('../database');
const ModelCommand = require('./ModelCommand');
const FighterStats = require('../utils/fighterStats');
const DataValidator = require('../utils/DataValidator');

class CheckStatsCommand {
    static async handleCheckStats(message, args) {
        try {
            if (args.length === 0) {
                // If no args, show model comparison stats
                await this.showModelComparisonStats(message);
                return;
            }

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

    static async showModelComparisonStats(message) {
        try {
            const stats = await database.query(`
                WITH model_performance AS (
                    SELECT 
                        sp.model_used,
                        COUNT(DISTINCT sp.event_id) as events_analyzed,
                        COUNT(*) as total_predictions,
                        ROUND(AVG(CASE WHEN json_extract(po.fight_outcomes, '$.correct') = 1 THEN 1 ELSE 0 END) * 100, 1) as fight_accuracy,
                        ROUND(AVG(CASE WHEN json_extract(po.fight_outcomes, '$.methodCorrect') = 1 THEN 1 ELSE 0 END) * 100, 1) as method_accuracy,
                        ROUND(AVG(po.confidence_accuracy), 1) as confidence_accuracy,
                        ROUND(AVG(CASE WHEN json_extract(po.parlay_outcomes, '$.correct') = 1 THEN 1 ELSE 0 END) * 100, 1) as parlay_accuracy
                    FROM prediction_outcomes po
                    JOIN stored_predictions sp ON po.prediction_id = sp.prediction_id
                    GROUP BY sp.model_used
                ),
                model_rankings AS (
                    SELECT *,
                        RANK() OVER (ORDER BY fight_accuracy DESC) as fight_rank,
                        RANK() OVER (ORDER BY method_accuracy DESC) as method_rank,
                        RANK() OVER (ORDER BY parlay_accuracy DESC) as parlay_rank
                    FROM model_performance
                )
                SELECT * FROM model_rankings
            `);

            const embed = new EmbedBuilder()
                .setColor('#0099ff')
                .setTitle('🤖 Fight Genie Model Performance')
                .setDescription([
                    'Compare how GPT-4 and Claude perform head-to-head in UFC predictions.',
                    'Data from verified fight outcomes and predictions.',
                    '',
                    '━━━━━━━━━━━━━━━━━━━━━━'
                ].join('\n'))
                .setThumbnail("attachment://FightGenie_Logo_1.PNG");

            stats.forEach(stat => {
                const modelName = stat.model_used === 'gpt' ? 'GPT-4' : 'Claude';
                const emoji = stat.model_used === 'gpt' ? '🧠' : '🤖';
                
                embed.addFields({
                    name: `${emoji} ${modelName} Performance`,
                    value: [
                        `Events Analyzed: ${stat.events_analyzed}`,
                        `Fight Accuracy: ${stat.fight_accuracy}%`,
                        `Method Accuracy: ${stat.method_accuracy}%`, 
                        `Parlay Success: ${stat.parlay_accuracy}%`,
                        `Confidence Score: ${stat.confidence_accuracy}%`,
                        '',
                        `Win Rate: ${((stat.fight_accuracy || 0)).toFixed(1)}%`
                    ].join('\n'),
                    inline: true
                });
            });

            // Get historical events for dropdown
            const events = await database.query(`
                SELECT DISTINCT 
                    e.event_id,
                    e.Event as event_name,
                    e.Date as event_date,
                    COUNT(DISTINCT sp.model_used) as models_used
                FROM events e
                JOIN stored_predictions sp ON e.event_id = sp.event_id
                JOIN prediction_outcomes po ON sp.prediction_id = po.prediction_id
                WHERE e.Date < datetime('now')
                GROUP BY e.event_id
                ORDER BY e.Date DESC
                LIMIT 25
            `);

            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId('view_historical_predictions')
                .setPlaceholder('View Historical Event Predictions')
                .addOptions(
                    events.map(event => ({
                        label: event.event_name,
                        description: `${new Date(event.event_date).toLocaleDateString()} - ${event.models_used} models`,
                        value: `event_${event.event_id}`,
                        emoji: '📊'
                    }))
                );

            const row = new ActionRowBuilder().addComponents(selectMenu);

            await message.reply({
                embeds: [embed],
                components: [row],
                files: [{
                    attachment: './src/images/FightGenie_Logo_1.PNG',
                    name: 'FightGenie_Logo_1.PNG'
                }]
            });

        } catch (error) {
            console.error('Error showing model stats:', error);
            await message.reply('Error retrieving model statistics.');
        }
    }

    static async createStatsEmbed(fighterName) {
        try {
            const stats = await FighterStats.getFighterStats(fighterName);
            const validation = await DataValidator.validateFighterStats(fighterName);

            const embed = new EmbedBuilder()
                .setColor('#0099ff')
                .setTitle(`👤 ${fighterName} Statistics`)
                .setDescription(validation.hasData ? 
                    `Last Updated: ${validation.lastUpdate ? new Date(validation.lastUpdate).toLocaleString() : 'Never'}` :
                    '❌ No stats found in database'
                );

            if (stats) {
                // Physical stats
                embed.addFields({
                    name: '📏 Physical Stats',
                    value: [
                        `Height: ${stats.Height || 'N/A'}`,
                        `Weight: ${stats.Weight || 'N/A'}`,
                        `Reach: ${stats.Reach || 'N/A'}`,
                        `Stance: ${stats.Stance || 'N/A'}`
                    ].join('\n'),
                    inline: true
                });

                // Career stats
                if (validation.record) {
                    embed.addFields({
                        name: '📊 Career Record',
                        value: [
                            `Record: ${validation.record.wins}-${validation.record.losses}-${validation.record.draws}`,
                            `Total Fights: ${validation.fightCount}`,
                            `Win Rate: ${((validation.record.wins / (validation.fightCount || 1)) * 100).toFixed(1)}%`
                        ].join('\n'),
                        inline: true
                    });
                }

                // Strike stats
                embed.addFields({
                    name: '👊 Strike Stats',
                    value: [
                        `Strikes Landed/Min: ${stats.SLPM?.toFixed(2) || '0.00'}`,
                        `Strikes Absorbed/Min: ${stats.SApM?.toFixed(2) || '0.00'}`,
                        `Strike Accuracy: ${stats.StrAcc || '0%'}`,
                        `Strike Defense: ${stats.StrDef || '0%'}`
                    ].join('\n'),
                    inline: false
                });

                // Grappling stats
                embed.addFields({
                    name: '🤼 Grappling Stats',
                    value: [
                        `Takedowns/15min: ${stats.TDAvg?.toFixed(2) || '0.00'}`,
                        `Takedown Accuracy: ${stats.TDAcc || '0%'}`,
                        `Takedown Defense: ${stats.TDDef || '0%'}`,
                        `Submissions/15min: ${stats.SubAvg?.toFixed(2) || '0.00'}`
                    ].join('\n'),
                    inline: false
                });
            }

            // Create update button
            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`update_stats_${fighterName}`)
                        .setLabel('Update Stats')
                        .setEmoji('🔄')
                        .setStyle(ButtonStyle.Primary)
                );

            return {
                embeds: [embed],
                components: [row]
            };

        } catch (error) {
            console.error(`Error creating stats embed for ${fighterName}:`, error);
            return {
                error: 'Error retrieving fighter statistics. Please try again.'
            };
        }
    }

    static async handleStatsButton(interaction, fighterName) {
        try {
            if (!interaction.deferred && !interaction.replied) {
                await interaction.deferUpdate();
            }
    
            const loadingEmbed = new EmbedBuilder()
                .setColor('#ffff00')
                .setTitle('🔄 Updating Fighter Stats')
                .setDescription(`Fetching latest stats for ${fighterName}...`);
    
            await interaction.editReply({
                embeds: [loadingEmbed],
                components: []
            });
    
            // Update the stats
            const updatedStats = await FighterStats.updateFighterStats(fighterName);
            if (!updatedStats) {
                await interaction.editReply({
                    content: `Failed to update stats for ${fighterName}. Please try again later.`,
                    embeds: [],
                    components: []
                });
                return;
            }
    
            // Get the record from database - properly destructure results
            const [winsResult, lossesResult, drawsResult] = await Promise.all([
                database.query(
                    "SELECT COUNT(*) as count FROM events WHERE Winner = ?",
                    [fighterName]
                ),
                database.query(
                    "SELECT COUNT(*) as count FROM events WHERE Loser = ?",
                    [fighterName]
                ),
                database.query(
                    'SELECT COUNT(*) as count FROM events WHERE (Winner = ? OR Loser = ?) AND Method LIKE "%Draw%"',
                    [fighterName, fighterName]
                )
            ]);
    
            const wins = winsResult[0]?.count || 0;
            const losses = lossesResult[0]?.count || 0;
            const draws = drawsResult[0]?.count || 0;
    
            const record = `${wins}-${losses}-${draws}`;
            const totalFights = wins + losses + draws;
            const winRate = totalFights > 0 ? ((wins / totalFights) * 100) : 0;
    
            const statsEmbed = new EmbedBuilder()
                .setColor('#0099ff')
                .setTitle(`👤 ${fighterName} Statistics`)
                .setDescription(`Last Updated: ${new Date().toLocaleString()}`)
                .addFields(
                    {
                        name: '📏 Physical Stats',
                        value: [
                            `Height: ${updatedStats.Height || 'N/A'}`,
                            `Weight: ${updatedStats.Weight || 'N/A'}`,
                            `Reach: ${updatedStats.Reach || 'N/A'}`,
                            `Stance: ${updatedStats.Stance || 'N/A'}`
                        ].join('\n'),
                        inline: true
                    },
                    {
                        name: '📊 Career Record',
                        value: [
                            `Record: ${record}`,
                            `Total Fights: ${totalFights}`,
                            `Win Rate: ${winRate.toFixed(1)}%`
                        ].join('\n'),
                        inline: true
                    },
                    {
                        name: '👊 Strike Stats',
                        value: [
                            `Strikes Landed/Min: ${updatedStats.SLPM?.toFixed(2) || '0.00'}`,
                            `Strikes Absorbed/Min: ${updatedStats.SApM?.toFixed(2) || '0.00'}`,
                            `Strike Accuracy: ${updatedStats.StrAcc || '0%'}`,
                            `Strike Defense: ${updatedStats.StrDef || '0%'}`
                        ].join('\n'),
                        inline: false
                    },
                    {
                        name: '🤼 Grappling Stats',
                        value: [
                            `Takedowns/15min: ${updatedStats.TDAvg?.toFixed(2) || '0.00'}`,
                            `Takedown Accuracy: ${updatedStats.TDAcc || '0%'}`,
                            `Takedown Defense: ${updatedStats.TDDef || '0%'}`,
                            `Submissions/15min: ${updatedStats.SubAvg?.toFixed(2) || '0.00'}`
                        ].join('\n'),
                        inline: false
                    }
                );
    
            const buttonRow = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`update_stats_${fighterName}`)
                        .setLabel('Update Stats')
                        .setEmoji('🔄')
                        .setStyle(ButtonStyle.Primary),
                    new ButtonBuilder()
                        .setCustomId('show_event')
                        .setLabel('Back to Event')
                        .setEmoji('↩️')
                        .setStyle(ButtonStyle.Secondary)
                );
    
            await interaction.editReply({
                embeds: [statsEmbed],
                components: [buttonRow]
            });
    
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