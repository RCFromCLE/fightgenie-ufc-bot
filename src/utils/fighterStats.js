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
            
            // Use the search URL directly with the last name
            const searchUrl = `http://www.ufcstats.com/statistics/fighters/search?query=${encodeURIComponent(fighterName.split(' ')[1])}`;
            console.log('Searching fighters page:', searchUrl);
            const response = await axios.get(searchUrl);
            const $ = cheerio.load(response.data);
            
            // Look for exact match
            let bestMatch = null;
            let bestScore = 0;
    
            $("table.b-statistics__table tbody tr").each((_, row) => {
                const firstName = $(row).find("td:nth-child(1)").text().trim();
                const lastName = $(row).find("td:nth-child(2)").text().trim();
                const fullName = `${firstName} ${lastName}`;
                const fighterLink = $(row).find("td:nth-child(1) a").attr("href");
    
                if (!firstName || !lastName || !fighterLink) return;
    
                // Compare full names
                const searchNameParts = fighterName.toLowerCase().split(' ');
                const foundNameParts = fullName.toLowerCase().split(' ');
    
                // Check if first and last names match exactly
                if (searchNameParts[0] === foundNameParts[0] && 
                    searchNameParts[1] === foundNameParts[1]) {
                    bestMatch = { fighterLink, foundName: fullName, matchType: "exact" };
                    bestScore = 1;
                    return false; // Break the loop
                }
            });
    
            if (bestMatch) {
                console.log('Found match:', bestMatch);
                return bestMatch;
            }
    
            console.log(`No matches found for: ${fighterName}`);
            return null;
    
        } catch (error) {
            console.error(`Error searching for fighter ${fighterName}:`, error);
            return null;
        }
    }

    static findExactMatch($, targetName) {
        let match = null;
        const targetNameLower = targetName.toLowerCase();
    
        $("table.b-statistics__table tbody tr").each((_, row) => {
            const firstName = $(row).find("td:nth-child(1)").text().trim();
            const lastName = $(row).find("td:nth-child(2)").text().trim();
            const fullName = `${firstName} ${lastName}`;
            const fighterLink = $(row).find("td:nth-child(1) a").attr("href");
    
            // Check for exact name match
            if (fullName.toLowerCase() === targetNameLower && fighterLink) {
                match = { fighterLink, foundName: fullName, matchType: "exact" };
                return false; // break each loop
            }
        });
        return match;
    }
    
    static findLastNameMatch($, targetLastName, fullTargetName) {
        let match = null;
        const targetLastNameLower = targetLastName.toLowerCase();
        const targetFirstName = fullTargetName.split(' ')[0].toLowerCase();
        
        $("table.b-statistics__table tbody tr").each((_, row) => {
            const firstName = $(row).find("td:nth-child(1)").text().trim();
            const lastName = $(row).find("td:nth-child(2)").text().trim();
            const fighterLink = $(row).find("td:nth-child(1) a").attr("href");
            
            if (!lastName || !fighterLink) return;
    
            // Check both last name AND first name similarity
            const lastNameSimilarity = this.calculateStringSimilarity(lastName.toLowerCase(), targetLastNameLower);
            const firstNameSimilarity = this.calculateStringSimilarity(firstName.toLowerCase(), targetFirstName);
            
            // Require high similarity for both names
            if (lastNameSimilarity > 0.8 && firstNameSimilarity > 0.7) {
                const fullName = `${firstName} ${lastName}`;
                match = { fighterLink, foundName: fullName, matchType: "lastName" };
                return false; // Break the loop if we find a good match
            }
        });
        return match;
    }
    
    static findFirstNameMatch($, targetFirstName) {
        let match = null;
        const targetFirstNameLower = targetFirstName.toLowerCase();
        let bestMatchScore = 0;
    
        $("table.b-statistics__table tbody tr").each((_, row) => {
            const firstName = $(row).find("td:nth-child(1)").text().trim();
            const lastName = $(row).find("td:nth-child(2)").text().trim();
            const fighterLink = $(row).find("td:nth-child(1) a").attr("href");
            
            if (!firstName || !fighterLink) return;
    
            // Compare first names using string similarity
            const similarity = this.calculateStringSimilarity(firstName.toLowerCase(), targetFirstNameLower);
            
            // Only consider matches with high similarity
            if (similarity > 0.8 && similarity > bestMatchScore) {
                const fullName = `${firstName} ${lastName}`;
                // Verify this isn't a different fighter with similar first name
                if (this.verifyFighterMatch(targetFirstName, firstName)) {
                    bestMatchScore = similarity;
                    match = { fighterLink, foundName: fullName, matchType: "firstName" };
                }
            }
        });
        return match;
    }
    
    static verifyFighterMatch(targetName, foundName) {
        // Remove special characters and convert to lowercase
        const cleanTarget = targetName.toLowerCase().replace(/[^a-z0-9]/g, '');
        const cleanFound = foundName.toLowerCase().replace(/[^a-z0-9]/g, '');
        
        // Check if the found name contains most of the target name characters
        const commonChars = cleanTarget.split('').filter(char => cleanFound.includes(char));
        const matchRatio = commonChars.length / cleanTarget.length;
        
        return matchRatio >= 0.8; // At least 80% of characters should match
    }
    
    static calculateStringSimilarity(str1, str2) {
        if (str1 === str2) return 1.0;
        if (str1.length === 0 || str2.length === 0) return 0.0;
        
        const matrix = Array(str2.length + 1).fill().map(() => Array(str1.length + 1).fill(0));
        
        for (let i = 0; i <= str1.length; i++) matrix[0][i] = i;
        for (let j = 0; j <= str2.length; j++) matrix[j][0] = j;
        
        for (let j = 1; j <= str2.length; j++) {
            for (let i = 1; i <= str1.length; i++) {
                if (str1[i-1] === str2[j-1]) {
                    matrix[j][i] = matrix[j-1][i-1];
                } else {
                    matrix[j][i] = Math.min(
                        matrix[j-1][i-1] + 1,
                        matrix[j][i-1] + 1,
                        matrix[j-1][i] + 1
                    );
                }
            }
        }
        
        const maxLength = Math.max(str1.length, str2.length);
        return 1 - (matrix[str2.length][str1.length] / maxLength);
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

        // Add current timestamp to stats
        const currentTime = new Date().toISOString();

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
        return { ...stats, last_updated: currentTime };

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