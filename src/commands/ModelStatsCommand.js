// ModelStatsCommand.js - Enhanced version

const { EmbedBuilder } = require("discord.js");
const database = require("../database");
const axios = require("axios");
const cheerio = require("cheerio");

class ModelStatsCommand {
    static async fetchEventFromUFCStats(eventName, eventDate) {
        try {
            // First, search for the event on ufcstats.com
            const searchResponse = await axios.get(
                "http://ufcstats.com/statistics/events/completed?page=all"
            );
            const $ = cheerio.load(searchResponse.data);

            let eventLink = null;

            // Find the event link by matching event name and date
            $("tr.b-statistics__table-row").each((_, element) => {
                const rowEventName = $(element).find("td:first-child a").text().trim();
                const rowDate = $(element).find("td:nth-child(2)").text().trim();

                // Flexible matching for event name and date
                if (
                    rowEventName.toLowerCase().includes(eventName.toLowerCase()) &&
                    new Date(rowDate).toISOString().slice(0, 10) ===
                    new Date(eventDate).toISOString().slice(0, 10)
                ) {
                    eventLink = $(element).find("td:first-child a").attr("href");
                }
            });

            if (!eventLink) {
                console.log(`Event not found: ${eventName} on ${eventDate}`);
                return null;
            }

            // Fetch event details
            const eventResponse = await axios.get(eventLink);
            const event$ = cheerio.load(eventResponse.data);

            const fights = [];

            // Parse fight results
            event$("tbody tr").each((_, fightRow) => {
                const $row = event$(fightRow);
                const winner = $row
                    .find("td.b-fight-details__table-col:first-child a")
                    .first()
                    .text()
                    .trim();
                const loser = $row
                    .find("td.b-fight-details__table-col:first-child a")
                    .last()
                    .text()
                    .trim();
                const method = $row
                    .find("td.b-fight-details__table-col_style_align-top")
                    .text()
                    .trim();
                const round = $row
                    .find("td.b-fight-details__table-col:nth-child(8)")
                    .text()
                    .trim();
                const time = $row
                    .find("td.b-fight-details__table-col:nth-child(9)")
                    .text()
                    .trim();

                if (winner && loser) {
                    fights.push({
                        winner,
                        loser,
                        method,
                        round,
                        time,
                    });
                }
            });

            return {
                eventLink,
                fights,
            };
        } catch (error) {
            console.error("Error fetching from UFCStats:", error);
            return null;
        }
    }

    static async processPredictionOutcomes(prediction) {
        try {
            const predictionData = JSON.parse(prediction.prediction_data);

            // Process fight predictions
            const fightResults = [];
            if (predictionData.fights) {
                for (const fight of predictionData.fights) {
                    const result = {
                        fighter1: fight.fighter1,
                        fighter2: fight.fighter2,
                        predictedWinner: fight.predictedWinner,
                        confidence: fight.confidence || null,
                        correct: null, // Will be updated when comparing with actual results
                    };
                    fightResults.push(result);
                }
            }

            // Process parlay predictions
            const parlayResults = [];
            if (predictionData.parlays) {
                for (const parlay of predictionData.parlays) {
                    const result = {
                        legs: parlay.legs,
                        predictedOutcome: parlay.predictedOutcome,
                        confidence: parlay.confidence || null,
                        correct: null, // Will be updated when comparing with actual results
                    };
                    parlayResults.push(result);
                }
            }

            // Process prop predictions
            const propResults = [];
            if (predictionData.props) {
                for (const prop of predictionData.props) {
                    const result = {
                        type: prop.type,
                        fighters: prop.fighters,
                        prediction: prop.prediction,
                        confidence: prop.confidence || null,
                        correct: null, // Will be updated when comparing with actual results
                    };
                    propResults.push(result);
                }
            }

            return {
                fightResults,
                parlayResults,
                propResults,
            };
        } catch (error) {
            console.error("Error processing prediction outcomes:", error);
            return null;
        }
    }

    static async updatePredictionOutcomes() {
        try {
            // Create prediction_outcomes table if it doesn't exist
            await database.query(`CREATE TABLE IF NOT EXISTS prediction_outcomes (
                outcome_id INTEGER PRIMARY KEY AUTOINCREMENT,
                event_id INTEGER,
                prediction_id INTEGER,
                event_name TEXT,
                event_date TEXT,
                fight_result TEXT,
                parlay_result TEXT,
                prop_result TEXT,
                outcome_verified BOOLEAN DEFAULT FALSE,
                last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(event_id) REFERENCES events(event_id),
                FOREIGN KEY(prediction_id) REFERENCES stored_predictions(prediction_id)
            )`);

            // Get all predictions that need outcome verification
            const predictions = await database.query(`
                SELECT 
                    sp.*,
                    e.Event as event_name,
                    e.Date as event_date
                FROM stored_predictions sp
                JOIN events e ON sp.event_id = e.event_id
                LEFT JOIN prediction_outcomes po ON sp.prediction_id = po.prediction_id
                WHERE po.prediction_id IS NULL
                AND e.Date < datetime('now')
                ORDER BY e.Date DESC
            `);

            console.log(
                `Found ${predictions.length} predictions needing outcome verification`
            );

            for (const prediction of predictions) {
                console.log(
                    `Processing prediction for event: ${prediction.event_name}`
                );

                // Fetch event results from UFCStats
                const ufcStatsResults = await this.fetchEventFromUFCStats(
                    prediction.event_name,
                    prediction.event_date
                );

                if (!ufcStatsResults) {
                    console.log(`No results found for event: ${prediction.event_name}`);
                    continue;
                }

                // Process prediction outcomes
                const outcomes = await this.processPredictionOutcomes(prediction);

                if (!outcomes) {
                    console.log(
                        `Error processing outcomes for prediction ${prediction.prediction_id}`
                    );
                    continue;
                }

                // Store the outcomes
                await database.query(
                    `
                    INSERT INTO prediction_outcomes (
                        event_id,
                        prediction_id,
                        event_name,
                        event_date,
                        fight_result,
                        parlay_result,
                        prop_result,
                        outcome_verified
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `,
                    [
                        prediction.event_id,
                        prediction.prediction_id,
                        prediction.event_name,
                        prediction.event_date,
                        JSON.stringify(outcomes.fightResults),
                        JSON.stringify(outcomes.parlayResults),
                        JSON.stringify(outcomes.propResults),
                        true,
                    ]
                );

                console.log(
                    `Stored outcomes for prediction ${prediction.prediction_id}`
                );

                // Add delay to prevent rate limiting
                await new Promise((resolve) => setTimeout(resolve, 2000));
            }
        } catch (error) {
            console.error("Error updating prediction outcomes:", error);
            throw error;
        }
    }

    static async getEnhancedModelStats() {
        try {
            const stats = await database.query(`
                SELECT 
                    sp.model_used,
                    COUNT(DISTINCT sp.event_id) as events_analyzed,
                    -- Fight stats
                    SUM(CASE WHEN json_extract(fight_result, '$[*].correct') = 1 THEN 1 ELSE 0 END) as correct_fights,
                    COUNT(json_extract(fight_result, '$[*].correct')) as total_fights,
                    -- Parlay stats  
                    SUM(CASE WHEN json_extract(parlay_result, '$[*].correct') = 1 THEN 1 ELSE 0 END) as correct_parlays,
                    COUNT(json_extract(parlay_result, '$[*].correct')) as total_parlays,
                    -- Prop stats
                    SUM(CASE WHEN json_extract(prop_result, '$[*].correct') = 1 THEN 1 ELSE 0 END) as correct_props,
                    COUNT(json_extract(prop_result, '$[*].correct')) as total_props
                FROM stored_predictions sp
                JOIN prediction_outcomes po ON sp.prediction_id = po.prediction_id
                GROUP BY sp.model_used           
            `);

            return stats.map((stat) => ({
                model: stat.model_used,
                eventsAnalyzed: stat.events_analyzed,
                fights: {
                    correct: stat.correct_fights,
                    total: stat.total_fights,
                    accuracy:
                        stat.total_fights > 0
                            ? (stat.correct_fights / stat.total_fights) * 100
                            : 0,
                },
                parlays: {
                    correct: stat.correct_parlays,
                    total: stat.total_parlays,
                    accuracy:
                        stat.total_parlays > 0
                            ? (stat.correct_parlays / stat.total_parlays) * 100
                            : 0,
                },
                props: {
                    correct: stat.correct_props,
                    total: stat.total_props,
                    accuracy:
                        stat.total_props > 0
                            ? (stat.correct_props / stat.total_props) * 100
                            : 0,
                },
            }));
        } catch (error) {
            console.error("Error getting enhanced stats:", error);
            throw error;
        }
    }

    static createEnhancedStatsEmbed(stats) {
        const embed = new EmbedBuilder()
            .setColor("#0099ff")
            .setTitle("🤖 Fight Genie Performance Analysis")
            .setDescription("Comprehensive Fight Prediction Statistics");

        for (const stat of stats) {
            const modelName = stat.model.toUpperCase();
            const modelEmoji = stat.model === "gpt" ? "🧠" : "🤖";

            embed.addFields({
                name: `${modelEmoji} ${modelName} Performance`,
                value: [
                    `Events Analyzed: ${stat.eventsAnalyzed}`,
                    "",
                    "🥊 Fight Predictions:",
                    `├ Accuracy: ${stat.fights.accuracy.toFixed(1)}%`,
                    `└ Record: ${stat.fights.correct}/${stat.fights.total}`,
                    "",
                    "🎲 Parlay Predictions:",
                    `├ Accuracy: ${stat.parlays.accuracy.toFixed(1)}%`,
                    `└ Record: ${stat.parlays.correct}/${stat.parlays.total}`,
                    "",
                    "🎯 Prop Predictions:",
                    `├ Accuracy: ${stat.props.accuracy.toFixed(1)}%`,
                    `└ Record: ${stat.props.correct}/${stat.props.total}`,
                ].join("\n"),
                inline: false,
            });
        }

        embed.setFooter({
            text: "Fight Genie - Powered by AI",
            iconURL: "https://your-bot-icon-url.com", // Replace with your bot's icon URL
        });

        return embed;
    }

    static async handleModelStatsCommand(message) {
        try {
            const loadingEmbed = new EmbedBuilder()
                .setColor("#ffff00")
                .setTitle("📊 Loading Fight Genie Statistics")
                .setDescription("Fetching and analyzing prediction accuracy...");

            const loadingMsg = await message.reply({ embeds: [loadingEmbed] });

            // Update outcomes and get enhanced stats
            await this.updatePredictionOutcomes();
            const stats = await this.getEnhancedModelStats();
            const statsEmbed = this.createEnhancedStatsEmbed(stats);

            await loadingMsg.edit({ embeds: [statsEmbed] });
        } catch (error) {
            console.error("Error handling model stats command:", error);
            await message.reply(
                "An error occurred while fetching Fight Genie statistics."
            );
        }
    }
}

module.exports = ModelStatsCommand;
