const { EmbedBuilder } = require("discord.js");
const database = require("../database");

class DataValidator {
    static async validateFighterStats(fighterName) {
        try {
            const stats = await database.query(`
                SELECT 
                    f.*,
                    datetime(f.last_updated) as updated_at,
                    (SELECT COUNT(*) FROM events WHERE Winner = f.Name) as wins,
                    (SELECT COUNT(*) FROM events WHERE Loser = f.Name) as losses,
                    (SELECT COUNT(*) FROM events WHERE (Winner = f.Name OR Loser = f.Name) AND Method LIKE '%Draw%') as draws,
                    (SELECT COUNT(*) FROM events WHERE Winner = f.Name OR Loser = f.Name) as fight_count
                FROM fighters f
                WHERE f.Name = ?
            `, [fighterName]);

            if (!stats || stats.length === 0) {
                return {
                    status: 'missing',
                    details: 'No data found',
                    hasData: false,
                    fightCount: 0,
                    record: { wins: 0, losses: 0, draws: 0 },
                    lastUpdate: null,
                    needsUpdate: true
                };
            }

            const fighterStats = stats[0];
            
            // Calculate record string
            const record = {
                wins: fighterStats.wins || 0,
                losses: fighterStats.losses || 0,
                draws: fighterStats.draws || 0
            };
            
            const statFields = [
                'SLPM', 'SApM', 'StrAcc', 'StrDef',
                'TDAvg', 'TDAcc', 'TDDef', 'SubAvg'
            ];
            
            const missingFields = [];
            statFields.forEach(field => {
                const value = fighterStats[field];
                if (!value || 
                    value === 0 || 
                    value === '0' || 
                    value === '0%' || 
                    value === 'NULL' || 
                    value === null) {
                    missingFields.push(field);
                }
            });

            const lastUpdate = fighterStats.updated_at ? new Date(fighterStats.updated_at) : null;
            const twoWeeksAgo = new Date(Date.now() - (14 * 24 * 60 * 60 * 1000));
            const needsUpdate = lastUpdate ? lastUpdate < twoWeeksAgo : true;

            return {
                status: missingFields.length >= 4 ? 'needs_update' : 
                        needsUpdate ? 'outdated' : 'complete',
                details: `${record.wins}-${record.losses}-${record.draws} (${fighterStats.fight_count || 0} fights)${missingFields.length > 0 ? 
                        `\n└ ${missingFields.length} missing/zero statistical fields` : ''}`,
                hasData: missingFields.length < 4,
                fightCount: fighterStats.fight_count || 0,
                record: record,
                lastUpdate: lastUpdate ? lastUpdate.toISOString() : null,
                missingFields: missingFields,
                needsUpdate: needsUpdate || missingFields.length >= 4
            };
        } catch (error) {
            console.error(`Error validating stats for ${fighterName}:`, error);
            return {
                status: 'error',
                details: error.message,
                hasData: false,
                fightCount: 0,
                record: { wins: 0, losses: 0, draws: 0 },
                lastUpdate: null,
                needsUpdate: true
            };
        }
    }

    static async createStatsReportEmbed(event, fights) {
        try {
            const embed = new EmbedBuilder()
                .setColor('#0099ff')
                .setTitle('📊 Fighter Data Quality Status')
                .setDescription(`Stats report for ${event.Event}\n${new Date().toLocaleString()}\n\n**Data Quality Legend:**\n` +
                    `🟢 **Complete** - All stats are up-to-date\n` +
                    `🟡 **Needs Update** - Stats are older than 14 days\n` +
                    `🔴 **Missing Data** - Fighter needs stats scraped\n` +
                    `🎯 = Main Card | 🥊 = Prelims`
                );
    
            const uniqueFighters = new Set(fights.flatMap(f => [f.fighter1, f.fighter2]));
            const statuses = {
                complete: [],
                needsUpdate: [],
                missing: []
            };
    
            const mainCardFighters = new Set(
                fights.filter(f => f.is_main_card === 1)
                    .flatMap(f => [f.fighter1, f.fighter2])
            );
    
            for (const fighter of uniqueFighters) {
                const validation = await this.validateFighterStats(fighter);
                const isMainCard = mainCardFighters.has(fighter);
                const cardIcon = isMainCard ? '🎯' : '🥊';
                
                const entry = `${cardIcon} ${fighter}\n└ ${validation.details}${
                    validation.missingFields?.length > 0 ? 
                    `\n└ Missing: ${validation.missingFields.join(', ')}` : ''
                }`;
    
                if (validation.status === 'complete' && !validation.needsUpdate) {
                    statuses.complete.push(entry);
                } else if (validation.status === 'needs_update' || validation.needsUpdate) {
                    statuses.needsUpdate.push(entry);
                } else {
                    statuses.missing.push(entry);
                }
            }
    
            // Split long lists into chunks of appropriate size
            const chunkSize = 15; // Adjust this number to control field size
            
            // Add complete fighters in chunks
            if (statuses.complete.length > 0) {
                const chunks = this.chunkArray(statuses.complete, chunkSize);
                chunks.forEach((chunk, index) => {
                    embed.addFields({
                        name: index === 0 ? '🟢 Complete Stats' : '🟢 Complete Stats (continued)',
                        value: chunk.join('\n\n'),
                        inline: false
                    });
                });
            }
    
            // Add needs update fighters in chunks
            if (statuses.needsUpdate.length > 0) {
                const chunks = this.chunkArray(statuses.needsUpdate, chunkSize);
                chunks.forEach((chunk, index) => {
                    embed.addFields({
                        name: index === 0 ? '🟡 Needs Update' : '🟡 Needs Update (continued)',
                        value: chunk.join('\n\n'),
                        inline: false
                    });
                });
            }
    
            // Add missing data fighters in chunks
            if (statuses.missing.length > 0) {
                const chunks = this.chunkArray(statuses.missing, chunkSize);
                chunks.forEach((chunk, index) => {
                    embed.addFields({
                        name: index === 0 ? '🔴 Missing Data' : '🔴 Missing Data (continued)',
                        value: chunk.join('\n\n'),
                        inline: false
                    });
                });
            }
    
            // Add instructions
            embed.addFields({
                name: '💡 How to Update',
                value: 'Use fighter dropdown menu to:\n• Update existing stats\n• Add missing fighter data',
                inline: false
            });
    
            return {
                embed,
                needsUpdate: statuses.needsUpdate.length > 0 || statuses.missing.length > 0,
                updateCount: statuses.needsUpdate.length + statuses.missing.length
            };
        } catch (error) {
            console.error('Error creating stats report embed:', error);
            throw error;
        }
    }
    
    // Helper method to chunk arrays
    static chunkArray(array, size) {
        const chunks = [];
        for (let i = 0; i < array.length; i += size) {
            chunks.push(array.slice(i, i + size));
        }
        return chunks;
    }
}
module.exports = DataValidator;