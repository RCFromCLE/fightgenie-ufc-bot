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

async function safeDeleteEvent(rowid) {
  try {
    console.log(`Starting safe deletion of event with rowid: ${rowid}`);
    
    // First, get the event_id for this rowid
    const eventInfo = await query("SELECT event_id, Event FROM events WHERE rowid = ?", [rowid]);
    if (!eventInfo || eventInfo.length === 0) {
      console.log(`No event found with rowid: ${rowid}`);
      return;
    }
    
    const eventId = eventInfo[0].event_id;
    const eventName = eventInfo[0].Event;
    console.log(`Found event: ${eventName} (event_id: ${eventId})`);
    
    // Check what dependent records exist
    console.log("\nChecking dependent records...");
    
    const predictions = await query("SELECT COUNT(*) as count FROM stored_predictions WHERE event_id = ?", [eventId]);
    console.log(`- Stored predictions: ${predictions[0].count}`);
    
    const outcomes = await query("SELECT COUNT(*) as count FROM prediction_outcomes WHERE event_id = ?", [eventId]);
    console.log(`- Prediction outcomes: ${outcomes[0].count}`);
    
    const odds = await query("SELECT COUNT(*) as count FROM odds_history WHERE event_id = ?", [eventId]);
    console.log(`- Odds history: ${odds[0].count}`);
    
    // Check if there are multiple events with the same event_id
    const sameEventId = await query("SELECT COUNT(*) as count FROM events WHERE event_id = ?", [eventId]);
    console.log(`- Events with same event_id: ${sameEventId[0].count}`);
    
    console.log("\nStarting deletion process...");
    
    // Delete dependent records first
    if (outcomes[0].count > 0) {
      console.log("Deleting prediction outcomes...");
      await query("DELETE FROM prediction_outcomes WHERE event_id = ?", [eventId]);
      console.log("✓ Prediction outcomes deleted");
    }
    
    if (predictions[0].count > 0) {
      console.log("Deleting stored predictions...");
      await query("DELETE FROM stored_predictions WHERE event_id = ?", [eventId]);
      console.log("✓ Stored predictions deleted");
    }
    
    if (odds[0].count > 0) {
      console.log("Deleting odds history...");
      await query("DELETE FROM odds_history WHERE event_id = ?", [eventId]);
      console.log("✓ Odds history deleted");
    }
    
    // Now delete the specific event record by rowid
    console.log("Deleting the event record...");
    const result = await query("DELETE FROM events WHERE rowid = ?", [rowid]);
    console.log("✓ Event record deleted");
    
    console.log(`\nSuccessfully deleted event with rowid: ${rowid}`);
    
  } catch (error) {
    console.error("Error during safe deletion:", error);
    throw error;
  }
}

// If you want to delete just the specific rowid without affecting other events with the same event_id
async function safeDeleteSpecificRow(rowid) {
  try {
    console.log(`Starting deletion of specific row with rowid: ${rowid}`);
    
    // Get the event info
    const eventInfo = await query("SELECT event_id, Event, fighter1, fighter2 FROM events WHERE rowid = ?", [rowid]);
    if (!eventInfo || eventInfo.length === 0) {
      console.log(`No event found with rowid: ${rowid}`);
      return;
    }
    
    console.log(`Found event row: ${eventInfo[0].Event} - ${eventInfo[0].fighter1} vs ${eventInfo[0].fighter2}`);
    
    // Check if there are other rows with the same event_id
    const sameEventId = await query("SELECT COUNT(*) as count FROM events WHERE event_id = ? AND rowid != ?", [eventInfo[0].event_id, rowid]);
    
    if (sameEventId[0].count > 0) {
      console.log(`There are ${sameEventId[0].count} other rows with the same event_id. Only deleting the specific row.`);
      
      // Just delete this specific row - no need to delete dependent records since other rows with same event_id exist
      await query("DELETE FROM events WHERE rowid = ?", [rowid]);
      console.log("✓ Specific event row deleted");
    } else {
      console.log("This is the only row with this event_id. Need to delete dependent records first.");
      // Use the full safe delete process
      await safeDeleteEvent(rowid);
    }
    
  } catch (error) {
    console.error("Error during specific row deletion:", error);
    throw error;
  }
}

// Main execution
const rowid = 20711; // The rowid you want to delete

console.log("Choose deletion method:");
console.log("1. Delete all records related to this event_id (full cleanup)");
console.log("2. Delete only the specific row (if other rows with same event_id exist)");

// For now, let's use the safer specific row deletion
safeDeleteSpecificRow(rowid)
  .then(() => {
    console.log("Deletion completed successfully!");
    db.close();
  })
  .catch((error) => {
    console.error("Deletion failed:", error);
    db.close();
    process.exit(1);
  });
