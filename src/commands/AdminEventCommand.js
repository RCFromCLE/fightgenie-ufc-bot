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

            $('.b-statistics__table-row').each((_, row) => {
                const $row = $(row);
                const name = $row.find('.b-statistics__table-col:first-child').text().trim();
                const date = $row.find('.b-statistics__table-col:nth-child(2)').text().trim();
                const location = $row.find('.b-statistics__table-col:nth-child(3)').text().trim();
                const link = $row.find('a').attr('href');

                if (name && date && link) {
                    events.push({ name, date, location, link });
                }
            });

            return events;
        } catch (error) {
            console.error('Error scraping upcoming events:', error);
            return null;
        }
    }

static async storeNewEvent(event) {
    try {
        console.log('Processing event:', event); // Debug log

        // Parse location
        const [city, country] = (event.location || '').split(',').map(s => s.trim());

        // Parse date properly
        let formattedDate;
        try {
            // Example date format from UFCStats: "December 07, 2024"
            const dateStr = event.date.trim();
            const dateParts = dateStr.match(/([A-Za-z]+)\s+(\d+),\s*(\d{4})/);
            
            if (!dateParts) {
                throw new Error(`Invalid date format: ${dateStr}`);
            }

            const months = {
                'January': '01', 'February': '02', 'March': '03', 'April': '04',
                'May': '05', 'June': '06', 'July': '07', 'August': '08',
                'September': '09', 'October': '10', 'November': '11', 'December': '12'
            };

            const month = months[dateParts[1]];
            const day = dateParts[2].padStart(2, '0');
            const year = dateParts[3];

            if (!month || !day || !year) {
                throw new Error(`Unable to parse date components from: ${dateStr}`);
            }

            formattedDate = `${year}-${month}-${day}`;
            console.log('Formatted date:', formattedDate); // Debug log
        } catch (dateError) {
            console.error('Date parsing error:', dateError);
            throw new Error(`Failed to parse date: ${event.date}`);
        }

        // Store in database with better error logging
        const query = `
            INSERT INTO events (
                Event, Date, City, Country, event_link, is_completed
            ) VALUES (?, ?, ?, ?, ?, 0)
            ON CONFLICT(event_link) DO UPDATE SET
                Event = excluded.Event,
                Date = excluded.Date,
                City = excluded.City,
                Country = excluded.Country,
                is_completed = 0
        `;

        const params = [
            event.name,
            formattedDate,
            city,
            country,
            event.link
        ];

        console.log('Executing query with params:', params); // Debug log

        await database.query(query, params);

        // Update existing event status
        await database.query(`
            UPDATE events 
            SET is_completed = 1
            WHERE Date < ?
        `, [formattedDate]);

        console.log(`Successfully stored new event: ${event.name}`);
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

            // First, let's clean up duplicates and fix completed status
            await database.query(`
                UPDATE events 
                SET is_completed = 0 
                WHERE Date > date('now')
            `);

            // Get the earliest uncompleted event
            const currentEvent = await database.query(`
                SELECT DISTINCT 
                    event_id, Date, Event, City, State, Country, event_link, is_completed
                FROM events 
                WHERE Date >= date('now') 
                    AND is_completed = 0
                ORDER BY Date ASC 
                LIMIT 1
            `);

            if (!currentEvent?.[0]) {
                // If no current event, fetch upcoming events
                return await this.handleUpcomingEvents(message);
            }

            // Mark this event as completed
            await database.query(`
                UPDATE events
                SET is_completed = 1,
                    completed_at = datetime('now')
                WHERE event_id = ?
            `, [currentEvent[0].event_id]);

            // Get the next event
            const nextEvent = await database.query(`
                SELECT DISTINCT 
                    event_id, Date, Event, City, State, Country, event_link
                FROM events
                WHERE Date > ?
                    AND is_completed = 0
                ORDER BY Date ASC
                LIMIT 1
            `, [currentEvent[0].Date]);

            const embed = new EmbedBuilder()
                .setColor('#00ff00')
                .setTitle('✅ Events Advanced Successfully')
                .setDescription([
                    '**Previous Event:**',
                    `Event: ${currentEvent[0].Event}`,
                    `Date: ${new Date(currentEvent[0].Date).toLocaleDateString('en-US', {
                        weekday: 'long',
                        month: 'long',
                        day: 'numeric'
                    })}`,
                    '',
                    nextEvent?.[0] ? 
                        [
                            '**Next Upcoming Event:**',
                            `Event: ${nextEvent[0].Event}`,
                            `Date: ${new Date(nextEvent[0].Date).toLocaleDateString('en-US', {
                                weekday: 'long',
                                month: 'long',
                                day: 'numeric'
                            })}`,
                            `Location: ${nextEvent[0].City}, ${nextEvent[0].Country}`
                        ].join('\n') :
                        'No upcoming events found.',
                    '',
                    'Use `$upcoming` to view the new current event.'
                ].join('\n'));

            await message.reply({ 
                embeds: [embed],
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