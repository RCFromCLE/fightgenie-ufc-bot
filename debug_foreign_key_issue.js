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

async function debugForeignKeyIssue() {
  try {
    console.log("=== DEBUGGING FOREIGN KEY CONSTRAINT ISSUE ===\n");
    
    // 1. Check all tables in the database
    console.log("1. Database Tables:");
    const tables = await query("SELECT name FROM sqlite_master WHERE type='table'");
    tables.forEach(table => console.log(`   - ${table.name}`));
    console.log();
    
    // 2. Check foreign key constraints
    console.log("2. Foreign Key Constraints:");
    console.log("   Checking if foreign keys are enabled...");
    const fkEnabled = await query("PRAGMA foreign_keys");
    console.log(`   Foreign keys enabled: ${fkEnabled[0]?.foreign_keys === 1 ? 'YES' : 'NO'}`);
    console.log();
    
    // 3. Get the most recent event
    console.log("3. Most Recent Event:");
    const recentEvent = await query(`
      SELECT event_id, Event, Date, COUNT(*) as fight_count
      FROM events 
      WHERE Date >= date('now', '-7 days')
      GROUP BY event_id, Event, Date
      ORDER BY Date DESC 
      LIMIT 1
    `);
    
    if (recentEvent.length > 0) {
      const event = recentEvent[0];
      console.log(`   Event: ${event.Event}`);
      console.log(`   Date: ${event.Date}`);
      console.log(`   Event ID: ${event.event_id}`);
      console.log(`   Fight Count: ${event.fight_count}`);
      console.log();
      
      // 4. Check what references this event_id
      console.log("4. References to this event_id:");
      
      // Check stored_predictions
      const predictions = await query("SELECT COUNT(*) as count FROM stored_predictions WHERE event_id = ?", [event.event_id]);
      console.log(`   - stored_predictions: ${predictions[0].count} records`);
      
      // Check prediction_outcomes
      const outcomes = await query("SELECT COUNT(*) as count FROM prediction_outcomes WHERE event_id = ?", [event.event_id]);
      console.log(`   - prediction_outcomes: ${outcomes[0].count} records`);
      
      // Check odds_history
      const odds = await query("SELECT COUNT(*) as count FROM odds_history WHERE event_id = ?", [event.event_id]);
      console.log(`   - odds_history: ${odds[0].count} records`);
      
      // Check if there are other tables that might reference event_id
      const allTables = ['market_analysis', 'cache', 'fighters', 'fighter_stats'];
      for (const tableName of allTables) {
        try {
          const tableInfo = await query(`PRAGMA table_info(${tableName})`);
          const hasEventId = tableInfo.some(col => col.name === 'event_id');
          if (hasEventId) {
            const count = await query(`SELECT COUNT(*) as count FROM ${tableName} WHERE event_id = ?`, [event.event_id]);
            console.log(`   - ${tableName}: ${count[0].count} records`);
          }
        } catch (err) {
          // Table might not exist, skip
        }
      }
      console.log();
      
      // 5. Check the specific rowid that's causing issues (20726)
      console.log("5. Checking problematic rowid (20726):");
      const problematicRow = await query("SELECT * FROM events WHERE rowid = 20726");
      if (problematicRow.length > 0) {
        const row = problematicRow[0];
        console.log(`   Found row: ${row.Event} - ${row.fighter1} vs ${row.fighter2}`);
        console.log(`   Event ID: ${row.event_id}`);
        console.log(`   Date: ${row.Date}`);
        
        // Check references to this specific event_id
        const refPredictions = await query("SELECT COUNT(*) as count FROM stored_predictions WHERE event_id = ?", [row.event_id]);
        const refOutcomes = await query("SELECT COUNT(*) as count FROM prediction_outcomes WHERE event_id = ?", [row.event_id]);
        const refOdds = await query("SELECT COUNT(*) as count FROM odds_history WHERE event_id = ?", [row.event_id]);
        
        console.log(`   References - predictions: ${refPredictions[0].count}, outcomes: ${refOutcomes[0].count}, odds: ${refOdds[0].count}`);
      } else {
        console.log("   Rowid 20726 not found");
      }
      console.log();
      
      // 6. Show table schemas to understand foreign key relationships
      console.log("6. Table Schemas with Foreign Keys:");
      
      const importantTables = ['events', 'stored_predictions', 'prediction_outcomes', 'odds_history'];
      for (const tableName of importantTables) {
        try {
          console.log(`\n   ${tableName.toUpperCase()} table:`);
          const schema = await query(`SELECT sql FROM sqlite_master WHERE type='table' AND name='${tableName}'`);
          if (schema.length > 0) {
            console.log(`   ${schema[0].sql}`);
          }
        } catch (err) {
          console.log(`   Error getting schema for ${tableName}: ${err.message}`);
        }
      }
      
    } else {
      console.log("   No recent events found");
    }
    
  } catch (error) {
    console.error("Error during debugging:", error);
  } finally {
    db.close();
  }
}

// Run the debug
debugForeignKeyIssue();
