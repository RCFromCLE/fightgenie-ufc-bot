const { OpenAI } = require('openai');
const database = require('../database');
const { TwitterApi } = require('twitter-api-v2');
const fs = require('fs').promises;
const ModelStatsCommand = require('../commands/ModelStatsCommand');

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
    }

    async generateTestPosts() {
        console.log('\n=== FIGHT GENIE TEST POSTS ===\n');
        const timestamp = new Date().toLocaleString();
        let output = `\n=== GENERATED ${timestamp} ===\n\n`;

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

        // Promo Tweet
        console.log('💫 Generating Promo Tweet...');
        const event = await this.getUpcomingEvent();
        if (event) {
            const tweet = await this.generateTweet({ event }, 'promo');
            output += '💫 PROMO:\n' + tweet + '\n\n';
        } else {
            output += '❌ No upcoming event available\n\n';
        }

        output += '='.repeat(50) + '\n';

        // Save to file
        const fs = require('fs').promises;
        try {
            await fs.appendFile(this.logFile, output);
            console.log(`✅ Posts saved to ${this.logFile}`);
        } catch (error) {
            console.error('Error writing to file:', error);
        }

        // Return summary
        return {
            success: true,
            message: `Generated test posts and saved to ${this.logFile}`
        };
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
                WHERE Date >= date('now')
                AND Event IS NOT NULL
                ORDER BY Date ASC
                LIMIT 1
            `);
            return event?.[0];
        } catch (error) {
            console.error('Error fetching upcoming event:', error);
            return null;
        }
    }

    async getFeaturedFightAnalysis() {
        try {
            // Alternate between models randomly
            const useGPT = Math.random() < 0.5;
            const modelToUse = useGPT ? 'gpt' : 'claude';
            console.log(`Using ${modelToUse.toUpperCase()} for fight analysis`);
    
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
        // Get all completed predictions with verified results using correct JSON extraction
        const stats = await database.query(`
            SELECT
                sp.model_used,
                COUNT(DISTINCT e.event_id) as events_analyzed,
                COUNT(*) as fights_predicted,
                SUM(CASE 
                    WHEN json_extract(po.fight_outcomes, '$.correct') = 1 
                    THEN 1 ELSE 0 
                END) as correct_predictions,
                SUM(CASE 
                    WHEN json_extract(po.fight_outcomes, '$.methodCorrect') = 1 
                    THEN 1 ELSE 0 
                END) as method_correct,
                AVG(po.confidence_accuracy) as avg_confidence
            FROM stored_predictions sp
            JOIN events e ON sp.event_id = e.event_id
            JOIN prediction_outcomes po ON sp.prediction_id = po.prediction_id
            WHERE e.Date < date('now')
            GROUP BY sp.model_used
        `);

        console.log('Raw stats query result:', stats);

        if (!stats?.length) {
            console.log('No stats found in initial query');
            return null;
        }

        // Process and format stats
        return stats.map(model => ({
            model_used: model.model_used,
            events_analyzed: model.events_analyzed,
            fights_predicted: model.fights_predicted || 0,
            win_rate: model.fights_predicted ? 
                ((model.correct_predictions / model.fights_predicted) * 100).toFixed(1) : '0.0',
            method_accuracy: model.fights_predicted ? 
                ((model.method_correct / model.fights_predicted) * 100).toFixed(1) : '0.0',
            avg_confidence: model.avg_confidence?.toFixed(1) || '0.0'
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
        
        if (!stats.length) {
            return "🤖 Fight Genie AI models are warming up! Stay tuned for prediction accuracy stats.";
        }

        const gptStats = stats.find(s => s.model_used === 'gpt');
        const claudeStats = stats.find(s => s.model_used === 'claude');

        if (gptStats && claudeStats) {
            return `🤖 Fight Genie Performance Update: GPT-4 (${gptStats.win_rate}% accurate) vs Claude (${claudeStats.win_rate}% accurate)! ${gptStats.events_analyzed} events analyzed. All predictions tracked publicly! #UFC #AI`;
        }

        return "🤖 Fight Genie's AI models are analyzing fights! Stay tuned for more stats.";
    } catch (error) {
        console.error('Error generating model comparison tweet:', error);
        return "🤖 Fight Genie's AI models are working hard! Stats coming soon.";
    }
}

async generateTweet(data, type) {
        this.tweetIdCounter++;
        const disclosureText = this.tweetIdCounter % 3 === 0 ? 
            "\n\n🤖 Tweet generated by GPT-4" : "";

        const prompt = await this.createPrompt(data, type);
        const completion = await this.openai.chat.completions.create({
            model: "gpt-4",
            messages: [
                { 
                    role: "system", 
                    content: `You are Fight Genie, an AI-powered UFC fight prediction bot. Write engaging tweets about real fight data and predictions. Maximum 240 characters (minus ${disclosureText.length} for disclosure). Always note predictions are AI-generated. Be specific with stats and data.`
                },
                { 
                    role: "user", 
                    content: prompt 
                }
            ],
            max_tokens: 200,
            temperature: 0.7
        });

        return completion.choices[0].message.content + disclosureText;
    }

    async createPrompt(data, type) {
        switch(type) {
            case 'fight_analysis':
                return `Create a tweet thread (3 tweets) analyzing ${data.fight.fighter1} vs ${data.fight.fighter2} for ${data.event.Event}:
                Tweet 1: Tale of the tape & style matchup
                Stats: ${data.fighter1Stats.SLPM} vs ${data.fighter2Stats.SLPM} strikes/min
                
                Tweet 2: Key factors & prediction
                ${data.fight.keyFactors.join('\n')}
                Predicted winner: ${data.fight.predictedWinner} (${data.fight.confidence}% confidence)
                
                Tweet 3: Method analysis
                ${data.fight.reasoning}
                
                Keep each tweet under 240 chars. Make it clear these are ${data.model.toUpperCase()} predictions.`;

            case 'value_pick':
                return `Create a tweet about this high-confidence pick:
                    Fighter: ${data.predictedWinner}
                    Confidence: ${data.confidence}%
                    Method: ${data.method}
                    Fighter Stats: ${data.fighterStats ? 
                        `${data.fighterStats.SLPM} strikes/min, ${data.fighterStats.TDAvg} takedowns/15min` : 
                        'Stats updating'}
                    Mention this is an AI-generated prediction.`;

            case 'model_competition':
                return `Create a tweet about our AI models' performance:
                    GPT-4: ${data.gpt.accuracy}% accurate over ${data.gpt.total_predictions} predictions
                    Claude: ${data.claude.accuracy}% accurate over ${data.claude.total_predictions} predictions
                    Events analyzed: ${data.gpt.events_predicted}
                    Mention that all predictions are tracked publicly.`;

            case 'promo':
                return `Create a promotional tweet for Fight Genie.
                    Include that we use GPT-4 and Claude for predictions,
                    track all results publicly,
                    and offer lifetime access for $50 (10% off with Solana).
                    Mention we accept all major cards, Apple Pay, PayPal, and Solana.`;

            default:
                return `Create a tweet about Fight Genie's AI predictions,
                    mentioning we use GPT-4 and Claude and track all results publicly.`;
        }
    }

async postFightAnalysisTweet() {
    try {
        // Get 3 different fights from predictions
        const event = await database.getUpcomingEvent();
        if (!event) return;

        const predictions = await database.query(`
            SELECT sp.prediction_data, sp.model_used
            FROM stored_predictions sp
            WHERE sp.event_id = ?
            ORDER BY sp.created_at DESC
            LIMIT 1
        `, [event.event_id]);

        if (!predictions?.[0]) return;

        const predictionData = JSON.parse(predictions[0].prediction_data);
        const fights = predictionData.fights || [];

        // Randomly select 3 different fights for analysis
        const selectedFights = [];
        const usedIndexes = new Set();

        while (selectedFights.length < 3 && usedIndexes.size < fights.length) {
            const randomIndex = Math.floor(Math.random() * fights.length);
            if (!usedIndexes.has(randomIndex)) {
                usedIndexes.add(randomIndex);
                selectedFights.push(fights[randomIndex]);
            }
        }

        if (selectedFights.length < 3) return;

        // Generate 3 different tweets for 3 different fights
        const tweets = await Promise.all(selectedFights.map(async (fight, index) => {
            const [fighter1Stats, fighter2Stats] = await Promise.all([
                database.query('SELECT * FROM fighters WHERE Name = ?', [fight.fighter1]),
                database.query('SELECT * FROM fighters WHERE Name = ?', [fight.fighter2])
            ]);

            return this.generateTweet({
                fight,
                fighter1Stats: fighter1Stats[0],
                fighter2Stats: fighter2Stats[0],
                event,
                tweetNumber: index + 1
            }, 'fight_analysis');
        }));

        // Post tweets
        if (this.testMode) {
            await this.logTweet('FIGHT ANALYSIS THREAD', tweets.join('\n\n'));
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
        console.error('Error with fight analysis tweet:', error);
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
            .sort(([,a], [,b]) => b - a)[0][0];
    }

    async scheduleTweets() {
        const schedule = require('node-schedule');
        
        // Sunday: Model Competition Day
        schedule.scheduleJob('0 14 * * 0', async () => {
            console.log('Executing Sunday model competition tweets');
            await this.postModelComparisonTweet();
        });
    
        // Tuesday: Featured Fight Analysis
        schedule.scheduleJob('0 15 * * 2', async () => {
            console.log('Executing Tuesday fight analysis tweets');
            const event = await this.getUpcomingEvent();
            if (event) {
                await this.postFightAnalysisTweet();
            }
        });
    
        // Thursday: Value Picks
        schedule.scheduleJob('0 15 * * 4', async () => {
            console.log('Executing Thursday value pick tweets');
            const event = await this.getUpcomingEvent();
            if (event) {
                await this.postValuePickTweet();
            }
        });
    
        // Saturday: Comprehensive Update
        schedule.scheduleJob('0 15 * * 6', async () => {
            console.log('Executing Saturday comprehensive update');
            const event = await this.getUpcomingEvent();
            if (event) {
                await this.postFightAnalysisTweet();
                await new Promise(resolve => setTimeout(resolve, 3600000));
                await this.postValuePickTweet();
                
                if (new Date(event.Date).toDateString() === new Date().toDateString()) {
                    await new Promise(resolve => setTimeout(resolve, 3600000));
                    const promoTweet = await this.generateTweet({ event }, 'promo');
                    if (this.testMode) {
                        await this.logTweet('PROMO', promoTweet);
                    } else {
                        await this.twitter.v2.tweet(promoTweet);
                    }
                }
            }
        });
    
        // Special Event Day Schedule
        schedule.scheduleJob('0 12,16,20 * * *', async () => {
            const event = await this.getUpcomingEvent();
            if (event && new Date(event.Date).toDateString() === new Date().toDateString()) {
                const hour = new Date().getHours();
                
                if (hour === 12) {
                    const promoTweet = await this.generateTweet({ event }, 'promo');
                    if (this.testMode) {
                        await this.logTweet('EVENT DAY PROMO', promoTweet);
                    } else {
                        await this.twitter.v2.tweet(promoTweet);
                    }
                    await new Promise(resolve => setTimeout(resolve, 1800000));
                    await this.postFightAnalysisTweet();
                } else if (hour === 16) {
                    await this.postValuePickTweet();
                } else if (hour === 20) {
                    await this.postModelComparisonTweet();
                    await new Promise(resolve => setTimeout(resolve, 1800000));
                    const finalPromo = await this.generateTweet({ event }, 'promo');
                    if (this.testMode) {
                        await this.logTweet('EVENT DAY FINAL PROMO', finalPromo);
                    } else {
                        await this.twitter.v2.tweet(finalPromo);
                    }
                }
            }
        });

        console.log(`Tweet automation scheduled. Test mode: ${this.testMode ? 'ON' : 'OFF'}`);
    }
}

module.exports = TweetAutomation;