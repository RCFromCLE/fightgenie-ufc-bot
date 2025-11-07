const { EmbedBuilder } = require('discord.js');
const database = require('../database');
const FighterStats = require('../utils/fighterStats');

class UpdateFighterStatsCommand {
    static async handleUpdateAllFighterStats(interaction) {
        try {
            // Verify admin permissions
            if (!interaction.member?.permissions.has("Administrator") || interaction.guild?.id !== "496121279712329756") {
                await interaction.editReply({
                    content: "❌ This command requires administrator permissions.",
                    ephemeral: true
                });
                return;
            }

            const loadingEmbed = new EmbedBuilder()
                .setColor('#ffff00')
                .setTitle('🔄 Updating Fighter Stats')
                .setDescription('Fetching current event fighters and updating their stats...');
            
            await interaction.editReply({ embeds: [loadingEmbed] });
            
            // Get the current event
            const event = await database.query(`
                SELECT DISTINCT Event, Date
                FROM events
                WHERE Date >= date('now')
                AND is_completed = 0
                ORDER BY Date ASC
                LIMIT 1
            `);
            
            if (!event?.[0]) {
                await interaction.editReply({
                    content: "No upcoming events found.",
                    embeds: []
                });
                return;
            }
            
            // Get all fights for the event
            const fights = await database.query(`
                SELECT DISTINCT fighter1, fighter2
                FROM events
                WHERE Event = ?
            `, [event[0].Event]);
            
            if (!fights || fights.length === 0) {
                await interaction.editReply({
                    content: "No fights found for the current event.",
                    embeds: []
                });
                return;
            }
            
            // Extract all fighter names
            const fighters = new Set();
            fights.forEach(fight => {
                fighters.add(fight.fighter1);
                fighters.add(fight.fighter2);
            });
            
            const fighterArray = Array.from(fighters);
            const totalFighters = fighterArray.length;
            
            // Update progress embed
            const progressEmbed = new EmbedBuilder()
                .setColor('#ffff00')
                .setTitle('🔄 Updating Fighter Stats')
                .setDescription([
                    `Event: ${event[0].Event}`,
                    `Total fighters to update: ${totalFighters}`,
                    '',
                    'This process may take a few minutes. Please wait...',
                    '',
                    '⏳ Starting updates...'
                ].join('\n'));
            
            await interaction.editReply({ embeds: [progressEmbed] });
            
            // Update stats for each fighter
            const results = [];
            let successCount = 0;
            let failCount = 0;
            
            for (let i = 0; i < fighterArray.length; i++) {
                const fighter = fighterArray[i];
                try {
                    // Update progress every 3 fighters
                    if (i % 3 === 0) {
                        const updatedProgressEmbed = new EmbedBuilder()
                            .setColor('#ffff00')
                            .setTitle('🔄 Updating Fighter Stats')
                            .setDescription([
                                `Event: ${event[0].Event}`,
                                `Progress: ${i}/${totalFighters} fighters`,
                                '',
                                'This process may take a few minutes. Please wait...',
                                '',
                                `⏳ Currently updating: ${fighter}`
                            ].join('\n'));
                        
                        await interaction.editReply({ embeds: [updatedProgressEmbed] });
                    }
                    
                    // Update fighter stats
                    const updatedStats = await FighterStats.updateFighterStats(fighter);
                    
                    if (updatedStats) {
                        results.push(`✅ ${fighter}`);
                        successCount++;
                    } else {
                        results.push(`❌ ${fighter} (not found)`);
                        failCount++;
                    }
                } catch (error) {
                    console.error(`Error updating stats for ${fighter}:`, error);
                    results.push(`❌ ${fighter} (error)`);
                    failCount++;
                }
                
                // Add a small delay to avoid rate limiting
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
            
            // Create completion embed
            const completionEmbed = new EmbedBuilder()
                .setColor('#00ff00')
                .setTitle('✅ Fighter Stats Update Complete')
                .setDescription([
                    `Event: ${event[0].Event}`,
                    `Successfully updated: ${successCount}/${totalFighters} fighters`,
                    `Failed: ${failCount}/${totalFighters} fighters`,
                    '',
                    '**Results:**',
                    results.join('\n')
                ].join('\n'));
            
            await interaction.editReply({ embeds: [completionEmbed] });
            
        } catch (error) {
            console.error('Error updating fighter stats:', error);
            await interaction.editReply('An error occurred while updating fighter stats. Please try again.');
        }
    }
}

module.exports = UpdateFighterStatsCommand;
