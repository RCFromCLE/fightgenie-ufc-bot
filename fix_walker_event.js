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

async function fixWalkerEvent() {
  try {
    console.log("=== FIXING WALKER VS ZHANG EVENT ===\n");
    
    // Step 1: Clean up the incomplete event data
    console.log("1. Cleaning up incomplete event data...");
    
    // Delete any related predictions first
    await query(`
      DELETE FROM stored_predictions 
      WHERE event_id IN (SELECT event_id FROM events WHERE Event = 'UFC Fight Night: Walker vs. Zhang')
    `);
    console.log("✓ Deleted related predictions");
    
    // Delete the incomplete event data
    await query(`DELETE FROM events WHERE Event = 'UFC Fight Night: Walker vs. Zhang'`);
    console.log("✓ Deleted incomplete event data");
    
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
    
    // Step 3: Get the next available event_id
    console.log("\n3. Getting next available event_id...");
    const maxEventIdResult = await query(`SELECT MAX(event_id) as max_id FROM events`);
    const nextEventId = (maxEventIdResult[0]?.max_id || 0) + 1;
    console.log(`✓ Using event_id: ${nextEventId}`);
    
    // Step 4: Store all fights with the same event_id
    console.log("\n4. Storing all fights...");
    
    for (let i = 0; i < fights.length; i++) {
      const fight = fights[i];
      
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
    }
    
    console.log(`\n✅ Successfully stored ${fights.length} fights for UFC Fight Night: Walker vs. Zhang with event_id ${nextEventId}`);
    
    // Step 5: Verify the fix
    console.log("\n5. Verifying the fix...");
    const storedFights = await query(`
      SELECT fighter1, fighter2, WeightClass, is_main_card
      FROM events 
      WHERE event_id = ?
      ORDER BY is_main_card DESC, rowid ASC
    `, [nextEventId]);
    
    console.log(`✓ Verification: Found ${storedFights.length} fights in database`);
    storedFights.forEach((fight, index) => {
      console.log(`  ${index + 1}. ${fight.fighter1} vs ${fight.fighter2} (${fight.WeightClass}) - Main Card: ${fight.is_main_card ? 'Yes' : 'No'}`);
    });
    
  } catch (error) {
    console.error("Error fixing Walker event:", error);
  } finally {
    db.close();
  }
}

fixWalkerEvent();
