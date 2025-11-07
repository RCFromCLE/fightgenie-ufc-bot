const sqlite3 = require("sqlite3").verbose();
const path = require("path");

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

async function checkWalkerEvent() {
  try {
    console.log("=== CHECKING WALKER VS ZHANG EVENT ===\n");
    
    // Check all events with Walker or Zhang
    const walkerEvents = await query(`
      SELECT rowid, event_id, Event, Date, fighter1, fighter2, WeightClass, is_main_card, is_completed
      FROM events 
      WHERE Event LIKE '%Walker%' OR Event LIKE '%Zhang%' OR fighter1 LIKE '%Walker%' OR fighter2 LIKE '%Walker%' OR fighter1 LIKE '%Zhang%' OR fighter2 LIKE '%Zhang%'
      ORDER BY rowid DESC
    `);
    
    console.log(`Found ${walkerEvents.length} Walker/Zhang related events:`);
    walkerEvents.forEach(event => {
      console.log(`ROWID: ${event.rowid}, ID: ${event.event_id}, Event: ${event.Event}, Fight: ${event.fighter1} vs ${event.fighter2}, Main: ${event.is_main_card}, Completed: ${event.is_completed}`);
    });
    
    if (walkerEvents.length > 0) {
      const eventId = walkerEvents[0].event_id;
      console.log(`\nChecking all fights for event_id ${eventId}:`);
      
      const allFights = await query(`
        SELECT rowid, event_id, fighter1, fighter2, WeightClass, is_main_card
        FROM events 
        WHERE event_id = ?
        ORDER BY is_main_card DESC, rowid ASC
      `, [eventId]);
      
      console.log(`Found ${allFights.length} fights for event_id ${eventId}:`);
      allFights.forEach((fight, index) => {
        console.log(`${index + 1}. ROWID: ${fight.rowid}, ${fight.fighter1} vs ${fight.fighter2} (${fight.WeightClass}) - Main Card: ${fight.is_main_card}`);
      });
    }
    
    // Check recent events to see the pattern
    console.log("\n=== RECENT EVENTS (last 10) ===");
    const recentEvents = await query(`
      SELECT rowid, event_id, Event, Date, fighter1, fighter2, WeightClass, is_main_card
      FROM events 
      WHERE Date >= '2025-08-20'
      ORDER BY rowid DESC
      LIMIT 10
    `);
    
    recentEvents.forEach(event => {
      console.log(`ROWID: ${event.rowid}, ID: ${event.event_id}, Event: ${event.Event}, Fight: ${event.fighter1} vs ${event.fighter2}`);
    });
    
  } catch (error) {
    console.error("Error:", error);
  } finally {
    db.close();
  }
}

checkWalkerEvent();
