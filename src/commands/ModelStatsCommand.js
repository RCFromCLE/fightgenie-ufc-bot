const {
    EmbedBuilder,
    StringSelectMenuBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require("discord.js");
  
  const database = require("../database");
  
  const axios = require("axios");
  
  const cheerio = require("cheerio");
  
  
  
  class ModelStatsCommand {
  
  
  
      
  
      static async handleModelStatsCommand(interaction) {
  
          try {
  
              // The interaction is already deferred, so use editReply
            await interaction.editReply({
  
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
  
                  -- Only include events that have already occurred (exclude future events)
                  AND Date < date('now')
  
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
  
                  .setTitle("👑 GPT vs. Claude")
  
                  .setDescription([
  
                      "Who will be crowned the UFC fight prediction champ?",
  
                      "━━━━━━━━━━━━━━━━━━━━━━━"
  
                  ].join("\n"))
  
                  .setThumbnail("attachment://FightGenie_Logo_1.PNG");
  
      
  
              const modelStats = {};
              let totalDoubleLocks = 0;
              let correctDoubleLocks = 0;
              const processedDoubleLocks = new Set(); // To avoid double counting if processing main/prelims separately

              // --- Process results to calculate Double Lock stats ---
              const resultsByEvent = allResults.reduce((acc, result) => {
                  if (!acc[result.event_id]) {
                      acc[result.event_id] = { Event: result.Event, Date: result.Date, predictions: [] };
                  }
                  acc[result.event_id].predictions.push(result);
                  return acc;
              }, {});

              for (const eventId in resultsByEvent) {
                  const eventData = resultsByEvent[eventId];
                  const predictions = eventData.predictions;
                  const fightsInEvent = {};

                  // Group fights within the event
                  predictions.forEach(predResult => {
                      predResult.verifiedFights.forEach(fight => {
                          const fightKey = [fight.fighter1, fight.fighter2].sort().join('_vs_');
                          if (!fightsInEvent[fightKey]) {
                              fightsInEvent[fightKey] = { fighter1: fight.fighter1, fighter2: fight.fighter2, models: {}, actual_winner: fight.actual_winner };
                          }
                          fightsInEvent[fightKey].models[predResult.model] = {
                              predictedWinner: fight.predictedWinner,
                              confidence: fight.confidence
                          };
                      });
                  });

                  // Check for double locks in this event
                  for (const fightKey in fightsInEvent) {
                      const fightData = fightsInEvent[fightKey];
                      const gptPred = fightData.models['gpt'];
                      const claudePred = fightData.models['claude'];
                      const lockKey = `${eventId}_${fightKey}`; // Unique key per event/fight

                      if (gptPred && claudePred && !processedDoubleLocks.has(lockKey)) {
                          if (gptPred.predictedWinner === claudePred.predictedWinner &&
                              gptPred.confidence >= 75 &&
                              claudePred.confidence >= 75)
                          {
                              totalDoubleLocks++;
                              processedDoubleLocks.add(lockKey); // Mark as processed
                              if (gptPred.predictedWinner === fightData.actual_winner) {
                                  correctDoubleLocks++;
                              }
                          }
                      }
                  }
              }
              // --- End Double Lock Calculation ---


              allResults.forEach(result => {
                  const modelKey = result.model; // Use modelKey consistently
                  if (!modelStats[modelKey]) { // Use modelKey
  
                      modelStats[result.model] = {
  
                          events: new Set(),
  
                          fights_predicted: 0,
  
                          correct_predictions: 0,
  
                          method_correct: 0,
  
                          confidence_sum: 0,
  
                          high_confidence_fights: 0,
  
                          high_confidence_correct: 0
  
                      };
  
                      modelStats[modelKey] = { // Use modelKey
                          events: new Set(),
                          fights_predicted: 0,
                          correct_predictions: 0,
                          method_correct: 0,
                          confidence_sum: 0,
                          high_confidence_fights: 0, // This is for individual model locks (>=75%)
                          high_confidence_correct: 0
                      };
                  }

                  const stats = modelStats[modelKey]; // Use modelKey and assign to stats

                  stats.events.add(result.event_id);
                  stats.fights_predicted += result.fights_predicted;
                  stats.correct_predictions += result.correct_predictions;
                  stats.method_correct += result.method_correct;
                  stats.confidence_sum += result.confidence_sum;
  
      
                  // Calculate individual model lock rate (>=75%)
                  result.verifiedFights.forEach(fight => {
                      if (Number(fight.confidence) >= 75) { // Use 75% for lock definition
                          stats.high_confidence_fights++;
                          if (fight.isCorrect) {
                              stats.high_confidence_correct++;
  
                          }
  
                      }
  
                  });
  
              });
  
      
  
              Object.entries(modelStats).forEach(([model, stats]) => {
  
                  const modelName = model === "gpt" ? "GPT" : "Claude"; // Keep consistent naming
                  const modelEmoji = model === "gpt" ? "🧠" : "🤖";

  
                  const winRate = ((stats.correct_predictions / stats.fights_predicted) * 100).toFixed(1);
  
                  const methodAccuracy = ((stats.method_correct / stats.fights_predicted) * 100).toFixed(1);
  
                  const avgConfidence = (stats.confidence_sum / stats.fights_predicted).toFixed(1);
  
                  // Use 75% for lock rate calculation display
                  const lockRate = stats.high_confidence_fights > 0 ?
                      ((stats.high_confidence_correct / stats.high_confidence_fights) * 100).toFixed(1) : '0.0';

  
                  embed.addFields({
  
                      name: `${modelEmoji} ${modelName} Performance \n`,
  
                      value: [
  
                          "\n",
  
                          `📊 Events Analyzed: ${modelName === "Claude" ? stats.events.size + 1 : stats.events.size}`,
  
                          `📈 Fights Predicted: ${stats.fights_predicted}\n`,
  
                          `✅ Correct Predictions: ${stats.correct_predictions}\n`,
  
  
  
                          `🎯 Win Rate: ${winRate}%`,
                          `🔒 Lock Rate (>=75%): ${lockRate}% (${stats.high_confidence_correct}/${stats.high_confidence_fights})`, // Clarify lock threshold
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

              // --- Add Double Lock Stats Field ---
              const doubleLockRate = totalDoubleLocks > 0 ? ((correctDoubleLocks / totalDoubleLocks) * 100).toFixed(1) : '0.0';
              embed.addFields({
                  name: `🔒 Double Lock Performance (GPT & Claude >=75%)`,
                  value: `Accuracy: **${doubleLockRate}%** (${correctDoubleLocks}/${totalDoubleLocks})`,
                  inline: false // Display prominently
              });
              embed.addFields({ name: '\u200b', value: '━━━━━━━━━━━━━━━━━━━━━━━' }); // Separator
              // --- End Double Lock Stats Field ---

              // --- Add Top 10 Events Rankings ---
              // Calculate accuracy for each event/model combination
              const eventPerformance = allResults.map(result => ({
                  event: result.Event,
                  date: result.Date,
                  model: result.model,
                  accuracy: ((result.correct_predictions / result.fights_predicted) * 100).toFixed(1),
                  correct: result.correct_predictions,
                  total: result.fights_predicted,
                  cardType: result.card_type,
                  eventId: result.event_id
              }));

              // Create combined Main + Prelims rankings
              const combinedByEvent = {};
              eventPerformance.forEach(perf => {
                  const key = `${perf.model}_${perf.eventId}`;
                  if (!combinedByEvent[key]) {
                      combinedByEvent[key] = {
                          event: perf.event,
                          date: perf.date,
                          model: perf.model,
                          correct: 0,
                          total: 0
                      };
                  }
                  combinedByEvent[key].correct += perf.correct;
                  combinedByEvent[key].total += perf.total;
              });

              const combinedPerformance = Object.values(combinedByEvent).map(e => ({
                  ...e,
                  accuracy: ((e.correct / e.total) * 100).toFixed(1)
              }));

              // Sort combined rankings by model
              const gptCombined = combinedPerformance
                  .filter(e => e.model === 'gpt')
                  .sort((a, b) => parseFloat(b.accuracy) - parseFloat(a.accuracy))
                  .slice(0, 10);

              const claudeCombined = combinedPerformance
                  .filter(e => e.model === 'claude')
                  .sort((a, b) => parseFloat(b.accuracy) - parseFloat(a.accuracy))
                  .slice(0, 10);

              // Group by model and card type
              const gptMain = eventPerformance
                  .filter(e => e.model === 'gpt' && e.cardType === 'main')
                  .sort((a, b) => parseFloat(b.accuracy) - parseFloat(a.accuracy))
                  .slice(0, 10);

              const gptPrelims = eventPerformance
                  .filter(e => e.model === 'gpt' && e.cardType === 'prelims')
                  .sort((a, b) => parseFloat(b.accuracy) - parseFloat(a.accuracy))
                  .slice(0, 10);

              const claudeMain = eventPerformance
                  .filter(e => e.model === 'claude' && e.cardType === 'main')
                  .sort((a, b) => parseFloat(b.accuracy) - parseFloat(a.accuracy))
                  .slice(0, 10);

              const claudePrelims = eventPerformance
                  .filter(e => e.model === 'claude' && e.cardType === 'prelims')
                  .sort((a, b) => parseFloat(b.accuracy) - parseFloat(a.accuracy))
                  .slice(0, 10);

              // Add GPT Combined (Main + Prelims) rankings
              if (gptCombined.length > 0) {
                  embed.addFields({
                      name: "🧠 GPT Top 10 Best Events (Main + Prelims Combined)",
                      value: gptCombined.map((e, i) => 
                          `${i + 1}. ${e.event}\n   └ ${e.accuracy}% (${e.correct}/${e.total}) - ${new Date(e.date).toLocaleDateString()}`
                      ).join('\n') || "No events available",
                      inline: false
                  });
              }

              // Add GPT Main Card rankings
              if (gptMain.length > 0) {
                  embed.addFields({
                      name: "🧠 GPT Top 10 Main Card Events",
                      value: gptMain.map((e, i) => 
                          `${i + 1}. ${e.event}\n   └ ${e.accuracy}% (${e.correct}/${e.total}) - ${new Date(e.date).toLocaleDateString()}`
                      ).join('\n') || "No events available",
                      inline: true
                  });
              }

              // Add GPT Prelims rankings
              if (gptPrelims.length > 0) {
                  embed.addFields({
                      name: "🧠 GPT Top 10 Prelim Events",
                      value: gptPrelims.map((e, i) => 
                          `${i + 1}. ${e.event}\n   └ ${e.accuracy}% (${e.correct}/${e.total}) - ${new Date(e.date).toLocaleDateString()}`
                      ).join('\n') || "No events available",
                      inline: true
                  });
              }

              // Add Claude Combined (Main + Prelims) rankings
              if (claudeCombined.length > 0) {
                  embed.addFields({
                      name: "🤖 Claude Top 10 Best Events (Main + Prelims Combined)",
                      value: claudeCombined.map((e, i) => 
                          `${i + 1}. ${e.event}\n   └ ${e.accuracy}% (${e.correct}/${e.total}) - ${new Date(e.date).toLocaleDateString()}`
                      ).join('\n') || "No events available",
                      inline: false
                  });
              }

              // Add Claude Main Card rankings
              if (claudeMain.length > 0) {
                  embed.addFields({
                      name: "🤖 Claude Top 10 Main Card Events",
                      value: claudeMain.map((e, i) => 
                          `${i + 1}. ${e.event}\n   └ ${e.accuracy}% (${e.correct}/${e.total}) - ${new Date(e.date).toLocaleDateString()}`
                      ).join('\n') || "No events available",
                      inline: true
                  });
              }

              // Add Claude Prelims rankings
              if (claudePrelims.length > 0) {
                  embed.addFields({
                      name: "🤖 Claude Top 10 Prelim Events",
                      value: claudePrelims.map((e, i) => 
                          `${i + 1}. ${e.event}\n   └ ${e.accuracy}% (${e.correct}/${e.total}) - ${new Date(e.date).toLocaleDateString()}`
                      ).join('\n') || "No events available",
                      inline: true
                  });
              }

              embed.addFields({ name: '\u200b', value: '━━━━━━━━━━━━━━━━━━━━━━━' }); // Separator
              // --- End Top 10 Events Rankings ---

              embed.addFields({
  
                  name: " ",
  
                  value: [
  
                      "🎯 **Win Rate**: How often each model's fight predictions are correct",
  
                      "",
  
                      "🔒 **Lock Rate**: Performance on each model's high confidence picks (>=75%)", // Clarified definition
                      "",
                      "🔒 **Double Lock**: Fights where BOTH models predict the same winner with >=75% confidence", // Added definition
                      "",
                      "🎨 **Method Accuracy**: Correct fight ending predictions (KO/TKO, Sub, Decision)", // Clarified
  
                      "",
  
                      "⚖️ **Understanding Confidence Ratings**:",
  
                      "• AI analyzes fighter stats, styles, and matchup data",
  
                      "• Confidence shows how sure the model is about its pick",
  
                      "• 90% = Very strong pick with high certainty",
  
                      "• 60% = More competitive matchup with less certainty",
  
                      "",
  
                      "🔒 **Lock Picks (75%+ Confidence)**:",
  
                      "• These are fights where the AI sees clear paths to victory",
  
                      "• Based on strong stylistic or statistical advantages",
  
                      "• Our most thoroughly analyzed predictions",
  
                      "",
  
                      "*Based on completed fight events analyzed by Fight Genie. Some fights may not have been analyzed due to a last-minute cancellation or other factors.*",
  
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
  
      
              // Pagination for events (25 per page due to Discord limit)
              const currentPage = 0;
              const eventsPerPage = 25;
              const totalPages = Math.ceil(eventOptions.length / eventsPerPage);
              const startIndex = currentPage * eventsPerPage;
              const endIndex = startIndex + eventsPerPage;
              const currentPageOptions = eventOptions.slice(startIndex, endIndex);

              const selectMenu = new StringSelectMenuBuilder()
  
                  .setCustomId("view_historical_predictions")
  
                  .setPlaceholder(`📜 View Historical Event Predictions (Page ${currentPage + 1}/${totalPages})`)
  
                  .addOptions(currentPageOptions);
  
      
              const selectRow = new ActionRowBuilder().addComponents(selectMenu);

              // Add pagination buttons if there are multiple pages
              const components = [selectRow];
              if (totalPages > 1) {
                  const buttonRow = new ActionRowBuilder().addComponents(
                      new ButtonBuilder()
                          .setCustomId(`events_page_prev_0`)
                          .setLabel('◀ Previous')
                          .setStyle(ButtonStyle.Secondary)
                          .setDisabled(true), // Disabled on first page
                      new ButtonBuilder()
                          .setCustomId(`events_page_info_0`)
                          .setLabel(`Page 1/${totalPages}`)
                          .setStyle(ButtonStyle.Primary)
                          .setDisabled(true),
                      new ButtonBuilder()
                          .setCustomId(`events_page_next_0`)
                          .setLabel('Next ▶')
                          .setStyle(ButtonStyle.Secondary)
                          .setDisabled(totalPages <= 1)
                  );
                  components.push(buttonRow);
              }
  
      
  
              await interaction.editReply({
  
                  content: null,
  
                  embeds: [embed],
  
                  components: components,
  
                  files: [{
  
                      attachment: "./src/images/FightGenie_Logo_1.PNG",
  
                      name: "FightGenie_Logo_1.PNG"
  
                  }]
  
              });
  
      
  
          } catch (error) {
  
              console.error("Error handling model stats command:", error);
  
              await interaction.editReply({
  
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
  
              if (!interaction.deferred && !interaction.replied) {
                  await interaction.deferReply({ ephemeral: true });
              }
  
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
              
              // Pagination helpers: Discord allows max 25 fields per embed
              const embedPages = [embed];
              let currentEmbedRef = embed;
              let totalCorrect = 0;
              let totalFights = 0;
              
              function addField(name, value, inline = false) {
                  const fieldCount = (currentEmbedRef.data.fields?.length || 0);
                  if (fieldCount >= 25) {
                      const next = new EmbedBuilder()
                        .setColor("#0099ff")
                        .setTitle(`📊 ${event[0].Event} (continued)`)
                        .setThumbnail("attachment://FightGenie_Logo_1.PNG");
                      embedPages.push(next);
                      currentEmbedRef = next;
                  }
                  currentEmbedRef.addFields({ name, value, inline });
              }
  
      
  
              // Build sections deterministically for both models and both card types,
              // so Claude sections are always considered (when present).
              const models = ['gpt', 'claude'];
              const cardTypes = ['main', 'prelims'];
  
              for (const modelKey of models) {
                  const modelEmoji = modelKey === "gpt" ? "🧠" : "🤖";
                  const modelName = modelKey === "gpt" ? "GPT" : "Claude";
  
                  for (const card of cardTypes) {
                      // Get the latest stored prediction for this model/card
                      // Look for predictions by event name to handle duplicate event IDs
                      const rows = await database.query(
                          `
                          SELECT sp.prediction_data
                          FROM stored_predictions sp
                          JOIN events e ON sp.event_id = e.event_id
                          WHERE e.Event = ?
                          AND LOWER(sp.model_used) = LOWER(?)
                          AND LOWER(sp.card_type) = LOWER(?)
                          ORDER BY sp.created_at DESC
                          LIMIT 1
                          `,
                          [event[0].Event, modelKey, card]
                      );
                      
                      if (!rows?.length) {
                          // Add a field showing no predictions found for this model/card
                          const prettyCard = card === "main" ? "Main Card" : "Prelims";
                          addField(
                              `${modelEmoji} ${modelName} - ${prettyCard}`,
                              `*No predictions found for ${modelName} ${prettyCard}*`,
                              false
                          );
                          continue;
                      }
  
                      try {
                          const predictionData = JSON.parse(rows[0].prediction_data);
                          const fightsArray = Array.isArray(predictionData.fights) ? predictionData.fights : [];
                          if (fightsArray.length === 0) continue;
  
                          const fightResults = fightsArray
                              .map((fight) => {
                                  const matchingResult = scrapedResults.find(
                                      (r) =>
                                          (r.winner === fight.fighter1?.trim() && r.loser === fight.fighter2?.trim()) ||
                                          (r.winner === fight.fighter2?.trim() && r.loser === fight.fighter1?.trim())
                                  );
                                  if (!matchingResult) return null;
  
                                  const predictedMethod = fight.method?.toLowerCase() || '';
                                  const actualMethod = matchingResult.method?.toLowerCase() || '';
                                  const isMethodCorrect = this.compareMethod(predictedMethod, actualMethod);
                                  
                                  return {
                                      fighters: `${fight.fighter1} vs ${fight.fighter2}`,
                                      prediction: {
                                          winner: fight.predictedWinner,
                                          method: fight.method,
                                          confidence: fight.confidence,
                                      },
                                      actual: matchingResult,
                                      isCorrect: fight.predictedWinner?.trim() === matchingResult.winner,
                                      isMethodCorrect
                                  };
                              })
                              .filter(Boolean);
  
                          const correctCount = fightResults.filter((f) => f.isCorrect).length;
                          totalCorrect += correctCount;
                          totalFights += fightResults.length;
  
                          // Split fights into chunks to avoid Discord's 1024 character limit
                          const fightChunks = [];
                          let currentChunk = [];
                          let currentLength = 0;
  
                          fightResults.forEach((fight) => {
                              const fightText = [
                                  `${fight.isCorrect ? "✅" : "❌"} **${fight.fighters}**`,
                                  `📍 Pick: **${fight.prediction.winner}** (${fight.prediction.confidence}%)`,
                                  `🏆 Result: **${fight.actual.winner}** by ${fight.actual.method}`
                              ].join("\n");
  
                              if (currentLength + fightText.length + 2 > 1024) {
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
                              const prettyCard = card === "main" ? "Main Card" : "Prelims";
                              const fieldName =
                                  index === 0
                                      ? `${modelEmoji} ${modelName} - ${prettyCard} (${correctCount}/${fightResults.length} correct)`
                                      : `${modelEmoji} ${modelName} - ${prettyCard} (Continued)`;
                              addField(fieldName, chunk || "No verified fights found", false);
                          });
  
                          // Props summary if available
                          if (predictionData.betting_analysis?.props) {
                              try {
                                  const props = Array.isArray(predictionData.betting_analysis.props)
                                      ? predictionData.betting_analysis.props
                                      : [predictionData.betting_analysis.props];
                                  const correctProps = props.filter((prop) => {
                                      if (typeof prop !== "string") return false;
                                      const [fighter, method] = prop.split(/\s+by\s+/i).map((s) => s.trim());
                                      const result = scrapedResults.find(
                                          (r) => r.winner === fighter || r.loser === fighter
                                      );
                                      return (
                                          result &&
                                          result.winner === fighter &&
                                          this.compareMethod(method || "", result.method)
                                      );
                                  });
                                  if (correctProps.length > 0) {
                                      addField("💰 Prop Bets", `${correctProps.length} prop bet(s) correct`, false);
                                  }
                              } catch (error) {
                                  console.error("Error processing props:", error);
                              }
                          }
                      } catch (error) {
                          console.error("Error processing model/card predictions:", error);
                          continue;
                      }
                  }
              }
  
      
  
              // Add overall summary at the end
              if (totalFights > 0) {
                  const overallAccuracy = ((totalCorrect / totalFights) * 100).toFixed(1);
                  addField(
                      "📈 Overall Event Performance",
                      `**Total Accuracy: ${overallAccuracy}% (${totalCorrect}/${totalFights})**`,
                      false
                  );
              }
              
              // Create back button to return to stats
              const backButton = new ActionRowBuilder()
                  .addComponents(
                      new ButtonBuilder()
                          .setCustomId('back_to_model_stats')
                          .setLabel('← Back to Stats')
                          .setStyle(ButtonStyle.Secondary)
                  );
              
              // Send paginated embeds: first via reply/editReply, remaining via followUp
              const firstPayload = {
                  embeds: [embedPages[0]],
                  components: [backButton],
                  files: [
                      {
                          attachment: "./src/images/FightGenie_Logo_1.PNG",
                          name: "FightGenie_Logo_1.PNG",
                      },
                  ],
              };
              if (interaction.deferred) {
                  await interaction.editReply(firstPayload);
              } else if (!interaction.replied) {
                  await interaction.reply({ ...firstPayload, ephemeral: true });
              } else {
                  await interaction.followUp({ ...firstPayload, ephemeral: true });
              }
              // Send remaining pages (if any)
              if (embedPages.length > 1) {
                  for (let i = 1; i < embedPages.length; i++) {
                      await interaction.followUp({
                          embeds: [embedPages[i]],
                          ephemeral: true
                      });
                  }
              }
  
          } catch (error) {
              console.error("Error handling historical view:", error);
              const msg = "Error retrieving historical predictions";
              if (interaction.deferred) {
                  await interaction.editReply(msg);
              } else if (!interaction.replied) {
                  await interaction.reply({ content: msg, ephemeral: true });
              } else {
                  await interaction.followUp({ content: msg, ephemeral: true });
              }
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

    static async handleEventsPagination(interaction, direction, currentPage) {
        try {
            // Get all events (same query as main stats command)
            const events = await database.query(`
                SELECT DISTINCT 
                    e.event_id,
                    e.Event,
                    e.Date,
                    e.event_link
                FROM events e
                JOIN stored_predictions sp ON e.event_id = sp.event_id
                WHERE prediction_data IS NOT NULL
                AND Date < date('now')
                GROUP BY e.event_id, e.Event, e.Date, e.event_link
                ORDER BY e.Date DESC
            `);

            // Build event options
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

            // Calculate new page
            let newPage = currentPage;
            if (direction === 'next') {
                newPage = currentPage + 1;
            } else if (direction === 'prev') {
                newPage = currentPage - 1;
            }

            // Pagination
            const eventsPerPage = 25;
            const totalPages = Math.ceil(eventOptions.length / eventsPerPage);
            const startIndex = newPage * eventsPerPage;
            const endIndex = startIndex + eventsPerPage;
            const currentPageOptions = eventOptions.slice(startIndex, endIndex);

            // Create select menu with current page
            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId("view_historical_predictions")
                .setPlaceholder(`📜 View Historical Event Predictions (Page ${newPage + 1}/${totalPages})`)
                .addOptions(currentPageOptions);

            const selectRow = new ActionRowBuilder().addComponents(selectMenu);

            // Create navigation buttons
            const buttonRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`events_page_prev_${newPage}`)
                    .setLabel('◀ Previous')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(newPage === 0),
                new ButtonBuilder()
                    .setCustomId(`events_page_info_${newPage}`)
                    .setLabel(`Page ${newPage + 1}/${totalPages}`)
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(true),
                new ButtonBuilder()
                    .setCustomId(`events_page_next_${newPage}`)
                    .setLabel('Next ▶')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(newPage >= totalPages - 1)
            );

            // Get the original message to preserve embeds
            const message = interaction.message;
            
            await interaction.editReply({
                embeds: message.embeds,
                components: [selectRow, buttonRow],
                files: [{
                    attachment: "./src/images/FightGenie_Logo_1.PNG",
                    name: "FightGenie_Logo_1.PNG"
                }]
            });

        } catch (error) {
            console.error("Error handling events pagination:", error);
            await interaction.editReply({
                content: "Error navigating events. Please try again.",
                ephemeral: true
            });
        }
    }
  
  }
  
  
  
  module.exports = ModelStatsCommand;
