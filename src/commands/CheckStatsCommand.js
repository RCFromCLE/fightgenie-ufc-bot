const { EmbedBuilder, ButtonBuilder, ActionRowBuilder, ButtonStyle } = require('discord.js');
const database = require('../database');
const ModelCommand = require('./ModelCommand');
const FighterStats = require('../utils/fighterStats');

class CheckStatsCommand {
    // Separate method for handling message commands
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

    // New method specifically for handling select menu interactions
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

    // Helper method to create the stats embed
    static async createStatsEmbed(fighter) {
        try {
            const stats = await database.query(
                "SELECT *, datetime(last_updated) as updated_at FROM fighters WHERE Name = ?",
                [fighter]
            );

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
            const lastUpdated = stat.updated_at 
                ? new Date(stat.updated_at).toLocaleString()
                : 'Never';
            
            const fights = await database.query(`
                SELECT COUNT(*) as count
                FROM events 
                WHERE Winner = ? OR Loser = ?
            `, [fighter, fighter]);
            
            const embed = new EmbedBuilder()
                .setColor('#0099ff')
                .setTitle(`Fighter Stats Database Check`)
                .setDescription(`Stats for ${fighter}\nUFC Fights: ${fights[0]?.count || 0}\nLast Updated: ${lastUpdated}`)
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
                });

            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`update_stats_${fighter}`)
                        .setLabel('Update Fighter Stats')
                        .setEmoji('🔄')
                        .setStyle(ButtonStyle.Primary)
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
            const fights = await database.query(`
                SELECT COUNT(*) as count
                FROM events 
                WHERE Winner = ? OR Loser = ?
            `, [fighterName, fighterName]);
    
            if (updatedStats) {
                // Get the current timestamp for last_updated
                const currentTime = new Date().toISOString();
                updatedStats.last_updated = currentTime;
                
                const statsEmbed = new EmbedBuilder()
                    .setColor('#0099ff')
                    .setTitle('Fighter Stats Database Check')
                    .setDescription(`Stats for ${fighterName}\nUFC Fights: ${fights[0]?.count || 0}\nLast Updated: ${new Date(currentTime).toLocaleString()}`)
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
                            name: '👊 Striking Stats',
                            value: [
                                `Strikes Landed per Min: ${updatedStats.SLPM?.toFixed(2) || 'N/A'}`,
                                `Strikes Absorbed per Min: ${updatedStats.SApM?.toFixed(2) || 'N/A'}`,
                                `Strike Accuracy: ${updatedStats.StrAcc || 'N/A'}`,
                                `Strike Defense: ${updatedStats.StrDef || 'N/A'}`
                            ].join('\n'),
                            inline: true
                        },
                        {
                            name: '🤼 Grappling Stats',
                            value: [
                                `Takedowns Avg: ${updatedStats.TDAvg?.toFixed(2) || 'N/A'}/15min`,
                                `Takedown Accuracy: ${updatedStats.TDAcc || 'N/A'}`,
                                `Takedown Defense: ${updatedStats.TDDef || 'N/A'}`,
                                `Submission Avg: ${updatedStats.SubAvg?.toFixed(2) || 'N/A'}/15min`
                            ].join('\n'),
                            inline: true
                        }
                    )
                    .setFooter({
                        text: `Current Model: ${ModelCommand.getCurrentModel().toUpperCase()} | Stats from UFCStats.com`,
                        iconURL: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/92/UFC_Logo.svg/2560px-UFC_Logo.svg.png'
                    });
    
                const row = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId(`update_stats_${fighterName}`)
                            .setLabel('Update Fighter Stats')
                            .setEmoji('🔄')
                            .setStyle(ButtonStyle.Primary)
                    );
    
                await interaction.editReply({
                    embeds: [statsEmbed],
                    components: [row]
                });
            } else {
                await interaction.editReply({
                    content: `Failed to update stats for ${fighterName}. Please try again later.`,
                    embeds: [],
                    components: []
                });
            }
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
        // Only defer if not already deferred
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

        console.log('Searching and adding new fighter:', fighterName);
        const stats = await FighterStats.scrapeFighterStats(fighterName);

        if (stats) {
            // Store the stats
            await FighterStats.updateFighterStats(fighterName);
            
            // Get fight count
            const fights = await database.query(`
                SELECT COUNT(*) as count
                FROM events 
                WHERE Winner = ? OR Loser = ?
            `, [fighterName, fighterName]);

            const statsEmbed = new EmbedBuilder()
                .setColor('#0099ff')
                .setTitle('Fighter Stats Database Check')
                .setDescription(`Stats for ${fighterName}\nUFC Fights: ${fights[0]?.count || 0}\nLast Updated: ${new Date().toLocaleString()}`)
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
                )
                .setFooter({
                    text: `Current Model: ${ModelCommand.getCurrentModel().toUpperCase()} | Stats from UFCStats.com`,
                    iconURL: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/92/UFC_Logo.svg/2560px-UFC_Logo.svg.png'
                });

            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`update_stats_${fighterName}`)
                        .setLabel('Update Fighter Stats')
                        .setEmoji('🔄')
                        .setStyle(ButtonStyle.Primary)
                );
            
            await interaction.editReply({
                embeds: [statsEmbed],
                components: [row]
            });
        } else {
            await interaction.editReply({
                content: `Could not find stats for "${fighterName}". Please check the spelling and try again.`,
                embeds: [],
                components: []
            });
        }
    } catch (error) {
        console.error('Error searching for fighter:', error);
        if (!interaction.replied) {
            await interaction.followUp({
                content: 'Error searching for fighter stats. Please try again later.',
                ephemeral: true
            });
        }
    }
}

    static createUpdateButton(fighterName) {
        return new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`update_stats_${fighterName}`)
                    .setLabel('Update Fighter Stats')
                    .setEmoji('🔄')
                    .setStyle(ButtonStyle.Primary)
            );
    }

    static async createStatsEmbed(stats, fighterName, totalFights) {
        const lastUpdated = stats.updated_at ? new Date(stats.updated_at).toLocaleString() : 'Never';
        
        return new EmbedBuilder()
            .setColor('#0099ff')
            .setTitle('Fighter Stats Database Check')
            .setDescription(`Stats for ${fighterName}\nUFC Fights: ${totalFights}\nLast Updated: ${lastUpdated}`)
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
            )
            .setFooter({
                text: `Current Model: ${ModelCommand.getCurrentModel().toUpperCase()} | Stats from UFCStats.com`,
                iconURL: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/92/UFC_Logo.svg/2560px-UFC_Logo.svg.png'
            });
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
            const fights = await database.query(`
                SELECT COUNT(*) as count
                FROM events 
                WHERE Winner = ? OR Loser = ?
            `, [fighterName, fighterName]);
    
            if (updatedStats) {
                const statsEmbed = await this.createStatsEmbed(updatedStats, fighterName, fights[0]?.count || 0);
                const row = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId(`update_stats_${fighterName}`)
                            .setLabel('Update Fighter Stats')
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
                    components: [row]
                });
            } else {
                await interaction.editReply({
                    content: `Failed to update stats for ${fighterName}. Please try again later.`,
                    components: []
                });
            }
        } catch (error) {
            console.error('Error updating fighter stats:', error);
            await interaction.followUp({
                content: 'Error updating fighter stats. Please try again later.',
                ephemeral: true
            });
        }
    }

    static async handleCheckStats(message, args) {
        try {
            // Join all args to handle full names properly
            const fighter = args.join(" ").trim();
            if (!fighter) {
                await message.reply("Please provide a fighter name. Usage: $checkstats Fighter Name");
                return;
            }
    
            // First try exact name match
            const stats = await database.query(
                "SELECT *, datetime(last_updated) as updated_at FROM fighters WHERE Name LIKE ?",
                [fighter]
            );
    
            // Get record and fight count
            const [fights, wins, losses, draws] = await Promise.all([
                database.query(`
                    SELECT COUNT(*) as count
                    FROM events 
                    WHERE Winner = ? OR Loser = ?
                `, [fighter, fighter]),
                database.query(
                    "SELECT COUNT(*) as count FROM events WHERE Winner = ?",
                    [fighter]
                ),
                database.query(
                    "SELECT COUNT(*) as count FROM events WHERE Loser = ?",
                    [fighter]
                ),
                database.query(
                    'SELECT COUNT(*) as count FROM events WHERE (Winner = ? OR Loser = ?) AND Method LIKE "%Draw%"',
                    [fighter, fighter]
                )
            ]);
    
            if (stats && stats.length > 0) {
                const stat = stats[0];
                const lastUpdated = stat.updated_at 
                    ? new Date(stat.updated_at).toLocaleString()
                    : 'Never';
    
                const record = `${wins[0]?.count || 0}-${losses[0]?.count || 0}-${draws[0]?.count || 0}`;
                    
                const embed = new EmbedBuilder()
                    .setColor('#0099ff')
                    .setTitle(`Fighter Stats Database Check`)
                    .setDescription(`Stats for ${fighter}\nRecord: ${record} (${fights[0]?.count || 0} fights)\nLast Updated: ${lastUpdated}`)
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
                    });
    
                const row = new ActionRowBuilder()
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
                            .setStyle(ButtonStyle.Secondary)
                    );
    
                await message.reply({ 
                    embeds: [embed],
                    components: [row]
                });
            } else {
                // Try searching for name parts before giving up
                const nameParts = fighter.split(' ');
                let alternativeSearch = null;
                
                if (nameParts.length > 1) {
                    // Try last name first
                    alternativeSearch = await database.query(
                        "SELECT Name FROM fighters WHERE Name LIKE ?",
                        [`%${nameParts[nameParts.length - 1]}%`]
                    );
                }
    
                if (alternativeSearch?.length > 0) {
                    const suggestions = alternativeSearch.map(s => s.Name).join('\n');
                    await message.reply(`Did you mean one of these fighters?\n${suggestions}\n\nPlease try again with the exact name.`);
                } else {
                    const row = new ActionRowBuilder()
                        .addComponents(
                            new ButtonBuilder()
                                .setCustomId(`scrape_stats_${fighter}`)
                                .setLabel('Search & Add Fighter')
                                .setEmoji('🔎')
                                .setStyle(ButtonStyle.Success)
                        );
    
                    await message.reply({ 
                        content: `No stats found in database for "${fighter}". Would you like to search for and add this fighter?`,
                        components: [row]
                    });
                }
            }
        } catch (error) {
            console.error('Error in checkstats command:', error);
            await message.reply('Error retrieving fighter stats from database.');
        }
    }
}

module.exports = CheckStatsCommand;