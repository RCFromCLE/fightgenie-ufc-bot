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
                    model: "chatGPT-latest",
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

            // Event Promo Codes (REMOVED - No longer applicable for free bot)
            // console.log('🎫 Generating Event Promo Codes...');
            // output += '🎫 EVENT PROMO CODES: (Removed)\n\n';

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
            // Use the static method from DatabaseManager to get the current/upcoming event
            // This ensures consistency with the rest of the application
            const event = await database.constructor.getUpcomingEvent();

            if (event) {
                // Create a date object and format it properly
                const eventDate = new Date(event.Date); // Assuming PT timezone
                return {
                    ...event,
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
                    .filter(fight => fight.confidence >= 75)
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
                                isHighConfidence: (Number(fight.confidence) || 0) >= 75
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

    // Consolidated function to post model competition/stats tweets using generateTweet
    async postModelStatsTweets() {
        try {
            console.log('Fetching model stats for competition tweet...');
            const stats = await this.getModelStats();

            if (!stats?.length || stats.length < 2) {
                console.log('Insufficient model stats available for comparison.');
                return;
            }

            const gptStats = stats.find(s => s.model_used === 'gpt');
            const claudeStats = stats.find(s => s.model_used === 'claude');

            if (!gptStats || !claudeStats) {
                console.log('Missing stats for one or both models.');
                return;
            }

            // Generate the thread content using the standardized prompt
            const threadContent = await this.generateTweet({
                gpt: gptStats,
                claude: claudeStats
            }, 'model_competition');

            if (!threadContent) {
                console.error('Failed to generate model competition tweet content.');
                return;
            }

            // Split the content, filter empty/placeholder tweets, and limit thread length
            const MAX_THREAD_TWEETS = 3; // Limit threads to 3 tweets max
            const tweets = threadContent.split('\n\n')
                .map(tweet => tweet.trim()) // Trim whitespace first
                .filter(tweet => tweet && tweet !== '---') // Remove empty and "---" tweets
                .slice(0, MAX_THREAD_TWEETS); // Limit to max number

            if (tweets.length === 0) {
                console.error('No valid tweets generated for model competition after filtering.');
                return;
            }

            // Log or post tweets
            if (this.testMode) {
                console.log('\n=== MODEL COMPETITION THREAD (Test Mode) ===\n');
                tweets.forEach((tweet, i) => console.log(`Tweet ${i + 1}:\n${tweet}\n`));
                await this.logTweet('MODEL COMPETITION', null, threadContent); // Log without event ID
            } else {
                console.log('Posting model competition thread...');
                let lastTweetId;
                for (const tweet of tweets) {
                    try {
                        const response = lastTweetId ?
                            await this.twitter.v2.reply(tweet.slice(0, 4000), lastTweetId) :
                            await this.twitter.v2.tweet(tweet.slice(0, 4000));
                        lastTweetId = response.data.id;
                        await new Promise(resolve => setTimeout(resolve, 2000)); // Wait between tweets
                    } catch (error) {
                        console.error('Error posting individual model competition tweet:', error);
                        if (error.data) console.error('Twitter API Error:', error.data);
                        // Decide if we should stop or continue posting the rest of the thread
                        break; // Stop posting on error
                    }
                }
                if (lastTweetId) { // Only log if at least one tweet was posted successfully
                   await this.logTweet('MODEL COMPETITION', null, threadContent);
                   console.log('Model competition thread posted successfully.');
                }
            }

        } catch (error) {
            console.error('Error in postModelStatsTweets:', error);
        }
    }

    // Removed redundant generateModelComparisonTweet function

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
                model: "chatGPT-latest",
                messages: [{
                    role: "system",
                    content: `You are Fight Genie, an AI-powered UFC fight prediction bot. Your SOLE task is to generate tweet content based *only* on the user prompt.
                        **CRITICAL RULES:**
                        - Output ONLY the raw tweet text. NO explanations, NO apologies, NO meta-commentary, NO numbering (like "1.", "Tweet 1:"), NO questions, NO requests for clarification.
                        - NEVER include placeholders like "ireeelvanaace" or similar.
                        - NEVER output separators like "---" or similar markers between tweets. Use standard paragraph breaks (\n\n) if generating multiple tweets for a thread.
                        - Adhere STRICTLY to the format requested in the user prompt (e.g., number of tweets for a thread).
                        - Sound like a knowledgeable, engaging, but concise human MMA analyst for fans aged 18-45.
                        - Use relevant emojis and hashtags naturally within the tweet text.
                        - Keep individual tweets under 450 characters. Prioritize brevity and clarity. Use bullet points where appropriate.
                        - When referring to models, use "GPT" and "Claude".
                        - Always include relevant hashtags like #UFC, #MMA, #FightGenie, plus any event-specific ones requested.
                        - Ensure the generated text is ready to be posted directly to Twitter without any modification.`
                },
                {
                    role: "user",
                    content: await this.createPrompt(data, type)
                }],
                max_tokens: 1500, // Adjusted for potentially slightly longer, better-formatted tweets
                temperature: 0.7,
                presence_penalty: 0.4, // Slightly reduced penalty
                frequency_penalty: 0.2  // Slightly reduced penalty
            });

            const tweet = completion.choices[0].message.content.trim(); // Trim whitespace
            return tweet; // Removed random suffix
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
            eventDate.setDate(eventDate.getDate() + 1);
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
        // Removed getRandomFormat

        switch (type) {
            case 'fight_analysis':
                // Standardized fight analysis prompt
                const baseStats = `
                    Fighter 1 (${data.fight.fighter1}):
                    - Record: ${data.fighter1Stats.Wins}-${data.fighter1Stats.Losses}
                    - SLpM: ${data.fighter1Stats.SLPM} | Str. Acc: ${data.fighter1Stats.StrAcc}% | Str. Def: ${data.fighter1Stats.StrDef}%
                    - SApM: ${data.fighter1Stats.SLpM_avg}
                    - TD Avg: ${data.fighter1Stats.TDAvg} | TD Acc: ${data.fighter1Stats.TDAcc}% | TD Def: ${data.fighter1Stats.TDDef}%
                    - Sub Avg: ${data.fighter1Stats.SubAvg}
                    - Height: ${data.fighter1Stats.Height} | Reach: ${data.fighter1Stats.Reach} | Stance: ${data.fighter1Stats.Stance}
                    - Finish Rate: ${data.fighter1Stats.FinishRate}% | Avg Fight Time: ${data.fighter1Stats.AvgFightTime}
                    - Striking accuracy: ${data.fighter1Stats.StrAcc}%
                    - Strike defense: ${data.fighter1Stats.StrDef}%
    
                    Fighter 2 (${data.fight.fighter2}):
                    - Record: ${data.fighter2Stats.Wins}-${data.fighter2Stats.Losses}
                    - SLpM: ${data.fighter2Stats.SLPM} | Str. Acc: ${data.fighter2Stats.StrAcc}% | Str. Def: ${data.fighter2Stats.StrDef}%
                    - SApM: ${data.fighter2Stats.SLpM_avg}
                    - TD Avg: ${data.fighter2Stats.TDAvg} | TD Acc: ${data.fighter2Stats.TDAcc}% | TD Def: ${data.fighter2Stats.TDDef}%
                    - Sub Avg: ${data.fighter2Stats.SubAvg}
                    - Height: ${data.fighter2Stats.Height} | Reach: ${data.fighter2Stats.Reach} | Stance: ${data.fighter2Stats.Stance}
                    - Finish Rate: ${data.fighter2Stats.FinishRate}% | Avg Fight Time: ${data.fighter2Stats.AvgFightTime}`;

                const matchupAnalysis = `
                    Matchup Insights:
                    - Stance: ${data.fighter1Stats.Stance} vs ${data.fighter2Stats.Stance}
                    - Reach Adv: ${Math.abs(parseFloat(data.fighter1Stats.Reach) - parseFloat(data.fighter2Stats.Reach))} inches for ${parseFloat(data.fighter1Stats.Reach) > parseFloat(data.fighter2Stats.Reach) ? data.fight.fighter1 : data.fight.fighter2}
                    - Striking Diff: ${Math.abs(parseFloat(data.fighter1Stats.SLPM) - parseFloat(data.fighter2Stats.SLPM)).toFixed(1)} SLpM
                    - Grappling Diff: ${Math.abs(parseFloat(data.fighter1Stats.TDAvg) - parseFloat(data.fighter2Stats.TDAvg)).toFixed(1)} TD/15min`;

                // Standardized format
                const fightAnalysisPrompt = `Generate a concise 3-tweet thread analyzing ${data.fight.fighter1} vs ${data.fight.fighter2} for ${data.event.Event}.

Tweet 1: Tale of the Tape & Key Stats
- Include records, key striking/grappling stats (SLpM, TD Avg), and physicals (Height, Reach, Stance) for both fighters using the provided base stats.
${baseStats}

Tweet 2: Matchup Dynamics & AI Factors
- Discuss the style matchup (Stance, Reach, Striking/Grappling differentials) using the provided matchup insights.
- List the key factors the AI considered: ${data.fight.keyFactors.join(', ')}.
${matchupAnalysis}

Tweet 3: AI Prediction & Reasoning
- State the predicted winner: ${data.fight.predictedWinner}
- Confidence: ${data.fight.confidence}%
- Predicted Method: ${data.fight.method}
- Briefly summarize the AI's reasoning: ${data.fight.reasoning}
- Include a call to action: "Get full predictions in our Discord (link in bio!)"

Instructions:
- Use bullet points for stats.
- Keep each tweet focused and under the character limit.
- Use emojis relevantly (🥊📊🧠).
- Include #UFC #${data.event.Event.replace(/[^a-zA-Z0-9]/g, '')} #FightGenie hashtags.`;

                return fightAnalysisPrompt;

            case 'value_pick':
                // Standardized value pick prompt
                const valuePickPrompt = `Create a single, compelling tweet highlighting a high-confidence value pick: ${data.predictedWinner} vs ${data.fighter1 === data.predictedWinner ? data.fighter2 : data.fighter1}.

Pick Details:
- Fighter: ${data.predictedWinner}
- Confidence: ${data.confidence}%
- Predicted Method: ${data.method}

Key Stats for ${data.predictedWinner}:
- Record: ${data.fighterStats.Wins}-${data.fighterStats.Losses}
- SLpM: ${data.fighterStats.SLPM} | Str. Acc: ${data.fighterStats.StrAcc}% | TD Avg: ${data.fighterStats.TDAvg}
- Finish Rate: ${data.fighterStats.FinishRate}%

AI Reasoning Snippet: ${data.reasoning.substring(0, 100)}... (Summarize key advantage)

Instructions:
- Start with a hook like "🎯 Fight Genie Value Pick!" or "🔥 High-Confidence Alert!".
- Clearly state the pick, opponent, and confidence level.
- Include 1-2 key stats supporting the pick.
- Briefly mention the AI's core reasoning (e.g., "AI highlights striking edge" or "Grappling advantage is key").
- Add a call to action: "Full analysis in our Discord! Link in bio."
- Use emojis (🎯💰📈).
- Include #UFC #FightPick #FightGenie hashtags.`;

                return valuePickPrompt;
/*
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
                    Include https://fightgenie.ai and relevant hashtags.
*/
            case 'model_competition':
                // Completely revised prompt for more natural, conversational model comparison tweets
                return `Create a single, engaging tweet that shares insights about our AI models' performance in predicting UFC fights. Instead of just listing stats, craft a narrative that feels like an MMA analyst discussing interesting trends.

                    Available Stats (use selectively, don't include all):
                    GPT:
                    - Overall Win Rate: ${data.gpt.win_rate}% (${data.gpt.won_fights}/${data.gpt.total_fights})
                    - Lock Pick Rate (>=75% Confidence): ${data.gpt.lock_rate}% (${data.gpt.lock_wins}/${data.gpt.total_locks})
                    - Total Fights Analyzed: ${data.gpt.total_fights}
                    - Events Analyzed: ${data.gpt.events_analyzed}
    
                    Claude:
                    - Overall Win Rate: ${data.claude.win_rate}% (${data.claude.won_fights}/${data.claude.total_fights})
                    - Lock Pick Rate (>=75% Confidence): ${data.claude.lock_rate}% (${data.claude.lock_wins}/${data.claude.total_locks})
                    - Total Fights Analyzed: ${data.claude.total_fights}
                    - Events Analyzed: ${data.claude.events_analyzed}
    
                    Approach:
                    - Focus on a specific insight or trend (e.g., "Claude excels at predicting underdogs" or "GPT has been on fire lately with submission predictions")
                    - Frame it as an interesting observation rather than a statistical report
                    - Mention only 1-2 key stats that support your narrative
                    - Add a thought-provoking question or prediction about future performance
                    - Include a subtle call to action about joining Discord (nothing too promotional)
                    
                    Style Guidelines:
                    - Write like an experienced MMA analyst sharing an interesting observation
                    - Use natural language that flows conversationally
                    - Avoid robotic phrasing like "GPT scored a solid 61.5% (8/13)"
                    - Use 1-2 relevant emojis naturally within the text
                    - Include #UFC #FightGenie hashtags
                    
                    Example Approach (create your own, don't copy this):
                    "Interesting trend in our AI predictions: Claude's been crushing it with underdog picks lately, hitting 72% when going against the odds. Meanwhile, GPT dominates main event calls. The AI rivalry continues! Who's your pick for best predictor? #UFC #FightGenie"`;


            case 'ufc_history':
                 // Standardized UFC History Prompt (Removed random format)
                const historyPrompt = `Create an engaging tweet connecting a historical UFC fact to the upcoming event, ${data.event.Event}.

Historical Fact: ${data.historical.fact}

Upcoming Event: ${data.event.Event} on ${new Date(data.event.Date).toLocaleDateString()}

Instructions:
1. Start with the historical fact, making it intriguing.
2. Draw a clear parallel or connection to the upcoming event (${data.event.Event}). This could be thematic, stylistic, related to stakes, weight class, etc.
3. Build anticipation for potential new history being made at ${data.event.Event}.
4. Keep it concise and impactful for Twitter.
5. Use relevant emojis (⏳📜🥊).
6. Include #UFC #MMAHistory #FightGenie and the event hashtag (e.g., #${data.event.Event.replace(/[^a-zA-Z0-9]/g, '')}).
7. End with: "🤖 Get AI predictions for ${data.event.Event} in our Discord! Link in bio."`;

                return historyPrompt;
/*
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
                                    • End with: "🤖 Add Fight Genie to your Discord (link in bio)! It's FREE! Use $donate to support us." // Updated CTA
                                    • Use appropriate emojis
                                    • Be engaging for both new and longtime fans
*/

            case 'promo':
                 // Standardized Promo Prompt (Removed random format)
                const promoPrompt = `Create an engaging promotional tweet for Fight Genie focused on the upcoming event: ${data.event.Event}.

Key Selling Points:
- Dual AI Predictions: GPT & Claude analyze every fight.
- Proven Accuracy: Track our model performance publicly.
- In-Depth Analysis: Stats, style breakdowns, method predictions.
- Discord Integration: Get picks directly in your server.
- Website: https://fightgenie.ai

Instructions:
1. Start with a hook related to ${data.event.Event}.
2. Highlight 1-2 key features (e.g., Dual AI, accuracy).
3. Mention the benefit for users (e.g., "Get an edge", "Impress your friends").
4. Include a strong call to action: "Add Fight Genie to your Discord! Link in bio."
5. Use relevant emojis (🤖📈🥊).
6. Include #UFC #${data.event.Event.replace(/[^a-zA-Z0-9]/g, '')} #AI #FightPicks #FightGenie hashtags.`;

                return promoPrompt;
/*
                    Key Features:
                    - Dual AI system (GPT & Claude)
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

                    Add Fight Genie to your Discord server today (link in bio)! It's FREE! Use $donate to support us. // Updated CTA

                    Create an engaging promotional thread that emphasizes technical excellence and analytical capabilities.
                    Include relevant hashtags #UFC #AI #FightPicks
*/
            default:
                 // Default fallback prompt
                return `Create an engaging tweet about Fight Genie's AI-powered UFC predictions.
                        Mention our dual AI system (GPT & Claude), Discord bot integration, and performance tracking.
                        Website: https://fightgenie.ai
                        Include #UFC #AI #FightGenie hashtags.`;
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
            
            // Split the content, filter empty/placeholder tweets, and limit thread length
            const MAX_THREAD_TWEETS = 3; // Limit threads to 3 tweets max (as requested by the prompt)
            const tweets = threadContent.split('\n\n')
                .map(tweet => tweet.trim()) // Trim whitespace first
                .filter(tweet => tweet && tweet !== '---') // Remove empty and "---" tweets
                .slice(0, MAX_THREAD_TWEETS); // Limit to max number

            if (tweets.length === 0) {
                 console.error('No valid tweets generated for fight analysis after filtering.');
                 return;
            }
    
            if (this.testMode) {
                // Log filtered tweets in test mode
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
    }

    async postValuePickTweet() {
        const valuePicks = await this.getValuePicks();
        if (valuePicks?.[0]) {
            const tweet = await this.generateTweet(valuePicks[0], 'value_pick');

            if (!tweet) {
                 console.error('Failed to generate value pick tweet content.');
                 return;
            }

            if (this.testMode) {
                console.log('\n=== VALUE PICK (Test Mode) ===\n', tweet);
                await this.logTweet('VALUE PICK', null, tweet); // Log without event ID for general picks
            } else {
                 try {
                     console.log('Posting value pick tweet...');
                     await this.twitter.v2.tweet(tweet.slice(0, 4000));
                     await this.logTweet('VALUE PICK', null, tweet);
                     console.log('Value pick tweet posted successfully.');
                 } catch (error) {
                     console.error('Error posting value pick tweet:', error);
                     if (error.data) console.error('Twitter API Error:', error.data);
                 }
            }
        } else {
             console.log('No value picks available to tweet.');
        }
    }

    // Removed redundant postModelComparisonTweet function

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

    // Removed scheduleEventPromoTweets function as promo codes are no longer used

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

    // This function is kept as it might be useful for other features,
    // but it's no longer directly used by the primary postModelStatsTweets.
    getMostAccurateMethod(methodStats) {
        const accuracies = {
            'KO/TKO': methodStats.ko_tko.correct / methodStats.ko_tko.total,
            'submissions': methodStats.submission.correct / methodStats.submission.total,
            'decisions': methodStats.decision.correct / methodStats.decision.total
        };

        return Object.entries(accuracies)
            .sort(([, a], [, b]) => b - a)[0][0];
    }

    // Restored generateWeeklyState function
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
                        WHEN CAST(NULLIF(json_extract(fight, '$.confidence'), '') AS DECIMAL) >= 75 
                        THEN 1 ELSE 0 
                    END) as total_locks,
                    SUM(CASE 
                        WHEN CAST(NULLIF(json_extract(fight, '$.confidence'), '') AS DECIMAL) >= 75 
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
                model: "chatGPT-latest",
                messages: [{
                    role: "system",
                    content: `You're Fight Genie - A Discord bot powered by AI sharing a weekly update. Your goal is to create an engaging 3-tweet thread summarizing the last event's AI performance and previewing the next.

                    **Make each week's thread feel fresh!** Choose a slightly different angle or focus each time. Examples:
                    - Focus heavily on the model vs. model competition this week.
                    - Highlight a particularly impressive (or surprising) lock pick performance.
                    - Emphasize the overall accuracy trend over the last few events (if data allows).
                    - Start with a strong hook about the upcoming event before diving into last week's stats.

                    **Core Information to Include (adapt phrasing each week):**
                    - Last Event: ${lastEvent[0].Event}
                    - Upcoming Event: ${upcomingEvent?.Event}
                    - GPT Performance (Last Event): ${gptWinRate}% win rate (${gptStats.correct_predictions}/${gptStats.total_predictions}), Locks: ${gptStats.lock_wins}/${gptStats.total_locks}
                    - Claude Performance (Last Event): ${claudeWinRate}% win rate (${claudeStats.correct_predictions}/${claudeStats.total_predictions}), Locks: ${claudeStats.lock_wins}/${claudeStats.total_locks}
                    - Mention promo codes dropping for ${upcomingEvent?.Event}.
                    - Call to action: Invite Fight Genie to Discord (link in bio/website).
                    - Website: https://fightgenie.ai

                    **Tweet Thread Structure (General Guide - Adapt based on chosen angle):**
                    1.  **Hook & Last Event Summary:** Start with an engaging hook (maybe related to your chosen angle). Briefly summarize BOTH models' performance for ${lastEvent[0].Event}.
                    2.  **Deeper Dive / Lock Picks:** Elaborate on the chosen angle (e.g., model comparison details, lock pick story).
                    3.  **Upcoming Event & CTA:** Preview ${upcomingEvent?.Event}, mention promo codes, and include the Discord invite/website link.

                    **Tone & Style:**
                    - Casual, engaging, and stats-focused but sound human.
                    - Use relevant emojis naturally (🤖🥊📊🔒📈).
                    - Include #UFC #FightGenie hashtags. Maybe add #${upcomingEvent?.Event?.replace(/[^a-zA-Z0-9]/g, '')}.

                    **Important Rules:**
                    - NEVER use "**Tweet X:**" or similar numbering.
                    - Ensure tweets flow naturally.
                    - Always mention both models' actual performance from the provided stats.
                    - If a model's win rate was low (<60%), you can optionally mention "limited data" or "learning phase" briefly.
                    - Maintain a confident tone about the AI's capabilities and upcoming predictions.
                    - Emphasize the fun, competitive aspect between GPT and Claude.
                    - Keep tweets concise for Twitter.

                    **Stats Provided:**
                    Last Event (${lastEvent[0].Event}) Performance:
    
                    GPT: ${gptWinRate}% (${gptStats.correct_predictions}/${gptStats.total_predictions}), Locks: ${gptStats.lock_wins}/${gptStats.total_locks}
                    Claude: ${claudeWinRate}% (${claudeStats.correct_predictions}/${claudeStats.total_predictions}), Locks: ${claudeStats.lock_wins}/${claudeStats.total_locks}
                    Next Event: ${upcomingEvent?.Event}

                    Now, generate the 3-tweet thread based on these instructions and stats.`
                }],
                temperature: 0.75 // Slightly increased temperature for more variability
            });
    
            return weeklyThread.choices[0].message.content;
        } catch (error) {
            console.error('Error generating weekly state thread:', error);
            throw error;
        }
    }
    // */ // Keep the function, remove the outer comment block

    // New function specifically for posting UFC History/Promo tweet
    async postUfcHistoryPromoTweet() {
        try {
            console.log('Executing UFC history and event promo tweet...');
            const event = await this.getUpcomingEvent();

            if (!event) {
                console.log('No upcoming event found for UFC history/promo tweet.');
                return;
            }

            // Generate the historical fact using AI
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
                model: "chatGPT-latest",
                messages: [historyPrompt],
                temperature: 0.9
            });

            const historicalFact = historyCompletion.choices[0].message.content;

            // Generate the tweet content
            const tweetContent = await this.generateTweet({
                historical: { fact: historicalFact, generated: true },
                event: event
            }, 'ufc_history');

            if (!tweetContent) {
                console.error('Failed to generate UFC history/promo tweet content.');
                return;
            }

            // Post or log the tweet
            if (this.testMode) {
                console.log('\n=== UFC HISTORY/PROMO TWEET (Test Mode) ===\n', tweetContent);
                await this.logTweet('UFC HISTORY PROMO', event.event_id, tweetContent); // Use consistent uppercase type
            } else {
                console.log('Posting UFC history/promo tweet...');
                try {
                    await this.twitter.v2.tweet(tweetContent.slice(0, 4000));
                    await this.logTweet('UFC HISTORY PROMO', event.event_id, tweetContent); // Use consistent uppercase type
                    console.log('UFC history/promo tweet posted successfully.');
                } catch (error) {
                    console.error('Error posting UFC history/promo tweet:', error);
                    if (error.data) console.error('Twitter API Error:', error.data);
                    // Don't log if posting failed
                }
            }
        } catch (error) {
            console.error('Error in postUfcHistoryPromoTweet:', error);
        }
    }

    // Restored postWeeklyState function
    async postWeeklyState() {
        try {
            const weeklyThread = await this.generateWeeklyState();
            if (!weeklyThread) {
                console.error('No weekly thread content generated');
                return;
            }

            // Split the content, filter empty/placeholder tweets, and limit thread length
            const MAX_THREAD_TWEETS = 3; // Limit threads to 3 tweets max
            const tweets = weeklyThread.split('\n\n')
                .map(tweet => tweet.trim()) // Trim whitespace first
                .filter(tweet => tweet && tweet !== '---') // Remove empty and "---" tweets
                .slice(0, MAX_THREAD_TWEETS); // Limit to max number

            if (tweets.length === 0) {
                console.error('No valid tweets generated for weekly state after filtering.');
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
    // */ // Keep the function, remove the outer comment block

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

    // Restored Weekly State Report schedule
    schedule.scheduleJob('weekly-state', '26 18 * * 1', async () => {
        try {
            // Use uppercase type consistent with others for checkTweetSent
            if (!(await this.checkTweetSent('WEEKLY STATE'))) {
                console.log('Executing Monday weekly state thread');
                await this.postWeeklyState();
                // Logging now uses uppercase and is handled within postWeeklyState if successful
                // await this.logTweet('WEEKLY STATE'); // Log handled internally now
            } else {
                 console.log('Weekly state tweet already sent today.');
            }
        } catch (error) {
            console.error('Error in scheduled weekly state job:', error);
        }
    });
    // */ // Keep the schedule, remove the outer comment block

    // Value Picks - Tuesdays at 11:53 AM
    schedule.scheduleJob('value-picks', '53 11 * * 2', async () => {
        try {
            // Check if a value pick tweet was already sent today (using null eventId)
            if (!(await this.checkTweetSent('VALUE PICK'))) {
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

    // UFC History & Event Promo - Wednesdays at 7:40 PM (Now calls the dedicated function)
    schedule.scheduleJob('ufc-history-promo', '40 19 * * 3', async () => {
        try {
            // Use consistent uppercase type for check
            if (!(await this.checkTweetSent('UFC HISTORY PROMO'))) {
                await this.postUfcHistoryPromoTweet();
                // Logging is handled within postUfcHistoryPromoTweet
            } else {
                 console.log('UFC history/promo tweet already sent today.');
            }
        } catch (error) {
            console.error('Error in scheduled UFC history/promo job:', error);
        }
    });

    // Model Competition Stats - Disabled to prevent the specific tweet format shown in the image
    // schedule.scheduleJob('model-competition', '0 14 * * 0', async () => {
    //     try {
    //         // Check if a model competition tweet was already sent today (using null eventId)
    //         if (!(await this.checkTweetSent('MODEL COMPETITION'))) {
    //             console.log('Executing Sunday model competition stats thread...');
    //             await this.postModelStatsTweets(); // Calls the consolidated function
    //             // Logging is handled within postModelStatsTweets
    //         } else {
    //              console.log('Model competition tweet already sent today.');
    //         }
    //     } catch (error) {
    //         console.error('Error in scheduled model competition job:', error);
    //     }
    // });

    // Saturday Updates - Starting at 3:00 PM
    schedule.scheduleJob('saturday-update', '00 14 * * 6', async () => {
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

// Command-line execution logic
if (require.main === module) {
    (async () => {
        require('dotenv').config(); // Load .env variables

        const tweetType = process.argv[2]; // Get the tweet type from command line argument
        if (!tweetType) {
            console.error('Error: Please provide a tweet type as a command line argument.');
            console.log('Available types: fight_analysis, value_pick, model_competition, weekly_state, ufc_history_promo');
            process.exit(1);
        }

        const automation = new TweetAutomation();
        // Ensure test mode respects environment variable even for manual runs
        automation.testMode = process.env.TWEET_TEST_MODE === 'true'; 
        console.log(`Manually triggering tweet type: ${tweetType} (Test Mode: ${automation.testMode})`);

        try {
            switch (tweetType.toLowerCase()) {
                case 'fight_analysis':
                    await automation.postFightAnalysisTweet();
                    break;
                case 'value_pick':
                    await automation.postValuePickTweet();
                    break;
                case 'model_competition':
                    await automation.postModelStatsTweets();
                    break;
                case 'weekly_state':
                    await automation.postWeeklyState();
                    break;
                case 'ufc_history_promo':
                    await automation.postUfcHistoryPromoTweet();
                    break;
                default:
                    console.error(`Error: Unknown tweet type "${tweetType}".`);
                    console.log('Available types: fight_analysis, value_pick, model_competition, weekly_state, ufc_history_promo');
                    process.exit(1);
            }
            console.log(`Manual trigger for ${tweetType} completed.`);
            // Explicitly exit after completion
             process.exit(0); 
        } catch (error) {
            console.error(`Error during manual trigger for ${tweetType}:`, error);
            process.exit(1);
        }
    })();
} else {
    module.exports = TweetAutomation;
}
