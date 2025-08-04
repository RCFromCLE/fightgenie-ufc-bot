const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const database = require('../database');
const axios = require('axios');
const cheerio = require('cheerio');

class AdminEventCommand {
    static async handleUpcomingEvents(message) {
        try {
            // Verify admin permissions
            if (!message.member?.permissions.has("Administrator") || message.guild?.id !== "496121279712329756") {
                await message.reply({
                    content: "❌ This command requires administrator permissions.",
                    ephemeral: true
                });
                return;
            }

            const loadingEmbed = new EmbedBuilder()
                .setColor('#ffff00')
                .setTitle('🔄 Fetching Upcoming Events')
                .setDescription('Checking UFCStats.com for upcoming events...');

            const loadingMsg = await message.reply({ embeds: [loadingEmbed] });

            // Fetch upcoming events
            const events = await this.scrapeUpcomingEvents();
            if (!events || events.length === 0) {
                await loadingMsg.edit({
                    content: "No upcoming events found on UFCStats.com",
                    embeds: []
                });
                return;
            }

            // Create embed with event list
            const embed = new EmbedBuilder()
                .setColor('#0099ff')
                .setTitle('📅 Upcoming UFC Events')
                .setDescription('Select an event to advance to:');

            // Add current event field
            const currentEvent = await database.query(`
                SELECT DISTINCT Event, Date
                FROM events
                WHERE Date >= date('now')
                AND is_completed = 0
                ORDER BY Date ASC
                LIMIT 1
            `);

            if (currentEvent?.[0]) {
                embed.addFields({
                    name: '🎯 Current Event',
                    value: `${currentEvent[0].Event}\n${new Date(currentEvent[0].Date).toLocaleDateString('en-US', {
                        weekday: 'long',
                        month: 'long',
                        day: 'numeric'
                    })}`,
                    inline: false
                });
            }

            // Add upcoming events
            events.forEach((event, index) => {
                embed.addFields({
                    name: `Event ${index + 1}`,
                    value: `${event.name}\n📅 ${event.date}\n📍 ${event.location || 'Location TBA'}`,
                    inline: true
                });
            });

            // Create buttons for each event
            const rows = [];
            let currentRow = new ActionRowBuilder();
            
            events.forEach((event, index) => {
                const button = new ButtonBuilder()
                    .setCustomId(`select_event_${index}`)
                    .setLabel(`Select Event ${index + 1}`)
                    .setStyle(ButtonStyle.Primary);
                
                currentRow.addComponents(button);
                
                // Create new row after 5 buttons
                if (currentRow.components.length === 5 || index === events.length - 1) {
                    rows.push(currentRow);
                    currentRow = new ActionRowBuilder();
                }
            });

            // Add cancel button
            const cancelRow = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('cancel_event_selection')
                        .setLabel('Cancel')
                        .setStyle(ButtonStyle.Secondary)
                );
            rows.push(cancelRow);

            await loadingMsg.edit({
                embeds: [embed],
                components: rows
            });

            // Set up button collector
            const filter = i => i.user.id === message.author.id;
            const collector = loadingMsg.createMessageComponentCollector({ 
                filter, 
                time: 60000 
            });

            collector.on('collect', async i => {
                try {
                    if (i.customId === 'cancel_event_selection') {
                        await loadingMsg.edit({
                            content: 'Event selection cancelled.',
                            embeds: [],
                            components: []
                        });
                        collector.stop();
                        return;
                    }
            
                    const selectedIndex = parseInt(i.customId.split('_')[2]);
                    const selectedEvent = events[selectedIndex];
            
                    // Update the original message first
                    await loadingMsg.edit({
                        content: `Processing event: ${selectedEvent.name}`,
                        embeds: [],
                        components: []
                    });
            
                    // Store event in database
                    await this.storeNewEvent(selectedEvent);
            
                    const confirmEmbed = new EmbedBuilder()
                        .setColor('#00ff00')
                        .setTitle('✅ Event Updated Successfully')
                        .setDescription([
                            '**New Current Event:**',
                            `Event: ${selectedEvent.name}`,
                            `Date: ${selectedEvent.date}`,
                            `Location: ${selectedEvent.location || 'TBA'}`,
                            '',
                            'Use `$upcoming` to view the event details.'
                        ].join('\n'));
            
                    // Update original message with confirmation
                    await loadingMsg.edit({
                        content: null,
                        embeds: [confirmEmbed],
                        components: []
                    });
            
                    collector.stop();
                } catch (error) {
                    console.error('Error handling event selection:', error);
                    try {
                        await loadingMsg.edit({
                            content: 'Error updating event. Please try again.',
                            embeds: [],
                            components: []
                        });
                    } catch (replyError) {
                        console.error('Error sending error message:', replyError);
                    }
                } finally {
                    // Acknowledge the interaction without updating it
                    try {
                        if (!i.replied && !i.deferred) {
                            await i.deferUpdate().catch(() => {});
                        }
                    } catch (e) {
                        // Ignore any acknowledgment errors
                    }
                }
            });
            
            collector.on('end', async (collected, reason) => {
                try {
                    if (reason === 'time' && collected.size === 0) {
                        await loadingMsg.edit({
                            content: 'Event selection timed out.',
                            embeds: [],
                            components: []
                        });
                    }
                } catch (error) {
                    console.error('Error handling collector end:', error);
                }
            });

        } catch (error) {
            console.error('Error handling upcoming events:', error);
            await message.reply('An error occurred while fetching upcoming events.');
        }
    }


    static async scrapeUpcomingEvents() {
        try {
            const response = await axios.get('http://www.ufcstats.com/statistics/events/upcoming');
            const $ = cheerio.load(response.data);
            const events = [];
    
            // Process each row sequentially
            for (const row of $('.b-statistics__table-row').toArray()) {
                const $row = $(row);
                const nameField = $row.find('.b-statistics__table-col:first-child').text().trim();
                const link = $row.find('a').attr('href');
                const locationField = $row.find('.b-statistics__table-col:nth-child(2)').text().trim();
    
                if (nameField && link) {
                    const name = nameField.split('\n')[0].trim();
                    const dateMatch = nameField.match(/([A-Za-z]+ \d+, \d{4})/);
                    let fights = [];
    
                    console.log(`Scraping event: ${name} at ${link}`);
    
                    // Get the event details page
                    try {
                        const eventPage = await axios.get(link);
                        const $event = cheerio.load(eventPage.data);
                        
                        // Try different selectors for upcoming events
                        const fightElements = $event('.c-listing-fight__content') // Try new structure first
                            .length ? $event('.c-listing-fight__content') : 
                            $event('.b-fight-details__table-row'); // Fall back to old structure
    
                        fightElements.each((idx, fightEl) => {
                            const $fight = $event(fightEl);
                            
                            // Try different selectors for fighter names
                            let fighters = [];
                            
                            // Try new structure selectors
                            const fighter1 = $fight.find('.c-listing-fight__corner-name--red').text().trim();
                            const fighter2 = $fight.find('.c-listing-fight__corner-name--blue').text().trim();
                            
                            if (fighter1 && fighter2) {
                                fighters = [fighter1, fighter2];
                            } else {
                                // Try old structure selectors
                                fighters = $fight.find('td:first-child a, .b-fight-details__table-col a')
                                    .map((_, el) => $event(el).text().trim())
                                    .get();
                            }
    
                            // Try different selectors for weight class
                            let weightClass = $fight.find('.c-listing-fight__class-text').text().trim() ||
                                            $fight.find('td:nth-child(7)').text().trim() ||
                                            'TBD';
    
                            console.log(`Found fighters: ${fighters.join(' vs ')} (${weightClass})`);
    
                            if (fighters.length === 2) {
                                fights.push({
                                    fighter1: fighters[0],
                                    fighter2: fighters[1],
                                    WeightClass: weightClass,
                                    is_main_card: idx < 5 ? 1 : 0
                                });
                            }
                        });
    
                        // If still no fights, try scraping from different page sections
                        if (fights.length === 0) {
                            const mainCardSection = $event('#card-tabs-1');
                            const prelimSection = $event('#card-tabs-2');
    
                            [mainCardSection, prelimSection].forEach((section, sectionIdx) => {
                                section.find('.l-listing__item').each((idx, item) => {
                                    const $item = $event(item);
                                    const fighter1 = $item.find('.c-listing__name:first').text().trim();
                                    const fighter2 = $item.find('.c-listing__name:last').text().trim();
                                    const weightClass = $item.find('.c-listing__term').text().trim() || 'TBD';
    
                                    if (fighter1 && fighter2) {
                                        fights.push({
                                            fighter1,
                                            fighter2,
                                            WeightClass: weightClass,
                                            is_main_card: sectionIdx === 0 ? 1 : 0
                                        });
                                    }
                                });
                            });
                        }
    
                    } catch (error) {
                        console.error(`Error scraping event page ${link}:`, error);
                    }
    
                    events.push({ 
                        name: name,
                        date: dateMatch ? dateMatch[0] : '',
                        location: locationField,
                        link: link,
                        fights: fights
                    });
    
                    console.log(`Added event ${name} with ${fights.length} fights`);
                }
            }
    
            console.log(`Scraped ${events.length} events with fights:`, events);
            return events;
        } catch (error) {
            console.error('Error scraping upcoming events:', error);
            return null;
        }
    }    

    static async storeNewEvent(event) {
        try {
            console.log('Starting to process event:', event);
            const [city, state, country] = (event.location || '').split(',').map(s => s.trim());
            let formattedDate;
    
            try {
                const dateStr = event.date.trim();
                const dateParts = dateStr.match(/([A-Za-z]+)\s+(\d+),\s*(\d{4})/);
                if (!dateParts) throw new Error(`Invalid date format: ${dateStr}`);
    
                const months = {
                    'January': '01', 'February': '02', 'March': '03', 'April': '04',
                    'May': '05', 'June': '06', 'July': '07', 'August': '08',
                    'September': '09', 'October': '10', 'November': '11', 'December': '12'
                };
    
                const month = months[dateParts[1]];
                const day = dateParts[2].padStart(2, '0');
                const year = dateParts[3];
    
                formattedDate = `${year}-${month}-${day}`;
            } catch (dateError) {
                console.error('Date parsing error:', dateError);
                throw new Error(`Failed to parse date: ${event.date}`);
            }
    
            // Clean up existing event records
            await database.query(`
                DELETE FROM market_analysis 
                WHERE event_id IN (SELECT event_id FROM events WHERE Event = ?)
            `, [event.name]);
            
            await database.query(`
                DELETE FROM prediction_outcomes 
                WHERE event_id IN (SELECT event_id FROM events WHERE Event = ?)
            `, [event.name]);
            
            await database.query(`
                DELETE FROM stored_predictions 
                WHERE event_id IN (SELECT event_id FROM events WHERE Event = ?)
            `, [event.name]);

            // Also delete any stored predictions for this event to force regeneration
            await database.query(`
                DELETE FROM stored_predictions 
                WHERE event_id IN (SELECT event_id FROM events WHERE Event = ?)
            `, [event.name]);
            
            await database.query('DELETE FROM events WHERE Event = ?', [event.name]);
    
            console.log(`Fetching fights from ${event.link}`);
            const response = await axios.get(event.link);
            const $ = cheerio.load(response.data);
            let fights = [];
    
            // Process each fight row in the table
            $('.b-fight-details__table-row').each((idx, row) => {
                const $row = $(row);
    
                // Get both fighters from the table cells
                const fighters = $row.find('.b-link.b-link_style_black')
                    .map((_, el) => $(el).text().trim())
                    .get()
                    .filter(name => name && !name.includes('View') && !name.includes('Matchup'));
    
                // Get weight class from the table cell
                const weightClass = $row.find('.b-fight-details__table-text')
                    .filter((_, el) => {
                        const text = $(el).text().trim();
                        return text.includes('weight') || text.includes('Weight');
                    })
                    .first()
                    .text()
                    .trim();
    
                if (fighters.length === 2) {
                    fights.push({
                        fighter1: fighters[0],
                        fighter2: fighters[1],
                        WeightClass: weightClass || 'TBD',
                        is_main_card: idx < 5 ? 1 : 0
                    });
                    console.log(`Found fight: ${fighters[0]} vs ${fighters[1]} (${weightClass})`);
                }
            });
    
            console.log(`Total fights found: ${fights.length}`);
    
            // Store each fight as a separate entry
            for (const fight of fights) {
                const fightQuery = `
                    INSERT INTO events (
                        Event, Date, City, State, Country,
                        fighter1, fighter2, WeightClass,
                        event_link, is_main_card
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `;
    
                await database.query(fightQuery, [
                    event.name,
                    formattedDate,
                    city,
                    state,
                    country,
                    fight.fighter1,
                    fight.fighter2,
                    fight.WeightClass,
                    event.link,
                    fight.is_main_card
                ]);
    
                console.log(`Stored fight ${fight.fighter1} vs ${fight.fighter2}`);
            }
    
            if (fights.length === 0) {
                throw new Error('No fights could be scraped from the event page');
            }
    
            console.log(`Successfully stored event: ${event.name} with ${fights.length} fights`);
            return true;
    
        } catch (error) {
            console.error('Error storing new event:', {
                error: error.message,
                event: event,
                stack: error.stack
            });
            throw error;
        }
    }
    
    static async handleAdvanceEvent(message) {
        try {
            // Verify admin permissions
            if (!message.member?.permissions.has("Administrator") || message.guild?.id !== "496121279712329756") {
                await message.reply({
                    content: "❌ This command requires administrator permissions.",
                    ephemeral: true
                });
                return;
            }
    
            console.log("Starting event advancement process...");
    
            // --- Simplified Current Event Logic ---
            // Find the earliest event that is not completed and is today or in the past
            // This aligns better with identifying the event that *should* be marked complete.
            const currentEventResult = await database.query(`
                SELECT DISTINCT 
                    event_id, Date, Event, City, State, Country, event_link
                FROM events 
                WHERE Date <= date('now') 
                  AND is_completed = 0
                  AND Event LIKE 'UFC%' -- Ensure it's a UFC event
                ORDER BY Date ASC -- Get the oldest uncompleted one first
                LIMIT 1
            `);
    
            if (!currentEventResult?.[0]) {
                // If no past/present uncompleted event, check if there's *any* uncompleted event
                const anyUncompleted = await database.query(`
                    SELECT event_id FROM events WHERE is_completed = 0 LIMIT 1
                `);
                if (!anyUncompleted?.[0]) {
                    console.log("No uncompleted events found at all. Fetching upcoming events to potentially add one.");
                    return await this.handleUpcomingEvents(message); // Prompt to add a new event
                } else {
                    // There are future uncompleted events, but none to mark complete right now.
                    console.log("No past or present events need completion. Check upcoming events.");
                    // Optionally, display the *next* upcoming event without marking anything complete.
                    const nextUpcoming = await database.query(`
                        SELECT DISTINCT Date, Event FROM events 
                        WHERE Date >= date('now') AND is_completed = 0 
                        ORDER BY Date ASC LIMIT 1
                    `);
                    let replyContent = "✅ No past or present events require completion.";
                    if (nextUpcoming?.[0]) {
                        replyContent += `\nThe next upcoming event is ${nextUpcoming[0].Event} on ${new Date(nextUpcoming[0].Date).toLocaleDateString()}.`;
                    }
                    await message.reply(replyContent);
                    return; 
                }
            }
    
            const currentEvent = currentEventResult[0];
            console.log(`Identified event to mark as completed: ${currentEvent.Event} (${currentEvent.Date})`);
    
            // Mark this event as completed
            await database.query(`
                UPDATE events
                SET is_completed = 1,
                    completed_at = datetime('now')
                WHERE Event = ? 
                  AND Date = ? -- Be specific to avoid marking future events with same name
            `, [currentEvent.Event, currentEvent.Date]);
            
            console.log(`Marked ${currentEvent.Event} as completed.`);
    
            // --- Find the Next Upcoming Event ---
            const nextEventResult = await database.query(`
                SELECT DISTINCT 
                    event_id, Date, Event, City, State, Country, event_link
                FROM events
                WHERE Date > ? -- Find events strictly after the one just completed
                  AND is_completed = 0
                ORDER BY Date ASC
                LIMIT 1
            `, [currentEvent.Date]); // Use the date of the event just completed
            
            const nextEvent = nextEventResult?.[0];
    
            // Force refresh fight data for next event
            if (nextEvent?.[0]?.event_link) {
                console.log(`Refreshing fight data for next event: ${nextEvent[0].Event}`);
                try {
                    const response = await axios.get(nextEvent[0].event_link);
                    const $ = cheerio.load(response.data);
                    const fights = [];
    
                    $('.b-fight-details__table-row').each((index, row) => {
                        const fighters = $(row).find('.b-fight-details__table-col:first-child a')
                            .map((_, el) => $(el).text().trim()).get();
                        const weightClass = $(row).find('td:nth-child(7)').text().trim();
    
                        if (fighters.length === 2) {
                            fights.push({
                                fighter1: fighters[0],
                                fighter2: fighters[1],
                                WeightClass: weightClass,
                                is_main_card: index < 5 ? 1 : 0
                            });
                        }
                    });
    
                    if (fights.length > 0) {
                        console.log(`Attempting to refresh ${fights.length} fights for ${nextEvent.Event}`);
                        // Clear existing fights AND predictions for this event before re-inserting
                        await database.query(`
                            DELETE FROM stored_predictions 
                            WHERE event_id IN (SELECT event_id FROM events WHERE Event = ?)
                        `, [nextEvent.Event]);
                        await database.query('DELETE FROM events WHERE Event = ?', [nextEvent.Event]);
                        console.log(`Cleared old data for ${nextEvent.Event}`);
    
                        // Store updated fights
                        for (const fight of fights) {
                            await database.query(`
                                INSERT INTO events (
                                    Event, Date, City, State, Country,
                                    fighter1, fighter2, WeightClass,
                                    event_link, is_main_card
                                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                            `, [
                                nextEvent.Event,
                                nextEvent.Date,
                                nextEvent.City,
                                nextEvent.State,
                                nextEvent.Country,
                                fight.fighter1,
                                fight.fighter2,
                                fight.WeightClass,
                                nextEvent.event_link,
                                fight.is_main_card
                            ]);
                        }
                        console.log(`Successfully refreshed ${fights.length} fights for ${nextEvent.Event}`);
                    } else {
                         console.log(`No fights found during refresh scrape for ${nextEvent.Event}`);
                    }
                } catch (scrapeError) {
                    console.error(`Error refreshing fight data for ${nextEvent?.Event}:`, scrapeError);
                    // Don't halt the whole process, just log the error
                }
            } else if (nextEvent) {
                 console.log(`No event link found for ${nextEvent.Event}, cannot refresh fights.`);
            }
    
            // --- Build Response Embed ---
            const embed = new EmbedBuilder()
                .setColor('#00ff00')
                .setTitle('✅ Event Advanced Successfully')
                .setDescription([
                    '**Completed Event:**',
                    `Event: ${currentEvent.Event}`,
                    `Date: ${new Date(currentEvent.Date).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric' })}`, // Added UTC timezone
                    '',
                    nextEvent ? 
                        [
                            '**Next Upcoming Event:**',
                            `Event: ${nextEvent.Event}`,
                            `Date: ${new Date(nextEvent.Date).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric' })}`, // Added UTC timezone
                            `Location: ${nextEvent.City || 'TBA'}, ${nextEvent.Country || 'TBA'}`
                        ].join('\n') :
                        '**No further upcoming events found in the database.**',
                    '',
                    'Use `$upcoming` to view the new current event details.'
                ].join('\n'));
            
            // Create buttons for updating fighter stats and running predictions
            const predictionButtonsRow = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`update_fighter_stats_${nextEvent?.event_id || 'latest'}`)
                        .setLabel('Update Fighter Stats')
                        .setEmoji('📊')
                        .setStyle(ButtonStyle.Primary),
                    new ButtonBuilder()
                        .setCustomId(`run_all_predictions_${nextEvent?.event_id || 'latest'}`)
                        .setLabel('Run All Predictions')
                        .setEmoji('🔄')
                        .setStyle(ButtonStyle.Success),
                    new ButtonBuilder()
                        .setCustomId(`view_event_${nextEvent?.event_id || 'latest'}`)
                        .setLabel('View Event')
                        .setEmoji('👁️')
                        .setStyle(ButtonStyle.Secondary)
                );
    
            await message.reply({ 
                embeds: [embed],
                components: [predictionButtonsRow],
                files: [{
                    attachment: './src/images/FightGenie_Logo_1.PNG',
                    name: 'FightGenie_Logo_1.PNG'
                }]
            });
    
        } catch (error) {
            console.error('Error advancing event:', error);
            await message.reply('An error occurred while advancing the event. Please try again.');
        }
    }

    static async forceUpdateCurrentEvent(message) {
        try {
            await this.handleUpcomingEvents(message);
        } catch (error) {
            console.error('Error forcing event update:', error);
            await message.reply('An error occurred while updating the current event.');
        }
    }
}

module.exports = AdminEventCommand;
