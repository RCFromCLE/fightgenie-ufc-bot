const { EmbedBuilder, ButtonBuilder, ActionRowBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const database = require('../database');
const FighterStats = require('./fighterStats');

class StatsDisplayHandler {
    static statsCache = {
        currentPage: 0,
        embeds: []
    };

    static async handleShowFighterStats(interaction) {
        try {
            await interaction.deferUpdate();

            const currentEvent = await database.query(
                `SELECT event_id FROM events WHERE Date >= date('now') ORDER BY Date ASC LIMIT 1`
            );
            
            // Extract fighter name from the select value
            const selectedValue = interaction.values[0];
            if (!selectedValue) {
                console.log('No value selected');
                return;
            }
    
            // Handle special case for data status
            if (selectedValue === 'all_data_status') {
                return await this.handleShowFighterDataStatus(interaction);
            }
    
            // Extract fighter name from the value (format: "fighter:FighterName")
            const fighter = selectedValue.split(':')[1];
            if (!fighter) {
                console.log('No fighter found in selection');
                return;
            }
    
            // Get fighter stats
            const stats = await FighterStats.getFighterStats(fighter);
            if (!stats) {
                await interaction.followUp({
                    content: `No stats found for ${fighter}. Try updating the fighter's stats.`,
                    ephemeral: true
                });
                return;
            }
    
            // Create stats embed
            const statsEmbed = new EmbedBuilder()
                .setColor('#0099ff')
                .setTitle(`Fighter Statistics: ${fighter}`)
                .setDescription(`Last Updated: ${stats.last_updated ? new Date(stats.last_updated).toLocaleString() : 'Never'}`)
                .addFields(
                    {
                        name: '📏 Physical Stats',
                        value: [
                            `Height: ${stats.Height || 'N/A'}`,
                            `Weight: ${stats.Weight || 'N/A'}`,
                            `Reach: ${stats.Reach || 'N/A'}`,
                            `Stance: ${stats.Stance || 'N/A'}`
                        ].join('\n'),
                        inline: true
                    },
                    {
                        name: '👊 Striking Stats',
                        value: [
                            `Strikes Landed per Min: ${stats.SLPM?.toFixed(2) || 'N/A'}`,
                            `Strikes Absorbed per Min: ${stats.SApM?.toFixed(2) || 'N/A'}`,
                            `Strike Accuracy: ${stats.StrAcc || 'N/A'}`,
                            `Strike Defense: ${stats.StrDef || 'N/A'}`
                        ].join('\n'),
                        inline: true
                    },
                    {
                        name: '🤼 Grappling Stats',
                        value: [
                            `Takedowns Avg: ${stats.TDAvg?.toFixed(2) || 'N/A'}/15min`,
                            `Takedown Accuracy: ${stats.TDAcc || 'N/A'}`,
                            `Takedown Defense: ${stats.TDDef || 'N/A'}`,
                            `Submission Avg: ${stats.SubAvg?.toFixed(2) || 'N/A'}/15min`
                        ].join('\n'),
                        inline: true
                    }
                );
    
            // Create a single row with essential buttons
            const buttonRow = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`update_stats_${fighter}`)
                        .setLabel('Update Stats')
                        .setEmoji('🔄')
                        .setStyle(ButtonStyle.Primary),
                    new ButtonBuilder()
                        .setCustomId('show_event')
                        .setLabel('Back to Event')
                        .setEmoji('↩️')
                        .setStyle(ButtonStyle.Secondary)
                );
    
            // Keep only the original select menu and add our button row
            const finalComponents = [buttonRow];
            if (interaction.message.components?.length > 0) {
                // Add the original select menu if it exists
                finalComponents.unshift(interaction.message.components[0]);
            }
    
            await interaction.editReply({
                embeds: [statsEmbed],
                components: finalComponents
            });
    
        } catch (error) {
            console.error('Error showing fighter stats:', error);
            await interaction.followUp({
                content: 'Error displaying fighter statistics. Please try again.',
                ephemeral: true
            });
        }
    }
        
    static async handleMainCardStats(interaction) {
        try {
            await interaction.deferUpdate();
            const event = await database.getUpcomingEvent();
            const fights = await database.getEventFights(event.Event);
            const mainCardFights = fights.filter(f => f.is_main_card === 1);
            
            const statsEmbeds = await Promise.all(
                mainCardFights.map(async fight => 
                    this.createFighterStatsEmbed(fight.fighter1, fight.fighter2)
                )
            );

            this.statsCache.embeds = statsEmbeds;
            this.statsCache.currentPage = 0;

            await interaction.message.edit({
                embeds: [statsEmbeds[0]],
                components: this.createNavigationComponents()
            });
        } catch (error) {
            console.error('Error handling main card stats:', error);
            await interaction.followUp({
                content: 'Error displaying main card statistics. Please try again.',
                ephemeral: true
            });
        }
    }

    static async handlePrelimStats(interaction) {
        try {
            await interaction.deferUpdate();
            const event = await database.getUpcomingEvent();
            const fights = await database.getEventFights(event.Event);
            const prelimFights = fights.filter(f => f.is_main_card === 0);
            
            const statsEmbeds = await Promise.all(
                prelimFights.map(async fight => 
                    this.createFighterStatsEmbed(fight.fighter1, fight.fighter2)
                )
            );

            this.statsCache.embeds = statsEmbeds;
            this.statsCache.currentPage = 0;

            await interaction.message.edit({
                embeds: [statsEmbeds[0]],
                components: this.createNavigationComponents()
            });
        } catch (error) {
            console.error('Error handling prelim stats:', error);
            await interaction.followUp({
                content: 'Error displaying preliminary card statistics. Please try again.',
                ephemeral: true
            });
        }
    }

    static async handleFightSelection(interaction) {
        try {
            await interaction.deferUpdate();
            
            const [fightIndex, eventId] = interaction.values[0].split('_');
            const event = await database.getUpcomingEvent();
            const fights = await database.getEventFights(event.Event);
            
            const selectedFight = fights[parseInt(fightIndex)];
            if (!selectedFight) {
                await interaction.followUp({
                    content: 'Fight not found.',
                    ephemeral: true
                });
                return;
            }

            const statsEmbed = await this.createFighterStatsEmbed(
                selectedFight.fighter1,
                selectedFight.fighter2
            );

            // Keep the same components
            const currentComponents = interaction.message.components;

            await interaction.message.edit({
                embeds: [statsEmbed],
                components: currentComponents
            });

        } catch (error) {
            console.error('Error handling fight selection:', error);
            await interaction.followUp({
                content: 'Error displaying fighter statistics. Please try again.',
                ephemeral: true
            });
        }
    }

    static formatTaleOfTape(fighter1Stats, fighter2Stats) {
        const f1 = fighter1Stats || {};
        const f2 = fighter2Stats || {};
        
        return [
            `**${f1.Name || 'Fighter 1'}**`,
            `Height: ${f1.Height || 'N/A'} | Weight: ${f1.Weight || 'N/A'}`,
            `Reach: ${f1.Reach || 'N/A'} | Stance: ${f1.Stance || 'N/A'}`,
            `Record: ${f1.record || '0-0-0'}`,
            '\nvs\n',
            `**${f2.Name || 'Fighter 2'}**`,
            `Height: ${f2.Height || 'N/A'} | Weight: ${f2.Weight || 'N/A'}`,
            `Reach: ${f2.Reach || 'N/A'} | Stance: ${f2.Stance || 'N/A'}`,
            `Record: ${f2.record || '0-0-0'}`
        ].join('\n');
    }

    static formatStrikingStats(fighter1Stats, fighter2Stats) {
        const f1 = fighter1Stats || {};
        const f2 = fighter2Stats || {};

        return [
            `**${f1.Name || 'Fighter 1'}**`,
            `Strikes Landed per Min: ${f1.SLPM?.toFixed(2) || '0.00'}`,
            `Strike Accuracy: ${f1.StrAcc || '0%'}`,
            `Strike Defense: ${f1.StrDef || '0%'}`,
            '\nvs\n',
            `**${f2.Name || 'Fighter 2'}**`,
            `Strikes Landed per Min: ${f2.SLPM?.toFixed(2) || '0.00'}`,
            `Strike Accuracy: ${f2.StrAcc || '0%'}`,
            `Strike Defense: ${f2.StrDef || '0%'}`
        ].join('\n');
    }

    static formatGrapplingStats(fighter1Stats, fighter2Stats) {
        const f1 = fighter1Stats || {};
        const f2 = fighter2Stats || {};

        return [
            `**${f1.Name || 'Fighter 1'}**`,
            `Takedowns Avg: ${f1.TDAvg?.toFixed(2) || '0.00'} per 15 min`,
            `Takedown Accuracy: ${f1.TDAcc || '0%'}`,
            `Takedown Defense: ${f1.TDDef || '0%'}`,
            `Submission Avg: ${f1.SubAvg?.toFixed(2) || '0.00'} per 15 min`,
            '\nvs\n',
            `**${f2.Name || 'Fighter 2'}**`,
            `Takedowns Avg: ${f2.TDAvg?.toFixed(2) || '0.00'} per 15 min`,
            `Takedown Accuracy: ${f2.TDAcc || '0%'}`,
            `Takedown Defense: ${f2.TDDef || '0%'}`,
            `Submission Avg: ${f2.SubAvg?.toFixed(2) || '0.00'} per 15 min`
        ].join('\n');
    }

    static formatMatchupAnalysis(matchup) {
        if (!matchup) return 'No matchup analysis available';

        return [
            `**Weight Class**: ${matchup.weightClass}`,
            '',
            '**Style Analysis**:',
            `Striking Advantage: ${matchup.stylistic?.striking?.advantage || 'Even'}`,
            `Grappling Advantage: ${matchup.stylistic?.grappling?.advantage || 'Even'}`,
            '',
            '**Physical Comparison**:',
            `Height Difference: ${matchup.tale_of_tape?.height?.difference || 0}"`,
            `Reach Difference: ${matchup.tale_of_tape?.reach?.difference || 0}"`,
            '',
            matchup.commonOpponents?.length > 0 
                ? `**Common Opponents**: ${matchup.commonOpponents.length} found`
                : '**Common Opponents**: None found'
        ].join('\n');
    }

    static createNavigationComponents() {
        return [
            new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('prev_stats_page')
                        .setLabel('Previous')
                        .setStyle(ButtonStyle.Primary)
                        .setDisabled(this.statsCache.currentPage === 0),
                    new ButtonBuilder()
                        .setCustomId('next_stats_page')
                        .setLabel('Next')
                        .setStyle(ButtonStyle.Primary)
                        .setDisabled(this.statsCache.currentPage === this.statsCache.embeds.length - 1),
                    new ButtonBuilder()
                        .setCustomId('show_event')
                        .setLabel('Back to Event')
                        .setEmoji('↩️')
                        .setStyle(ButtonStyle.Secondary)
                )
        ];
    }

    static async updateNavigation(interaction) {
        try {
            const currentEmbed = this.statsCache.embeds[this.statsCache.currentPage];
            await interaction.message.edit({
                embeds: [currentEmbed],
                components: this.createNavigationComponents()
            });
        } catch (error) {
            console.error('Error updating navigation:', error);
            await interaction.followUp({
                content: 'Error updating display. Please try again.',
                ephemeral: true
            });
        }
    }
}

module.exports = StatsDisplayHandler;