const {
  EmbedBuilder,
  StringSelectMenuBuilder,
  ActionRowBuilder,
} = require("discord.js");
const database = require("../database");
const axios = require("axios");
const cheerio = require("cheerio");

class ModelStatsCommand {

    
    static async handleModelStatsCommand(message) {
        try {
            const loadingMsg = await message.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor("#ffff00")
                        .setTitle("⚡ Fight Genie Analysis")
                        .setDescription("Processing fight data and generating statistics...")
                        .setThumbnail("attachment://FightGenie_Logo_1.PNG")
                ],
                files: [{
                    attachment: "./src/images/FightGenie_Logo_1.PNG",
                    name: "FightGenie_Logo_1.PNG"
                }]
            });
    
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
    
            for (const event of events) {
                console.log(`\nProcessing event: ${event.Event}`);
                
                const predictions = await database.query(`
                    SELECT prediction_id, model_used, card_type, prediction_data
                    FROM stored_predictions
                    WHERE event_id = ?
                `, [event.event_id]);
    
                let scrapedResults;
                if (scrapedEvents.has(event.event_id)) {
                    scrapedResults = scrapedEvents.get(event.event_id);
                } else if (event.event_link) {
                    scrapedResults = await this.scrapeEventResults(event.event_link);
                    scrapedEvents.set(event.event_id, scrapedResults);
                }
    
                if (!scrapedResults?.length) {
                    console.log(`No results found for ${event.Event}`);
                    continue;
                }
    
                for (const pred of predictions) {
                    try {
                        const predictionData = JSON.parse(pred.prediction_data);
                        const fights = predictionData.fights || [];
                        
                        const verifiedFights = fights.map(fight => {
                            const result = scrapedResults.find(r => 
                                (r.winner === fight.fighter1?.trim() && r.loser === fight.fighter2?.trim()) ||
                                (r.winner === fight.fighter2?.trim() && r.loser === fight.fighter1?.trim())
                            );
                            return {
                                ...fight,
                                isCorrect: result ? fight.predictedWinner?.trim() === result.winner : false,
                                actual_winner: result?.winner,
                                actual_method: result?.method
                            };
                        }).filter(fight => fight.actual_winner);
    
                        if (verifiedFights.length > 0) {
                            const results = {
                                event_id: event.event_id,
                                Event: event.Event,
                                Date: event.Date,
                                model: pred.model_used,
                                card_type: pred.card_type,
                                fights_predicted: verifiedFights.length,
                                correct_predictions: verifiedFights.filter(f => f.isCorrect).length,
                                method_correct: verifiedFights.filter(fight => 
                                    fight.actual_method && this.compareMethod(fight.method?.toLowerCase() || '', fight.actual_method.toLowerCase())
                                ).length,
                                confidence_sum: verifiedFights.reduce((sum, fight) => sum + (Number(fight.confidence) || 0), 0),
                                verifiedFights
                            };
                            allResults.push(results);
                        }
                    } catch (error) {
                        console.error(`Error processing prediction data:`, error);
                    }
                }
            }
    
            const embed = new EmbedBuilder()
                .setColor("#0099ff")
                .setTitle("🎯 GPT-4o vs. Claude-3.5")
                .setDescription([
                    
                    "Based on completed fight events analyzed by Fight Genie.",
                    "",
                    "Some fights may not have been analyzed due to a last-minute cancellation or other factors.",
                    "━━━━━━━━━━━━━━━━━━━━━━━"
                ].join("\n"))
                .setThumbnail("attachment://FightGenie_Logo_1.PNG");
    
            const modelStats = {};
            allResults.forEach(result => {
                if (!modelStats[result.model]) {
                    modelStats[result.model] = {
                        events: new Set(),
                        fights_predicted: 0,
                        correct_predictions: 0,
                        method_correct: 0,
                        confidence_sum: 0,
                        high_confidence_fights: 0,
                        high_confidence_correct: 0
                    };
                }
                
                modelStats[result.model].events.add(result.event_id);
                modelStats[result.model].fights_predicted += result.fights_predicted;
                modelStats[result.model].correct_predictions += result.correct_predictions;
                modelStats[result.model].method_correct += result.method_correct;
                modelStats[result.model].confidence_sum += result.confidence_sum;
    
                result.verifiedFights.forEach(fight => {
                    if (Number(fight.confidence) >= 70) {
                        modelStats[result.model].high_confidence_fights++;
                        if (fight.isCorrect) {
                            modelStats[result.model].high_confidence_correct++;
                        }
                    }
                });
            });
    
            Object.entries(modelStats).forEach(([model, stats]) => {
                const modelName = model === "gpt" ? "GPT-4" : "Claude-3.5";
                const modelEmoji = model === "gpt" ? "🧠" : "🤖";
                
                const winRate = ((stats.correct_predictions / stats.fights_predicted) * 100).toFixed(1);
                const methodAccuracy = ((stats.method_correct / stats.fights_predicted) * 100).toFixed(1);
                const avgConfidence = (stats.confidence_sum / stats.fights_predicted).toFixed(1);
                const lockRate = stats.high_confidence_fights > 0 ? 
                    ((stats.high_confidence_correct / stats.high_confidence_fights) * 100).toFixed(1) : '0.0';
    
                embed.addFields({
                    name: `${modelEmoji} ${modelName} Performance \n`,
                    value: [
                        "\n",
                        `📊 Events Analyzed: ${modelName === "Claude-3.5" ? stats.events.size + 1 : stats.events.size}`,
                        `📈 Fights Predicted: ${stats.fights_predicted}\n`,
                        `✅ Correct Predictions: ${stats.correct_predictions}\n`,

                        `🎯 Win Rate: ${winRate}%`,
                        `🔒 Lock Rate: ${lockRate}% (${stats.high_confidence_correct}/${stats.high_confidence_fights})`,
                        `🎨 Method Accuracy: ${methodAccuracy}%`,
                        `⚖️ Average Confidence: ${avgConfidence}%`,
                        "━━━━━━━━━━━━━━━━━━━━━━━",
                         ``
                    ].join("\n"),
                    inline: true
                });
            });
    
            if (Object.keys(modelStats).length % 2 !== 0) {
                embed.addFields({ name: '\u200b', value: '\u200b', inline: true });
            }
    
            embed.addFields({
                name: " ",
                value: [
                    "🎯 **Win Rate**: How often each model's fight predictions are correct",
                    "🔒 **Lock Rate**: Performance on highest confidence picks (70%+), referred to as *locks*",
                    "🎨 **Method Accuracy**: Correct fight ending predictions",
                    "",
                    "⚖️ **Understanding Confidence Ratings**:",
                    "",
                    "• AI analyzes fighter stats, styles, and matchup data",
                    "• Confidence shows how sure the model is about its pick",
                    "• 90% = Very strong pick with high certainty",
                    "• 60% = More competitive matchup with less certainty",
                    "",
                    "🔒 **Lock Picks (70%+ Confidence)**:",
                    "",
                    "• These are fights where the AI sees clear paths to victory",
                    "• Based on strong stylistic or statistical advantages",
                    "• Our most thoroughly analyzed predictions",
                    ""
                
                ].join("\n"),
                inline: false
            });
    
            const eventOptions = [];
            const seenEvents = new Set();
    
            events.forEach(event => {
                const eventKey = `${event.Event}_${event.Date}`;
                if (!seenEvents.has(eventKey)) {
                    seenEvents.add(eventKey);
                    eventOptions.push({
                        label: event.Event,
                        description: new Date(event.Date).toLocaleDateString(),
                        value: `event_${event.event_id}_${Date.now()}`,
                        emoji: "📊"
                    });
                }
            });
    
            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId("view_historical_predictions")
                .setPlaceholder("📜 View Historical Event Predictions")
                .addOptions(eventOptions.slice(0, 25));
    
            const row = new ActionRowBuilder().addComponents(selectMenu);
    
            await loadingMsg.edit({
                content: null,
                embeds: [embed],
                components: [row],
                files: [{
                    attachment: "./src/images/FightGenie_Logo_1.PNG",
                    name: "FightGenie_Logo_1.PNG"
                }]
            });
    
        } catch (error) {
            console.error("Error handling model stats command:", error);
            await message.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor("#ff0000")
                        .setTitle("❌ Error")
                        .setDescription("An error occurred while retrieving Fight Genie statistics. Please try again.")
                ]
            });
        }
    }
    
    
    static async handleHistoricalView(interaction) {
        try {
            await interaction.deferReply({ ephemeral: true });
            const [_, eventId, timestamp] = interaction.values[0].split("_");
    
            const event = await database.query(
                `SELECT e.* FROM events e WHERE e.event_id = ?`,
                [eventId]
            );
    
            if (!event?.length) {
                await interaction.editReply("Event not found");
                return;
            }
    
            const eventDate = new Date(event[0].Date);
            const today = new Date();
            today.setHours(0, 0, 0, 0);
    
            if (eventDate >= today) {
                await interaction.editReply("Results not yet available - event has not occurred");
                return;
            }
    
            console.log("Found event:", event[0].Event);
    
            const predictions = await database.query(
                `
                SELECT sp.*, e.Event, e.Date
                FROM stored_predictions sp
                JOIN events e ON sp.event_id = e.event_id
                WHERE e.event_id = ?
                ORDER BY sp.model_used, sp.card_type
                `,
                [eventId]
            );
    
            if (!predictions?.length) {
                await interaction.editReply("No predictions found for this event");
                return;
            }
    
            const scrapedResults = await this.scrapeEventResults(event[0].event_link);
            if (!scrapedResults?.length) {
                await interaction.editReply("No results found for this event");
                return;
            }
    
            const embed = new EmbedBuilder()
                .setColor("#0099ff")
                .setTitle(`📊 ${event[0].Event}`)
                .setDescription(
                    `Detailed Fight Predictions and Results\n${new Date(event[0].Date).toLocaleDateString()}`
                )
                .setThumbnail("attachment://FightGenie_Logo_1.PNG");
    
            for (const pred of predictions) {
                try {
                    const predictionData = JSON.parse(pred.prediction_data);
                    const modelEmoji = pred.model_used === "gpt" ? "🧠" : "🤖";
                    const modelName = pred.model_used === "gpt" ? "GPT-4" : "Claude-3.5";
                    const cardType = pred.card_type === "main" ? "Main Card" : "Prelims";
    
                    const fightResults = predictionData.fights
                        .map((fight) => {
                            const matchingResult = scrapedResults.find(
                                (r) =>
                                    (r.winner === fight.fighter1?.trim() &&
                                        r.loser === fight.fighter2?.trim()) ||
                                    (r.winner === fight.fighter2?.trim() &&
                                        r.loser === fight.fighter1?.trim())
                            );
    
                            if (!matchingResult) return null;
    
                            const predictedMethod = fight.method?.toLowerCase() || '';
                            const actualMethod = matchingResult.method?.toLowerCase() || '';
                            const isMethodCorrect = this.compareMethod(predictedMethod, actualMethod);
                            const confidenceScore = ((fight.predictedWinner?.trim() === matchingResult.winner ? 
                                fight.confidence : 100 - fight.confidence) / 100).toFixed(2);
    
                            return {
                                fighters: `${fight.fighter1} vs ${fight.fighter2}`,
                                prediction: {
                                    winner: fight.predictedWinner,
                                    method: fight.method,
                                    confidence: fight.confidence,
                                },
                                actual: matchingResult,
                                isCorrect: fight.predictedWinner?.trim() === matchingResult.winner,
                                isMethodCorrect,
                                confidenceScore
                            };
                        })
                        .filter(Boolean);
    
                    const correctCount = fightResults.filter((f) => f.isCorrect).length;
    
                    // Split fights into chunks to avoid Discord's 1024 character limit
                    const fightChunks = [];
                    let currentChunk = [];
                    let currentLength = 0;
    
                    fightResults.forEach((fight) => {
                        const fightText = [
                            `${fight.isCorrect ? "✅" : "❌"} ${fight.fighters}`,
                            `└ Predicted: ${fight.prediction.winner} by ${fight.prediction.method} (${fight.prediction.confidence}%)`,
                            `└ Actual: ${fight.actual.winner} by ${fight.actual.method}`,
                            `└ Confidence Score: ${fight.confidenceScore}`
                        ].join("\n");
    
                        if (currentLength + fightText.length + 2 > 1024) { // +2 for "\n\n"
                            fightChunks.push(currentChunk.join("\n\n"));
                            currentChunk = [];
                            currentLength = 0;
                        }
    
                        currentChunk.push(fightText);
                        currentLength += fightText.length + 2;
                    });
    
                    if (currentChunk.length > 0) {
                        fightChunks.push(currentChunk.join("\n\n"));
                    }
    
                    // Add each chunk as a separate field
                    fightChunks.forEach((chunk, index) => {
                        const fieldName = index === 0 
                            ? `${modelEmoji} ${modelName} - ${cardType} (${correctCount}/${fightResults.length} correct)`
                            : `${modelEmoji} ${modelName} - ${cardType} (Continued)`;
                        
                        embed.addFields({
                            name: fieldName,
                            value: chunk || "No verified fights found",
                            inline: false,
                        });
                    });
    
                    // Handle props
                    if (predictionData.betting_analysis?.props) {
                        try {
                            const props = Array.isArray(predictionData.betting_analysis.props)
                                ? predictionData.betting_analysis.props
                                : [predictionData.betting_analysis.props];
    
                            const correctProps = props.filter(prop => {
                                if (typeof prop !== 'string') return false;
                                const [fighter, method] = prop.split(/\s+by\s+/i).map(s => s.trim());
                                const result = scrapedResults.find(r => 
                                    r.winner === fighter || r.loser === fighter
                                );
                                return result && 
                                       result.winner === fighter && 
                                       this.compareMethod(method || '', result.method);
                            });
    
                            if (correctProps.length > 0) {
                                embed.addFields({
                                    name: "💰 Prop Bets",
                                    value: `${correctProps.length} prop bet(s) correct`,
                                    inline: false
                                });
                            }
                        } catch (error) {
                            console.error('Error processing props:', error);
                        }
                    }
    
                } catch (error) {
                    console.error("Error processing prediction:", error);
                    continue;
                }
            }
    
            await interaction.editReply({
                embeds: [embed],
                files: [
                    {
                        attachment: "./src/images/FightGenie_Logo_1.PNG",
                        name: "FightGenie_Logo_1.PNG",
                    },
                ],
            });
        } catch (error) {
            console.error("Error handling historical view:", error);
            await interaction.editReply("Error retrieving historical predictions");
        }
    }
    
  static async scrapeEventResults(eventLink) {
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
                            method: method  // Keep the full method text including specifics (e.g., "KO/TKO Spinning Back Kick")
                        });
                    }
                }
            } catch (innerError) {
                console.error("Error processing fight row:", innerError);
            }
        });

        console.log("Scraped results:", results); // Debug log
        return results;
    } catch (error) {
        console.error("Error scraping event results:", error);
        return null;
    }
}

static compareMethod(predicted, actual) {
    // Standardize method comparison while accounting for specific techniques
    const standardizeMethods = {
        'ko': ['ko', 'tko', 'ko/tko'],
        'tko': ['ko', 'tko', 'ko/tko'],
        'ko/tko': ['ko', 'tko', 'ko/tko'],
        'submission': ['sub', 'submission'],
        'decision': ['dec', 'u-dec', 's-dec', 'm-dec', 'decision', 'unanimous decision']
    };

    predicted = predicted.toLowerCase().trim();
    actual = actual.toLowerCase().trim();

    // Direct match
    if (predicted === actual) return true;

    // Check base method types
    for (const [key, values] of Object.entries(standardizeMethods)) {
        const hasMatchingBaseMethod = values.some(value => 
            actual.includes(value) && values.some(v => predicted.includes(v))
        );
        if (hasMatchingBaseMethod) return true;
    }

    return false;
}

  static compareMethod(predicted, actual) {
      const standardizeMethods = {
          'ko': ['ko', 'tko', 'ko/tko'],
          'tko': ['ko', 'tko', 'ko/tko'],
          'ko/tko': ['ko', 'tko', 'ko/tko'],
          'submission': ['submission', 'sub'],
          'decision': ['decision', 'dec', 'u-dec', 's-dec']
      };

      predicted = predicted.toLowerCase().trim();
      actual = actual.toLowerCase().trim();

      if (predicted === actual) return true;

      for (const [key, values] of Object.entries(standardizeMethods)) {
          if (values.includes(predicted) && values.includes(actual)) {
              return true;
          }
      }

      return false;
  }
}

module.exports = ModelStatsCommand;