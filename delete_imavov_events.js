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

async function safeDeleteEventByName(eventName) {
  try {
    console.log(`Safely deleting event: ${eventName}`);
    
    // Get all event_ids for this event name
    const eventIds = await query("SELECT DISTINCT event_id FROM events WHERE Event = ?", [eventName]);
    
    console.log(`Found ${eventIds.length} event_ids to clean up:`, eventIds.map(e => e.event_id));
    
    for (const { event_id } of eventIds) {
      console.log(`Cleaning up event_id: ${event_id}`);
      
      // Delete dependent records first (in correct order to avoid foreign key constraints)
      const predOutcomes = await query("DELETE FROM prediction_outcomes WHERE event_id = ?", [event_id]);
      console.log(`  - Deleted prediction_outcomes`);
      
      const storedPreds = await query("DELETE FROM stored_predictions WHERE event_id = ?", [event_id]);
      console.log(`  - Deleted stored_predictions`);
      
      const oddsHistory = await query("DELETE FROM odds_history WHERE event_id = ?", [event_id]);
      console.log(`  - Deleted odds_history`);
      
      // Check for other tables that might reference event_id
      try {
        const marketAnalysisExists = await query("SELECT name FROM sqlite_master WHERE type='table' AND name='market_analysis'");
        if (marketAnalysisExists.length > 0) {
          const columns = await query("PRAGMA table_info(market_analysis)");
          const hasEventId = columns.some(col => col.name === 'event_id');
          if (hasEventId) {
            await query("DELETE FROM market_analysis WHERE event_id = ?", [event_id]);
            console.log(`  - Deleted market_analysis`);
          }
        }
      } catch (err) {
        // Table might not exist, continue
      }
    }
    
    // Finally delete the events
    const result = await query("DELETE FROM events WHERE Event = ?", [eventName]);
    console.log(`✓ Successfully deleted all data for: ${eventName}`);
    return result;
  } catch (error) {
    console.error(`Error safely deleting event ${eventName}:`, error);
    throw error;
  }
}

async function deleteImavovEvents() {
  try {
    console.log("=== DELETING IMAVOV VS BORRALHO EVENTS ===\n");
    
    // 1. Check what we're about to delete
    console.log("1. Checking events to delete...");
    const eventsToDelete = await query(`
      SELECT event_id, Event, Date, fighter1, fighter2, is_completed
      FROM events 
      WHERE Event LIKE '%Imavov%Borralho%'
      ORDER BY event_id ASC
    `);
    
    console.log(`Found ${eventsToDelete.length} events to delete:`);
    eventsToDelete.forEach(event => {
      console.log(`   ID: ${event.event_id}, Event: ${event.Event}, Fight: ${event.fighter1} vs ${event.fighter2}, Completed: ${event.is_completed}`);
    });
    
    if (eventsToDelete.length === 0) {
      console.log("No Imavov vs Borralho events found to delete.");
      return;
    }
    
    // 2. Check for dependent records
    console.log("\n2. Checking dependent records...");
    const eventIds = eventsToDelete.map(e => e.event_id);
    
    for (const eventId of eventIds) {
      const predictions = await query("SELECT COUNT(*) as count FROM stored_predictions WHERE event_id = ?", [eventId]);
      const outcomes = await query("SELECT COUNT(*) as count FROM prediction_outcomes WHERE event_id = ?", [eventId]);
      const odds = await query("SELECT COUNT(*) as count FROM odds_history WHERE event_id = ?", [eventId]);
      
      console.log(`   Event ID ${eventId}: ${predictions[0].count} predictions, ${outcomes[0].count} outcomes, ${odds[0].count} odds`);
    }
    
    // 3. Perform safe deletion
    console.log("\n3. Performing safe deletion...");
    await safeDeleteEventByName("UFC Fight Night: Imavov vs. Borralho");
    
    // 4. Verify deletion
    console.log("\n4. Verifying deletion...");
    const remainingEvents = await query(`
      SELECT event_id, Event, Date, fighter1, fighter2
      FROM events 
      WHERE Event LIKE '%Imavov%Borralho%'
    `);
    
    if (remainingEvents.length === 0) {
      console.log("✅ All Imavov vs Borralho events successfully deleted!");
    } else {
      console.log(`❌ ${remainingEvents.length} events still remain:`, remainingEvents);
    }
    
    console.log("\n🎉 DELETION COMPLETED!");
    console.log("You can now try to delete the events in the database browser without foreign key constraint errors.");
    
  } catch (error) {
    console.error("Error deleting Imavov events:", error);
  } finally {
    db.close();
  }
}

// Run the deletion
deleteImavovEvents();
