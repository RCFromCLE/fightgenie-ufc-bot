const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const axios = require('axios');
const cheerio = require('cheerio');

const db = new sqlite3.Database(path.join(__dirname, "ufc_database.sqlite"));

async function query(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) {
        console.error("Database query error:", err);
        reject(err);
      } else {
        resolve(rows);
      }
    });
  });
}

async function completeFixWalkerEvent() {
  try {
    console.log("=== COMPLETE FIX FOR WALKER VS ZHANG EVENT ===\n");
    
    // Step 1: Find all event_ids related to Walker vs Zhang
    console.log("1. Finding all related event_ids...");
    const relatedEvents = await query(`
      SELECT DISTINCT event_id, Event, COUNT(*) as fight_count
      FROM events 
      WHERE Event LIKE '%Walker%' AND Event LIKE '%Zhang%'
      GROUP BY event_id, Event
      ORDER BY event_id DESC
    `);
    
    console.log("Found related events:");
    relatedEvents.forEach(event => {
      console.log(`  Event ID ${event.event_id}: ${event.Event} (${event.fight_count} fights)`);
    });
    
    // Step 2: Clean up ALL related data thoroughly
    console.log("\n2. Cleaning up ALL related data...");
    
    for (const event of relatedEvents) {
      console.log(`Cleaning up event_id ${event.event_id}...`);
      
      // Delete market analysis
      await query(`DELETE FROM market_analysis WHERE event_id = ?`, [event.event_id]);
      
      // Delete prediction outcomes
      await query(`DELETE FROM prediction_outcomes WHERE event_id = ?`, [event.event_id]);
      
      // Delete stored predictions
      await query(`DELETE FROM stored_predictions WHERE event_id = ?`, [event.event_id]);
      
      // Delete odds history
      await query(`DELETE FROM odds_history WHERE event_id = ?`, [event.event_id]);
      
      // Delete events
      await query(`DELETE FROM events WHERE event_id = ?`, [event.event_id]);
      
      console.log(`✓ Cleaned up event_id ${event.event_id}`);
    }
    
    // Step 3: Verify cleanup
    console.log("\n3. Verifying cleanup...");
    const remainingEvents = await query(`
      SELECT event_id, Event, fighter1, fighter2 
      FROM events 
      WHERE Event LIKE '%Walker%' AND Event LIKE '%Zhang%'
    `);
    
    if (remainingEvents.length > 0) {
      console.log("⚠️ Still found remaining events:");
      remainingEvents.forEach(event => {
        console.log(`  ID ${event.event_id}: ${event.Event} - ${event.fighter1} vs ${event.fighter2}`);
      });
      
      // Force delete any remaining
      await query(`DELETE FROM events WHERE Event LIKE '%Walker%' AND Event LIKE '%Zhang%'`);
      console.log("✓ Force deleted remaining events");
    } else {
      console.log("✓ All Walker vs Zhang events cleaned up");
    }
    
    // Step 4: Get a truly fresh event_id
    console.log("\n4. Getting fresh event_id...");
    const maxEventIdResult = await query(`SELECT MAX(event_id) as max_id FROM events`);
    const nextEventId = (maxEventIdResult[0]?.max_id || 0) + 1;
    console.log(`✓ Using fresh event_id: ${nextEventId}`);
    
    // Step 5: Scrape the full fight card
    console.log("\n5. Scraping full fight card...");
    const eventLink = 'http://www.ufcstats.com/event-details/754968e325d6f60d';
    const response = await axios.get(eventLink);
    const $ = cheerio.load(response.data);
    
    const fights = [];
    $('.b-fight-details__table-row').each((idx, row) => {
      const $row = $(row);
      
      const fighters = $row.find('.b-link.b-link_style_black')
        .map((_, el) => $(el).text().trim())
        .get()
        .filter(name => name && !name.includes('View') && !name.includes('Matchup'));
      
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
      }
    });
    
    console.log(`✓ Scraped ${fights.length} fights`);
    
    // Step 6: Store all fights with the same event_id
    console.log("\n6. Storing all fights...");
    
    for (let i = 0; i < fights.length; i++) {
      const fight = fights[i];
      
      try {
        await query(`
          INSERT INTO events (
            event_id, Event, Date, City, State, Country,
            fighter1, fighter2, WeightClass,
            event_link, is_main_card
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          nextEventId,
          'UFC Fight Night: Walker vs. Zhang',
          '2025-08-23',
          'Shanghai',
          'Hebei',
          'China',
          fight.fighter1,
          fight.fighter2,
          fight.WeightClass,
          eventLink,
          fight.is_main_card
        ]);
        
        console.log(`✓ Stored: ${fight.fighter1} vs ${fight.fighter2} (${fight.WeightClass}) - Main Card: ${fight.is_main_card ? 'Yes' : 'No'}`);
      } catch (error) {
        console.error(`❌ Failed to store fight ${i + 1}: ${fight.fighter1} vs ${fight.fighter2}`);
        console.error(`Error: ${error.message}`);
        throw error;
      }
    }
    
    console.log(`\n✅ Successfully stored ${fights.length} fights for UFC Fight Night: Walker vs. Zhang with event_id ${nextEventId}`);
    
    // Step 7: Final verification
    console.log("\n7. Final verification...");
    const storedFights = await query(`
      SELECT fighter1, fighter2, WeightClass, is_main_card
      FROM events 
      WHERE event_id = ?
      ORDER BY is_main_card DESC, rowid ASC
    `, [nextEventId]);
    
    console.log(`✓ Final verification: Found ${storedFights.length} fights in database`);
    console.log("\nMain Card:");
    storedFights.filter(f => f.is_main_card === 1).forEach((fight, index) => {
      console.log(`  ${index + 1}. ${fight.fighter1} vs ${fight.fighter2} (${fight.WeightClass})`);
    });
    
    console.log("\nPreliminary Card:");
    storedFights.filter(f => f.is_main_card === 0).forEach((fight, index) => {
      console.log(`  ${index + 1}. ${fight.fighter1} vs ${fight.fighter2} (${fight.WeightClass})`);
    });
    
    console.log(`\n🎉 Event successfully fixed! The Discord bot should now show all ${storedFights.length} fights.`);
    
  } catch (error) {
    console.error("Error in complete fix:", error);
  } finally {
    db.close();
  }
}

completeFixWalkerEvent();
