const database = require("../database");
const axios = require("axios");
const cheerio = require("cheerio");

class FighterStats {
    // Cache to store fighter stats
    static statsCache = new Map();
    static CACHE_DURATION = 7 * 24 * 60 * 60 * 1000; // 7 days

    static async getFighterStats(fighterName) {
        try {
            if (!fighterName) {
                console.error('Invalid fighter name provided to getFighterStats');
                return null;
            }

            // Check cache first
            const cachedStats = this.statsCache.get(fighterName);
            if (cachedStats && Date.now() - cachedStats.timestamp < this.CACHE_DURATION) {
                console.log(`Using cached stats for ${fighterName}`);
                return cachedStats.data;
            }

            // Get stats from database
            const stats = await database.query(
                "SELECT *, datetime(last_updated) as updated_at FROM fighters WHERE Name = ?",
                [fighterName]
            );

            if (!stats || stats.length === 0) {
                console.log(`No stats found in database for ${fighterName}, attempting to scrape...`);
                return await this.updateFighterStats(fighterName);
            }

            // Get fight record
            const record = await this.getFighterRecord(fighterName);

            // Combine stats with record
            const fighterStats = {
                ...stats[0],
                record,
                last_updated: stats[0].updated_at || new Date().toISOString()
            };

            // Update cache
            this.statsCache.set(fighterName, {
                data: fighterStats,
                timestamp: Date.now()
            });

            return fighterStats;
        } catch (error) {
            console.error(`Error getting fighter stats for ${fighterName}:`, error);
            return null;
        }
    }

    static async searchFighter(fighterName) {
        try {
            if (!fighterName || typeof fighterName !== 'string') {
                throw new Error(`Invalid fighter name: ${fighterName}`);
            }

            console.log(`\nSearching for fighter: ${fighterName}`);
            
            // Clean the name and create search variations
            const cleanName = fighterName.trim();
            const nameParts = cleanName.split(/\s+/);
            
            if (nameParts.length === 0) {
                throw new Error('No valid name parts found after cleaning');
            }

            // Try different search approaches
            const searchMethods = [
                // Exact name match
                async () => {
                    const url = `http://www.ufcstats.com/statistics/fighters?char=${nameParts[0][0].toUpperCase()}&page=all`;
                    console.log('Trying exact match search:', url);
                    const $ = await this.fetchAndLoad(url);
                    return this.findExactMatch($, cleanName);
                },
                // Last name search
                async () => {
                    if (nameParts.length > 1) {
                        const url = `http://www.ufcstats.com/statistics/fighters?char=${nameParts[nameParts.length - 1][0].toUpperCase()}&page=all`;
                        console.log('Trying last name search:', url);
                        const $ = await this.fetchAndLoad(url);
                        return this.findLastNameMatch($, nameParts[nameParts.length - 1]);
                    }
                    return null;
                },
                // First name search
                async () => {
                    const url = `http://www.ufcstats.com/statistics/fighters?char=${nameParts[0][0].toUpperCase()}&page=all`;
                    console.log('Trying first name search:', url);
                    const $ = await this.fetchAndLoad(url);
                    return this.findFirstNameMatch($, nameParts[0]);
                }
            ];

            // Try each search method in order
            for (const searchMethod of searchMethods) {
                try {
                    const result = await searchMethod();
                    if (result) {
                        console.log('Found match:', result);
                        return result;
                    }
                } catch (searchError) {
                    console.error('Error in search method:', searchError);
                    continue;
                }
            }

            console.log(`No matches found for: ${fighterName}`);
            return null;

        } catch (error) {
            console.error(`Error searching for fighter ${fighterName}:`, error);
            return null;
        }
    }

    static async fetchAndLoad(url) {
        try {
            const response = await axios.get(url);
            return cheerio.load(response.data);
        } catch (error) {
            console.error('Error fetching URL:', url, error);
            throw error;
        }
    }

    static findExactMatch($, targetName) {
        let match = null;
        $("table.b-statistics__table tbody tr").each((_, row) => {
            const firstName = $(row).find("td:nth-child(1)").text().trim();
            const lastName = $(row).find("td:nth-child(2)").text().trim();
            const fullName = `${firstName} ${lastName}`;
            const fighterLink = $(row).find("td:nth-child(1) a").attr("href");

            if (fullName.toLowerCase() === targetName.toLowerCase() && fighterLink) {
                match = { fighterLink, foundName: fullName, matchType: "exact" };
                return false; // break each loop
            }
        });
        return match;
    }

    static findLastNameMatch($, targetLastName) {
        let match = null;
        $("table.b-statistics__table tbody tr").each((_, row) => {
            const firstName = $(row).find("td:nth-child(1)").text().trim();
            const lastName = $(row).find("td:nth-child(2)").text().trim();
            const fighterLink = $(row).find("td:nth-child(1) a").attr("href");

            if (lastName.toLowerCase() === targetLastName.toLowerCase() && fighterLink) {
                match = { fighterLink, foundName: `${firstName} ${lastName}`, matchType: "lastName" };
                return false; // break each loop
            }
        });
        return match;
    }

    static findFirstNameMatch($, targetFirstName) {
        let match = null;
        $("table.b-statistics__table tbody tr").each((_, row) => {
            const firstName = $(row).find("td:nth-child(1)").text().trim();
            const lastName = $(row).find("td:nth-child(2)").text().trim();
            const fighterLink = $(row).find("td:nth-child(1) a").attr("href");

            if (firstName.toLowerCase() === targetFirstName.toLowerCase() && fighterLink) {
                match = { fighterLink, foundName: `${firstName} ${lastName}`, matchType: "firstName" };
                return false; // break each loop
            }
        });
        return match;
    }

    static async scrapeFighterStats(fighterName) {
        try {
            console.log(`\nStarting stat scrape for fighter: ${fighterName}`);
            
            const searchResult = await this.searchFighter(fighterName);
            if (!searchResult) {
                console.log('No fighter found in search');
                return null;
            }

            const { fighterLink, foundName } = searchResult;
            console.log(`Found fighter: ${foundName} at ${fighterLink}`);
            
            // Fetch fighter's page
            const response = await axios.get(fighterLink);
            const $ = cheerio.load(response.data);

            // Helper to extract stats
            const extractStat = (label) => {
                const stat = $('.b-list__box-list')
                    .find(`i:contains("${label}")`)
                    .parent()
                    .text()
                    .replace(`${label}:`, '')
                    .trim();
                return stat || '';
            };

            // Extract and clean stats
            const stats = {
                Name: foundName,
                Height: extractStat('Height').replace(/\s+/g, ''),
                Weight: parseInt(extractStat('Weight').replace(/\D/g, '')) || null,
                Reach: extractStat('Reach').replace(/"/g, '').trim(),
                Stance: extractStat('STANCE'),
                DOB: extractStat('DOB'),
                SLPM: parseFloat(extractStat('SLpM')) || null,
                SApM: parseFloat(extractStat('SApM')) || null,
                StrAcc: extractStat('Str. Acc.').includes('%') ? extractStat('Str. Acc.') : extractStat('Str. Acc.') + '%',
                StrDef: extractStat('Str. Def').includes('%') ? extractStat('Str. Def') : extractStat('Str. Def') + '%',
                TDAvg: parseFloat(extractStat('TD Avg.')) || null,
                TDAcc: extractStat('TD Acc.').includes('%') ? extractStat('TD Acc.') : extractStat('TD Acc.') + '%',
                TDDef: extractStat('TD Def.').includes('%') ? extractStat('TD Def.') : extractStat('TD Def.') + '%',
                SubAvg: parseFloat(extractStat('Sub. Avg.')) || null,
                last_updated: new Date().toISOString()
            };

            console.log('Successfully scraped stats for', foundName);
            return stats;

        } catch (error) {
            console.error(`Error scraping stats for ${fighterName}:`, error);
            return null;
        }
    }

    static async updateFighterStats(fighterName) {
        try {
            console.log(`\nUpdating stats for ${fighterName}`);
            const stats = await this.scrapeFighterStats(fighterName);
            
            if (!stats) {
                console.log(`No stats found for ${fighterName}`);
                return null;
            }

            // Insert or update stats in database
            await database.query(`
                INSERT OR REPLACE INTO fighters (
                    Name, Height, Weight, Reach, Stance, DOB,
                    SLPM, SApM, StrAcc, StrDef, TDAvg,
                    TDAcc, TDDef, SubAvg, last_updated
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
            `, [
                stats.Name,
                stats.Height,
                stats.Weight,
                stats.Reach,
                stats.Stance,
                stats.DOB,
                stats.SLPM,
                stats.SApM,
                stats.StrAcc,
                stats.StrDef,
                stats.TDAvg,
                stats.TDAcc,
                stats.TDDef,
                stats.SubAvg
            ]);

            console.log(`Successfully updated database for ${stats.Name}`);

            // Update cache
            this.statsCache.set(fighterName, {
                data: stats,
                timestamp: Date.now()
            });

            return stats;

        } catch (error) {
            console.error(`Error updating stats for ${fighterName}:`, error);
            return null;
        }
    }

    static async getFighterRecord(fighterName) {
        try {
            const [wins, losses, draws] = await Promise.all([
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

            return {
                wins: wins[0]?.count || 0,
                losses: losses[0]?.count || 0,
                draws: draws[0]?.count || 0
            };
        } catch (error) {
            console.error(`Error getting record for ${fighterName}:`, error);
            return { wins: 0, losses: 0, draws: 0 };
        }
    }
}

module.exports = FighterStats;