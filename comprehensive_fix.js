const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const axios = require("axios");
const cheerio = require("cheerio");

// Connect to the database
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

async function runQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) {
        console.error("Database run error:", err);
        reject(err);
      } else {
        resolve({ lastID: this.lastID, changes: this.changes });
      }
    });
  });
}

async function comprehensiveFix() {
  try {
    console.log("=== COMPREHENSIVE FIX FOR FIGHT GENIE BOT ===\n");
    
    // 1. First, let's check the current state
    console.log("1. Checking current database state...");
    const currentEvents = await query(`
      SELECT event_id, Event, Date, COUNT(*) as fight_count, is_completed
      FROM events 
      WHERE Event LIKE '%Walker%Zhang%' OR Date >= date('now', '-7 days')
      GROUP BY event_id, Event, Date
      ORDER BY Date DESC
    `);
    
    console.log("Current events:");
    currentEvents.forEach(event => {
      console.log(`   ID: ${event.event_id}, Event: ${event.Event}, Fights: ${event.fight_count}, Completed: ${event.is_completed}`);
    });
    console.log();
    
    // 2. Fix the foreign key constraint issue by creating a safe delete function
    console.log("2. Creating safe event deletion function...");
    
    async function safeDeleteEvent(eventName) {
      console.log(`   Safely deleting event: ${eventName}`);
      
      // Get all event_ids for this event name
      const eventIds = await query("SELECT DISTINCT event_id FROM events WHERE Event = ?", [eventName]);
      
      for (const { event_id } of eventIds) {
        console.log(`   Cleaning up event_id: ${event_id}`);
        
        // Delete dependent records first (in correct order)
        await query("DELETE FROM prediction_outcomes WHERE event_id = ?", [event_id]);
        await query("DELETE FROM stored_predictions WHERE event_id = ?", [event_id]);
        await query("DELETE FROM odds_history WHERE event_id = ?", [event_id]);
        
        // Check if market_analysis table exists and has event_id column
        try {
          const marketAnalysisExists = await query("SELECT name FROM sqlite_master WHERE type='table' AND name='market_analysis'");
          if (marketAnalysisExists.length > 0) {
            const columns = await query("PRAGMA table_info(market_analysis)");
            const hasEventId = columns.some(col => col.name === 'event_id');
            if (hasEventId) {
              await query("DELETE FROM market_analysis WHERE event_id = ?", [event_id]);
            }
          }
        } catch (err) {
          // Table might not exist, continue
        }
      }
      
      // Finally delete the events
      await query("DELETE FROM events WHERE Event = ?", [eventName]);
      console.log(`   ✓ Successfully deleted all data for: ${eventName}`);
    }
    
    // 3. Clean up the Walker vs Zhang event completely
    console.log("3. Cleaning up Walker vs Zhang event...");
    await safeDeleteEvent("UFC Fight Night: Walker vs. Zhang");
    
    // 4. Scrape the full fight card
    console.log("4. Scraping full fight card from UFCStats...");
    const eventUrl = "http://www.ufcstats.com/event-details/754968e325d6f60d";
    
    const response = await axios.get(eventUrl);
    const $ = cheerio.load(response.data);
    
    const fights = [];
    let fightIndex = 0;
    
    $('.b-fight-details__table-row').each((index, row) => {
      const $row = $(row);
      
      // Get fighter names
      const fighters = $row.find('.b-link.b-link_style_black')
        .map((_, el) => $(el).text().trim())
        .get()
        .filter(name => name && !name.includes('View') && !name.includes('Matchup'));
      
      // Get weight class
      let weightClass = $row.find('.b-fight-details__table-text')
        .filter((_, el) => {
          const text = $(el).text().trim();
          return text.includes('weight') || text.includes('Weight') || 
                 text.includes('Catch') || text.includes('Bantam') || 
                 text.includes('Feather') || text.includes('Light') || 
                 text.includes('Welter') || text.includes('Middle') || 
                 text.includes('Heavy') || text.includes('Fly');
        })
        .first()
        .text()
        .trim();
      
      // If no weight class found, try other selectors
      if (!weightClass) {
        weightClass = $row.find('td').eq(6).text().trim() || 
                     $row.find('td').eq(7).text().trim() || 
                     'TBD';
      }
      
      if (fighters.length === 2) {
        fights.push({
          fighter1: fighters[0],
          fighter2: fighters[1],
          WeightClass: weightClass || 'TBD',
          is_main_card: fightIndex < 5 ? 1 : 0
        });
        fightIndex++;
      }
    });
    
    console.log(`   ✓ Scraped ${fights.length} fights`);
    
    // 5. Store all fights with proper event_id management
    console.log("5. Storing all fights in database...");
    
    if (fights.length === 0) {
      throw new Error("No fights found to store");
    }
    
    // Get the next available event_id
    const maxEventId = await query("SELECT MAX(event_id) as max_id FROM events");
    const nextEventId = (maxEventId[0]?.max_id || 0) + 1;
    
    console.log(`   Using event_id: ${nextEventId}`);
    
    // Event details
    const eventName = "UFC Fight Night: Walker vs. Zhang";
    const eventDate = "2025-08-23"; // Adjust if needed
    const eventLink = eventUrl;
    
    // Store all fights with the same event_id
    for (let i = 0; i < fights.length; i++) {
      const fight = fights[i];
      
      try {
        await runQuery(`
          INSERT INTO events (
            event_id, Event, Date, City, State, Country,
            fighter1, fighter2, WeightClass,
            event_link, is_main_card, is_completed
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          nextEventId,
          eventName,
          eventDate,
          "Shanghai",
          "",
          "China",
          fight.fighter1,
          fight.fighter2,
          fight.WeightClass,
          eventLink,
          fight.is_main_card,
          0 // Not completed
        ]);
        
        console.log(`   ✓ Stored: ${fight.fighter1} vs ${fight.fighter2} (${fight.WeightClass}) - Main Card: ${fight.is_main_card ? 'Yes' : 'No'}`);
      } catch (error) {
        console.error(`   ❌ Failed to store: ${fight.fighter1} vs ${fight.fighter2} - ${error.message}`);
      }
    }
    
    // 6. Verify the fix
    console.log("\n6. Verifying the fix...");
    const verifyFights = await query(`
      SELECT event_id, fighter1, fighter2, WeightClass, is_main_card
      FROM events 
      WHERE Event = ? 
      ORDER BY is_main_card DESC, event_id ASC
    `, [eventName]);
    
    console.log(`✓ Verification: Found ${verifyFights.length} fights in database`);
    
    const mainCard = verifyFights.filter(f => f.is_main_card === 1);
    const prelims = verifyFights.filter(f => f.is_main_card === 0);
    
    console.log("\nMain Card:");
    mainCard.forEach((fight, index) => {
      console.log(`  ${index + 1}. ${fight.fighter1} vs ${fight.fighter2} (${fight.WeightClass})`);
    });
    
    console.log("\nPreliminary Card:");
    prelims.forEach((fight, index) => {
      console.log(`  ${index + 1}. ${fight.fighter1} vs ${fight.fighter2} (${fight.WeightClass})`);
    });
    
    // 7. Create an improved safe delete function for future use
    console.log("\n7. Creating improved database management functions...");
    
    // Update the database.js file's delete methods to handle foreign keys properly
    const improvedDeleteFunction = `
// Add this method to your DatabaseManager class in database.js
async safeDeleteEventByName(eventName) {
  try {
    console.log(\`Safely deleting event: \${eventName}\`);
    
    // Get all event_ids for this event name
    const eventIds = await this.query("SELECT DISTINCT event_id FROM events WHERE Event = ?", [eventName]);
    
    for (const { event_id } of eventIds) {
      console.log(\`Cleaning up event_id: \${event_id}\`);
      
      // Delete dependent records first (in correct order to avoid foreign key constraints)
      await this.query("DELETE FROM prediction_outcomes WHERE event_id = ?", [event_id]);
      await this.query("DELETE FROM stored_predictions WHERE event_id = ?", [event_id]);
      await this.query("DELETE FROM odds_history WHERE event_id = ?", [event_id]);
      
      // Check for other tables that might reference event_id
      try {
        const marketAnalysisExists = await this.query("SELECT name FROM sqlite_master WHERE type='table' AND name='market_analysis'");
        if (marketAnalysisExists.length > 0) {
          const columns = await this.query("PRAGMA table_info(market_analysis)");
          const hasEventId = columns.some(col => col.name === 'event_id');
          if (hasEventId) {
            await this.query("DELETE FROM market_analysis WHERE event_id = ?", [event_id]);
          }
        }
      } catch (err) {
        // Table might not exist, continue
      }
    }
    
    // Finally delete the events
    const result = await this.query("DELETE FROM events WHERE Event = ?", [eventName]);
    console.log(\`Successfully deleted all data for: \${eventName}\`);
    return result;
  } catch (error) {
    console.error(\`Error safely deleting event \${eventName}:\`, error);
    throw error;
  }
}
`;
    
    console.log("Improved delete function created (see console output for code to add to database.js)");
    console.log(improvedDeleteFunction);
    
    console.log("\n🎉 COMPREHENSIVE FIX COMPLETED!");
    console.log(`✅ Event stored with event_id: ${nextEventId}`);
    console.log(`✅ Total fights: ${verifyFights.length} (${mainCard.length} main card, ${prelims.length} prelims)`);
    console.log("✅ Foreign key constraint issues resolved");
    console.log("\nTo test: Use /upcoming in Discord and you should see the full fight card with prelims toggle working.");
    
  } catch (error) {
    console.error("Error in comprehensive fix:", error);
  } finally {
    db.close();
  }
}

// Run the comprehensive fix
comprehensiveFix();
