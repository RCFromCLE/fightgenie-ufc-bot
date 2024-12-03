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

            // UFC History - using AI generation
            console.log('📅 Generating UFC History...');
            if (upcomingEvent) {
                const historyPrompt = {
                    role: "system",
                    content: `You are an expert UFC historian. Create an interesting historical UFC fact that:
                    1. Is verifiably true and significant
                    2. Would be fascinating to both casual and hardcore MMA fans
                    3. Has some thematic or narrative connection to ${upcomingEvent.Event}
                    4. Involves either:
                       - A similar matchup/situation
                       - The same weight class
                       - The same venue
                       - A similar stakes/title situation
                       - Or a relevant record/milestone
                    5. Would make fans more excited for the upcoming event
                    
                    Focus on dramatic moments, significant records, or compelling narratives. Make all tweets formatted very professionally.
                    Include specific details like dates and numbers where relevant. Do not be too wordy or whimsical. Sound human and professional.`
                };

                const historyCompletion = await this.openai.chat.completions.create({
                    model: "chatgpt-4o-latest",
                    messages: [historyPrompt],
                    temperature: 0.9
                });

                const historicalFact = {
                    fact: historyCompletion.choices[0].message.content,
                    generated: true
                };

                const historyTweet = await this.generateTweet({
                    historical: historicalFact,
                    event: upcomingEvent
                }, 'ufc_history');
                output += '📅 UFC HISTORY:\n' + historyTweet + '\n\n';
            } else {
                output += '❌ No upcoming event available\n\n';
            }

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
                        const promoTweet = `🎯 Fight Genie ${upcomingEvent.Event} - FREE ACCESS CODE
    
    ${promoCodes[i].code}
    
    To redeem:

    1. Add our bot to your Discord server (link in bio)
    2. Type $promo "${promoCodes[i].code}"
    3. Follow @FightGenie & tweet us 🤝
    
    • Valid for ${upcomingEvent.Event} only
    • Expires at event completion
    • AI predictions by GPT-4o & Claude-3.5
    • First come, first served! 🎉
    • 1 code per Discord server 
    
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
    
            // Get only the highest confidence pick
            const highConfidencePicks = await Promise.all(
                fights
                    .filter(fight => fight.confidence >= 70)
                    .map(async fight => {
                        const fighterStats = await database.query(
                            'SELECT * FROM fighters WHERE Name = ?',
                            [fight.predictedWinner]
                        );
                        return {
                            ...fight,
                            fighterStats: fighterStats[0],
                            model: predictions[0].model_used
                        };
                    })
            );
    
            // Sort by confidence and return only the highest one
            return highConfidencePicks
                .sort((a, b) => b.confidence - a.confidence)
                .slice(0, 1);
        } catch (error) {
            console.error('Error getting value pick:', error);
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
                `🤖 Fight Genie Model Showdown!\n\nGPT-4o: ${gptStats.win_rate}% accurate\nClaude-3.5: ${claudeStats.win_rate}% accurate\n\nBoth models analyzed ${gptStats.events_analyzed} events & ${gptStats.fights_predicted} fights! All results tracked publicly. #UFC #AIpredictions`,

                `📊 Method Prediction Accuracy:\n\nGPT-4o: ${gptStats.method_accuracy}%\nClaude-3.5: ${claudeStats.method_accuracy}%\n\nBased on ${gptStats.fights_predicted} verified fight outcomes! Which AI predicts finishes better? #UFCstats`,

                `💫 AI Confidence vs Reality:\n\nGPT-4o confidence: ${gptStats.avg_confidence}%\nClaude-3.5 confidence: ${claudeStats.avg_confidence}%\n\nTracking ${gptStats.events_analyzed} events of predictions! #FightGenie #UFC`
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

GPT-4o: Won ${gptStats.fights_won}/${gptStats.fights_predicted} fights (${gptStats.win_rate}%)
Claude-3.5: Won ${claudeStats.fights_won}/${claudeStats.fights_predicted} fights (${claudeStats.win_rate}%)

🔒 Lock Picks (70%+ confidence hits):
GPT-4o: ${gptStats.lock_wins}/${gptStats.total_locks} (${gptStats.lock_rate}%)
Claude-3.5: ${claudeStats.lock_wins}/${claudeStats.total_locks} (${claudeStats.lock_rate}%)

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
        try {
            const completion = await this.openai.chat.completions.create({
                model: "chatgpt-4o-latest",
                messages: [{
                    role: "system",
                    content: `You are Fight Genie, an AI-powered UFC fight prediction bot that is a Discord bot.
                        Never start tweets with numbers like "1/" or "1/1" or any variation.
                        Begin tweets naturally with the content itself.
                        Each tweet should be complete and self-contained.
                        Include relevant emojis and hashtags.
                        Keep a single tweet under 450 characters, air on the side of brevity, use bullets and emojis, and make things easily understandable.
                        When referring to Claude, use Claude-3.5.
                        When referring to GPT-4, use GPT-4o.
                        Never use artificial separators or tweet numbering.
                        Do not be overly wordy or verbose, try to sound like a human.
                        Be engaging and informative for MMA fans age 18-45.`
                },
                {
                    role: "user",
                    content: await this.createPrompt(data, type)
                }],
                max_tokens: 1500,
                temperature: 0.7,
                presence_penalty: 0.6,
                frequency_penalty: 0.3
            });
    
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
                    - Combined finish rate: ${(parseFloat(data.fighter1Stats.FinishRate) + parseFloat(data.fighter2Stats.FinishRate)) / 2}%
                    - Striking differential: ${Math.abs(parseFloat(data.fighter1Stats.SLPM) - parseFloat(data.fighter2Stats.SLPM))} strikes/min
                    - Grappling differential: ${Math.abs(parseFloat(data.fighter1Stats.TDAvg) - parseFloat(data.fighter2Stats.TDAvg))} TD/15min
                    - Experience gap: ${Math.abs(parseInt(data.fighter1Stats.Wins) + parseInt(data.fighter1Stats.Losses) - parseInt(data.fighter2Stats.Wins) - parseInt(data.fighter2Stats.Losses))} fights
                    - Average fight time difference: ${Math.abs(parseFloat(data.fighter1Stats.AvgFightTime) - parseFloat(data.fighter2Stats.AvgFightTime))} minutes`;

                // Different format templates
                const formats = {
                    0: `Create a detailed tweet thread (1 tweet, thread for each item mentioned) breakdown of ${data.fight.fighter1} vs ${data.fight.fighter2} for ${data.event.Event}.
                        ${baseStats}
                        ${matchupAnalysis}
    
                        Tale of the tape & career achievements
                        Striking analysis & statistical edges
                        Grappling comparison & ground game
                        Style matchup & tactical breakdown
                        Prediction with confidence explanation`,

                    1: `Create a technical 3-tweet analysis of ${data.fight.fighter1} vs ${data.fight.fighter2} for ${data.event.Event}.
                        ${baseStats}
                        ${matchupAnalysis}
    
                        Complete statistical comparison
                        Career patterns & tendencies
                        Style matchup & key advantages
                        AI prediction with detailed reasoning`,

                    2: `Create a narrative 3-tweet story about ${data.fight.fighter1} vs ${data.fight.fighter2} for ${data.event.Event}.
                        ${baseStats}
                        ${matchupAnalysis}
    
                        Fighter journeys & career highlights
                        Style clash & key battlegrounds
                        Analytics-based prediction & method`,

                    3: `Create a deep-dive 3-tweet thread analyzing ${data.fight.fighter1} vs ${data.fight.fighter2} for ${data.event.Event}.
                        ${baseStats}
                        ${matchupAnalysis}
    
                        Fighter backgrounds & experience
                        Striking statistics & standup game
                        Grappling metrics & ground skills
                        Physical advantages & disadvantages
                        Style matchup & strategic factors
                        AI prediction with confidence breakdown`,

                    4: `Create a statistical 4-tweet analysis of ${data.fight.fighter1} vs ${data.fight.fighter2} for ${data.event.Event}.
                        ${baseStats}
                        ${matchupAnalysis}
    
                        Career statistics & achievements
                        Performance metrics comparison
                        Win percentages & method breakdown
                        Data-driven prediction & reasoning`
                };

                return formats[format] + `\n\nAI Analysis Factors:\n${data.fight.keyFactors.join('\n')}\nPredicted winner: ${data.fight.predictedWinner} (${data.fight.confidence}% confidence)\nMethod: ${data.fight.method}\nDetailed reasoning: ${data.fight.reasoning}\n\nInclude relevant emojis and #UFC #FightGenie hashtags.`;

            case 'value_pick':
                const valueFormat = getRandomFormat();
                const valueFormats = {
                    0: `Create a brief value pick breakdown for ${data.predictedWinner} (Statistical Focus), be sure to show the pick in an easily identifiable way.`,
                    1: `Create a brief high-confidence analysis for ${data.predictedWinner} (Career Trends Focus), be sure to show the pick in an easily identifiable way.`,
                    2: `Create a brief betting insight thread for ${data.predictedWinner} (Style Matchup Focus), be sure to show the pick in an easily identifiable way.`,
                    3: `Create a brief pick analysis for ${data.predictedWinner} (Technical Focus), be sure to show the pick in an easily identifiable way and include a prediction.`,
                    4: `Create a brief prediction thread for ${data.predictedWinner} (Historical Focus), be sure to show the pick in an easily identifiable way and include a prediction.`
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
                    Be brief but informative.
                    Include https://fightgenie.ai and relevant hashtags.`;

            case 'model_competition':
                return `Create 3 focused tweets comparing GPT-4 and Claude's performance:
                    
                            Stats to work with:
                            GPT-4o:
                            - Win rate: ${data.gpt.win_rate}%
                            - Total predictions: ${data.gpt.fights_predicted}
                            - Lock rate (70%+ confidence hits): ${data.gpt.lock_rate}% (${data.gpt.lock_wins}/${data.gpt.total_locks})
                            - Events analyzed: ${data.gpt.events_analyzed}
                    
                            Claude-3.5:
                            - Win rate: ${data.claude.win_rate}%
                            - Total predictions: ${data.claude.fights_predicted}
                            - Lock rate (70%+ confidence hits): ${data.claude.lock_rate}% (${data.claude.lock_wins}/${data.claude.total_locks})
                            - Events analyzed: ${data.claude.events_analyzed}
                    
                            Focus only on win rates head-to-head comparison
                            Focus only on lock rates (high confidence picks at 70%+)
                            Overall statistical summary of both metrics together
                    
                            Keep tone engaging but factual while maintaining brevity. Include total fights/events analyzed.
                            Use emojis 🤖🎯📊 etc.
                            Include #UFC #FightGenie hashtags.
                            Do not mention prediction methods or types.`;


            case 'ufc_history':
                const historyFormat = getRandomFormat();
                const historyFormats = {
                    0: "Create an epic storytelling tweet connecting UFC history to today",
                    1: "Create a 'path to greatness' style tweet linking past to present",
                    2: "Create a 'records and milestones' focused historical parallel",
                    3: "Create a 'full circle' narrative connecting past champions to current challengers",
                    4: "Create a 'defining moments' tweet linking historical significance to upcoming potential"
                };

                return `${historyFormats[historyFormat]}
                    
                                    Historical Context:
                                    ${data.historical.fact}
                                    
                                    Upcoming Event:
                                    Event: ${data.event.Event}
                                    Date: ${new Date(data.event.Date).toLocaleDateString()}
                                    
                                    You are Fight Genie, an AI Powered Discord bot who's sole purpose is to pick UFC fights and share interesting facts from the UFC history on Twitter/X. 
                                    
                                    Create a tweet that:

                                    1. Connects this historical moment to the upcoming fights
                                    2. Builds anticipation for potential new history
                                    3. Appeals to both casual and hardcore fans
                                    4. Uses vivid fight imagery and stats, but don't be too corny
                                    5. Encourages interaction with our bot
                                    
                                    Tweet must:
                                    • Include event hashtag and #FightGenie
                                    • End with a version of "🤖 Add Fight Genie to your Discord server today & use $buy for AI powered predictions for your entire community"
                                    • Use appropriate emojis
                                    • Be engaging for both new and longtime fans`;


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
                    - Dual AI system (GPT-4o & Claude-3.5)
                    - High Lock Rate (70%+ success)
                    - Fun social experiment: Claude-3.5 vs GPT-4o
                    - Access to historical predictions
                    - Custom fight analysis
                    - Detailed statistical and style breakdowns
                    - Method predictions
                    - Value picks
                    - Performance tracking
    
                    Event: ${data.event.Event}
                    Website: https://fightgenie.ai

                    Add Fight Genie to your Discord server today (link in bio)!
    
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
    
            // Generate the entire thread content using generateTweet
            const threadContent = await this.generateTweet(analysis, 'fight_analysis');
            
            // Split the content into individual tweets
            const tweets = threadContent.split('\n\n').filter(tweet => tweet.trim());
    
            if (this.testMode) {
                // Log tweets in test mode
                console.log('\n=== FIGHT ANALYSIS THREAD ===\n');
                tweets.forEach((tweet, i) => {
                    console.log(`Tweet ${i + 1}:\n${tweet}\n`);
                });
                await this.logTweet('fight_analysis', event.event_id, threadContent);
                return;
            }
    
            // Post the thread
            let lastTweetId;
            for (const tweet of tweets) {
                try {
                    const response = lastTweetId ?
                        await this.twitter.v2.reply(tweet.slice(0, 4000), lastTweetId) :
                        await this.twitter.v2.tweet(tweet.slice(0, 4000));
                    
                    lastTweetId = response.data.id;
                    
                    // Wait between tweets to prevent rate limiting
                    await new Promise(resolve => setTimeout(resolve, 2000));
                } catch (error) {
                    console.error('Error posting individual tweet:', error);
                    if (error.data) {
                        console.error('Twitter API Error:', error.data);
                    }
                    throw error;
                }
            }
    
            // Log successful thread
            await this.logTweet('fight_analysis', event.event_id, threadContent);
            console.log('Analysis thread posted successfully');
    
        } catch (error) {
            console.error('Error posting fight analysis thread:', error);
            if (error.data) {
                console.error('Twitter API Error:', error.data);
            }
            throw error;
        }
    }    async postValuePickTweet() {
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
    GPT-4o (${baseStats.find(s => s.model_used === 'gpt')?.win_rate}% accurate) vs
    Claude-3.5 (${baseStats.find(s => s.model_used === 'claude')?.win_rate}% accurate)
    ${predictionStats[0].events_analyzed} events analyzed! #UFC #AI`;
            tweets.push(overallTweet);

            // Method breakdown tweet
            if (methodStats) {
                const gptMethods = methodStats['gpt'];
                const methodTweet = `📊 Method Prediction Accuracy:
    KO/TKO: GPT-4o ${(gptMethods.ko_tko.correct / gptMethods.ko_tko.total * 100).toFixed(1)}%
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

    async generateWeeklyState() {
        try {
            const lastEvent = await database.query(`
                SELECT DISTINCT e.* 
                FROM events e
                JOIN stored_predictions sp ON e.event_id = sp.event_id
                WHERE e.Date < date('now')
                AND EXISTS (
                    SELECT 1 
                    FROM prediction_outcomes po 
                    WHERE po.prediction_id = sp.prediction_id
                )
                ORDER BY e.Date DESC
                LIMIT 1
            `);
    
            if (!lastEvent?.[0]) {
                throw new Error('No completed events found');
            }
    
            // Modified query with explicit JSON boolean handling
            const predictions = await database.query(`
                WITH RECURSIVE fight_predictions AS (
                    SELECT 
                        sp.model_used,
                        po.fight_outcomes,
                        json_each.value as fight
                    FROM stored_predictions sp
                    JOIN prediction_outcomes po ON sp.prediction_id = po.prediction_id
                    CROSS JOIN json_each(po.fight_outcomes)
                    WHERE sp.event_id = ?
                    AND json_valid(po.fight_outcomes)
                )
                SELECT 
                    model_used,
                    COUNT(*) as total_predictions,
                    SUM(CASE 
                        WHEN LOWER(json_extract(fight, '$.correct')) IN ('true', '1') 
                        OR json_extract(fight, '$.correct') = 1 
                        THEN 1 ELSE 0 
                    END) as correct_predictions,
                    SUM(CASE 
                        WHEN CAST(NULLIF(json_extract(fight, '$.confidence'), '') AS DECIMAL) >= 70 
                        THEN 1 ELSE 0 
                    END) as total_locks,
                    SUM(CASE 
                        WHEN CAST(NULLIF(json_extract(fight, '$.confidence'), '') AS DECIMAL) >= 70 
                        AND (
                            LOWER(json_extract(fight, '$.correct')) IN ('true', '1')
                            OR json_extract(fight, '$.correct') = 1
                        )
                        THEN 1 ELSE 0 
                    END) as lock_wins
                FROM fight_predictions
                GROUP BY model_used
            `, [lastEvent[0].event_id]);
    
            // Add debug logging to see raw fight data
            const rawFightData = await database.query(`
                SELECT 
                    sp.model_used,
                    json_extract(value, '$.confidence') as confidence,
                    json_extract(value, '$.correct') as correct
                FROM stored_predictions sp
                JOIN prediction_outcomes po ON sp.prediction_id = po.prediction_id
                CROSS JOIN json_each(po.fight_outcomes)
                WHERE sp.event_id = ?
                ORDER BY sp.model_used, confidence DESC
            `, [lastEvent[0].event_id]);
    
            console.log('Raw Fight Data Sample:', rawFightData.slice(0, 5));
            console.log('Last Event:', lastEvent[0]);
            console.log('Raw Predictions Data:', predictions);
    
            // Get upcoming event info
            const upcomingEvent = await this.getUpcomingEvent();
    
            // Get both models' stats
            const gptStats = predictions.find(s => s.model_used === 'gpt') || {
                total_predictions: 0,
                correct_predictions: 0,
                total_locks: 0,
                lock_wins: 0
            };
    
            const claudeStats = predictions.find(s => s.model_used === 'claude') || {
                total_predictions: 0,
                correct_predictions: 0,
                total_locks: 0,
                lock_wins: 0
            };
    
            // Calculate win rates
            const gptWinRate = gptStats.total_predictions > 0 
                ? ((gptStats.correct_predictions / gptStats.total_predictions) * 100).toFixed(1)
                : '0.0';
            const claudeWinRate = claudeStats.total_predictions > 0 
                ? ((claudeStats.correct_predictions / claudeStats.total_predictions) * 100).toFixed(1)
                : '0.0';
    
            // Debug logging
            console.log('GPT Stats:', {
                ...gptStats,
                winRate: gptWinRate
            });
            console.log('Claude Stats:', {
                ...claudeStats,
                winRate: claudeWinRate
            });
    
            const weeklyThread = await this.openai.chat.completions.create({
                model: "chatgpt-4o-latest",
                messages: [{
                    role: "system",
                    content: `You're Fight Genie - A Discord bot powered by AI sharing a weekly update. Use these stats:
    
                    Last Event (${lastEvent[0].Event}) Performance:
    
                    GPT-4o Stats:
                    Total Picks: ${gptStats.total_predictions}
                    Correct Picks: ${gptStats.correct_predictions}
                    Win Rate: ${gptWinRate}%
                    Lock Picks (70%+): ${gptStats.lock_wins}/${gptStats.total_locks}
    
                    Claude-3.5 Stats:
                    Total Picks: ${claudeStats.total_predictions}
                    Correct Picks: ${claudeStats.correct_predictions}
                    Win Rate: ${claudeWinRate}%
                    Lock Picks (70%+): ${claudeStats.lock_wins}/${claudeStats.total_locks}
    
                    Next Event: ${upcomingEvent?.Event}
    
                    Create a 3-tweet thread following these guidelines:
                    1. Never use "**Tweet X:**" format
                    2. Structure tweets naturally as a conversation while maintaining structure.
                    3. Each tweet should flow from the previous one
                    4. Cover these topics in order:
                       - Both models' performance summary for last event
                       - Lock pick performance comparison between models
                       - Preview of upcoming card (${upcomingEvent?.Event})
                       - Mention that promo codes for ${upcomingEvent?.Event} will be dropping later in the week
                       - This is a Discord bot so mention inviting Fight Genie to your server and link is in our bio or on our website
                       - Website: https://fightgenie.ai
                    5. Keep tone casual and stats-focused, sound human.
                    6. Use relevant emojis naturally
                    7. Include #UFC #FightGenie hashtags
    
                    Important context rules:
                    - Always mention both models' actual performance
                    - If either model had lock picks, highlight them specifically
                    - If either model's win rate was below 60%, mention limited data availability as a factor
                    - Always maintain confident tone about upcoming predictions
                    - When mentioning performance issues, frame it as a data availability challenge
                    - Emphasize the competitive aspect between GPT-4o and Claude-3.5
    
                    Never mention tweet numbers or use artificial separators.`
                }],
                temperature: 0.7
            });
    
            return weeklyThread.choices[0].message.content;
        } catch (error) {
            console.error('Error generating weekly state thread:', error);
            throw error;
        }
    }

// Weekly state posting method
async postWeeklyState() {
    try {
        const weeklyThread = await this.generateWeeklyState();
        if (!weeklyThread) {
            console.error('No weekly thread content generated');
            return;
        }

        const tweets = weeklyThread.split('\n\n').filter(tweet => tweet.trim());
        
        if (tweets.length === 0) {
            console.error('No valid tweets after splitting content');
            return;
        }

        if (this.testMode) {
            console.log('\n=== FIGHT GENIE WEEKLY STATE ===\n');
            tweets.forEach((tweet, i) => {
                console.log(`Tweet ${i + 1}:\n${tweet}\n`);
            });
            return;
        }

        let lastTweetId;
        for (const tweet of tweets) {
            try {
                const response = lastTweetId ?
                    await this.twitter.v2.reply(tweet.slice(0, 4000), lastTweetId) :
                    await this.twitter.v2.tweet(tweet.slice(0, 4000));
                lastTweetId = response.data.id;
                await new Promise(resolve => setTimeout(resolve, 2000));
            } catch (error) {
                console.error('Error posting individual tweet:', error);
                throw error;
            }
        }
        console.log('Posted weekly state thread');
    } catch (error) {
        console.error('Error posting weekly state:', error);
        throw error;
    }
}


// Move checkTweetSent to be a class method
async checkTweetSent(type, eventId = null) {
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

// Move logTweet to be a class method
async logTweet(type, eventId = null, content = null) {
    try {
        // For weekly state, we don't need an event_id
        if (type === 'weekly_state') {
            await database.query(`
                INSERT INTO tweet_logs (tweet_type, content, created_at)
                VALUES (?, ?, datetime('now'))
            `, [type, content]);
        } else {
            await database.query(`
                INSERT INTO tweet_logs (event_id, tweet_type, content, created_at)
                VALUES (?, ?, ?, datetime('now'))
            `, [eventId, type, content]);
        }
    } catch (error) {
        console.error('Error logging tweet:', error);
        // Don't throw error for logging failures
    }
}        

async scheduleTweets() {
    const schedule = require('node-schedule');

    // Cancel any existing jobs before scheduling new ones
    Object.keys(schedule.scheduledJobs).forEach(jobName => {
        console.log(`Cancelling existing job: ${jobName}`);
        schedule.scheduledJobs[jobName].cancel();
    });

    // Weekly State Report - Mondays at 6:26 PM
    schedule.scheduleJob('weekly-state', '26 18 * * 1', async () => {
        try {
            if (!(await this.checkTweetSent('weekly_state'))) {
                console.log('Executing Monday weekly state thread');
                await this.postWeeklyState();
                await this.logTweet('weekly_state');
            }
        } catch (error) {
            console.error('Error posting weekly state:', error);
        }
    });

    // Value Picks - Mondays at 10:23 PM
    schedule.scheduleJob('value-picks', '53 11 * * 2', async () => {
        try {
            if (!(await this.checkTweetSent('value_picks'))) {
                console.log('Executing value pick tweets');
                const event = await this.getUpcomingEvent();
                if (event) {
                    await this.postValuePickTweet();
                    await this.logTweet('value_picks', event.event_id);
                }
            }
        } catch (error) {
            console.error('Error posting value picks:', error);
        }
    });

    // UFC History & Event Promo - Tuesdays at 7:40 PM
    schedule.scheduleJob('ufc-history-promo', '40 19 * * 3', async () => {
        try {
            if (!(await this.checkTweetSent('ufc_history_promo'))) {
                console.log('Executing UFC history and event promo');
                const event = await this.getUpcomingEvent();

                if (!event) {
                    console.log('No upcoming event found');
                    return;
                }

                const historyPrompt = {
                    role: "system",
                    content: `You are an expert UFC historian. Create an interesting historical UFC fact that:
                    1. Is verifiably true and significant
                    2. Would be fascinating to both casual and hardcore MMA fans
                    3. Has some thematic or narrative connection to ${event.Event}
                    4. Involves either:
                       - A similar matchup/situation
                       - The same weight class
                       - The same venue
                       - A similar stakes/title situation
                       - Or a relevant record/milestone
                    5. Would make fans more excited for the upcoming event
                    
                    Focus on dramatic moments, significant records, or compelling narratives.
                    Include specific details like dates and numbers where relevant.
                    Consider current storylines and fan interests.
                    Look for unique angles that highlight the significance of the upcoming event.`
                };

                const historyCompletion = await this.openai.chat.completions.create({
                    model: "chatgpt-4o-latest",
                    messages: [historyPrompt],
                    temperature: 0.9
                });

                const tweet = await this.generateTweet({
                    historical: {
                        fact: historyCompletion.choices[0].message.content,
                        generated: true
                    },
                    event: event
                }, 'ufc_history');

                if (!this.testMode) {
                    await this.twitter.v2.tweet(tweet);
                }
                await this.logTweet('ufc_history_promo', event.event_id, tweet);
                console.log('Posted UFC history and event promo');
            }
        } catch (error) {
            console.error('Error posting UFC history promo:', error);
        }
    });

    // Model Competition - Sundays at 2:00 PM
    schedule.scheduleJob('model-competition', '0 14 * * 0', async () => {
        try {
            if (!(await this.checkTweetSent('model_competition'))) {
                console.log('Executing Sunday model competition tweets');
                await this.postModelComparisonTweet();
                await this.logTweet('model_competition');
            }
        } catch (error) {
            console.error('Error posting model competition:', error);
        }
    });

    // Saturday Updates - Starting at 3:00 PM
    schedule.scheduleJob('saturday-update', '26 23 * * 1', async () => {
        try {
            if (!(await this.checkTweetSent('saturday_update'))) {
                console.log('Executing Saturday comprehensive update');
                const event = await this.getUpcomingEvent();
                if (event) {
                    // Post fight analysis at 3:00 PM
                    await this.postFightAnalysisTweet();
                    await this.logTweet('saturday_analysis', event.event_id);
                    console.log('Posted fight analysis at 3:00 PM');

                    // Post value picks at 4:30 PM
                    await new Promise(resolve => setTimeout(resolve, 90 * 60 * 1000));
                    await this.postValuePickTweet();
                    await this.logTweet('saturday_picks', event.event_id);
                    console.log('Posted value picks at 4:30 PM');

                    // Post promo at 5:45 PM if it's event day
                    if (new Date(event.Date).toDateString() === new Date().toDateString()) {
                        await new Promise(resolve => setTimeout(resolve, 75 * 60 * 1000));
                        const promoTweet = await this.generateTweet({ event }, 'promo');
                        if (!this.testMode) {
                            await this.twitter.v2.tweet(promoTweet);
                        }
                        await this.logTweet('saturday_promo', event.event_id, promoTweet);
                        console.log('Posted promo at 5:45 PM');
                    }
                }
            }
        } catch (error) {
            console.error('Error posting Saturday update:', error);
        }
    });

    console.log(`Tweet automation scheduled. Test mode: ${this.testMode ? 'ON' : 'OFF'}`);
}

}

module.exports = TweetAutomation;