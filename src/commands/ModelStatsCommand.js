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
            const loadingMsg = await message.reply("⌛ Analyzing fight results...");
    
            // Modified query to only get events that have started and have at least one completed fight
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
            `)
                
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
                        
                        const verifiedFights = fights.filter(fight => 
                            scrapedResults.some(r => 
                                (r.winner === fight.fighter1?.trim() && r.loser === fight.fighter2?.trim()) ||
                                (r.winner === fight.fighter2?.trim() && r.loser === fight.fighter1?.trim())
                            )
                        );
    
                        if (verifiedFights.length > 0) {
                            const results = {
                                event_id: event.event_id,
                                Event: event.Event,
                                Date: event.Date,
                                model: pred.model_used,
                                card_type: pred.card_type,
                                fights_predicted: verifiedFights.length,
                                correct_predictions: verifiedFights.filter(fight => {
                                    const result = scrapedResults.find(r => 
                                        (r.winner === fight.fighter1?.trim() && r.loser === fight.fighter2?.trim()) ||
                                        (r.winner === fight.fighter2?.trim() && r.loser === fight.fighter1?.trim())
                                    );
                                    return result && fight.predictedWinner?.trim() === result.winner;
                                }).length,
                                method_correct: verifiedFights.filter(fight => {
                                    const result = scrapedResults.find(r => 
                                        (r.winner === fight.fighter1?.trim() && r.loser === fight.fighter2?.trim()) ||
                                        (r.winner === fight.fighter2?.trim() && r.loser === fight.fighter1?.trim())
                                    );
                                    return result && result.method?.toLowerCase().includes(fight.method?.toLowerCase() || '');
                                }).length,
                                confidence_sum: verifiedFights.reduce((sum, fight) => sum + (Number(fight.confidence) || 0), 0)
                            };
                            allResults.push(results);
                        }
                    } catch (error) {
                        console.error(`Error processing prediction data:`, error);
                    }
                }
            }
    
            const modelStats = {};
            allResults.forEach(result => {
                if (!modelStats[result.model]) {
                    modelStats[result.model] = {
                        events: new Set(),
                        fights_predicted: 0,
                        correct_predictions: 0,
                        method_correct: 0,
                        confidence_sum: 0
                    };
                }
                
                modelStats[result.model].events.add(result.event_id);
                modelStats[result.model].fights_predicted += result.fights_predicted;
                modelStats[result.model].correct_predictions += result.correct_predictions;
                modelStats[result.model].method_correct += result.method_correct;
                modelStats[result.model].confidence_sum += result.confidence_sum;
            });
    
            const embed = new EmbedBuilder()
                .setColor("#0099ff")
                .setTitle("🤖 Fight Genie Model Analysis")
                .setDescription("Model Performance Comparison\nBased on completed fight predictions only\n\n━━━━━━━━━━━━━━━━━━━━━━")
                .setThumbnail("attachment://FightGenie_Logo_1.PNG");
    
                Object.entries(modelStats).forEach(([model, stats]) => {
                    const modelName = model === "gpt" ? "GPT-4" : "Claude";
                    const modelEmoji = model === "gpt" ? "🧠" : "🤖";
                    
                    const winRate = ((stats.correct_predictions / stats.fights_predicted) * 100).toFixed(1);
                    const methodAccuracy = ((stats.method_correct / stats.fights_predicted) * 100).toFixed(1);
                    const avgConfidence = (stats.confidence_sum / stats.fights_predicted).toFixed(1);
                
                    embed.addFields({
                        name: `${modelEmoji} ${modelName} Performance`,
                        value: [
                            `Events Analyzed: ${events.length}`,  // Simply use events.length here
                            `Fights Predicted: ${stats.fights_predicted}`,
                            `Win Rate: ${winRate}%`,
                            `Method Accuracy: ${methodAccuracy}%`,
                            `Average Confidence: ${avgConfidence}%`
                        ].join("\n"),
                        inline: true
                    });
                });

            // Event selection dropdown setup
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
                .setPlaceholder("View Event Predictions")
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
            await message.reply("Error retrieving Fight Genie statistics. Please try again.");
        }
    }  static async processEventPredictions(event, predictions, scrapedResults) {
    const eventResults = [];

    for (const pred of predictions) {
      try {
        const predictionData = JSON.parse(pred.prediction_data);
        const fights = predictionData.fights;

        let results = {
          event_id: event.event_id,
          Event: event.Event,
          Date: event.Date,
          model: pred.model_used,
          card_type: pred.card_type,
          fight_details: [], // Store only actual verified fights
        };

        for (const fight of fights) {
          const matchingResult = scrapedResults.find(
            (r) =>
              (r.winner === fight.fighter1?.trim() &&
                r.loser === fight.fighter2?.trim()) ||
              (r.winner === fight.fighter2?.trim() &&
                r.loser === fight.fighter1?.trim())
          );

          if (matchingResult) {
            // Only add fights that have actual results
            results.fight_details.push({
              fighters: `${fight.fighter1} vs ${fight.fighter2}`,
              prediction: {
                winner: fight.predictedWinner,
                method: fight.method,
                confidence: Number(fight.confidence) || 0,
              },
              actual: {
                winner: matchingResult.winner,
                method: matchingResult.method,
              },
              isCorrect:
                fight.predictedWinner?.trim() === matchingResult.winner,
              isMethodCorrect: matchingResult.method
                ?.toLowerCase()
                .includes(fight.method?.toLowerCase() || ""),
            });
          }
        }

        if (results.fight_details.length > 0) {
          eventResults.push(results);
        }
      } catch (error) {
        console.error(`Error processing prediction for ${event.Event}:`, error);
      }
    }

    return eventResults;
  }

  static async handleHistoricalView(interaction) {
    try {
      await interaction.deferReply({ ephemeral: true });

      const [_, eventId, timestamp] = interaction.values[0].split("_");

      // Get event details and predictions
      const event = await database.query(
        `
            SELECT e.*
            FROM events e
            WHERE e.event_id = ?
        `,
        [eventId]
      );

      if (!event?.length) {
        await interaction.editReply("Event not found");
        return;
      }

      // Check if event is in the future or today
      const eventDate = new Date(event[0].Date);
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      if (eventDate >= today) {
        await interaction.editReply(
          "Results not yet available - event has not occurred"
        );
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

      // Get actual results
      const scrapedResults = await this.scrapeEventResults(event[0].event_link);
      if (!scrapedResults?.length) {
        await interaction.editReply("No results found for this event");
        return;
      }

      const embed = new EmbedBuilder()
        .setColor("#0099ff")
        .setTitle(`📊 ${event[0].Event}`)
        .setDescription(
          `Detailed Fight Predictions and Results\n${new Date(
            event[0].Date
          ).toLocaleDateString()}`
        )
        .setThumbnail("attachment://FightGenie_Logo_1.PNG");

      for (const pred of predictions) {
        try {
          const predictionData = JSON.parse(pred.prediction_data);
          const modelEmoji = pred.model_used === "gpt" ? "🧠" : "🤖";
          const modelName = pred.model_used === "gpt" ? "GPT-4" : "Claude";
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

              return {
                fighters: `${fight.fighter1} vs ${fight.fighter2}`,
                prediction: {
                  winner: fight.predictedWinner,
                  method: fight.method,
                  confidence: fight.confidence,
                },
                actual: {
                  winner: matchingResult.winner,
                  method: matchingResult.method,
                },
                isCorrect:
                  fight.predictedWinner?.trim() === matchingResult.winner,
                isMethodCorrect: matchingResult.method
                  ?.toLowerCase()
                  .includes(fight.method?.toLowerCase() || ""),
              };
            })
            .filter(Boolean);

          const correctCount = fightResults.filter((f) => f.isCorrect).length;

          embed.addFields({
            name: `${modelEmoji} ${modelName} - ${cardType} (${correctCount}/${fightResults.length} correct)`,
            value:
              fightResults
                .map((fight) => {
                  const resultEmoji = fight.isCorrect ? "✅" : "❌";
                  const methodEmoji = fight.isMethodCorrect ? "🎯" : "📌";
                  return [
                    `${resultEmoji} ${fight.fighters}`,
                    `└ Predicted: ${fight.prediction.winner} by ${fight.prediction.method} (${fight.prediction.confidence}%)`,
                    `└ Actual: ${fight.actual.winner} by ${fight.actual.method}`,
                  ].join("\n");
                })
                .join("\n\n") || "No verified fights found",
            inline: false,
          });
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

  static async processDetailedFightResults(predictions, actualResults) {
    return predictions
      .map((fight) => {
        const matchingResult = actualResults.find(
          (r) =>
            (r.winner === fight.fighter1?.trim() &&
              r.loser === fight.fighter2?.trim()) ||
            (r.winner === fight.fighter2?.trim() &&
              r.loser === fight.fighter1?.trim())
        );

        if (!matchingResult) return null;

        return {
          fighters: `${fight.fighter1} vs ${fight.fighter2}`,
          prediction: {
            winner: fight.predictedWinner,
            method: fight.method,
            confidence: fight.confidence,
          },
          actual: {
            winner: matchingResult.winner,
            method: matchingResult.method,
          },
          isCorrect: fight.predictedWinner?.trim() === matchingResult.winner,
          isMethodCorrect: matchingResult.method
            ?.toLowerCase()
            .includes(fight.method?.toLowerCase() || ""),
        };
      })
      .filter(Boolean);
  }

  static async scrapeEventResults(eventLink) {
    try {
      if (!eventLink) return null;

      console.log(`Scraping results from: ${eventLink}`);
      const response = await axios.get(eventLink);
      const $ = cheerio.load(response.data);
      const results = [];

      $(".b-fight-details__table-body tr").each((_, row) => {
        try {
          const $row = $(row);
          const fighters = $row.find(".b-link.b-link_style_black");
          const methodText = $row
            .find('.b-fight-details__table-text:contains("Won by")')
            .next()
            .text()
            .trim();

          if (fighters.length >= 2) {
            const winner = $(fighters[0]).text().trim();
            const loser = $(fighters[1]).text().trim();

            if (winner && loser) {
              results.push({
                winner,
                loser,
                method: methodText || "Decision",
              });
            }
          }
        } catch (innerError) {
          console.error("Error processing fight row:", innerError);
        }
      });

      return results;
    } catch (error) {
      console.error("Error scraping event results:", error);
      return null;
    }
  }
}

module.exports = ModelStatsCommand;
