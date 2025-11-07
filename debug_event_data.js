const sqlite3 = require("sqlite3").verbose();
const path = require("path");

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

async function debugEventData() {
  try {
    console.log("=== DEBUGGING EVENT DATA ===\n");
    
    // Check current events
    console.log("1. Current events in database:");
    const currentEvents = await query(`
      SELECT event_id, Event, Date, fighter1, fighter2, WeightClass, is_main_card, is_completed
      FROM events 
      WHERE Event LIKE '%Walker%' OR Event LIKE '%Zhang%'
      ORDER BY event_id DESC
    `);
    
    if (currentEvents.length === 0) {
      console.log("No Walker vs Zhang events found");
      
      // Check all recent events
      console.log("\n2. All recent events:");
      const recentEvents = await query(`
        SELECT event_id, Event, Date, fighter1, fighter2, WeightClass, is_main_card, is_completed
        FROM events 
        WHERE Date >= '2025-08-20'
        ORDER BY event_id DESC
        LIMIT 20
      `);
      
      recentEvents.forEach(event => {
        console.log(`ID: ${event.event_id}, Event: ${event.Event}, Fight: ${event.fighter1} vs ${event.fighter2}, Main: ${event.is_main_card}, Completed: ${event.is_completed}`);
      });
    } else {
      currentEvents.forEach(event => {
        console.log(`ID: ${event.event_id}, Event: ${event.Event}, Fight: ${event.fighter1} vs ${event.fighter2}, Main: ${event.is_main_card}, Completed: ${event.is_completed}`);
      });
      
      // Check if there are multiple fights for the same event_id
      const eventId = currentEvents[0].event_id;
      console.log(`\n3. All fights for event_id ${eventId}:`);
      const allFights = await query(`
        SELECT event_id, fighter1, fighter2, WeightClass, is_main_card
        FROM events 
        WHERE event_id = ?
        ORDER BY is_main_card DESC, rowid ASC
      `, [eventId]);
      
      allFights.forEach((fight, index) => {
        console.log(`Fight ${index + 1}: ${fight.fighter1} vs ${fight.fighter2} (${fight.WeightClass}) - Main Card: ${fight.is_main_card}`);
      });
    }
    
    // Check for any duplicate event_ids
    console.log("\n4. Checking for duplicate event_ids:");
    const duplicates = await query(`
      SELECT event_id, COUNT(*) as count
      FROM events 
      WHERE Date >= '2025-08-20'
      GROUP BY event_id
      HAVING COUNT(*) > 1
      ORDER BY count DESC
    `);
    
    if (duplicates.length > 0) {
      console.log("Found duplicate event_ids:");
      duplicates.forEach(dup => {
        console.log(`Event ID ${dup.event_id}: ${dup.count} records`);
      });
    } else {
      console.log("No duplicate event_ids found");
    }
    
    // Check the maximum event_id
    console.log("\n5. Maximum event_id in database:");
    const maxId = await query(`SELECT MAX(event_id) as max_id FROM events`);
    console.log(`Max event_id: ${maxId[0].max_id}`);
    
  } catch (error) {
    console.error("Error debugging event data:", error);
  } finally {
    db.close();
  }
}

debugEventData();
