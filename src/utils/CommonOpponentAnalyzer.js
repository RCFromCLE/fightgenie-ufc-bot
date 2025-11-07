const database = require("../database");

class CommonOpponentAnalyzer {
    /**
     * Analyzes common opponents between two fighters and their performance against similar styles
     * @param {string} fighter1 - Name of first fighter
     * @param {string} fighter2 - Name of second fighter
     * @returns {Promise<Object>} - Analysis results
     */
    static async analyzeCommonOpponents(fighter1, fighter2) {
        try {
            console.log(`Analyzing common opponents for ${fighter1} vs ${fighter2}`);
            
            // Get all opponents for each fighter
            const [fighter1Opponents, fighter2Opponents] = await Promise.all([
                this.getFighterOpponents(fighter1),
                this.getFighterOpponents(fighter2)
            ]);
            
            // Find common opponents
            const commonOpponents = fighter1Opponents.filter(opp => 
                fighter2Opponents.some(opp2 => opp2.opponent === opp.opponent)
            );
            
            console.log(`Found ${commonOpponents.length} common opponents`);
            
            // Analyze performance against common opponents
            const commonOpponentAnalysis = await this.analyzePerformanceAgainstCommonOpponents(
                fighter1, 
                fighter2, 
                commonOpponents, 
                fighter1Opponents, 
                fighter2Opponents
            );
            
            // Find fighters with similar styles and analyze performance
            const similarStyleAnalysis = await this.analyzeSimilarStylePerformance(fighter1, fighter2);
            
            return {
                commonOpponentCount: commonOpponents.length,
                commonOpponentAnalysis,
                similarStyleAnalysis,
                performanceInsights: this.generatePerformanceInsights(
                    commonOpponentAnalysis, 
                    similarStyleAnalysis
                )
            };
        } catch (error) {
            console.error(`Error analyzing common opponents: ${error.message}`);
            return {
                commonOpponentCount: 0,
                commonOpponentAnalysis: null,
                similarStyleAnalysis: null,
                performanceInsights: []
            };
        }
    }
    
    /**
     * Gets all opponents for a fighter from the database
     * @param {string} fighterName - Name of the fighter
     * @returns {Promise<Array>} - List of opponents with fight details
     */
    static async getFighterOpponents(fighterName) {
        try {
            // Get fights where fighter was winner
            const winsQuery = `
                SELECT 
                    Loser as opponent, 
                    Method as method, 
                    Date as date,
                    'Win' as result
                FROM events 
                WHERE Winner = ? 
                ORDER BY Date DESC
            `;
            
            // Get fights where fighter was loser
            const lossesQuery = `
                SELECT 
                    Winner as opponent, 
                    Method as method, 
                    Date as date,
                    'Loss' as result
                FROM events 
                WHERE Loser = ? 
                ORDER BY Date DESC
            `;
            
            const [wins, losses] = await Promise.all([
                database.query(winsQuery, [fighterName]),
                database.query(lossesQuery, [fighterName])
            ]);
            
            // Combine and sort by date (most recent first)
            return [...wins, ...losses].sort((a, b) => 
                new Date(b.date) - new Date(a.date)
            );
        } catch (error) {
            console.error(`Error getting opponents for ${fighterName}: ${error.message}`);
            return [];
        }
    }
    
    /**
     * Analyzes performance against common opponents
     * @param {string} fighter1 - Name of first fighter
     * @param {string} fighter2 - Name of second fighter
     * @param {Array} commonOpponents - List of common opponents
     * @param {Array} fighter1Opponents - All opponents of fighter1
     * @param {Array} fighter2Opponents - All opponents of fighter2
     * @returns {Promise<Object>} - Analysis results
     */
    static async analyzePerformanceAgainstCommonOpponents(
        fighter1, 
        fighter2, 
        commonOpponents, 
        fighter1Opponents, 
        fighter2Opponents
    ) {
        if (commonOpponents.length === 0) {
            return {
                fighter1Performance: null,
                fighter2Performance: null,
                comparativeAdvantage: null,
                detailedAnalysis: []
            };
        }
        
        // Calculate performance metrics
        let fighter1Wins = 0;
        let fighter2Wins = 0;
        const detailedAnalysis = [];
        
        for (const commonOpp of commonOpponents) {
            const opponent = commonOpp.opponent;
            
            // Find fighter1's fight with this opponent
            const fighter1Fight = fighter1Opponents.find(o => o.opponent === opponent);
            
            // Find fighter2's fight with this opponent
            const fighter2Fight = fighter2Opponents.find(o => o.opponent === opponent);
            
            if (fighter1Fight && fighter2Fight) {
                if (fighter1Fight.result === 'Win') fighter1Wins++;
                if (fighter2Fight.result === 'Win') fighter2Wins++;
                
                detailedAnalysis.push({
                    opponent,
                    fighter1Result: fighter1Fight.result,
                    fighter1Method: fighter1Fight.method,
                    fighter2Result: fighter2Fight.result,
                    fighter2Method: fighter2Fight.method,
                    recency: this.calculateRecencyScore(fighter1Fight.date, fighter2Fight.date),
                    relevance: this.calculateRelevanceScore(fighter1Fight.date, fighter2Fight.date)
                });
            }
        }
        
        // Determine comparative advantage
        let comparativeAdvantage = null;
        if (fighter1Wins > fighter2Wins) {
            comparativeAdvantage = fighter1;
        } else if (fighter2Wins > fighter1Wins) {
            comparativeAdvantage = fighter2;
        }
        
        return {
            fighter1Performance: {
                wins: fighter1Wins,
                winRate: fighter1Wins / commonOpponents.length
            },
            fighter2Performance: {
                wins: fighter2Wins,
                winRate: fighter2Wins / commonOpponents.length
            },
            comparativeAdvantage,
            detailedAnalysis
        };
    }
    
    /**
     * Analyzes performance against fighters with similar styles
     * @param {string} fighter1 - Name of first fighter
     * @param {string} fighter2 - Name of second fighter
     * @returns {Promise<Object>} - Analysis results
     */
    static async analyzeSimilarStylePerformance(fighter1, fighter2) {
        try {
            // Get fighter styles
            const [fighter1Style, fighter2Style] = await Promise.all([
                this.getFighterStyle(fighter1),
                this.getFighterStyle(fighter2)
            ]);
            
            // Find fighters with similar styles
            const [fighter1SimilarStyleOpponents, fighter2SimilarStyleOpponents] = await Promise.all([
                this.getFightersWithSimilarStyle(fighter2Style, fighter1),
                this.getFightersWithSimilarStyle(fighter1Style, fighter2)
            ]);
            
            // Analyze performance against similar styles
            const fighter1VsSimilarStyles = await this.analyzePerformanceAgainstStyle(
                fighter1, 
                fighter1SimilarStyleOpponents
            );
            
            const fighter2VsSimilarStyles = await this.analyzePerformanceAgainstStyle(
                fighter2, 
                fighter2SimilarStyleOpponents
            );
            
            return {
                fighter1: {
                    style: fighter1Style,
                    performanceAgainstSimilarStyles: fighter1VsSimilarStyles
                },
                fighter2: {
                    style: fighter2Style,
                    performanceAgainstSimilarStyles: fighter2VsSimilarStyles
                },
                stylistic_advantage: this.determineStyleAdvantage(
                    fighter1VsSimilarStyles, 
                    fighter2VsSimilarStyles
                )
            };
        } catch (error) {
            console.error(`Error analyzing similar style performance: ${error.message}`);
            return {
                fighter1: { style: "Unknown", performanceAgainstSimilarStyles: null },
                fighter2: { style: "Unknown", performanceAgainstSimilarStyles: null },
                stylistic_advantage: null
            };
        }
    }
    
    /**
     * Gets a fighter's style based on their stats and fight history
     * @param {string} fighterName - Name of the fighter
     * @returns {Promise<string>} - Fighter's style classification
     */
    static async getFighterStyle(fighterName) {
        try {
            // Get fighter stats
            const stats = await database.query(
                "SELECT SLPM, TDAvg, SubAvg, StrAcc, TDAcc FROM fighters WHERE Name = ?", 
                [fighterName]
            );
            
            if (!stats || stats.length === 0) return "Unknown";
            
            const fighterStats = stats[0];
            
            // Get fighter's win methods
            const winMethods = await database.query(
                `SELECT Method FROM events WHERE Winner = ?`,
                [fighterName]
            );

            // Count KO/TKO, submissions, and decisions (null-safe)
            const koCount = winMethods.filter(w => {
                const m = (w.Method || '').toLowerCase();
                return m.includes('ko') || m.includes('tko');
            }).length;

            const subCount = winMethods.filter(w => {
                const m = (w.Method || '').toLowerCase();
                return m.includes('submission') || m.includes('sub');
            }).length;

            const decCount = winMethods.filter(w => {
                const m = (w.Method || '').toLowerCase();
                return m.includes('decision') || m.includes('dec');
            }).length;

            const totalWins = koCount + subCount + decCount;

            // Determine style based on stats and win methods
            const slpm = parseFloat(fighterStats.SLPM) || 0;
            const tdAvg = parseFloat(fighterStats.TDAvg) || 0;
            const subAvg = parseFloat(fighterStats.SubAvg) || 0;

            // If we have no classified wins yet, fall back to stats-only heuristics
            if (totalWins === 0) {
                if (slpm > 3.5 && tdAvg < 1.0) return "Striker";
                if (subAvg > 1.0 || tdAvg > 2.5) return "Submission Grappler";
                if (tdAvg > 2.0) return "Control Grappler";
                if (slpm > 3.0 && tdAvg > 1.5) return "Mixed";
                return "Balanced";
            }

            // Style classification logic
            if (koCount / totalWins > 0.5 && slpm > 3.5) {
                return "Striker";
            } else if (subCount / totalWins > 0.4 || subAvg > 1.0) {
                return "Submission Grappler";
            } else if (tdAvg > 2.0 && decCount / totalWins > 0.5) {
                return "Control Grappler";
            } else if (slpm > 3.0 && tdAvg > 1.5) {
                return "Mixed";
            } else {
                return "Balanced";
            }
        } catch (error) {
            console.error(`Error getting fighter style for ${fighterName}: ${error.message}`);
            return "Unknown";
        }
    }
    
    /**
     * Finds fighters with similar styles to the given style
     * @param {string} style - Fighting style to match
     * @param {string} excludeFighter - Fighter to exclude from results
     * @returns {Promise<Array>} - List of fighters with similar styles
     */
    static async getFightersWithSimilarStyle(style, excludeFighter) {
        try {
            if (style === "Unknown") return [];
            
            // This is a simplified approach. In a real implementation, you would
            // query the database for fighters with similar statistical profiles.
            // For now, we'll use a basic query based on win methods.
            
            let methodPattern;
            switch (style) {
                case "Striker":
                    methodPattern = "%KO%";
                    break;
                case "Submission Grappler":
                    methodPattern = "%Submission%";
                    break;
                case "Control Grappler":
                    methodPattern = "%Decision%";
                    break;
                default:
                    return []; // Return empty for Mixed/Balanced/Unknown
            }
            
            // Find fighters who win by the specified method
            const fighters = await database.query(
                `SELECT DISTINCT Winner as name
                FROM events 
                WHERE Method LIKE ? 
                AND Winner != ?
                GROUP BY Winner
                HAVING COUNT(*) >= 2
                LIMIT 5`,
                [methodPattern, excludeFighter]
            );
            
            return fighters.map(f => f.name);
        } catch (error) {
            console.error(`Error finding similar style fighters: ${error.message}`);
            return [];
        }
    }
    
    /**
     * Analyzes a fighter's performance against opponents with a specific style
     * @param {string} fighterName - Name of the fighter
     * @param {Array} styleSimilarOpponents - List of opponents with similar styles
     * @returns {Promise<Object>} - Performance metrics
     */
    static async analyzePerformanceAgainstStyle(fighterName, styleSimilarOpponents) {
        try {
            if (styleSimilarOpponents.length === 0) {
                return {
                    wins: 0,
                    losses: 0,
                    winRate: 0,
                    performanceRating: "Unknown"
                };
            }
            
            // Get wins against similar style opponents
            const wins = await database.query(
                `SELECT COUNT(*) as count
                FROM events
                WHERE Winner = ?
                AND Loser IN (${styleSimilarOpponents.map(() => '?').join(',')})`,
                [fighterName, ...styleSimilarOpponents]
            );
            
            // Get losses against similar style opponents
            const losses = await database.query(
                `SELECT COUNT(*) as count
                FROM events
                WHERE Loser = ?
                AND Winner IN (${styleSimilarOpponents.map(() => '?').join(',')})`,
                [fighterName, ...styleSimilarOpponents]
            );
            
            const winCount = wins[0]?.count || 0;
            const lossCount = losses[0]?.count || 0;
            const totalFights = winCount + lossCount;
            
            // Calculate win rate
            const winRate = totalFights > 0 ? winCount / totalFights : 0;
            
            // Determine performance rating
            let performanceRating;
            if (totalFights === 0) {
                performanceRating = "Unknown";
            } else if (winRate >= 0.75) {
                performanceRating = "Excellent";
            } else if (winRate >= 0.6) {
                performanceRating = "Good";
            } else if (winRate >= 0.4) {
                performanceRating = "Average";
            } else {
                performanceRating = "Poor";
            }
            
            return {
                wins: winCount,
                losses: lossCount,
                winRate,
                performanceRating
            };
        } catch (error) {
            console.error(`Error analyzing performance against style: ${error.message}`);
            return {
                wins: 0,
                losses: 0,
                winRate: 0,
                performanceRating: "Unknown"
            };
        }
    }
    
    /**
     * Determines which fighter has the stylistic advantage
     * @param {Object} fighter1Performance - Fighter 1's performance metrics
     * @param {Object} fighter2Performance - Fighter 2's performance metrics
     * @returns {string|null} - Name of fighter with advantage or null if even
     */
    static determineStyleAdvantage(fighter1Performance, fighter2Performance) {
        if (!fighter1Performance || !fighter2Performance) return null;
        
        const performanceRatings = {
            "Excellent": 4,
            "Good": 3,
            "Average": 2,
            "Poor": 1,
            "Unknown": 0
        };
        
        const fighter1Rating = performanceRatings[fighter1Performance.performanceRating] || 0;
        const fighter2Rating = performanceRatings[fighter2Performance.performanceRating] || 0;
        
        if (fighter1Rating > fighter2Rating) {
            return "fighter1";
        } else if (fighter2Rating > fighter1Rating) {
            return "fighter2";
        } else {
            return null; // Even
        }
    }
    
    /**
     * Calculates a recency score for a fight date
     * @param {string} date - Date of the fight
     * @returns {number} - Recency score (0-1)
     */
    static calculateRecencyScore(date1, date2) {
        const now = new Date();
        const fightDate1 = new Date(date1);
        const fightDate2 = new Date(date2);
        
        // Use the more recent fight date
        const fightDate = new Date(Math.max(fightDate1, fightDate2));
        
        // Calculate months since fight
        const monthsSinceFight = (now - fightDate) / (1000 * 60 * 60 * 24 * 30);
        
        // Score decreases as time increases (more recent = higher score)
        // 0-12 months: 1.0-0.75, 12-24 months: 0.75-0.5, 24-36 months: 0.5-0.25, >36 months: 0.25-0
        if (monthsSinceFight <= 12) {
            return 1.0 - (monthsSinceFight / 48);
        } else if (monthsSinceFight <= 24) {
            return 0.75 - ((monthsSinceFight - 12) / 48);
        } else if (monthsSinceFight <= 36) {
            return 0.5 - ((monthsSinceFight - 24) / 48);
        } else {
            return Math.max(0.25 - ((monthsSinceFight - 36) / 48), 0);
        }
    }
    
    /**
     * Calculates a relevance score for fight dates
     * @param {string} date1 - Date of fighter1's fight
     * @param {string} date2 - Date of fighter2's fight
     * @returns {number} - Relevance score (0-1)
     */
    static calculateRelevanceScore(date1, date2) {
        const fightDate1 = new Date(date1);
        const fightDate2 = new Date(date2);
        
        // Calculate months between fights
        const monthsBetweenFights = Math.abs(fightDate1 - fightDate2) / (1000 * 60 * 60 * 24 * 30);
        
        // Score decreases as time between fights increases (closer = higher score)
        // 0-6 months: 1.0-0.75, 6-12 months: 0.75-0.5, 12-24 months: 0.5-0.25, >24 months: 0.25-0
        if (monthsBetweenFights <= 6) {
            return 1.0 - (monthsBetweenFights / 24);
        } else if (monthsBetweenFights <= 12) {
            return 0.75 - ((monthsBetweenFights - 6) / 24);
        } else if (monthsBetweenFights <= 24) {
            return 0.5 - ((monthsBetweenFights - 12) / 48);
        } else {
            return Math.max(0.25 - ((monthsBetweenFights - 24) / 96), 0);
        }
    }
    
    /**
     * Generates insights based on common opponent and style analysis
     * @param {Object} commonOpponentAnalysis - Common opponent analysis results
     * @param {Object} similarStyleAnalysis - Similar style analysis results
     * @returns {Array} - List of insights
     */
    static generatePerformanceInsights(commonOpponentAnalysis, similarStyleAnalysis) {
        const insights = [];
        
        // Add insights from common opponent analysis
        if (commonOpponentAnalysis && commonOpponentAnalysis.comparativeAdvantage) {
            insights.push(
                `${commonOpponentAnalysis.comparativeAdvantage} has performed better against common opponents`
            );
            
            // Add detailed insights from specific fights if available
            if (commonOpponentAnalysis.detailedAnalysis && commonOpponentAnalysis.detailedAnalysis.length > 0) {
                // Sort by relevance and recency
                const sortedAnalysis = [...commonOpponentAnalysis.detailedAnalysis]
                    .sort((a, b) => (b.relevance + b.recency) - (a.relevance + a.recency))
                    .slice(0, 3); // Take top 3 most relevant
                
                for (const analysis of sortedAnalysis) {
                    if (analysis.fighter1Result !== analysis.fighter2Result) {
                        insights.push(
                            `${analysis.fighter1Result === 'Win' ? 'Fighter1' : 'Fighter2'} defeated ${analysis.opponent} while ${analysis.fighter1Result === 'Win' ? 'Fighter2' : 'Fighter1'} lost`
                        );
                    } else if (analysis.fighter1Method !== analysis.fighter2Method) {
                        insights.push(
                            `Both fighters defeated ${analysis.opponent}, but by different methods (${analysis.fighter1Method} vs ${analysis.fighter2Method})`
                        );
                    }
                }
            }
        }
        
        // Add insights from style analysis
        if (similarStyleAnalysis) {
            if (similarStyleAnalysis.stylistic_advantage === "fighter1") {
                insights.push(
                    `Fighter1 has performed well against opponents with similar style to Fighter2`
                );
            } else if (similarStyleAnalysis.stylistic_advantage === "fighter2") {
                insights.push(
                    `Fighter2 has performed well against opponents with similar style to Fighter1`
                );
            }
            
            // Add style-specific insights
            if (similarStyleAnalysis.fighter1.style && similarStyleAnalysis.fighter2.style) {
                if (similarStyleAnalysis.fighter1.style === "Striker" && similarStyleAnalysis.fighter2.style === "Grappler") {
                    insights.push("Classic striker vs grappler matchup");
                } else if (similarStyleAnalysis.fighter1.style === "Grappler" && similarStyleAnalysis.fighter2.style === "Striker") {
                    insights.push("Classic grappler vs striker matchup");
                } else if (similarStyleAnalysis.fighter1.style === similarStyleAnalysis.fighter2.style) {
                    insights.push(`Both fighters have similar ${similarStyleAnalysis.fighter1.style.toLowerCase()} styles`);
                }
            }
        }
        
        return insights;
    }
}

module.exports = CommonOpponentAnalyzer;
