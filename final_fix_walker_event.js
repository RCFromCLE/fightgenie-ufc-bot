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

async function finalFixWalkerEvent() {
  try {
    console.log("=== FINAL FIX FOR WALKER VS ZHANG EVENT ===\n");
    
    // Step 1: Complete cleanup of all Walker vs Zhang data
    console.log("1. Complete cleanup...");
    
    // Delete all related data
    await query(`DELETE FROM market_analysis WHERE event_id IN (SELECT event_id FROM events WHERE Event LIKE '%Walker%' AND Event LIKE '%Zhang%')`);
    await query(`DELETE FROM prediction_outcomes WHERE event_id IN (SELECT event_id FROM events WHERE Event LIKE '%Walker%' AND Event LIKE '%Zhang%')`);
    await query(`DELETE FROM stored_predictions WHERE event_id IN (SELECT event_id FROM events WHERE Event LIKE '%Walker%' AND Event LIKE '%Zhang%')`);
    await query(`DELETE FROM odds_history WHERE event_id IN (SELECT event_id FROM events WHERE Event LIKE '%Walker%' AND Event LIKE '%Zhang%')`);
    await query(`DELETE FROM events WHERE Event LIKE '%Walker%' AND Event LIKE '%Zhang%'`);
    
    console.log("✓ All Walker vs Zhang data cleaned up");
    
    // Step 2: Scrape the full fight card
    console.log("\n2. Scraping full fight card...");
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
    
    // Step 3: Store fights using auto-increment approach
    console.log("\n3. Storing fights with auto-increment approach...");
    
    let sharedEventId = null;
    
    for (let i = 0; i < fights.length; i++) {
      const fight = fights[i];
      
      if (i === 0) {
        // First fight: let SQLite auto-generate the event_id
        await query(`
          INSERT INTO events (
            Event, Date, City, State, Country,
            fighter1, fighter2, WeightClass,
            event_link, is_main_card
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
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
        
        // Get the auto-generated event_id
        const result = await query(`
          SELECT event_id FROM events 
          WHERE Event = 'UFC Fight Night: Walker vs. Zhang' 
          AND fighter1 = ? AND fighter2 = ?
          ORDER BY rowid DESC LIMIT 1
        `, [fight.fighter1, fight.fighter2]);
        
        sharedEventId = result[0].event_id;
        console.log(`✓ First fight stored with auto-generated event_id: ${sharedEventId}`);
        console.log(`  ${fight.fighter1} vs ${fight.fighter2} (${fight.WeightClass}) - Main Card: ${fight.is_main_card ? 'Yes' : 'No'}`);
        
      } else {
        // Subsequent fights: insert without event_id, then update to match the shared one
        await query(`
          INSERT INTO events (
            Event, Date, City, State, Country,
            fighter1, fighter2, WeightClass,
            event_link, is_main_card
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
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
        
        // Get the rowid of the just-inserted record
        const insertResult = await query(`
          SELECT rowid, event_id FROM events 
          WHERE Event = 'UFC Fight Night: Walker vs. Zhang' 
          AND fighter1 = ? AND fighter2 = ?
          ORDER BY rowid DESC LIMIT 1
        `, [fight.fighter1, fight.fighter2]);
        
        const insertedRowId = insertResult[0].rowid;
        const insertedEventId = insertResult[0].event_id;
        
        // Update the event_id to match the shared one
        await query(`
          UPDATE events 
          SET event_id = ? 
          WHERE rowid = ?
        `, [sharedEventId, insertedRowId]);
        
        console.log(`✓ Fight ${i + 1} stored and updated to use shared event_id ${sharedEventId}`);
        console.log(`  ${fight.fighter1} vs ${fight.fighter2} (${fight.WeightClass}) - Main Card: ${fight.is_main_card ? 'Yes' : 'No'}`);
      }
    }
    
    console.log(`\n✅ Successfully stored ${fights.length} fights with shared event_id ${sharedEventId}`);
    
    // Step 4: Final verification
    console.log("\n4. Final verification...");
    const storedFights = await query(`
      SELECT fighter1, fighter2, WeightClass, is_main_card
      FROM events 
      WHERE event_id = ?
      ORDER BY is_main_card DESC, rowid ASC
    `, [sharedEventId]);
    
    console.log(`✓ Final verification: Found ${storedFights.length} fights in database`);
    console.log("\nMain Card:");
    storedFights.filter(f => f.is_main_card === 1).forEach((fight, index) => {
      console.log(`  ${index + 1}. ${fight.fighter1} vs ${fight.fighter2} (${fight.WeightClass})`);
    });
    
    console.log("\nPreliminary Card:");
    storedFights.filter(f => f.is_main_card === 0).forEach((fight, index) => {
      console.log(`  ${index + 1}. ${fight.fighter1} vs ${fight.fighter2} (${fight.WeightClass})`);
    });
    
    console.log(`\n🎉 SUCCESS! Event fixed with event_id ${sharedEventId}. The Discord bot should now show all ${storedFights.length} fights.`);
    console.log("\nTo test: Use /upcoming in Discord and you should see the full fight card with prelims toggle working.");
    
  } catch (error) {
    console.error("Error in final fix:", error);
  } finally {
    db.close();
  }
}

finalFixWalkerEvent();
