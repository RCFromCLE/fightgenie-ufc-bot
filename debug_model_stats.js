const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'ufc_database.sqlite');
const db = new sqlite3.Database(dbPath);

async function debugModelStats() {
    console.log('=== Debugging Model Stats Storage ===\n');
    
    // First, let's see all unique model_used values
    db.all(`
        SELECT DISTINCT model_used, COUNT(*) as count
        FROM stored_predictions
        GROUP BY model_used
        ORDER BY count DESC
    `, [], (err, rows) => {
        if (err) {
            console.error('Error querying model_used values:', err);
            return;
        }
        
        console.log('Unique model_used values in database:');
        rows.forEach(row => {
            console.log(`  - "${row.model_used}": ${row.count} predictions`);
        });
        
        // Now let's check a specific event that should have both GPT and Claude
        console.log('\n=== Checking Recent Event Predictions ===\n');
        
        db.all(`
            SELECT 
                sp.event_id,
                e.Event as event_name,
                sp.model_used,
                sp.card_type,
                sp.created_at,
                LENGTH(sp.prediction_data) as data_length
            FROM stored_predictions sp
            JOIN events e ON sp.event_id = e.event_id
            WHERE e.Date >= date('now', '-30 days')
            ORDER BY sp.created_at DESC
            LIMIT 20
        `, [], (err, rows) => {
            if (err) {
                console.error('Error querying recent predictions:', err);
                return;
            }
            
            console.log('Recent predictions (last 30 days):');
            rows.forEach(row => {
                console.log(`Event: ${row.event_name} (ID: ${row.event_id})`);
                console.log(`  Model: "${row.model_used}"`);
                console.log(`  Card: ${row.card_type}`);
                console.log(`  Created: ${row.created_at}`);
                console.log(`  Data size: ${row.data_length} bytes\n`);
            });
            
            // Check if we have any Claude predictions at all
            db.get(`
                SELECT COUNT(*) as count
                FROM stored_predictions
                WHERE LOWER(model_used) LIKE '%claude%'
            `, [], (err, row) => {
                if (err) {
                    console.error('Error counting Claude predictions:', err);
                    db.close();
                    return;
                }
                
                console.log(`\nTotal predictions with 'claude' in model_used: ${row.count}`);
                
                // Check different variations
                const variations = ['claude', 'Claude', 'claude-3-5-sonnet', 'claude-3.5-sonnet'];
                
                Promise.all(variations.map(variant => 
                    new Promise((resolve) => {
                        db.get(`
                            SELECT COUNT(*) as count
                            FROM stored_predictions
                            WHERE model_used = ?
                        `, [variant], (err, row) => {
                            resolve({ variant, count: row ? row.count : 0 });
                        });
                    })
                )).then(results => {
                    console.log('\nChecking specific variations:');
                    results.forEach(r => {
                        console.log(`  "${r.variant}": ${r.count} predictions`);
                    });
                    
                    db.close();
                });
            });
        });
    });
}

debugModelStats();
