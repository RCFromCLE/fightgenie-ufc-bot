const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'ufc_database.sqlite');
const db = new sqlite3.Database(dbPath);

const eventId = 20713; // The event being queried

console.log(`\n=== Checking Claude predictions for event_id ${eventId} ===\n`);

// First check what predictions exist for this event
db.all(`
    SELECT 
        event_id,
        model_used,
        card_type,
        created_at,
        LENGTH(prediction_data) as data_size
    FROM stored_predictions
    WHERE event_id = ?
    ORDER BY model_used, card_type
`, [eventId], (err, rows) => {
    if (err) {
        console.error('Error:', err);
        db.close();
        return;
    }
    
    console.log(`Found ${rows.length} predictions for event ${eventId}:`);
    rows.forEach(row => {
        console.log(`  Model: "${row.model_used}", Card: "${row.card_type}", Created: ${row.created_at}`);
    });
    
    // Now check if there's a Claude prediction for a different event_id
    console.log('\n=== Checking for Claude predictions in nearby events ===\n');
    
    db.all(`
        SELECT DISTINCT
            sp.event_id,
            e.Event as event_name,
            sp.model_used,
            COUNT(*) as prediction_count
        FROM stored_predictions sp
        JOIN events e ON sp.event_id = e.event_id
        WHERE e.Event LIKE '%Walker%Zhang%'
           OR e.Event LIKE '%Zhang%Walker%'
        GROUP BY sp.event_id, e.Event, sp.model_used
        ORDER BY sp.event_id, sp.model_used
    `, [], (err, rows) => {
        if (err) {
            console.error('Error:', err);
            db.close();
            return;
        }
        
        console.log('Walker vs Zhang events and their predictions:');
        rows.forEach(row => {
            console.log(`  Event ID: ${row.event_id}, Name: "${row.event_name}"`);
            console.log(`    Model: "${row.model_used}", Count: ${row.prediction_count}`);
        });
        
        db.close();
    });
});
