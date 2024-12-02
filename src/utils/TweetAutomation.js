const { OpenAI } = require('openai');
const database = require('../database');
const { TwitterApi } = require('twitter-api-v2');
const fs = require('fs').promises;
const ModelStatsCommand = require('../commands/ModelStatsCommand');
const axios = require('axios');
const cheerio = require('cheerio');
const schedule = require('node-schedule');

class TweetAutomation {
    constructor() {
        this.openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY
        });

        this.twitter = new TwitterApi({
            appKey: process.env.TWITTER_API_KEY,
            appSecret: process.env.TWITTER_API_SECRET,
            accessToken: process.env.TWITTER_ACCESS_TOKEN,
            accessSecret: process.env.TWITTER_ACCESS_SECRET,
        });

        this.tweetIdCounter = 0;
        this.testMode = process.env.TWEET_TEST_MODE === 'true';
        this.logFile = 'tweet-logs.txt';

        console.log('\n🤖 Tweet Automation System Started');
        console.log('📊 Checking schedule every 15 minutes');

        // Initialize schedules first
        this.scheduleTweets();
        
        // Then start the check cycle
        this.startScheduleMonitoring();
    }

    async startScheduleMonitoring() {
        await this.showUpcomingTweets();
        // Check schedule every 15 minutes
        setInterval(() => this.showUpcomingTweets(), 15 * 60 * 1000);
    }
    
    async generateTestPosts() {
        try {
            console.log('\n=== FIGHT GENIE TEST POSTS ===\n');
            const timestamp = new Date().toLocaleString();
            let output = `\n=== GENERATED ${timestamp} ===\n\n`;

            // Get upcoming event first since multiple sections need it
            const upcomingEvent = await this.getUpcomingEvent();

            // Fight Analysis
            console.log('🥊 Generating Fight Analysis Thread...');
            const analysis = await this.getFeaturedFightAnalysis();
            if (analysis) {
                output += '🥊 FIGHT ANALYSIS THREAD:\n';
                for (let i = 1; i <= 3; i++) {
                    const tweet = await this.generateTweet(analysis, 'fight_analysis');
                    output += `Tweet ${i}:\n${tweet}\n\n`;
                }
            } else {
                output += '❌ No fight analysis data available\n\n';
            }

            // Value Pick
            console.log('🎯 Generating Value Pick...');
            const valuePicks = await this.getValuePicks();
            if (valuePicks?.[0]) {
                const tweet = await this.generateTweet(valuePicks[0], 'value_pick');
                output += '🎯 VALUE PICK:\n' + tweet + '\n\n';
            } else {
                output += '❌ No value picks available\n\n';
            }

            // Model Comparison
            console.log('🤖 Generating Model Comparison...');
            const stats = await this.getModelStats();
            if (stats?.length >= 2) {
                const gptStats = stats.find(s => s.model_used === 'gpt');
                const claudeStats = stats.find(s => s.model_used === 'claude');
                const tweet = await this.generateTweet({
                    gpt: gptStats,
                    claude: claudeStats
                }, 'model_competition');
                output += '🤖 MODEL COMPARISON:\n' + tweet + '\n\n';
            } else {
                output += '❌ No model stats available\n\n';
            }

            // Event Promo Codes
            console.log('🎫 Generating Event Promo Codes...');
            if (upcomingEvent) {
                const promoCodes = await database.query(`
                    SELECT code 
                    FROM promo_codes 
                    WHERE current_uses = 0 
                    LIMIT 3
                `);

                if (promoCodes?.length) {
                    output += '🎫 EVENT PROMO CODES:\n';
                    for (let i = 0; i < promoCodes.length; i++) {
                        const promoTweet = `🎯 Fight Genie ${upcomingEvent.Event} Code
    
    ${promoCodes[i].code}
    
    To redeem:
    1. Add our bot to your server (link in bio)
    2. Type $promo "${promoCodes[i].code}"
    3. Follow @FightGenie & tweet us 🤝
    
    • Valid for ${upcomingEvent.Event} only
    • Expires at event completion
    • AI predictions by GPT-4 & Claude
    
    https://fightgenie.ai #UFC`;
                        output += `Promo Code ${i + 1}:\n${promoTweet}\n\n`;
                    }
                } else {
                    output += '❌ No promo codes available\n\n';
                }
            } else {
                output += '❌ No upcoming event available\n\n';
            }

            // Promo Tweet
            console.log('💫 Generating Promo Tweet...');
            if (upcomingEvent) {
                const tweet = await this.generateTweet({ event: upcomingEvent }, 'promo');
                output += '💫 PROMO:\n' + tweet + '\n\n';
            } else {
                output += '❌ No upcoming event available\n\n';
            }

            output += '='.repeat(50) + '\n';

            // Save to file
            try {
                await fs.appendFile(this.logFile, output);
                console.log(`✅ Posts saved to ${this.logFile}`);
            } catch (error) {
                console.error('Error writing to file:', error);
            }

            return {
                success: true,
                message: `Generated test posts and saved to ${this.logFile}`
            };
        } catch (error) {
            console.error('Error generating test posts:', error);
            throw error;
        }
    }
    async logTweet(type, content) {
        const timestamp = new Date().toISOString();
        const logEntry = `[${timestamp}] ${type}\n${content}\n${'='.repeat(50)}\n`;

        console.log(logEntry);

        if (this.testMode) {
            try {
                await fs.appendFile(this.logFile, logEntry);
            } catch (error) {
                console.error('Error writing to log file:', error);
            }
        }
    }

    async getUpcomingEvent() {
        try {
            const event = await database.query(`
                SELECT *
                FROM events
                WHERE Date >= date('now', '+1 day')
                AND Event IS NOT NULL
                ORDER BY Date ASC
                LIMIT 1
            `);
            
            if (event?.[0]) {
                // Create a date object and format it properly
                const eventDate = new Date(event[0].Date + 'T00:00:00-07:00'); // Assuming PT timezone
                return {
                    ...event[0],
                    Date: eventDate.toISOString() // This ensures consistent date handling
                };
            }
            return null;
        } catch (error) {
            console.error('Error fetching upcoming event:', error);
            return null;
        }
    }

    async generateUniqueEventAnalysis() {
        try {
            const event = await this.getUpcomingEvent();
            if (!event) return null;

            // Get all predictions for the event
            const predictions = await database.query(`
                SELECT prediction_data, model_used 
                FROM stored_predictions sp
                WHERE sp.event_id = ? 
                AND prediction_data IS NOT NULL
                ORDER BY sp.created_at DESC 
                LIMIT 1
            `, [event.event_id]);

            if (!predictions?.[0]) return null;

            const predictionData = JSON.parse(predictions[0].prediction_data);
            const fights = predictionData.fights || [];

            // Get all fighter stats
            const fighterStats = await Promise.all(
                fights.flatMap(fight => [
                    database.query('SELECT * FROM fighters WHERE Name = ? LIMIT 1', [fight.fighter1]),
                    database.query('SELECT * FROM fighters WHERE Name = ? LIMIT 1', [fight.fighter2])
                ])
            );

            // Create unique analysis data
            const analysisData = {
                totalFights: fights.length,
                avgConfidence: fights.reduce((sum, f) => sum + (f.confidence || 0), 0) / fights.length,
                southpawCount: fighterStats.filter(f => f[0]?.Stance === 'Southpaw').length,
                avgHeight: fighterStats.reduce((sum, f) => sum + (parseFloat(f[0]?.Height) || 0), 0) / fighterStats.length,
                highestFinishRate: Math.max(...fighterStats.map(f => parseFloat(f[0]?.FinishRate || 0))),
                grapplersCount: fighterStats.filter(f => (parseFloat(f[0]?.TDAvg) || 0) > 2).length,
                strikersCount: fighterStats.filter(f => (parseFloat(f[0]?.SLPM) || 0) > 4).length,
                closeMatchups: fights.filter(f => Math.abs(f.confidence - 50) < 10).length
            };

            return this.generateTweet({ event, analysis: analysisData }, 'unique_analysis');
        } catch (error) {
            console.error('Error generating unique analysis:', error);
            return null;
        }
    }

    async getFeaturedFightAnalysis() {
        try {
            // Alternate between models randomly
            const useGPT = Math.random() < 0.5;
            const modelToUse = useGPT ? 'gpt' : 'claude';
            console.log(`Using ${modelToUse.toUpperCase()}'s prediction data for fight analysis`);

            const event = await this.getUpcomingEvent();
            if (!event) return null;

            // Get predictions for chosen model
            const predictions = await database.query(`
                SELECT prediction_data, model_used 
                FROM stored_predictions sp
                WHERE sp.event_id = ? 
                AND sp.model_used = ?
                AND prediction_data IS NOT NULL
                ORDER BY sp.created_at DESC 
                LIMIT 1
            `, [event.event_id, modelToUse]);

            if (!predictions?.[0]) {
                console.log(`No predictions found for ${modelToUse}`);
                return null;
            }

            const predictionData = JSON.parse(predictions[0].prediction_data);
            const fights = predictionData.fights || [];

            // Filter fights with complete analysis
            const analyzableFights = fights.filter(fight =>
                fight.reasoning &&
                fight.keyFactors?.length > 0
            );

            if (!analyzableFights.length) {
                console.log('No fights with complete analysis found');
                return null;
            }

            // Randomly select a fight
            const randomIndex = Math.floor(Math.random() * analyzableFights.length);
            const selectedFight = analyzableFights[randomIndex];

            // Get fighter stats
            const [fighter1Stats, fighter2Stats] = await Promise.all([
                database.query('SELECT * FROM fighters WHERE Name = ? LIMIT 1', [selectedFight.fighter1]),
                database.query('SELECT * FROM fighters WHERE Name = ? LIMIT 1', [selectedFight.fighter2])
            ]);

            return {
                fight: selectedFight,
                model: modelToUse,
                fighter1Stats: fighter1Stats[0],
                fighter2Stats: fighter2Stats[0],
                event: event
            };

        } catch (error) {
            console.error('Error getting featured fight analysis:', error);
            return null;
        }
    }

    async getValuePicks() {
        try {
            // Alternate between models randomly
            const useGPT = Math.random() < 0.5;
            const modelToUse = useGPT ? 'gpt' : 'claude';
            console.log(`Using ${modelToUse.toUpperCase()} for value picks`);

            const event = await this.getUpcomingEvent();
            if (!event) return null;

            // Get predictions for chosen model
            const predictions = await database.query(`
                SELECT sp.prediction_data, sp.model_used
                FROM stored_predictions sp
                WHERE sp.event_id = ?
                AND sp.model_used = ?
                AND prediction_data IS NOT NULL
                ORDER BY sp.created_at DESC
                LIMIT 1
            `, [event.event_id, modelToUse]);

            if (!predictions?.[0]) {
                console.log(`No predictions found for ${modelToUse}`);
                return null;
            }

            const predictionData = JSON.parse(predictions[0].prediction_data);
            const fights = predictionData.fights || [];

            // Get high confidence picks with fighter stats
            const highConfidencePicks = await Promise.all(
                fights
                    .filter(fight => fight.confidence >= 70)
                    .map(async fight => {
                        const fighterStats = await database.query(
                            'SELECT * FROM fighters WHERE Name = ? LIMIT 1',
                            [fight.predictedWinner]
                        );
                        return {
                            ...fight,
                            fighterStats: fighterStats[0],
                            model: modelToUse // Include which model made this prediction
                        };
                    })
            );

            // Sort by confidence and return
            return highConfidencePicks.sort((a, b) => b.confidence - a.confidence);

        } catch (error) {
            console.error('Error getting value picks:', error);
            return null;
        }
    }

    async getValuePicks() {
        try {
            const event = await this.getUpcomingEvent();
            if (!event) return null;

            const predictions = await database.query(`
                SELECT sp.prediction_data, sp.model_used
                FROM stored_predictions sp
                WHERE sp.event_id = ?
                ORDER BY sp.created_at DESC
                LIMIT 1
            `, [event.event_id]);

            if (!predictions?.[0]) return null;

            const predictionData = JSON.parse(predictions[0].prediction_data);
            const fights = predictionData.fights || [];

            const highConfidencePicks = await Promise.all(
                fights
                    .filter(fight => fight.confidence >= 70)
                    .map(async fight => {
                        const fighterStats = await database.query(
                            'SELECT * FROM fighters WHERE Name = ?',
                            [fight.predictedWinner]
                        );
                        return { ...fight, fighterStats: fighterStats[0] };
                    })
            );

            return highConfidencePicks.sort((a, b) => b.confidence - a.confidence);
        } catch (error) {
            console.error('Error getting value picks:', error);
            return null;
        }
    }

    async getModelStats() {
        try {
            // Step 1: Get all events with predictions, exactly like ModelStatsCommand
            const events = await database.query(`
                SELECT DISTINCT 
                    e.event_id,
                    e.Event,
                    e.Date,
                    e.event_link,
                    COUNT(DISTINCT sp.prediction_id) as prediction_count,
                    COUNT(DISTINCT CASE WHEN sp.card_type = 'main' THEN sp.prediction_id END) as main_predictions,
                    COUNT(DISTINCT CASE WHEN sp.card_type = 'prelims' THEN sp.prediction_id END) as prelim_predictions,
                    GROUP_CONCAT(DISTINCT sp.model_used) as models_used
                FROM events e
                JOIN stored_predictions sp ON e.event_id = sp.event_id
                WHERE prediction_data IS NOT NULL
                AND (
                    Date < date('now') 
                    OR (
                        Date = date('now') 
                        AND EXISTS (
                            SELECT 1 FROM fight_results fr 
                            WHERE fr.event_id = e.event_id 
                            AND fr.is_completed = 1
                        )
                    )
                )
                GROUP BY e.event_id, e.Event, e.Date, e.event_link
                ORDER BY e.Date DESC
            `);

            console.log(`Found ${events.length} events to analyze`);
            let allResults = [];
            const scrapedEvents = new Map();

            // Step 2: Process each event
            for (const event of events) {
                console.log(`Processing event: ${event.Event}`);

                const predictions = await database.query(`
                    SELECT prediction_id, model_used, card_type, prediction_data
                    FROM stored_predictions
                    WHERE event_id = ?
                `, [event.event_id]);

                // Step 3: Get or scrape results
                let scrapedResults;
                if (scrapedEvents.has(event.event_id)) {
                    scrapedResults = scrapedEvents.get(event.event_id);
                } else if (event.event_link) {
                    try {
                        const response = await axios.get(event.event_link);
                        const $ = cheerio.load(response.data);
                        const results = [];

                        $(".b-fight-details__table tbody tr").each((_, row) => {
                            const $row = $(row);
                            const fighters = $row.find(".b-link.b-link_style_black");
                            const methodCell = $row.find('td').eq(7);
                            const methodText = methodCell.text().trim();

                            if (fighters.length >= 2) {
                                const winner = $(fighters[0]).text().trim();
                                const loser = $(fighters[1]).text().trim();

                                if (winner && loser && methodText) {
                                    results.push({
                                        winner,
                                        loser,
                                        method: methodText.replace(/\s+/g, ' ').trim()
                                    });
                                }
                            }
                        });

                        scrapedResults = results;
                        scrapedEvents.set(event.event_id, results);
                    } catch (error) {
                        console.error(`Error scraping ${event.Event}:`, error);
                        continue;
                    }
                }

                if (!scrapedResults?.length) {
                    console.log(`No results found for ${event.Event}`);
                    continue;
                }

                // Step 4: Process predictions
                for (const pred of predictions) {
                    try {
                        const predictionData = JSON.parse(pred.prediction_data);
                        const fights = predictionData.fights || [];

                        const verifiedFights = fights.map(fight => {
                            const result = scrapedResults.find(r =>
                                (r.winner === fight.fighter1?.trim() && r.loser === fight.fighter2?.trim()) ||
                                (r.winner === fight.fighter2?.trim() && r.loser === fight.fighter1?.trim())
                            );

                            if (!result) return null;

                            return {
                                isCorrect: fight.predictedWinner?.trim() === result.winner,
                                confidence: Number(fight.confidence) || 0,
                                isHighConfidence: (Number(fight.confidence) || 0) >= 70
                            };
                        }).filter(Boolean);

                        if (verifiedFights.length > 0) {
                            allResults.push({
                                model: pred.model_used,
                                fights_predicted: verifiedFights.length,
                                correct_predictions: verifiedFights.filter(f => f.isCorrect).length,
                                high_confidence_fights: verifiedFights.filter(f => f.isHighConfidence).length,
                                high_confidence_correct: verifiedFights.filter(f => f.isHighConfidence && f.isCorrect).length,
                                confidence_sum: verifiedFights.reduce((sum, f) => sum + f.confidence, 0)
                            });
                        }
                    } catch (error) {
                        console.error('Error processing prediction:', error);
                    }
                }
            }

            // Step 5: Aggregate stats
            const modelStats = {};
            allResults.forEach(result => {
                if (!modelStats[result.model]) {
                    modelStats[result.model] = {
                        fights_predicted: 0,
                        correct_predictions: 0,
                        high_confidence_fights: 0,
                        high_confidence_correct: 0,
                        confidence_sum: 0
                    };
                }

                const stats = modelStats[result.model];
                stats.fights_predicted += result.fights_predicted;
                stats.correct_predictions += result.correct_predictions;
                stats.high_confidence_fights += result.high_confidence_fights;
                stats.high_confidence_correct += result.high_confidence_correct;
                stats.confidence_sum += result.confidence_sum;
            });

            // Step 6: Format results
            return Object.entries(modelStats).map(([model, stats]) => ({
                model_used: model,
                events_analyzed: events.length,
                total_fights: stats.fights_predicted,
                won_fights: stats.correct_predictions,
                win_rate: ((stats.correct_predictions / stats.fights_predicted) * 100).toFixed(1),
                lock_rate: ((stats.high_confidence_correct / stats.high_confidence_fights) * 100).toFixed(1),
                lock_wins: stats.high_confidence_correct,
                total_locks: stats.high_confidence_fights,
                avg_confidence: (stats.confidence_sum / stats.fights_predicted).toFixed(1)
            }));

        } catch (error) {
            console.error('Error getting model stats:', error);
            return null;
        }
    }


    async postModelStatsTweets() {
        try {
            console.log('Fetching model stats...');
            const modelStats = await this.getModelStats();

            if (!modelStats?.length) {
                console.log('No model stats available');
                return;
            }

            console.log('Model stats:', modelStats);

            const gptStats = modelStats.find(s => s.model_used === 'gpt');
            const claudeStats = modelStats.find(s => s.model_used === 'claude');

            if (!gptStats || !claudeStats) {
                console.log('Missing stats for one or both models');
                return;
            }

            const tweets = [
                `🤖 Fight Genie Model Showdown!\n\nGPT-4: ${gptStats.win_rate}% accurate\nClaude: ${claudeStats.win_rate}% accurate\n\nBoth models analyzed ${gptStats.events_analyzed} events & ${gptStats.fights_predicted} fights! All results tracked publicly. #UFC #AIpredictions`,

                `📊 Method Prediction Accuracy:\n\nGPT-4: ${gptStats.method_accuracy}%\nClaude: ${claudeStats.method_accuracy}%\n\nBased on ${gptStats.fights_predicted} verified fight outcomes! Which AI predicts finishes better? #UFCstats`,

                `💫 AI Confidence vs Reality:\n\nGPT-4 confidence: ${gptStats.avg_confidence}%\nClaude confidence: ${claudeStats.avg_confidence}%\n\nTracking ${gptStats.events_analyzed} events of predictions! #FightGenie #UFC`
            ];

            // Log or post tweets
            if (this.testMode) {
                await this.logTweet('MODEL COMPARISON THREAD', tweets.join('\n\n'));
            } else {
                let lastTweetId;
                for (const tweet of tweets) {
                    const response = lastTweetId ?
                        await this.twitter.v2.reply(tweet, lastTweetId) :
                        await this.twitter.v2.tweet(tweet);
                    lastTweetId = response.data.id;
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }

            console.log('Model comparison tweets generated successfully');

        } catch (error) {
            console.error('Error posting model stats tweets:', error);
        }
    }

    async generateModelComparisonTweet() {
        try {
            const stats = await this.getModelStats();
            console.log('Model Stats:', stats);

            if (!stats?.length) {
                return "🤖 Fight Genie's models are warming up! Stay tuned for prediction stats.";
            }

            const gptStats = stats.find(s => s.model_used === 'gpt');
            const claudeStats = stats.find(s => s.model_used === 'claude');

            if (gptStats && claudeStats) {
                return `🤖 MODEL BATTLE REPORT

GPT-4: Won ${gptStats.fights_won}/${gptStats.fights_predicted} fights (${gptStats.win_rate}%)
Claude: Won ${claudeStats.fights_won}/${claudeStats.fights_predicted} fights (${claudeStats.win_rate}%)

🔒 Lock Picks (70%+ confidence hits):
GPT: ${gptStats.lock_wins}/${gptStats.total_locks} (${gptStats.lock_rate}%)
Claude: ${claudeStats.lock_wins}/${claudeStats.total_locks} (${claudeStats.lock_rate}%)

📊 ${gptStats.events_analyzed} events analyzed! Join us at https://fightgenie.ai #UFC`;
            }

            return "🤖 Fight Genie models analyzing fights! Stats coming soon.";
        } catch (error) {
            console.error('Error generating comparison tweet:', error);
            return "🤖 Models processing fight data! Check back soon.";
        }
    }

    async scrapeEventResults(eventLink) {
        try {
            if (!eventLink) return null;

            console.log(`Scraping results from: ${eventLink}`);
            const response = await axios.get(eventLink);
            const $ = cheerio.load(response.data);
            const results = [];

            $(".b-fight-details__table tbody tr").each((_, row) => {
                try {
                    const $row = $(row);
                    const $cells = $row.find('td');

                    // Get winner/loser from the fighter column
                    const fighters = $row.find(".b-link.b-link_style_black");

                    // Get method directly from the METHOD column
                    const methodCell = $cells.eq(7);  // METHOD is typically the 8th column
                    const methodText = methodCell.text().trim();

                    if (fighters.length >= 2) {
                        const winner = $(fighters[0]).text().trim();
                        const loser = $(fighters[1]).text().trim();

                        if (winner && loser && methodText) {
                            // Parse the complete method text
                            const method = methodText
                                .replace(/\s+/g, ' ')  // Normalize whitespace
                                .trim();

                            results.push({
                                winner,
                                loser,
                                method: method
                            });
                        }
                    }
                } catch (innerError) {
                    console.error("Error processing fight row:", innerError);
                }
            });

            console.log("Scraped results:", results);
            return results;
        } catch (error) {
            console.error("Error scraping event results:", error);
            return null;
        }
    }

    async generateTweet(data, type) {
        const tweetIdCounter = {};  // Track counters per thread
        
        // Helper to get thread size based on format
        const getThreadSize = (format) => {
            switch(format) {
                case 'fight_analysis': return 3;  // Always 3 tweets for fight analysis
                case 'value_pick': return 1;      // Single tweet for value picks
                case 'model_competition': return 2; // 2 tweets for model stats
                case 'promo': return 1;           // Single tweet for promos
                default: return 1;
            }
        };
    
        // Generate the tweet
        try {
            const completion = await this.openai.chat.completions.create({
                model: "chatgpt-4o-latest",
                messages: [
                    {
                        role: "system",
                        content: `You are Fight Genie, an AI-powered UFC fight prediction bot.
                            Create ${getThreadSize(type)} tweets for a thread.
                            Each tweet MUST be complete - never end mid-sentence.
                            Never mention that data is missing our incomplete, work with what you have.
                            Number tweets as 1/${getThreadSize(type)}, 2/${getThreadSize(type)}, etc.
                            Each tweet should have a clear focus:
                            - Fight Analysis: Stats → Style → Prediction
                            - Value Picks: Single comprehensive pick with stats
                            - Model Competition: Performance → Details
                            - Promos: Clear, complete promotional message
                            Include relevant emojis and hashtags.
                            Never use undefined values - if a stat is missing, omit it.
                            When referring to Claude, use Claude-3.5.
                            When referring to GPT-4, use GPT-4o.
                            Keep each tweet under 500 characters.`
                    },
                    {
                        role: "user",
                        content: await this.createPrompt(data, type)
                    }
                ],
                max_tokens: 1000,
                temperature: 0.7,
                presence_penalty: 0.6,  // Encourage variety
                frequency_penalty: 0.3   // Discourage repetition
            });
    
            // Add disclosure tag every 3rd tweet
            const tweet = completion.choices[0].message.content;
            return tweet + (this.tweetIdCounter++ % 3 === 0 ? "\n\n🤖 Tweet generated by GPT-4o" : "");
        } catch (error) {
            console.error('Error generating tweet:', error);
            return null;
        }
    }

    async showUpcomingTweets() {
        console.log('\n=== 📅 FIGHT GENIE TWEET SCHEDULE ===\n');
        
        try {
            // Get event info
            const event = await this.getUpcomingEvent();
            if (!event) {
                console.log('❌ No upcoming event found');
                return;
            }
     
            // Calculate dates & event info
            const now = new Date();
            const eventDate = new Date(event.Date);
            const daysUntilEvent = Math.ceil((eventDate - now) / (1000 * 60 * 60 * 24));
            const isFightWeek = daysUntilEvent <= 7;
            const nextWeek = new Date(now.getTime() + (7 * 24 * 60 * 60 * 1000));
     
            // Show event header
            console.log(`🎯 Next Event: ${event.Event}`);
            console.log(`📅 Event Date: ${eventDate.toLocaleString('en-US', {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
                year: 'numeric'
            })}`);
            console.log(`${isFightWeek ? '🔥 FIGHT WEEK!' : `⏳ ${daysUntilEvent} days until event`}`);
     
            // Show registered jobs
            const scheduledJobs = schedule.scheduledJobs;
            console.log('\n📋 Registered Jobs:');
            console.log(Object.keys(scheduledJobs).join(', '));
     
            // Show detailed job status
            console.log('\n⏰ Job Schedule Status:');
            Object.entries(scheduledJobs).forEach(([name, job]) => {
                const nextRun = job.nextInvocation();
                console.log(`\n${name}:`);
                console.log(`Next Run: ${nextRun?.toLocaleString() || 'Not scheduled'}`);
                console.log(`Pattern: ${job.cronPattern || 'No pattern'}`);
            });
     
            // Group tweets by day
            console.log('\n📅 Upcoming Week Schedule:');
            const tweetsByDay = new Map();
            
            Object.entries(scheduledJobs).forEach(([name, job]) => {
                const nextRun = job.nextInvocation();
                
                // Skip if no next run time
                if (!nextRun) {
                    console.log(`\nSkipping ${name}: No next run time scheduled`);
                    return;
                }
    
                // Convert the nextRun to a proper Date object if it isn't already
                const nextRunDate = new Date(nextRun);
                if (isNaN(nextRunDate.getTime())) {
                    console.log(`\nSkipping ${name}: Invalid date`);
                    return;
                }
                
                const nextRunTime = nextRunDate.getTime();
                const nowTime = now.getTime();
                const nextWeekTime = nextWeek.getTime();
                
                // Check if the run time is within our window
                if (nextRunTime >= nowTime && nextRunTime <= nextWeekTime) {
                    const dateKey = nextRunDate.toDateString();
                    if (!tweetsByDay.has(dateKey)) {
                        tweetsByDay.set(dateKey, []);
                    }
                    tweetsByDay.get(dateKey).push({
                        type: name,
                        time: nextRunDate
                    });
                    console.log(`\n✅ Scheduled: ${name}`);
                    console.log(`   Time: ${nextRunDate.toLocaleString()}`);
                }
            });
     
            // Display tweets by day
            if (tweetsByDay.size > 0) {
                Array.from(tweetsByDay.entries())
                    .sort(([dateA], [dateB]) => new Date(dateA) - new Date(dateB))
                    .forEach(([date, tweets]) => {
                        console.log(`\n📆 ${date}:`);
                        tweets
                            .sort((a, b) => a.time - b.time)
                            .forEach(tweet => {
                                console.log(`  ⏰ ${tweet.time.toLocaleTimeString()}`);
                                console.log(`  📝 ${tweet.type}`);
                                console.log('  ' + '━'.repeat(38));
                            });
                    });
            } else {
                console.log('\nNo tweets scheduled for the next week');
            }
     
            console.log('\nNext schedule check in 15 minutes...');
    
        } catch (error) {
            console.error('Error checking upcoming tweets:', error);
            console.error('Stack trace:', error.stack);
        }
    }

    async createPrompt(data, type) {
        const getRandomFormat = () => Math.floor(Math.random() * 5); // 0-4 format types
    
        switch (type) {
            case 'fight_analysis':
                const format = getRandomFormat();
                const baseStats = `
                    Fighter 1 (${data.fight.fighter1}):
                    - Strikes per min: ${data.fighter1Stats.SLPM}
                    - Striking accuracy: ${data.fighter1Stats.StrAcc}%
                    - Strike defense: ${data.fighter1Stats.StrDef}%
                    - Strikes absorbed per min: ${data.fighter1Stats.SLpM_avg}
                    - Takedowns per 15m: ${data.fighter1Stats.TDAvg}
                    - Takedown accuracy: ${data.fighter1Stats.TDAcc}%
                    - Takedown defense: ${data.fighter1Stats.TDDef}%
                    - Submission attempts per 15m: ${data.fighter1Stats.SubAvg}
                    - Height: ${data.fighter1Stats.Height}
                    - Reach: ${data.fighter1Stats.Reach}
                    - Stance: ${data.fighter1Stats.Stance}
                    - Win/Loss: ${data.fighter1Stats.Wins}-${data.fighter1Stats.Losses}
                    - Win methods: KO (${data.fighter1Stats.KO}), SUB (${data.fighter1Stats.SUB}), DEC (${data.fighter1Stats.DEC})
                    - Finish rate: ${data.fighter1Stats.FinishRate}%
                    - Average fight time: ${data.fighter1Stats.AvgFightTime}
                    - Career significant strikes: ${data.fighter1Stats.TotalStrikes}
                    - Career takedowns: ${data.fighter1Stats.TotalTD}
    
                    Fighter 2 (${data.fight.fighter2}):
                    - Strikes per min: ${data.fighter2Stats.SLPM}
                    - Striking accuracy: ${data.fighter2Stats.StrAcc}%
                    - Strike defense: ${data.fighter2Stats.StrDef}%
                    - Strikes absorbed per min: ${data.fighter2Stats.SLpM_avg}
                    - Takedowns per 15m: ${data.fighter2Stats.TDAvg}
                    - Takedown accuracy: ${data.fighter2Stats.TDAcc}%
                    - Takedown defense: ${data.fighter2Stats.TDDef}%
                    - Submission attempts per 15m: ${data.fighter2Stats.SubAvg}
                    - Height: ${data.fighter2Stats.Height}
                    - Reach: ${data.fighter2Stats.Reach}
                    - Stance: ${data.fighter2Stats.Stance}
                    - Win/Loss: ${data.fighter2Stats.Wins}-${data.fighter2Stats.Losses}
                    - Win methods: KO (${data.fighter2Stats.KO}), SUB (${data.fighter2Stats.SUB}), DEC (${data.fighter2Stats.DEC})
                    - Finish rate: ${data.fighter2Stats.FinishRate}%
                    - Average fight time: ${data.fighter2Stats.AvgFightTime}
                    - Career significant strikes: ${data.fighter2Stats.TotalStrikes}
                    - Career takedowns: ${data.fighter2Stats.TotalTD}`;
    
                const matchupAnalysis = `
                    Style Matchup Analysis:
                    - Stance dynamic: ${data.fighter1Stats.Stance} vs ${data.fighter2Stats.Stance}
                    - Height difference: ${Math.abs(parseFloat(data.fighter1Stats.Height) - parseFloat(data.fighter2Stats.Height))} inches
                    - Reach advantage: ${Math.abs(parseFloat(data.fighter1Stats.Reach) - parseFloat(data.fighter2Stats.Reach))} inches
                    - Combined finish rate: ${(parseFloat(data.fighter1Stats.FinishRate) + parseFloat(data.fighter2Stats.FinishRate))/2}%
                    - Striking differential: ${Math.abs(parseFloat(data.fighter1Stats.SLPM) - parseFloat(data.fighter2Stats.SLPM))} strikes/min
                    - Grappling differential: ${Math.abs(parseFloat(data.fighter1Stats.TDAvg) - parseFloat(data.fighter2Stats.TDAvg))} TD/15min
                    - Experience gap: ${Math.abs(parseInt(data.fighter1Stats.Wins) + parseInt(data.fighter1Stats.Losses) - parseInt(data.fighter2Stats.Wins) - parseInt(data.fighter2Stats.Losses))} fights
                    - Average fight time difference: ${Math.abs(parseFloat(data.fighter1Stats.AvgFightTime) - parseFloat(data.fighter2Stats.AvgFightTime))} minutes`;
    
                // Different format templates
                const formats = {
                    0: `Create a detailed 5-tweet breakdown of ${data.fight.fighter1} vs ${data.fight.fighter2} for ${data.event.Event}.
                        ${baseStats}
                        ${matchupAnalysis}
    
                        Tweet 1: Tale of the tape & career achievements
                        Tweet 2: Striking analysis & statistical edges
                        Tweet 3: Grappling comparison & ground game
                        Tweet 4: Style matchup & tactical breakdown
                        Tweet 5: Prediction with confidence explanation`,
    
                    1: `Create a technical 4-tweet analysis of ${data.fight.fighter1} vs ${data.fight.fighter2} for ${data.event.Event}.
                        ${baseStats}
                        ${matchupAnalysis}
    
                        Tweet 1: Complete statistical comparison
                        Tweet 2: Career patterns & tendencies
                        Tweet 3: Style matchup & key advantages
                        Tweet 4: AI prediction with detailed reasoning`,
    
                    2: `Create a narrative 3-tweet story about ${data.fight.fighter1} vs ${data.fight.fighter2} for ${data.event.Event}.
                        ${baseStats}
                        ${matchupAnalysis}
    
                        Tweet 1: Fighter journeys & career highlights
                        Tweet 2: Style clash & key battlegrounds
                        Tweet 3: Analytics-based prediction & method`,
    
                    3: `Create a deep-dive 6-tweet thread analyzing ${data.fight.fighter1} vs ${data.fight.fighter2} for ${data.event.Event}.
                        ${baseStats}
                        ${matchupAnalysis}
    
                        Tweet 1: Fighter backgrounds & experience
                        Tweet 2: Striking statistics & standup game
                        Tweet 3: Grappling metrics & ground skills
                        Tweet 4: Physical advantages & disadvantages
                        Tweet 5: Style matchup & strategic factors
                        Tweet 6: AI prediction with confidence breakdown`,
    
                    4: `Create a statistical 4-tweet analysis of ${data.fight.fighter1} vs ${data.fight.fighter2} for ${data.event.Event}.
                        ${baseStats}
                        ${matchupAnalysis}
    
                        Tweet 1: Career statistics & achievements
                        Tweet 2: Performance metrics comparison
                        Tweet 3: Win percentages & method breakdown
                        Tweet 4: Data-driven prediction & reasoning`
                };
    
                return formats[format] + `\n\nAI Analysis Factors:\n${data.fight.keyFactors.join('\n')}\nPredicted winner: ${data.fight.predictedWinner} (${data.fight.confidence}% confidence)\nMethod: ${data.fight.method}\nDetailed reasoning: ${data.fight.reasoning}\n\nInclude relevant emojis and #UFC #FightGenie hashtags.`;
    
            case 'value_pick':
                const valueFormat = getRandomFormat();
                const valueFormats = {
                    0: `Create a value pick breakdown for ${data.predictedWinner} (Statistical Focus)`,
                    1: `Create a high-confidence analysis for ${data.predictedWinner} (Career Trends Focus)`,
                    2: `Create a betting insight thread for ${data.predictedWinner} (Style Matchup Focus)`,
                    3: `Create a detailed pick analysis for ${data.predictedWinner} (Technical Focus)`,
                    4: `Create a prediction thread for ${data.predictedWinner} (Historical Focus)`
                };
    
                return `${valueFormats[valueFormat]}
    
                    Complete Fighter Stats:
                    - Strikes per min: ${data.fighterStats.SLPM}
                    - Striking accuracy: ${data.fighterStats.StrAcc}%
                    - Strike defense: ${data.fighterStats.StrDef}%
                    - Strikes absorbed: ${data.fighterStats.SLpM_avg}/min
                    - Takedowns per 15m: ${data.fighterStats.TDAvg}
                    - Takedown accuracy: ${data.fighterStats.TDAcc}%
                    - Takedown defense: ${data.fighterStats.TDDef}%
                    - Submission attempts: ${data.fighterStats.SubAvg}/15min
                    - Win/Loss: ${data.fighterStats.Wins}-${data.fighterStats.Losses}
                    - Finish rate: ${data.fighterStats.FinishRate}%
                    - Average fight time: ${data.fighterStats.AvgFightTime}
                    - Win methods: KO (${data.fighterStats.KO}), SUB (${data.fighterStats.SUB}), DEC (${data.fighterStats.DEC})
                    
                    Prediction Details:
                    - Confidence: ${data.confidence}%
                    - Predicted method: ${data.method}
                    - Key edges: ${data.keyAdvantages || 'To be analyzed'}
                    - Statistical advantages: ${data.statEdges || 'To be analyzed'}
                    
                    Create a thread that emphasizes technical analysis and statistical evidence.
                    Include https://fightgenie.ai and relevant hashtags.`;
    
                    case 'model_competition':
                        return `Create 3 focused tweets comparing GPT-4 and Claude's performance:
                    
                            Stats to work with:
                            GPT-4:
                            - Win rate: ${data.gpt.win_rate}%
                            - Total predictions: ${data.gpt.fights_predicted}
                            - Lock rate (70%+ confidence hits): ${data.gpt.lock_rate}% (${data.gpt.lock_wins}/${data.gpt.total_locks})
                            - Events analyzed: ${data.gpt.events_analyzed}
                    
                            Claude:
                            - Win rate: ${data.claude.win_rate}%
                            - Total predictions: ${data.claude.fights_predicted}
                            - Lock rate (70%+ confidence hits): ${data.claude.lock_rate}% (${data.claude.lock_wins}/${data.claude.total_locks})
                            - Events analyzed: ${data.claude.events_analyzed}
                    
                            Tweet 1: Focus only on win rates head-to-head comparison
                            Tweet 2: Focus only on lock rates (high confidence picks at 70%+)
                            Tweet 3: Overall statistical summary of both metrics together
                    
                            Keep tone engaging but factual. Include total fights/events analyzed.
                            Use emojis 🤖🎯📊 etc.
                            Include #UFC #FightGenie hashtags.
                            Do not mention prediction methods or types.`;

            case 'promo':
                const promoFormat = getRandomFormat();
                const promoFormats = {
                    0: "Create a feature-focused promotional thread",
                    1: "Create a statistical proof promotional thread",
                    2: "Create a user-benefit focused promotional thread",
                    3: "Create a technical capability promotional thread",
                    4: "Create an event-specific promotional thread"
                };
    
                return `${promoFormats[promoFormat]}
                    Key Features:
                    - Dual AI system (GPT-4 & Claude)
                    - High Lock Rate (70%+ success)
                    - Fun social experiment: Claude vs GPT
                    - Access to historical predictions
                    - Custom fight analysis
                    - Detailed statistical and style breakdowns
                    - Method predictions
                    - Value picks
                    - Performance tracking
    
                    Event: ${data.event.Event}
                    Website: https://fightgenie.ai
                    Discord bot available (link in bio)
    
                    Create an engaging promotional thread that emphasizes technical excellence and analytical capabilities.
                    Include relevant hashtags #UFC #AI #FightPicks`;
    
            default:
                return `Create an engaging thread about Fight Genie's AI predictions.
                        Mention we have Claude-3.5 and GPT-4o models predicting current UFC event, and we do this all within your Discord server if you invite our bot today, performance tracking, and website https://fightgenie.ai`;
        }
    }

    async postFightAnalysisTweet() {
        try {
            // Get upcoming event and featured fight analysis
            const event = await this.getUpcomingEvent();
            if (!event) {
                console.log('No current event found');
                return;
            }
    
            const analysis = await this.getFeaturedFightAnalysis();
            if (!analysis) {
                console.log('No fight analysis available');
                return;
            }
    
            console.log(`Posting analysis for ${analysis.fight.fighter1} vs ${analysis.fight.fighter2}`);
    
            // Post initial tweet
            const firstTweet = await this.twitter.v2.tweet(
                `1/3 🥊 Fight Analysis Alert 🥊: ${analysis.fight.fighter1} vs ${analysis.fight.fighter2} at #UFC310. ` +
                `${analysis.fight.fighter1} lands an impressive ${analysis.fighter1Stats.SLPM} strikes/min compared to ${analysis.fight.fighter2}'s ` +
                `${analysis.fighter2Stats.SLPM}. Stay tuned for our prediction. #FightGenie #UFC`
            );
    
            // Wait between tweets
            await new Promise(resolve => setTimeout(resolve, 2000));
    
            // Post second tweet as reply
            const secondTweet = await this.twitter.v2.reply(
                `2/3 ${analysis.fight.keyFactors?.[0] || 'Analysis in progress...'}. ` +
                `Our AI model predicts ${analysis.fight.predictedWinner} to win with ${analysis.fight.confidence}% confidence. ` +
                `#FightGenie #UFC310`,
                firstTweet.data.id
            );
    
            // Wait between tweets
            await new Promise(resolve => setTimeout(resolve, 2000));
    
            // Post third tweet as reply
            await this.twitter.v2.reply(
                `3/3 ${analysis.fight.predictedWinner} dominates the stats: ` +
                `${analysis.fight.reasoning} ` +
                `#FightGenie #UFC`,
                secondTweet.data.id
            );
    
            console.log('Analysis thread posted successfully');
    
        } catch (error) {
            console.error('Error posting fight analysis thread:', error);
            if (error.data) {
                console.error('Twitter API Error:', error.data);
            }
        }
    }

    async postValuePickTweet() {
        const valuePicks = await this.getValuePicks();
        if (valuePicks?.[0]) {
            const tweet = await this.generateTweet(valuePicks[0], 'value_pick');

            if (this.testMode) {
                await this.logTweet('VALUE PICK', tweet);
            } else {
                await this.twitter.v2.tweet(tweet);
            }

            console.log('Value pick ' + (this.testMode ? 'logged' : 'posted') + ':', tweet);
        }
    }

    async postModelComparisonTweet() {
        const stats = await this.getModelStats();
        if (stats?.length >= 2) {
            const gptStats = stats.find(s => s.model_used === 'gpt');
            const claudeStats = stats.find(s => s.model_used === 'claude');

            const tweet = await this.generateTweet({
                gpt: gptStats,
                claude: claudeStats
            }, 'model_competition');

            if (this.testMode) {
                await this.logTweet('MODEL COMPARISON', tweet);
            } else {
                await this.twitter.v2.tweet(tweet);
            }

            console.log('Model comparison ' + (this.testMode ? 'logged' : 'posted') + ':', tweet);
        }
    }

    async getMethodStats() {
        try {
            // Get detailed method breakdown
            const methodStats = await database.query(`
                SELECT 
                    sp.model_used,
                    json_extract(po.fight_outcomes, '$.method') as predicted_method,
                    json_extract(po.fight_outcomes, '$.actualMethod') as actual_method,
                    COUNT(*) as prediction_count,
                    COUNT(CASE WHEN json_extract(po.fight_outcomes, '$.methodCorrect') = 1 THEN 1 END) as correct_count
                FROM stored_predictions sp
                JOIN prediction_outcomes po ON sp.prediction_id = po.prediction_id
                GROUP BY sp.model_used, predicted_method
                ORDER BY prediction_count DESC
            `);

            // Calculate method accuracy by type
            const methodBreakdown = {};
            methodStats.forEach(stat => {
                if (!methodBreakdown[stat.model_used]) {
                    methodBreakdown[stat.model_used] = {
                        ko_tko: { total: 0, correct: 0 },
                        submission: { total: 0, correct: 0 },
                        decision: { total: 0, correct: 0 }
                    };
                }

                const method = stat.predicted_method?.toLowerCase() || '';
                if (method.includes('ko') || method.includes('tko')) {
                    methodBreakdown[stat.model_used].ko_tko.total += stat.prediction_count;
                    methodBreakdown[stat.model_used].ko_tko.correct += stat.correct_count;
                } else if (method.includes('sub')) {
                    methodBreakdown[stat.model_used].submission.total += stat.prediction_count;
                    methodBreakdown[stat.model_used].submission.correct += stat.correct_count;
                } else if (method.includes('dec')) {
                    methodBreakdown[stat.model_used].decision.total += stat.prediction_count;
                    methodBreakdown[stat.model_used].decision.correct += stat.correct_count;
                }
            });

            return methodBreakdown;
        } catch (error) {
            console.error('Error getting method stats:', error);
            return null;
        }
    }

    async scheduleEventPromoTweets(event) {
        try {
            const promoCodes = await database.query(`
                SELECT code 
                FROM promo_codes 
                WHERE current_uses = 0 
                LIMIT 3
            `);

            if (!promoCodes?.length) {
                console.log('❌ No available promo codes. Generate more using $createnewcodes');
                await this.logTweet('PROMO CODES', 'No available promo codes found');
                return;
            }

            const currentEvent = await this.getUpcomingEvent();
            if (!currentEvent) {
                console.log('❌ No upcoming event found');
                return;
            }

            const eventDate = new Date(currentEvent.Date);
            const expirationDate = new Date(eventDate);
            expirationDate.setDate(expirationDate.getDate() + 1);
            expirationDate.setHours(1, 30, 0, 0);

            const startHour = 12; // Start at noon
            const endHour = 22;   // End at 10 PM

            for (let i = 0; i < Math.min(promoCodes.length, 3); i++) {
                const hour = Math.floor(Math.random() * (endHour - startHour)) + startHour;
                const minute = Math.floor(Math.random() * 60);
                const tweetTime = new Date(eventDate);
                tweetTime.setHours(hour, minute);

                const promoTweet = `🎯 Fight Genie ${currentEvent.Event} Free Access Code Alert!
    
    ${promoCodes[i].code}
    
    To redeem:
    1. Add our bot to your server (link in bio)
    2. Type $promo "${promoCodes[i].code}"
    3. Follow @FightGenie & @ us something nice 🤝.
    
    • First Come, First Served. One use per code. One code per Discord server. 
    • Valid for ${currentEvent.Event} only
    • Expires at event completion
    • AI predictions by GPT-4o & Claude-3.5
    
    https://fightgenie.ai #UFC #FightGenie`;

                const j = schedule.scheduleJob(tweetTime, async () => {
                    console.log(`Executing promo code tweet for code: ${promoCodes[i].code}`);

                    if (this.testMode) {
                        await this.logTweet('PROMO CODE', promoTweet);
                    } else {
                        await this.twitter.v2.tweet(promoTweet);
                        await database.query(`
                            UPDATE promo_codes 
                            SET current_uses = 1 
                            WHERE code = ?
                        `, [promoCodes[i].code]);
                    }
                });

                console.log(`Scheduled promo code tweet for ${tweetTime.toLocaleString()}`);
            }

        } catch (error) {
            console.error('Error scheduling promo code tweets:', error);
        }
    }


    async getFightPredictionStats() {
        try {
            // Get fight prediction details
            const predictionStats = await database.query(`
                SELECT 
                    sp.model_used,
                    COUNT(DISTINCT sp.event_id) as events_analyzed,
                    COUNT(*) as total_predictions,
                    AVG(CASE WHEN json_extract(po.fight_outcomes, '$.correct') = 1 THEN 1 ELSE 0 END) * 100 as accuracy,
                    AVG(po.confidence_accuracy) as avg_confidence,
                    COUNT(CASE WHEN sp.card_type = 'main' THEN 1 END) as main_card_predictions,
                    COUNT(CASE WHEN sp.card_type = 'prelims' THEN 1 END) as prelim_predictions
                FROM stored_predictions sp
                JOIN prediction_outcomes po ON sp.prediction_id = po.prediction_id
                GROUP BY sp.model_used
            `);

            return predictionStats;
        } catch (error) {
            console.error('Error getting fight prediction stats:', error);
            return null;
        }
    }

    async postModelStatsTweets() {
        try {
            // Get all stats
            const [baseStats, methodStats, predictionStats] = await Promise.all([
                this.getModelStats(),
                this.getMethodStats(),
                this.getFightPredictionStats()
            ]);

            if (!baseStats?.length) return;

            // Generate multiple tweets about different aspects
            const tweets = [];

            // Overall performance tweet
            const overallTweet = `🤖 Fight Genie Performance Update:
    GPT-4 (${baseStats.find(s => s.model_used === 'gpt')?.win_rate}% accurate) vs
    Claude (${baseStats.find(s => s.model_used === 'claude')?.win_rate}% accurate)
    ${predictionStats[0].events_analyzed} events analyzed! #UFC #AI`;
            tweets.push(overallTweet);

            // Method breakdown tweet
            if (methodStats) {
                const gptMethods = methodStats['gpt'];
                const methodTweet = `📊 Method Prediction Accuracy:
    KO/TKO: GPT-4 ${(gptMethods.ko_tko.correct / gptMethods.ko_tko.total * 100).toFixed(1)}%
    Submissions: ${(gptMethods.submission.correct / gptMethods.submission.total * 100).toFixed(1)}%
    Decisions: ${(gptMethods.decision.correct / gptMethods.decision.total * 100).toFixed(1)}%
    🎯 Most accurate at predicting ${this.getMostAccurateMethod(gptMethods)}! #UFCStats`;
                tweets.push(methodTweet);
            }

            // Detailed prediction analysis
            if (predictionStats?.length) {
                const gptStats = predictionStats.find(s => s.model_used === 'gpt');
                const predictionTweet = `💫 Fight Prediction Insights:
    ${gptStats.total_predictions} fights analyzed
    Main Card: ${((gptStats.main_card_predictions / gptStats.total_predictions) * 100).toFixed(1)}% accurate
    Prelims: ${((gptStats.prelim_predictions / gptStats.total_predictions) * 100).toFixed(1)}% accurate
    Average Confidence: ${gptStats.avg_confidence.toFixed(1)}% #UFCPredictions`;
                tweets.push(predictionTweet);
            }

            // Post tweets
            if (this.testMode) {
                await this.logTweet('MODEL STATS THREAD', tweets.join('\n\n'));
            } else {
                let lastTweetId;
                for (const tweet of tweets) {
                    const response = lastTweetId ?
                        await this.twitter.v2.reply(tweet, lastTweetId) :
                        await this.twitter.v2.tweet(tweet);
                    lastTweetId = response.data.id;
                }
            }

        } catch (error) {
            console.error('Error posting model stats tweets:', error);
        }
    }

    getMostAccurateMethod(methodStats) {
        const accuracies = {
            'KO/TKO': methodStats.ko_tko.correct / methodStats.ko_tko.total,
            'submissions': methodStats.submission.correct / methodStats.submission.total,
            'decisions': methodStats.decision.correct / methodStats.decision.total
        };

        return Object.entries(accuracies)
            .sort(([, a], [, b]) => b - a)[0][0];
    }

    async scheduleTweets() {
        const schedule = require('node-schedule');
    
        // Helper function to check if tweet was already sent today
        async function checkTweetSent(type, eventId = null) {
            const query = eventId 
                ? `SELECT * FROM tweet_logs 
                   WHERE tweet_type = ? 
                   AND event_id = ?
                   AND date(created_at) = date('now')`
                : `SELECT * FROM tweet_logs 
                   WHERE tweet_type = ? 
                   AND date(created_at) = date('now')`;
    
            const params = eventId ? [type, eventId] : [type];
            const result = await database.query(query, params);
            return result?.length > 0;
        }
    
        // Helper function to log tweet
        async function logTweet(type, eventId = null, content = null) {
            await database.query(`
                INSERT INTO tweet_logs (event_id, tweet_type, content, created_at)
                VALUES (?, ?, ?, datetime('now'))
            `, [eventId, type, content]);
        }
    
        // Fight Week Analysis - Check daily at 9 AM during weekdays
        schedule.scheduleJob('weekday-analysis', '0 9 * * 1-5', async () => {
            try {
                const event = await this.getUpcomingEvent();
                if (!event) return;
    
                const eventDate = new Date(event.Date);
                const today = new Date();
                const daysUntilEvent = Math.ceil((eventDate - today) / (1000 * 60 * 60 * 24));
    
                const mainTweeted = await database.query(`
                    SELECT * FROM tweet_logs 
                    WHERE event_id = ? 
                    AND tweet_type = 'main_analysis'
                    AND created_at > datetime('now', '-7 days')
                `, [event.event_id]);
    
                const prelimTweeted = await database.query(`
                    SELECT * FROM tweet_logs 
                    WHERE event_id = ? 
                    AND tweet_type = 'prelim_analysis'
                    AND created_at > datetime('now', '-7 days')
                `, [event.event_id]);
    
                if (daysUntilEvent <= 7) {
                    if (!mainTweeted?.length && Math.random() < 0.5) {
                        const hour = Math.floor(Math.random() * 12) + 9;
                        const minute = Math.floor(Math.random() * 60);
    
                        console.log(`Scheduling main card analysis for ${hour}:${minute}`);
                        schedule.scheduleJob('main-card-analysis', `${minute} ${hour} * * *`, async () => {
                            try {
                                const analysis = await this.getFeaturedFightAnalysis('main');
                                if (analysis) {
                                    await this.postFightAnalysisTweet();
                                    await logTweet('main_analysis', event.event_id);
                                }
                            } catch (error) {
                                console.error('Error executing main card analysis:', error);
                            }
                        });
                    }
    
                    if (!prelimTweeted?.length && Math.random() < 0.5) {
                        const hour = Math.floor(Math.random() * 12) + 9;
                        const minute = Math.floor(Math.random() * 60);
    
                        console.log(`Scheduling prelim analysis for ${hour}:${minute}`);
                        schedule.scheduleJob('prelim-analysis', `${minute} ${hour} * * *`, async () => {
                            try {
                                const analysis = await this.getFeaturedFightAnalysis('prelims');
                                if (analysis) {
                                    await this.postFightAnalysisTweet();
                                    await logTweet('prelim_analysis', event.event_id);
                                }
                            } catch (error) {
                                console.error('Error executing prelim analysis:', error);
                            }
                        });
                    }
                }
            } catch (error) {
                console.error('Error scheduling fight analysis:', error);
            }
        });
    
        // Sunday: Model Competition Day
        schedule.scheduleJob('sunday-model-competition', '0 14 * * 0', async () => {
            try {
                if (!(await checkTweetSent('model_competition'))) {
                    console.log('Executing Sunday model competition tweets');
                    await this.postModelComparisonTweet();
                    await logTweet('model_competition');
                }
            } catch (error) {
                console.error('Error posting model competition:', error);
            }
        });
    
        // Monday Schedule
        schedule.scheduleJob('monday-schedule', '0 12 * * 1', async () => {
            try {
                if (!(await checkTweetSent('weekly_schedule'))) {
                    console.log('Executing Monday schedule announcement');
                    const scheduleTweet = `📅 This Week at Fight Genie:
            
                        Mon (12pm): Weekly Schedule
                        Mon-Fri: Random Fight Analysis
                        Thu (3pm): Value Picks
                        Sat (3pm): Full Card Breakdown
                        Sun (2pm): Model Battle Report
                        
                        All predictions by GPT-4 & Claude
                        Find us on Discord (link in bio)
                        🔮 https://fightgenie.ai`;
    
                    if (!this.testMode) {
                        await this.twitter.v2.tweet(scheduleTweet);
                    }
                    await logTweet('weekly_schedule', null, scheduleTweet);
                }
            } catch (error) {
                console.error('Error posting schedule:', error);
            }
        });
    
        // Thursday: Value Picks
        schedule.scheduleJob('thursday-value-picks', '0 15 * * 4', async () => {
            try {
                if (!(await checkTweetSent('value_picks'))) {
                    console.log('Executing Thursday value pick tweets');
                    const event = await this.getUpcomingEvent();
                    if (event) {
                        await this.postValuePickTweet();
                        await logTweet('value_picks', event.event_id);
                    }
                }
            } catch (error) {
                console.error('Error posting value picks:', error);
            }
        });
    
        // Saturday: Comprehensive Update
        schedule.scheduleJob('saturday-update', '0 15 * * 6', async () => {
            try {
                if (!(await checkTweetSent('saturday_update'))) {
                    console.log('Executing Saturday comprehensive update');
                    const event = await this.getUpcomingEvent();
                    if (event) {
                        await this.postFightAnalysisTweet();
                        await logTweet('saturday_analysis', event.event_id);
                        
                        await new Promise(resolve => setTimeout(resolve, 3600000));
                        await this.postValuePickTweet();
                        await logTweet('saturday_picks', event.event_id);
    
                        if (new Date(event.Date).toDateString() === new Date().toDateString()) {
                            await new Promise(resolve => setTimeout(resolve, 3600000));
                            const promoTweet = await this.generateTweet({ event }, 'promo');
                            if (!this.testMode) {
                                await this.twitter.v2.tweet(promoTweet);
                            }
                            await logTweet('saturday_promo', event.event_id, promoTweet);
                        }
                    }
                }
            } catch (error) {
                console.error('Error posting Saturday update:', error);
            }
        });
    
        // Special Event Day Schedule
        schedule.scheduleJob('event-day-schedule', '0 12,16,20 * * *', async () => {
            try {
                const event = await this.getUpcomingEvent();
                if (event && new Date(event.Date).toDateString() === new Date().toDateString()) {
                    const hour = new Date().getHours();
                    const tweetType = `event_day_${hour}`;
    
                    if (!(await checkTweetSent(tweetType, event.event_id))) {
                        if (hour === 12) {
                            const promoTweet = await this.generateTweet({ event }, 'promo');
                            if (!this.testMode) {
                                await this.twitter.v2.tweet(promoTweet);
                            }
                            await logTweet(tweetType, event.event_id, promoTweet);
                            
                            await new Promise(resolve => setTimeout(resolve, 1800000));
                            await this.postFightAnalysisTweet();
                            await logTweet(`${tweetType}_analysis`, event.event_id);
                        } else if (hour === 16) {
                            await this.postValuePickTweet();
                            await logTweet(tweetType, event.event_id);
                        } else if (hour === 20) {
                            await this.postModelComparisonTweet();
                            await logTweet(`${tweetType}_model`, event.event_id);
                            
                            await new Promise(resolve => setTimeout(resolve, 1800000));
                            const finalPromo = await this.generateTweet({ event }, 'promo');
                            if (!this.testMode) {
                                await this.twitter.v2.tweet(finalPromo);
                            }
                            await logTweet(`${tweetType}_final`, event.event_id, finalPromo);
                        }
                    }
                }
            } catch (error) {
                console.error('Error handling event day schedule:', error);
            }
        });
    
        // Recovery check on startup
        try {
            const event = await this.getUpcomingEvent();
            if (event) {
                const today = new Date();
                const hour = today.getHours();
                const dayOfWeek = today.getDay();
    
                // Check for missed tweets based on current time
                if (dayOfWeek === 0 && hour >= 14) {
                    if (!(await checkTweetSent('model_competition'))) {
                        console.log('Recovering missed Sunday model competition');
                        await this.postModelComparisonTweet();
                        await logTweet('model_competition');
                    }
                }
    
                if (dayOfWeek === 1 && hour >= 12) {
                    if (!(await checkTweetSent('weekly_schedule'))) {
                        console.log('Recovering missed Monday schedule');
                        // Post schedule tweet recovery...
                    }
                }
    
                if (dayOfWeek === 4 && hour >= 15) {
                    if (!(await checkTweetSent('value_picks'))) {
                        console.log('Recovering missed Thursday value picks');
                        await this.postValuePickTweet();
                        await logTweet('value_picks', event.event_id);
                    }
                }
    
                // Check event day missed tweets
                if (new Date(event.Date).toDateString() === today.toDateString()) {
                    for (const scheduleHour of [12, 16, 20]) {
                        if (hour >= scheduleHour) {
                            const tweetType = `event_day_${scheduleHour}`;
                            if (!(await checkTweetSent(tweetType, event.event_id))) {
                                console.log(`Recovering missed ${tweetType}`);
                                // Execute corresponding event day logic...
                            }
                        }
                    }
                }
            }
        } catch (error) {
            console.error('Error running recovery check:', error);
        }
    
        console.log(`Tweet automation scheduled. Test mode: ${this.testMode ? 'ON' : 'OFF'}`);
    }        
}

module.exports = TweetAutomation;