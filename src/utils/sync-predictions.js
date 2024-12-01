const { EmbedBuilder } = require('discord.js');
const database = require('../database');
const axios = require('axios');
const cheerio = require('cheerio');

class AdminPredictionCommand {
    static async handleSyncPredictions(message) {
        try {
            if (!message.member?.permissions.has("Administrator") || 
                message.guild?.id !== "496121279712329756") {
                await message.reply({
                    content: "❌ This command requires administrator permissions.",
                    ephemeral: true
                });
                return;
            }
    
            const loadingEmbed = new EmbedBuilder()
                .setColor('#ffff00')
                .setTitle('🔄 Syncing Prediction Outcomes')
                .setDescription('Processing completed event predictions...');
    
            const loadingMsg = await message.reply({ embeds: [loadingEmbed] });
            
            const events = await database.query(`
                SELECT DISTINCT 
                    e.event_id,
                    e.Event,
                    e.Date,
                    e.event_link,
                    COUNT(DISTINCT sp.prediction_id) as prediction_count
                FROM events e
                JOIN stored_predictions sp ON e.event_id = sp.event_id
                WHERE prediction_data IS NOT NULL
                AND Date < date('now')
                AND sp.prediction_id NOT IN (
                    SELECT prediction_id FROM prediction_outcomes
                )
                GROUP BY e.event_id, e.Event, e.Date, e.event_link
                ORDER BY e.Date DESC
            `);
    
            console.log(`Found ${events.length} events to process`);
            let syncedCount = 0;
            let errorCount = 0;
            const processedEvents = new Set();
            const details = [];
    
            const scrapedEvents = new Map();
    
            for (const event of events) {
                try {
                    console.log(`\nProcessing event: ${event.Event}`);
                    
                    let scrapedResults;
                    if (scrapedEvents.has(event.event_id)) {
                        scrapedResults = scrapedEvents.get(event.event_id);
                    } else if (event.event_link) {
                        scrapedResults = await this.scrapeEventResults(event.event_link);
                        scrapedEvents.set(event.event_id, scrapedResults);
                    }
    
                    if (!scrapedResults?.length) {
                        console.log('No results found for event');
                        details.push(`❌ ${event.Event}: No results found`);
                        continue;
                    }
    
                    const predictions = await database.query(`
                        SELECT prediction_id, model_used, card_type, prediction_data, event_id
                        FROM stored_predictions
                        WHERE event_id = ?
                    `, [event.event_id]);
    
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
                                // Insert basic outcome data matching your DB structure
                                await database.query(`
                                    INSERT INTO prediction_outcomes (
                                        prediction_id,
                                        event_id,
                                        fight_outcomes
                                    ) VALUES (?, ?, ?)
                                `, [
                                    pred.prediction_id,
                                    pred.event_id,
                                    JSON.stringify({
                                        correct: 0,
                                        methodCorrect: 0,
                                        method: "Decision"  // Default method
                                    })
                                ]);
    
                                syncedCount++;
                                processedEvents.add(event.Event);
                            }
                        } catch (predError) {
                            console.error(`Error processing prediction ${pred.prediction_id}:`, predError);
                            errorCount++;
                        }
                    }
    
                    details.push(`✅ ${event.Event}: Processed ${syncedCount} predictions`);
    
                } catch (eventError) {
                    console.error(`Error processing event ${event.Event}:`, eventError);
                    errorCount++;
                    details.push(`⚠️ ${event.Event}: ${eventError.message}`);
                }
            }
    
            const completionEmbed = new EmbedBuilder()
                .setColor('#00ff00')
                .setTitle('✅ Prediction Sync Complete')
                .setDescription([
                    `Processed ${events.length} events`,
                    `Successfully synced: ${syncedCount}`,
                    `Events processed: ${processedEvents.size}`,
                    errorCount > 0 ? `Errors encountered: ${errorCount}` : '',
                    '',
                    '=== Sync Details ===',
                    ...details,
                    '',
                    'Use `$stats` to view updated model performance.'
                ].join('\n'));
    
            await loadingMsg.edit({ embeds: [completionEmbed] });
    
        } catch (error) {
            console.error('Error syncing predictions:', error);
            await message.reply('Error syncing prediction outcomes. Please try again.');
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
                    
                    const fighters = $row.find(".b-link.b-link_style_black");
                    const methodCell = $cells.eq(7);
                    const methodText = methodCell.text().trim();
                    
                    if (fighters.length >= 2) {
                        const winner = $(fighters[0]).text().trim();
                        const loser = $(fighters[1]).text().trim();

                        if (winner && loser && methodText) {
                            const method = methodText.replace(/\s+/g, ' ').trim();
                            results.push({ winner, loser, method });
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

    static compareMethod(predicted, actual) {
        const standardizeMethods = {
            'ko': ['ko', 'tko', 'ko/tko'],
            'tko': ['ko', 'tko', 'ko/tko'],
            'ko/tko': ['ko', 'tko', 'ko/tko'],
            'submission': ['sub', 'submission'],
            'decision': ['dec', 'u-dec', 's-dec', 'm-dec', 'decision', 'unanimous decision']
        };

        predicted = predicted.toLowerCase().trim();
        actual = actual.toLowerCase().trim();

        if (predicted === actual) return true;

        for (const [_, values] of Object.entries(standardizeMethods)) {
            if (values.includes(predicted) && values.some(v => actual.includes(v))) {
                return true;
            }
        }

        return false;
    }
}

module.exports = AdminPredictionCommand;