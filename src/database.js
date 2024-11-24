const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const axios = require("axios");
const cheerio = require("cheerio");
const client = require('../index').client;




class DatabaseManager {
  constructor() {
    this.db = new sqlite3.Database(
      path.join(__dirname, "../ufc_database.sqlite")
    );
    this.initializeDatabase();
  }

  // Core query method used by all other methods
  async query(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) {
          console.error("Database query error:", err);
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  async createCacheTable() {
    try {
        await this.query(`
            CREATE TABLE IF NOT EXISTS cache (
                cache_id INTEGER PRIMARY KEY AUTOINCREMENT,
                cache_key TEXT UNIQUE,
                cache_value TEXT,
                expires_at DATETIME,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await this.query(`
            CREATE INDEX IF NOT EXISTS idx_cache_expiry 
            ON cache(expires_at)
        `);

        // Create cleanup trigger
        await this.query(`
            CREATE TRIGGER IF NOT EXISTS cleanup_expired_cache
            AFTER INSERT ON cache
            BEGIN
                DELETE FROM cache 
                WHERE expires_at < datetime('now');
            END
        `);
    } catch (error) {
        console.error('Error creating cache table:', error);
        throw error;
    }
}

async initializeDatabase() {
    try {
        // Create events table if it doesn't exist
        await this.query(`
            CREATE TABLE IF NOT EXISTS events (
                event_id INTEGER PRIMARY KEY AUTOINCREMENT,
                Date TEXT,
                Event TEXT,
                City TEXT,
                State TEXT,
                Country TEXT,
                Winner TEXT,
                Loser TEXT,
                WeightClass TEXT,
                Round INTEGER,
                Method TEXT,
                event_link TEXT,
                is_main_card INTEGER DEFAULT 0
            )
        `);

        // Create cache table
        await this.createCacheTable();

        // Create fighters table
        await this.createFightersTable();

        // Create fighter_stats table
        await this.createFighterStatsTable();

        // Create stored_predictions table
        await this.createPredictionsTable();

        // Create prediction_outcomes table
        await this.initializePredictionOutcomesTable();

        // Create odds tables
        await this.createOddsTables();

        // Create payment tables
        await this.createPaymentTables();

        console.log("Database tables initialized successfully");
    } catch (error) {
        console.error("Error initializing database:", error);
        throw error;
    }
}

  async createPaymentTables() {
      try {

        
          // First check if tables exist
          const existingTables = await this.query(`
              SELECT name FROM sqlite_master 
              WHERE type='table' AND name='server_subscriptions'
          `);

          if (existingTables.length > 0) {
              console.log('Updating existing server_subscriptions table...');
              
              // Check for missing columns
              const columns = await this.query(`PRAGMA table_info(server_subscriptions)`);
              
              if (!columns.find(col => col.name === 'event_id')) {
                  await this.query(`
                      ALTER TABLE server_subscriptions 
                      ADD COLUMN event_id TEXT
                  `);
              }

              // Create or update indices
              await this.query(`
                  CREATE INDEX IF NOT EXISTS idx_server_subs_server 
                  ON server_subscriptions(server_id)
              `);

              await this.query(`
                  CREATE INDEX IF NOT EXISTS idx_server_subs_expiration 
                  ON server_subscriptions(expiration_date)
              `);
          } else {
              console.log('Creating new server_subscriptions table...');
              
              // Create new table if it doesn't exist
              await this.query(`
                  CREATE TABLE IF NOT EXISTS server_subscriptions (
                      id INTEGER PRIMARY KEY AUTOINCREMENT,
                      server_id TEXT NOT NULL,
                      subscription_type TEXT NOT NULL,
                      payment_id TEXT UNIQUE,
                      status TEXT NOT NULL,
                      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                      expiration_date DATETIME,
                      event_id TEXT
                  )
              `);

              // Create indices
              await this.query(`
                  CREATE INDEX IF NOT EXISTS idx_server_subs_server 
                  ON server_subscriptions(server_id)
              `);

              await this.query(`
                  CREATE INDEX IF NOT EXISTS idx_server_subs_expiration 
                  ON server_subscriptions(expiration_date)
              `);
          }

          await database.query(`
            CREATE TABLE IF NOT EXISTS solana_payments (
                payment_id INTEGER PRIMARY KEY AUTOINCREMENT,
                payment_address TEXT UNIQUE NOT NULL,
                keypair_secret TEXT NOT NULL,
                status TEXT NOT NULL,
                amount_sol DECIMAL(20,8),
                transaction_signature TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                completed_at DATETIME,
                server_id TEXT,
                payment_type TEXT
            )
        `);

        await database.query(`
            CREATE INDEX IF NOT EXISTS idx_solana_payments_address 
            ON solana_payments(payment_address)
        `);

        await database.query(`
            CREATE INDEX IF NOT EXISTS idx_solana_payments_status 
            ON solana_payments(status)
        `);

          // Handle triggers with proper error checking
          try {
              // Check if triggers exist
              const existingTriggers = await this.query(`
                  SELECT name FROM sqlite_master 
                  WHERE type='trigger' 
                  AND (name='update_server_subs_timestamp' OR name='cleanup_expired_subscriptions')
              `);

              // Drop existing triggers if they exist
              if (existingTriggers.length > 0) {
                  console.log('Updating existing triggers...');
                  for (const trigger of existingTriggers) {
                      await this.query(`DROP TRIGGER IF EXISTS ${trigger.name}`);
                  }
              }

              // Create triggers
              await this.query(`
                  CREATE TRIGGER IF NOT EXISTS update_server_subs_timestamp 
                  AFTER UPDATE ON server_subscriptions
                  BEGIN
                      UPDATE server_subscriptions 
                      SET updated_at = CURRENT_TIMESTAMP
                      WHERE id = NEW.id;
                  END
              `);

              await this.query(`
                  CREATE TRIGGER IF NOT EXISTS cleanup_expired_subscriptions
                  AFTER INSERT ON server_subscriptions
                  BEGIN
                      UPDATE server_subscriptions 
                      SET status = 'EXPIRED' 
                      WHERE expiration_date < datetime('now')
                      AND subscription_type = 'EVENT'
                      AND status = 'ACTIVE';
                  END
              `);

              console.log("Payment tables setup complete");
          } catch (triggerError) {
              console.error("Error handling triggers:", triggerError);
              // Continue execution even if trigger creation fails
          }

      } catch (error) {
          console.error("Error creating payment tables:", error);
          throw error;
      }
  }

  async getModelComparisonStats() {
    try {
      const query = `
          WITH model_performance AS (
              SELECT 
                  sp.model_used,
                  COUNT(DISTINCT sp.event_id) as events_analyzed,
                  COUNT(*) as total_predictions,
                  ROUND(AVG(CASE WHEN json_extract(po.fight_outcomes, '$.correct') = 1 THEN 1 ELSE 0 END) * 100, 1) as fight_accuracy,
                  ROUND(AVG(CASE WHEN json_extract(po.fight_outcomes, '$.methodCorrect') = 1 THEN 1 ELSE 0 END) * 100, 1) as method_accuracy,
                  ROUND(AVG(po.confidence_accuracy), 1) as confidence_accuracy,
                  ROUND(AVG(CASE WHEN json_extract(po.parlay_outcomes, '$.correct') = 1 THEN 1 ELSE 0 END) * 100, 1) as parlay_accuracy
              FROM prediction_outcomes po
              JOIN stored_predictions sp ON po.prediction_id = sp.prediction_id
              GROUP BY sp.model_used
          ),
          model_rankings AS (
              SELECT *,
                  RANK() OVER (ORDER BY fight_accuracy DESC) as fight_rank,
                  RANK() OVER (ORDER BY method_accuracy DESC) as method_rank,
                  RANK() OVER (ORDER BY parlay_accuracy DESC) as parlay_rank
              FROM model_performance
          )
          SELECT * FROM model_rankings`;

      const stats = await this.query(query);
      console.log('Retrieved model comparison stats:', stats);
      return stats;
    } catch (error) {
      console.error('Error getting model comparison stats:', error);
      return [];
    }
  }

  async getHistoricalPredictions(eventId) {
    try {
      const query = `
          SELECT 
              sp.prediction_id,
              sp.model_used,
              sp.card_type,
              sp.prediction_data,
              po.fight_outcomes,
              po.confidence_accuracy,
              e.Event as event_name,
              e.Date as event_date
          FROM stored_predictions sp
          JOIN events e ON sp.event_id = e.event_id
          LEFT JOIN prediction_outcomes po ON sp.prediction_id = po.prediction_id
          WHERE sp.event_id = ?
          ORDER BY sp.created_at DESC`;

      const predictions = await this.query(query, [eventId]);
      return predictions;
    } catch (error) {
      console.error('Error getting historical predictions:', error);
      return [];
    }
  }

  async getEventPredictionStats(eventId) {
    try {
      const query = `
          SELECT 
              sp.model_used,
              COUNT(*) as total_fights,
              SUM(CASE WHEN json_extract(po.fight_outcomes, '$.correct') = 1 THEN 1 ELSE 0 END) as correct_predictions,
              ROUND(AVG(po.confidence_accuracy), 2) as avg_confidence,
              COUNT(CASE WHEN json_extract(po.fight_outcomes, '$.methodCorrect') = 1 THEN 1 ELSE 0 END) as correct_methods
          FROM stored_predictions sp
          JOIN prediction_outcomes po ON sp.prediction_id = po.prediction_id
          WHERE sp.event_id = ?
          GROUP BY sp.model_used`;

      const stats = await this.query(query, [eventId]);
      return stats;
    } catch (error) {
      console.error('Error getting event prediction stats:', error);
      return [];
    }
  }

  async getPredictionPerformanceOverTime(modelType = null) {
    try {
      const query = `
          SELECT 
              e.Date,
              sp.model_used,
              COUNT(*) as total_predictions,
              ROUND(AVG(CASE WHEN json_extract(po.fight_outcomes, '$.correct') = 1 THEN 100 ELSE 0 END), 2) as accuracy,
              ROUND(AVG(po.confidence_accuracy), 2) as confidence_accuracy
          FROM stored_predictions sp
          JOIN events e ON sp.event_id = e.event_id
          JOIN prediction_outcomes po ON sp.prediction_id = po.prediction_id
          ${modelType ? 'WHERE sp.model_used = ?' : ''}
          GROUP BY e.Date, sp.model_used
          ORDER BY e.Date DESC
          LIMIT 10`;

      const params = modelType ? [modelType] : [];
      const performance = await this.query(query, params);
      return performance;
    } catch (error) {
      console.error('Error getting prediction performance:', error);
      return [];
    }
  }

  async getDetailedModelStats(modelType) {
    try {
      const query = `
          WITH fight_details AS (
              SELECT 
                  sp.model_used,
                  json_extract(po.fight_outcomes, '$.predictedMethod') as predicted_method,
                  json_extract(po.fight_outcomes, '$.actualMethod') as actual_method,
                  json_extract(po.fight_outcomes, '$.correct') as is_correct,
                  json_extract(po.fight_outcomes, '$.confidence') as confidence
              FROM stored_predictions sp
              JOIN prediction_outcomes po ON sp.prediction_id = po.prediction_id
              WHERE sp.model_used = ?
          )
          SELECT 
              model_used,
              COUNT(*) as total_predictions,
              ROUND(AVG(CASE WHEN is_correct = 1 THEN 100 ELSE 0 END), 2) as overall_accuracy,
              ROUND(AVG(CASE WHEN predicted_method = actual_method THEN 100 ELSE 0 END), 2) as method_accuracy,
              ROUND(AVG(confidence), 2) as avg_confidence
          FROM fight_details
          GROUP BY model_used`;

      const stats = await this.query(query, [modelType]);
      return stats;
    } catch (error) {
      console.error('Error getting detailed model stats:', error);
      return [];
    }
  }

  async activateServerEventAccess(serverId, paymentId) {
      try {
          // Get the next event's date for expiration
          const event = await this.query(`
              SELECT event_id, Date 
              FROM events 
              WHERE Date >= date('now') 
              ORDER BY Date ASC 
              LIMIT 1
          `);

          if (!event || !event[0]) {
              throw new Error('No upcoming event found');
          }

          // Set expiration to day after event
          const expirationDate = new Date(event[0].Date);
          expirationDate.setDate(expirationDate.getDate() + 1);

          await this.query(`
              INSERT OR REPLACE INTO server_subscriptions (
                  server_id,
                  subscription_type,
                  payment_id,
                  status,
                  event_id,
                  expiration_date,
                  created_at
              ) VALUES (?, 'EVENT', ?, 'ACTIVE', ?, ?, datetime('now'))
          `, [
              serverId,
              paymentId,
              event[0].event_id,
              expirationDate.toISOString()
          ]);

          console.log('Event access activated:', {
              serverId,
              paymentId,
              eventId: event[0].event_id,
              expiration: expirationDate
          });

          return {
              eventId: event[0].event_id,
              expirationDate: expirationDate
          };
      } catch (error) {
          console.error('Error activating server event access:', error);
          throw error;
      }
  }

  async checkServerAccess(serverId, eventId) {
    try {
        // Query the database to check if the server has active subscriptions
        const query = `
            SELECT * FROM subscriptions
            WHERE server_id = ? AND (event_id = ? OR ? IS NULL) AND active = 1
        `;
        const params = [serverId, eventId, eventId];
        const [rows] = await database.execute(query, params);

        const hasAccess = rows.length > 0;
        console.log(`💳 Found ${rows.length} active subscriptions`);
        console.log(`Server ${hasAccess ? 'has' : 'does not have'} event access`);
        
        return hasAccess;
    } catch (error) {
        console.error('Error checking server access:', error);
        return false;
    }
}

async verifyAccess(serverId, eventId = null) {
  try {
      console.log('\n=== Server Access Verification Started ===');
      console.log(`🔍 Checking access for Server ID: ${serverId}`);
      console.log(`🎯 Event ID: ${eventId || 'No specific event'}`);

      // First check for lifetime access
      const lifetimeAccess = await this.query(`
          SELECT * FROM server_subscriptions 
          WHERE server_id = ? 
          AND subscription_type = 'LIFETIME'
          AND status = 'ACTIVE'
      `, [serverId]);

      if (lifetimeAccess.length > 0) {
          console.log('✅ LIFETIME ACCESS VERIFIED');
          return true;
      }

      // If no lifetime access and no specific event requested, check for any active event access
      if (!eventId) {
          const anyEventAccess = await this.query(`
              SELECT * FROM server_subscriptions
              WHERE server_id = ?
              AND subscription_type = 'EVENT'
              AND status = 'ACTIVE'
              AND expiration_date > datetime('now')
          `, [serverId]);

          if (anyEventAccess.length > 0) {
              console.log('✅ ACTIVE EVENT ACCESS FOUND');
              return true;
          }
      }

      // Check for specific event access if eventId provided
      if (eventId) {
          const eventAccess = await this.query(`
              SELECT * FROM server_subscriptions
              WHERE server_id = ?
              AND event_id = ?
              AND subscription_type = 'EVENT'
              AND status = 'ACTIVE'
              AND expiration_date > datetime('now')
          `, [serverId, eventId]);

          if (eventAccess.length > 0) {
              console.log(`✅ EVENT ACCESS VERIFIED FOR EVENT ${eventId}`);
              return true;
          }
      }

      console.log('❌ NO VALID ACCESS FOUND');
      return false;
  } catch (error) {
      console.error('Error verifying access:', error);
      return false;
  }
}

  async createFightersTable() {
    try {
      // First create table if it doesn't exist
      await this.db.run(`CREATE TABLE IF NOT EXISTS fighters (
            fighter_id INTEGER PRIMARY KEY AUTOINCREMENT,
            Name TEXT UNIQUE,
            Height TEXT,
            Weight TEXT,
            Reach TEXT,
            Stance TEXT,
            DOB TEXT,
            SLPM REAL,
            SApM REAL,
            StrAcc TEXT,
            StrDef TEXT,
            TDAvg REAL,
            TDAcc TEXT,
            TDDef TEXT,
            SubAvg REAL,
            last_updated TIMESTAMP
        )`);

      // Check if last_updated column exists
      const columns = await this.query(`PRAGMA table_info(fighters)`);
      if (!columns.some((col) => col.name === "last_updated")) {
        // Add last_updated column if it doesn't exist
        await this.query(
          `ALTER TABLE fighters ADD COLUMN last_updated TIMESTAMP`
        );
        console.log("Added last_updated column to fighters table");
      }

      // Add index for better performance
      await this.query(
        `CREATE INDEX IF NOT EXISTS idx_fighters_name ON fighters(Name)`
      );
    } catch (error) {
      console.error("Error creating/updating fighters table:", error);
      throw error;
    }
  }
  async createFighterStatsTable() {
    await this.query(`CREATE TABLE IF NOT EXISTS fighter_stats (
            stats_id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE,
            record TEXT,
            wins INTEGER DEFAULT 0,
            losses INTEGER DEFAULT 0,
            draws INTEGER DEFAULT 0,
            ko_wins INTEGER DEFAULT 0,
            submission_wins INTEGER DEFAULT 0,
            decision_wins INTEGER DEFAULT 0,
            total_fights INTEGER DEFAULT 0,
            finishes JSON,
            strike_stats JSON,
            grappling_stats JSON,
            fight_time_stats JSON,
            last_fight_date DATE,
            last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(name) REFERENCES fighters(Name)
        )`);

    // Add indices for better performance
    await this.query(`CREATE INDEX IF NOT EXISTS idx_fighter_stats_name 
            ON fighter_stats(name)`);
    await this.query(`CREATE INDEX IF NOT EXISTS idx_fighter_stats_last_fight 
            ON fighter_stats(last_fight_date)`);

    // Create timestamp update trigger
    await this
      .query(`CREATE TRIGGER IF NOT EXISTS update_fighter_stats_timestamp
            AFTER UPDATE ON fighter_stats
            BEGIN
                UPDATE fighter_stats 
                SET last_updated = CURRENT_TIMESTAMP
                WHERE stats_id = NEW.stats_id;
            END
        `);
  }

  async createPredictionsTable() {
    await this.query(`CREATE TABLE IF NOT EXISTS stored_predictions (
            prediction_id INTEGER PRIMARY KEY AUTOINCREMENT,
            event_id INTEGER,
            card_type TEXT,
            model_used TEXT,
            prediction_data TEXT,
            accuracy REAL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(event_id) REFERENCES events(event_id)
        )`);
  }

  async initializePredictionOutcomesTable() {
    await this.query(`CREATE TABLE IF NOT EXISTS prediction_outcomes (
            outcome_id INTEGER PRIMARY KEY AUTOINCREMENT,
            prediction_id INTEGER,
            event_id INTEGER,
            fight_outcomes TEXT,
            parlay_outcomes TEXT,
            prop_outcomes TEXT,
            model_used TEXT,
            confidence_accuracy REAL,
            last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(prediction_id) REFERENCES stored_predictions(prediction_id),
            FOREIGN KEY(event_id) REFERENCES events(event_id)
        )`);

    // Add indices for better performance
    await this.query(`CREATE INDEX IF NOT EXISTS idx_prediction_outcomes_pred 
            ON prediction_outcomes(prediction_id)`);
    await this.query(`CREATE INDEX IF NOT EXISTS idx_prediction_outcomes_event 
            ON prediction_outcomes(event_id)`);
  }

  async createOddsTables() {
    // Create odds_history table
    await this.query(`CREATE TABLE IF NOT EXISTS odds_history (
            odds_id INTEGER PRIMARY KEY AUTOINCREMENT,
            event_id INTEGER,
            fighter1 TEXT,
            fighter2 TEXT,
            fighter1_odds DECIMAL,
            fighter2_odds DECIMAL,
            bookmaker TEXT,
            market_type TEXT DEFAULT 'h2h',
            last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(event_id) REFERENCES events(event_id)
        )`);

    // Create odds cache table
    await this.query(`CREATE TABLE IF NOT EXISTS odds_cache (
            cache_id INTEGER PRIMARY KEY AUTOINCREMENT,
            request_type TEXT,
            response_data TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            expires_at TIMESTAMP,
            requests_remaining INTEGER
        )`);

    // Create indices
    await this.query(`CREATE INDEX IF NOT EXISTS idx_odds_event 
            ON odds_history(event_id, last_updated)`);
    await this.query(`CREATE INDEX IF NOT EXISTS idx_odds_fighters
            ON odds_history(fighter1, fighter2)`);
    await this.query(`CREATE INDEX IF NOT EXISTS idx_odds_bookmaker
            ON odds_history(bookmaker)`);
    await this.query(`CREATE INDEX IF NOT EXISTS idx_odds_cache_type
            ON odds_cache(request_type)`);
    await this.query(`CREATE INDEX IF NOT EXISTS idx_odds_cache_expiry
            ON odds_cache(expires_at)`);

    // Create cleanup trigger
    await this.query(`
            CREATE TRIGGER IF NOT EXISTS cleanup_expired_cache
            AFTER INSERT ON odds_cache
            BEGIN
                DELETE FROM odds_cache 
                WHERE expires_at < datetime('now');
            END
        `);
  }

  async storeOddsCache(
    requestType,
    responseData,
    expiresAt,
    requestsRemaining
  ) {
    try {
      await this.query(
        `
        INSERT INTO odds_cache (
          request_type, response_data, expires_at, requests_remaining
        ) VALUES (?, ?, ?, ?)
      `,
        [
          requestType,
          JSON.stringify(responseData),
          expiresAt,
          requestsRemaining,
        ]
      );
    } catch (error) {
      console.error("Error storing odds cache:", error);
      throw error;
    }
  }

  async getOddsCache(requestType) {
    try {
      const cache = await this.query(
        `
        SELECT response_data, expires_at, requests_remaining
        FROM odds_cache
        WHERE request_type = ?
        AND expires_at > datetime('now')
        ORDER BY created_at DESC
        LIMIT 1
      `,
        [requestType]
      );

      if (cache && cache.length > 0) {
        return {
          data: JSON.parse(cache[0].response_data),
          expiresAt: cache[0].expires_at,
          requestsRemaining: cache[0].requests_remaining,
        };
      }
      return null;
    } catch (error) {
      console.error("Error getting odds cache:", error);
      return null;
    }
  }

  async cleanupOldOdds(daysToKeep = 30) {
    try {
      await this.query(
        `
        DELETE FROM odds_history
        WHERE last_updated < datetime('now', '-' || ? || ' days')
      `,
        [daysToKeep]
      );

      await this.query(`
        DELETE FROM odds_cache
        WHERE expires_at < datetime('now')
      `);
    } catch (error) {
      console.error("Error cleaning up old odds:", error);
      throw error;
    }
  }

  async getCurrentEvent() {
    try {
      const currentDate = new Date().toISOString().slice(0, 10);

      const event = await this.query(
        `
        SELECT DISTINCT event_id, Date, Event, City, State, Country, event_link
        FROM events 
        WHERE Date = ?
        LIMIT 1
      `,
        [currentDate]
      );

      console.log("Direct query result:", event);

      if (event && event.length > 0) {
        return event[0];
      }
      return null;
    } catch (error) {
      console.error("Error getting current event:", error);
      throw error;
    }
  }

  async getUpcomingEvent() {
    try {
      // First try to get today's event
      const currentEvent = await this.getCurrentEvent();
      if (currentEvent) {
        console.log("Found current event:", currentEvent.Event);
        return currentEvent;
      }

      // Only if no current event, get next event
      const currentDate = new Date().toISOString().slice(0, 10);
      const nextEvent = await this.query(
        `
        SELECT DISTINCT event_id, Date, Event, City, State, Country, event_link
        FROM events
        WHERE Date > ?
        ORDER BY Date ASC
        LIMIT 1
      `,
        [currentDate]
      );

      if (nextEvent && nextEvent.length > 0) {
        console.log("No current event, found next event:", nextEvent[0].Event);
        return nextEvent[0];
      }

      // If nothing found, scrape new data
      console.log("No events found, scraping new data...");
      const scrapedEvent = await this.scrapeUpcomingEvent();

      if (scrapedEvent && scrapedEvent.fights) {
        for (const fight of scrapedEvent.fights) {
          await this.insertEventFight(scrapedEvent, fight);
        }
      }

      return scrapedEvent;
    } catch (error) {
      console.error("Error in getUpcomingEvent:", error.message);
      throw error;
    }
  }

  async scrapeUpcomingEvent() {
    try {
      console.log("Starting to scrape upcoming event...");

      const eventLink = await this.getDirectEventLink();
      if (!eventLink) {
        throw new Error("Could not find event link");
      }

      console.log("Found event link:", eventLink);
      const eventResponse = await axios.get(eventLink);
      const $ = cheerio.load(eventResponse.data);

      // Get event name with multiple fallbacks
      const eventName =
        $("h2.b-content__title").text().trim() ||
        $(".b-content__title-highlight").text().trim() ||
        $("h1.hero-event-name").text().trim() ||
        "Upcoming UFC Event";

      // Enhanced date scraping
      let dateText = this.scrapeEventDate($);
      if (!dateText) {
        console.warn("Could not find event date, using current date");
        dateText = new Date().toISOString().split("T")[0];
      }

      // Enhanced location scraping
      let locationText = this.scrapeEventLocation($);
      console.log("Found location text:", locationText);

      const date = this.parseDate(dateText);
      const [city, state, country] = this.parseLocation(locationText);

      // Scrape fights
      const fights = this.scrapeFights($);

      const eventData = {
        Event: eventName,
        Date: date,
        City: city,
        State: state,
        Country: country,
        event_link: eventLink,
        fights: fights,
      };

      console.log("Successfully scraped event data:", {
        ...eventData,
        fights: `Found ${fights.length} fights`,
      });

      return eventData;
    } catch (error) {
      console.error("Error in scrapeUpcomingEvent:", error);
      throw error;
    }
  }

  scrapeEventDate($) {
    const dateSelectors = [
      '.b-list__box-list li:contains("Date:")',
      ".b-statistics__date",
      ".b-list__box-list:first",
      'li.b-list__box-list-item:contains("Date")',
      ".hero-date",
    ];

    for (const selector of dateSelectors) {
      const element = $(selector);
      if (element.length) {
        const dateText = element
          .text()
          .replace("Date:", "")
          .replace("DATE:", "")
          .trim();
        if (dateText) return dateText;
      }
    }
    return null;
  }

  scrapeEventLocation($) {
    const locationSelectors = [
      '.b-list__box-list li:contains("Location:")',
      ".hero-location",
      '.b-statistics__table-col:contains("Location")',
      ".event-location",
    ];

    for (const selector of locationSelectors) {
      const element = $(selector);
      if (element.length) {
        const locationText = element
          .text()
          .replace("Location:", "")
          .replace("LOCATION:", "")
          .trim();
        if (locationText) return locationText;
      }
    }
    return "";
  }

  scrapeFights($) {
    const fights = [];
    const fightSelectors = [
      "tbody tr",
      ".b-fight-details__table tbody tr",
      ".fight-card-list tr",
    ];

    for (const selector of fightSelectors) {
      $(selector).each((index, row) => {
        const $row = $(row);
        const fighters = [];

        // Try different ways to find fighter names
        $row.find("a").each((_, el) => {
          const text = $(el).text().trim();
          if (text && !text.includes("View") && !text.includes("Matchup")) {
            fighters.push(text);
          }
        });

        // Backup method to find fighter names
        if (fighters.length < 2) {
          $row.find("td").each((_, el) => {
            const text = $(el).text().trim();
            if (text && !text.includes("View") && !text.includes("Matchup")) {
              fighters.push(text);
            }
          });
        }

        // Get weight class
        let weightClass =
          $row.find("td:nth-child(7)").text().trim() ||
          $row
            .find("td")
            .filter(function () {
              return (
                $(this).text().includes("weight") ||
                $(this).text().includes("Weight")
              );
            })
            .first()
            .text()
            .trim() ||
          "TBD";

        if (fighters.length >= 2) {
          fights.push({
            fighter1: fighters[0],
            fighter2: fighters[1],
            WeightClass: weightClass,
            is_main_card: index < 5 ? 1 : 0,
          });
        }
      });

      if (fights.length > 0) break; // Stop if we found fights using current selector
    }

    return fights;
  }

  async getDirectEventLink() {
    try {
      const sources = [
        "http://www.ufcstats.com/statistics/events/upcoming",
        "http://www.ufcstats.com/statistics/events/completed",
      ];

      for (const source of sources) {
        console.log(`Checking ${source} for event link...`);
        const response = await axios.get(source);
        const $ = cheerio.load(response.data);

        const eventLink =
          $("td.b-statistics__table-col a.b-link.b-link_style_black")
            .first()
            .attr("href") ||
          $('tr:contains("NEXT") a.b-link.b-link_style_black').attr("href") ||
          $('.b-link.b-link_style_black[href*="event-details"]')
            .first()
            .attr("href");

        if (eventLink) {
          console.log(`Found event link: ${eventLink}`);
          return eventLink;
        }
      }
      return null;
    } catch (error) {
      console.error("Error getting direct event link:", error);
      return null;
    }
  }

  async getEventFights(eventName) {
    try {
      // First try to get existing fights
      let fights = await this.query(
        `
              SELECT
                  event_id,
                  Winner as fighter1,
                  Loser as fighter2,
                  WeightClass,
                  Round,
                  Method,
                  is_main_card
              FROM events
              WHERE Event = ?
              ORDER BY event_id ASC
              `,
        [eventName]
      );

      // If no fights found or less than expected, scrape fresh data
      if (!fights || fights.length < 6) {
        console.log("Insufficient fights found, scraping fresh data...");
        const scrapedEvent = await this.scrapeUpcomingEvent();

        // Insert all scraped fights
        for (const fight of scrapedEvent.fights) {
          await this.insertEventFight(scrapedEvent, fight);
        }

        // Get updated fights list
        fights = await this.query(
          `
                  SELECT
                      event_id,
                      Winner as fighter1,
                      Loser as fighter2,
                      WeightClass,
                      Round,
                      Method,
                      is_main_card
                  FROM events
                  WHERE Event = ?
                  ORDER BY event_id ASC
                  `,
          [eventName]
        );
      }

      console.log(
        `Retrieved ${fights.length} fights from database:`,
        JSON.stringify(fights, null, 2)
      );
      return fights;
    } catch (error) {
      console.error("Error getting event fights:", error);
      throw error;
    }
  }

  async insertEventFight(event, fight) {
    const query = `
          INSERT INTO events (
              Date, Event, City, State, Country,
              Winner, Loser, WeightClass, Round, Method,
              event_link, is_main_card
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
    try {
      await this.query(query, [
        event.Date,
        event.Event,
        event.City,
        event.State,
        event.Country,
        fight.fighter1,
        fight.fighter2,
        fight.WeightClass,
        fight.Round || null,
        fight.Method || null,
        event.event_link,
        fight.is_main_card,
      ]);
      console.log(
        `Inserted fight: ${fight.fighter1} vs ${fight.fighter2} (${
          fight.is_main_card ? "Main Card" : "Prelims"
        })`
      );
    } catch (error) {
      console.error("Error inserting fight:", error);
      throw error;
    }
  }

  async clearExistingFights(eventName) {
    const query = "DELETE FROM events WHERE Event = ?";
    try {
      await this.query(query, [eventName]);
      console.log(`Cleared existing fights for event: ${eventName}`);
    } catch (error) {
      console.error("Error clearing existing fights:", error);
      throw error;
    }
  }

  parseLocation(location) {
    try {
      console.log("Parsing location:", location);

      if (!location) {
        console.log("No location provided, returning default values");
        return ["TBD", "", "TBD"];
      }

      const cleanLocation = location.trim();
      if (!cleanLocation) {
        return ["TBD", "", "TBD"];
      }

      const parts = cleanLocation.split(",").map((part) => part.trim());

      if (parts.length === 3) {
        return parts;
      } else if (parts.length === 2) {
        return [parts[0], "", parts[1]];
      } else if (parts.length === 1) {
        return [parts[0], "", ""];
      }

      return ["TBD", "", "TBD"];
    } catch (error) {
      console.error("Error parsing location:", error);
      return ["TBD", "", "TBD"];
    }
  }

  parseDate(dateStr) {
    try {
      console.log("Parsing date:", dateStr);
      const months = {
        Jan: "01",
        Feb: "02",
        Mar: "03",
        Apr: "04",
        May: "05",
        Jun: "06",
        Jul: "07",
        Aug: "08",
        Sep: "09",
        Oct: "10",
        Nov: "11",
        Dec: "12",
      };

      let [month, day, year] = dateStr.replace(/\s+/g, " ").trim().split(" ");

      if (month && day && year) {
        day = day.replace(/\D/g, "").padStart(2, "0");
        month = months[month.substring(0, 3)] || "01";
        return `${year}-${month}-${day}`;
      }

      return new Date().toISOString().split("T")[0];
    } catch (error) {
      console.error("Error parsing date:", error);
      return new Date().toISOString().split("T")[0];
    }
  } // Fighter and fighter stats methods
  async getFighterCompleteStats(fighterName) {
    const sql = `
        SELECT f.*,
               fs.record,
               fs.last_updated,
               COUNT(fh.fight_id) as total_fights,
               SUM(CASE WHEN fh.result = 'Win' THEN 1 ELSE 0 END) as total_wins,
               SUM(CASE
                   WHEN fh.result = 'Win' AND
                        (fh.method LIKE '%KO%' OR fh.method LIKE '%TKO%')
                   THEN 1 ELSE 0 END) as ko_wins,
               SUM(CASE
                   WHEN fh.result = 'Win' AND fh.method LIKE '%Submission%'
                   THEN 1 ELSE 0 END) as submission_wins
        FROM fighters f
        LEFT JOIN fighter_stats fs ON f.Name = fs.name
        LEFT JOIN fight_history fh ON f.Name = fh.fighter_name
        WHERE f.Name = ?
        GROUP BY f.Name
    `;
    const [result] = await this.query(sql, [fighterName]);
    return result;
  }

  async getFinishes(fighterName, position, method) {
    return new Promise((resolve, reject) => {
      this.db.get(
        `
            SELECT COUNT(*) as count
            FROM events
            WHERE ${position} = ?
            AND Method LIKE ?
            `,
        [fighterName, `%${method}%`],
        (err, result) => {
          if (err) {
            console.error("Error getting finishes:", err);
            resolve(0);
          } else {
            resolve(result.count);
          }
        }
      );
    });
  }

  async getCommonOpponents(fighter1, fighter2) {
    const sql = `
        SELECT DISTINCT f1.opponent_name,
               f1.result as fighter1_result,
               f1.method as fighter1_method,
               f2.result as fighter2_result,
               f2.method as fighter2_method
        FROM fight_history f1
        INNER JOIN fight_history f2
            ON f1.opponent_name = f2.opponent_name
        WHERE f1.fighter_name = ?
        AND f2.fighter_name = ?
        ORDER BY f1.fight_date DESC
    `;
    return this.query(sql, [fighter1, fighter2]);
  }

  async getStyleMatchupHistory(fighter1, fighter2) {
    const sql = `
        SELECT f.*,
               op.Stance as opponent_stance,
               op.SLPM as opponent_slpm,
               op.TDAvg as opponent_tdavg
        FROM fight_history f
        JOIN fighters op ON f.opponent_name = op.Name
        WHERE f.fighter_name = ?
        AND op.Stance = (SELECT Stance FROM fighters WHERE Name = ?)
        ORDER BY f.fight_date DESC
        LIMIT 5
    `;
    return this.query(sql, [fighter1, fighter2]);
  }

  async calculateFinishRate(fighterName) {
    const sql = `
        SELECT
            COUNT(*) as total_fights,
            SUM(CASE
                WHEN method LIKE '%KO%' OR method LIKE '%TKO%' OR method LIKE '%Submission%'
                THEN 1 ELSE 0
            END) as finishes
        FROM fight_history
        WHERE fighter_name = ? AND result = 'Win'
    `;
    const [result] = await this.query(sql, [fighterName]);
    return result.total_fights > 0
      ? (result.finishes / result.total_fights) * 100
      : 0;
  }

  async calculateWinStreak(fighterName) {
    const sql = `
        SELECT result
        FROM fight_history
        WHERE fighter_name = ?
        ORDER BY fight_date DESC
        LIMIT 5
    `;
    const results = await this.query(sql, [fighterName]);
    let streak = 0;
    for (const fight of results) {
      if (fight.result === "Win") streak++;
      else break;
    }
    return streak;
  }

  async populateFighterStats() {
    console.log("Populating fighter_stats table with initial data...");

    try {
      const fighters = await this.query(
        "SELECT DISTINCT fighter_name FROM fight_history"
      );

      for (const fighter of fighters) {
        try {
          const name = fighter.fighter_name;
          const history = await this.query(
            "SELECT * FROM fight_history WHERE fighter_name = ? ORDER BY fight_date DESC",
            [name]
          );

          // Calculate stats
          const stats = history.reduce((acc, fight) => {
            if (fight.result === "Win") {
              acc.wins = (acc.wins || 0) + 1;
              if (
                fight.method?.includes("KO") ||
                fight.method?.includes("TKO")
              ) {
                acc.ko_wins = (acc.ko_wins || 0) + 1;
              } else if (fight.method?.includes("Submission")) {
                acc.submission_wins = (acc.submission_wins || 0) + 1;
              } else if (fight.method?.includes("Decision")) {
                acc.decision_wins = (acc.decision_wins || 0) + 1;
              }
            } else if (fight.result === "Loss") {
              acc.losses = (acc.losses || 0) + 1;
            } else if (fight.result === "Draw") {
              acc.draws = (acc.draws || 0) + 1;
            }
            return acc;
          }, {});

          const record = `${stats.wins || 0}-${stats.losses || 0}-${
            stats.draws || 0
          }`;
          const last_fight = history[0];

          // Insert stats
          await this.query(
            `
                    INSERT INTO fighter_stats (
                        name, record, wins, losses, draws,
                        ko_wins, submission_wins, decision_wins,
                        total_fights, last_fight_date
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `,
            [
              name,
              record,
              stats.wins || 0,
              stats.losses || 0,
              stats.draws || 0,
              stats.ko_wins || 0,
              stats.submission_wins || 0,
              stats.decision_wins || 0,
              history.length,
              last_fight?.fight_date || null,
            ]
          );
        } catch (error) {
          console.error(
            `Error populating stats for fighter ${fighter.fighter_name}:`,
            error
          );
        }
      }
      console.log("Finished populating fighter_stats table");
    } catch (error) {
      console.error("Error in populateFighterStats:", error);
      throw error;
    }
  }

  async checkAndInitializeFighterStats() {
    try {
      const result = await this.query(
        "SELECT COUNT(*) as count FROM fighter_stats"
      );

      if (result[0].count === 0) {
        await this.populateFighterStats();
      }
    } catch (error) {
      console.error("Error checking fighter stats:", error);
      throw error;
    }
  } // Prediction-related methods
  async updatePredictionOutcomes() {
    try {
      // Get all predictions that need verification
      const predictions = await this.query(`
          SELECT 
              sp.*,
              e.Event as event_name,
              e.Date as event_date,
              e.event_link
          FROM stored_predictions sp
          JOIN events e ON sp.event_id = e.event_id
          LEFT JOIN prediction_outcomes po ON sp.prediction_id = po.prediction_id
          WHERE po.prediction_id IS NULL
          AND e.Date < datetime('now')
          AND e.event_link IS NOT NULL
      `);

      console.log(
        `Found ${predictions.length} predictions needing verification`
      );

      for (const prediction of predictions) {
        try {
          console.log(
            `Processing prediction for event: ${prediction.event_name}`
          );

          const predictionData = JSON.parse(prediction.prediction_data);

          // Get actual results from database first
          let actualResults = await this.query(
            `
                  SELECT Winner as winner, Loser as loser, Method as method, Round as round
                  FROM events
                  WHERE Event = ? AND Method IS NOT NULL
              `,
            [prediction.event_name]
          );

          // If no results in database, try fetching from UFCStats
          if (!actualResults || actualResults.length === 0) {
            if (prediction.event_link) {
              actualResults = await this.fetchEventResults(
                prediction.event_link
              );
            }
          }

          if (!actualResults || actualResults.length === 0) {
            console.log(`No results found for event: ${prediction.event_name}`);
            continue;
          }

          // Process fight predictions
          const fightOutcomes = await this.processFightOutcomes(
            predictionData.fights,
            actualResults
          );

          // Process parlay predictions
          const parlayOutcomes = this.processParlayOutcomes(
            predictionData.betting_analysis?.parlays,
            actualResults
          );

          // Process prop predictions
          const propOutcomes = this.processPropOutcomes(
            predictionData.betting_analysis?.props,
            actualResults
          );

          // Calculate confidence accuracy
          const confidenceAccuracy =
            this.calculateConfidenceAccuracy(fightOutcomes);

          // Store outcomes
          await this.query(
            `
                  INSERT INTO prediction_outcomes (
                      prediction_id,
                      event_id,
                      fight_outcomes,
                      parlay_outcomes,
                      prop_outcomes,
                      model_used,
                      confidence_accuracy,
                      last_updated
                  ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                  `,
            [
              prediction.prediction_id,
              prediction.event_id,
              JSON.stringify(fightOutcomes),
              JSON.stringify(parlayOutcomes),
              JSON.stringify(propOutcomes),
              prediction.model_used,
              confidenceAccuracy,
            ]
          );

          console.log(
            `Stored outcomes for prediction ${prediction.prediction_id}`
          );
        } catch (error) {
          console.error(
            `Error processing prediction ${prediction.prediction_id}:`,
            error
          );
        }
      }
    } catch (error) {
      console.error("Error updating prediction outcomes:", error);
      throw error;
    }
  }

  async fetchEventResults(eventLink) {
    try {
      console.log("Fetching event results from:", eventLink);
      const response = await axios.get(eventLink);
      const $ = cheerio.load(response.data);

      const fights = [];
      $("tbody tr").each((_, row) => {
        const $row = $(row);

        // Get winner and loser from the first column
        const fighters = $row
          .find("td:first-child a")
          .map((_, el) => $(el).text().trim())
          .get();
        if (fighters.length !== 2) return;

        // Get method of victory
        const method = $row
          .find("td.b-fight-details__table-col_style_align-top")
          .text()
          .trim();

        // Get round and time
        const round = $row.find("td:nth-child(8)").text().trim();
        const time = $row.find("td:nth-child(9)").text().trim();

        fights.push({
          winner: fighters[0],
          loser: fighters[1],
          method: method,
          round: round,
          time: time,
        });
      });

      console.log(`Found ${fights.length} fight results`);
      return fights;
    } catch (error) {
      console.error("Error fetching event results:", error);
      return null;
    }
  }

  processFightOutcomes(predictedFights, actualResults) {
    if (!predictedFights || !actualResults) return [];

    return predictedFights
      .map((prediction) => {
        const actualFight = actualResults.find(
          (result) =>
            (result.winner === prediction.fighter1 &&
              result.loser === prediction.fighter2) ||
            (result.winner === prediction.fighter2 &&
              result.loser === prediction.fighter1)
        );

        if (!actualFight) return null;

        return {
          fighter1: prediction.fighter1,
          fighter2: prediction.fighter2,
          predictedWinner: prediction.predictedWinner,
          actualWinner: actualFight.winner,
          confidence: prediction.confidence,
          predictedMethod: prediction.method,
          actualMethod: actualFight.method,
          correct: actualFight.winner === prediction.predictedWinner,
          methodCorrect: prediction.method
            ?.toLowerCase()
            .includes(actualFight.method.toLowerCase()),
        };
      })
      .filter(Boolean);
  }

  processParlayOutcomes(parlayStr, actualResults) {
    if (!parlayStr) return [];

    const parlayMatches = parlayStr.match(/include ([^,]+(?:,[^,]+)*)/i);
    if (!parlayMatches) return [];

    const parlayFighters = parlayMatches[1].split(",").map((s) => s.trim());

    return parlayFighters
      .map((fighter) => {
        const result = actualResults.find(
          (r) => r.winner === fighter || r.loser === fighter
        );
        if (!result) return null;

        return {
          fighter,
          correct: result.winner === fighter,
        };
      })
      .filter(Boolean);
  }

  processPropOutcomes(propsStr, actualResults) {
    if (!propsStr) return [];

    const propMatches = propsStr.match(/([^,.]+(?:by|win by)[^,.]+)/gi) || [];

    return propMatches
      .map((prop) => {
        const [fighter, method] = prop.split(/\s+by\s+/i);
        const result = actualResults.find(
          (r) => r.winner === fighter || r.loser === fighter
        );
        if (!result) return null;

        return {
          fighter: fighter.trim(),
          predictedMethod: method?.trim(),
          actualMethod: result.method,
          correct:
            result.winner === fighter &&
            method?.toLowerCase().includes(result.method.toLowerCase()),
        };
      })
      .filter(Boolean);
  }

  calculateConfidenceAccuracy(fightOutcomes) {
    if (!fightOutcomes || fightOutcomes.length === 0) return 0;

    const confidenceAccuracy = fightOutcomes.reduce((acc, fight) => {
      if (!fight.confidence) return acc;

      const confidenceScore = fight.correct
        ? fight.confidence / 100
        : (100 - fight.confidence) / 100;

      return acc + confidenceScore;
    }, 0);

    return (confidenceAccuracy / fightOutcomes.length) * 100;
  }

  async getModelStats() {
    try {
      const stats = await this.query(`
          WITH fight_stats AS (
              SELECT 
                  po.model_used,
                  COUNT(DISTINCT po.event_id) as events_analyzed,
                  -- Fight predictions
                  SUM(json_extract(fight.value, '$.correct')) as correct_fights,
                  COUNT(fight.value) as total_fights,
                  -- Method predictions
                  SUM(CASE WHEN json_extract(fight.value, '$.methodCorrect') = 1 THEN 1 ELSE 0 END) as correct_methods,
                  -- Confidence accuracy
                  AVG(po.confidence_accuracy) as avg_confidence_accuracy,
                  -- Parlay performance
                  SUM(json_extract(parlay.value, '$.correct')) as correct_parlay_legs,
                  COUNT(parlay.value) as total_parlay_legs,
                  -- Prop performance
                  SUM(json_extract(prop.value, '$.correct')) as correct_props,
                  COUNT(prop.value) as total_props
              FROM prediction_outcomes po
              CROSS JOIN json_each(po.fight_outcomes) as fight
              LEFT JOIN json_each(po.parlay_outcomes) as parlay
              LEFT JOIN json_each(po.prop_outcomes) as prop
              GROUP BY po.model_used
          )
          SELECT 
              model_used,
              events_analyzed,
              correct_fights,
              total_fights,
              ROUND(CAST(correct_fights AS FLOAT) / total_fights * 100, 2) as fight_accuracy,
              ROUND(CAST(correct_methods AS FLOAT) / total_fights * 100, 2) as method_accuracy,
              ROUND(avg_confidence_accuracy, 2) as confidence_accuracy,
              correct_parlay_legs,
              total_parlay_legs,
              ROUND(CAST(correct_parlay_legs AS FLOAT) / total_parlay_legs * 100, 2) as parlay_accuracy,
              correct_props,
              total_props,
              ROUND(CAST(correct_props AS FLOAT) / total_props * 100, 2) as prop_accuracy
          FROM fight_stats
          WHERE total_fights > 0
      `);

      return stats;
    } catch (error) {
      console.error("Error getting model stats:", error);
      throw error;
    }
  }
  processFightOutcomes(predictedFights, actualResults) {
    if (!predictedFights || !actualResults) return [];

    return predictedFights
      .map((prediction) => {
        const actualFight = actualResults.find(
          (result) =>
            (result.winner === prediction.fighter1 &&
              result.loser === prediction.fighter2) ||
            (result.winner === prediction.fighter2 &&
              result.loser === prediction.fighter1)
        );

        if (!actualFight) return null;

        return {
          fighter1: prediction.fighter1,
          fighter2: prediction.fighter2,
          predictedWinner: prediction.predictedWinner,
          actualWinner: actualFight.winner,
          confidence: prediction.confidence,
          predictedMethod: prediction.method,
          actualMethod: actualFight.method,
          correct: actualFight.winner === prediction.predictedWinner,
          methodCorrect: prediction.method
            ?.toLowerCase()
            .includes(actualFight.method.toLowerCase()),
        };
      })
      .filter(Boolean);
  }

  processParlayOutcomes(parlayStr, actualResults) {
    if (!parlayStr) return [];

    // Extract fighter names from parlay string
    const parlayMatches = parlayStr.match(/include ([^,]+(?:,[^,]+)*)/i);
    if (!parlayMatches) return [];

    const parlayFighters = parlayMatches[1].split(",").map((s) => s.trim());

    return parlayFighters
      .map((fighter) => {
        const result = actualResults.find(
          (r) => r.winner === fighter || r.loser === fighter
        );
        if (!result) return null;

        return {
          fighter,
          correct: result.winner === fighter,
        };
      })
      .filter(Boolean);
  }

  processPropOutcomes(propsStr, actualResults) {
    if (!propsStr) return [];

    // Extract prop bets from string
    const propMatches = propsStr.match(/([^,.]+(?:by|win by)[^,.]+)/gi) || [];

    return propMatches
      .map((prop) => {
        const [fighter, method] = prop.split(/\s+by\s+/i);
        const result = actualResults.find(
          (r) => r.winner === fighter || r.loser === fighter
        );
        if (!result) return null;

        return {
          fighter: fighter.trim(),
          predictedMethod: method?.trim(),
          actualMethod: result.method,
          correct:
            result.winner === fighter &&
            method?.toLowerCase().includes(result.method.toLowerCase()),
        };
      })
      .filter(Boolean);
  }

  calculateConfidenceAccuracy(fightOutcomes) {
    if (!fightOutcomes || fightOutcomes.length === 0) return 0;

    const confidenceAccuracy = fightOutcomes.reduce((acc, fight) => {
      if (!fight.confidence) return acc;

      // Compare confidence with actual outcome
      const confidenceScore = fight.correct
        ? fight.confidence / 100 // If correct, higher confidence is better
        : (100 - fight.confidence) / 100; // If wrong, lower confidence is better

      return acc + confidenceScore;
    }, 0);

    return (confidenceAccuracy / fightOutcomes.length) * 100;
  }

  async getModelStats() {
    try {
      const stats = await this.query(`
          WITH fight_stats AS (
              SELECT 
                  po.model_used,
                  COUNT(DISTINCT po.event_id) as events_analyzed,
                  -- Fight predictions
                  SUM(json_extract(fight.value, '$.correct')) as correct_fights,
                  COUNT(fight.value) as total_fights,
                  -- Method predictions
                  SUM(CASE WHEN json_extract(fight.value, '$.methodCorrect') = 1 THEN 1 ELSE 0 END) as correct_methods,
                  -- Confidence accuracy
                  AVG(po.confidence_accuracy) as avg_confidence_accuracy,
                  -- Parlay performance
                  SUM(json_extract(parlay.value, '$.correct')) as correct_parlay_legs,
                  COUNT(parlay.value) as total_parlay_legs,
                  -- Prop performance
                  SUM(json_extract(prop.value, '$.correct')) as correct_props,
                  COUNT(prop.value) as total_props
              FROM prediction_outcomes po
              CROSS JOIN json_each(po.fight_outcomes) as fight
              LEFT JOIN json_each(po.parlay_outcomes) as parlay
              LEFT JOIN json_each(po.prop_outcomes) as prop
              GROUP BY po.model_used
          )
          SELECT 
              model_used,
              events_analyzed,
              correct_fights,
              total_fights,
              ROUND(CAST(correct_fights AS FLOAT) / total_fights * 100, 2) as fight_accuracy,
              ROUND(CAST(correct_methods AS FLOAT) / total_fights * 100, 2) as method_accuracy,
              ROUND(avg_confidence_accuracy, 2) as confidence_accuracy,
              correct_parlay_legs,
              total_parlay_legs,
              ROUND(CAST(correct_parlay_legs AS FLOAT) / total_parlay_legs * 100, 2) as parlay_accuracy,
              correct_props,
              total_props,
              ROUND(CAST(correct_props AS FLOAT) / total_props * 100, 2) as prop_accuracy
          FROM fight_stats
          WHERE total_fights > 0
      `);

      return stats;
    } catch (error) {
      console.error("Error getting model stats:", error);
      throw error;
    }
  }
  async query(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) {
          console.error("Database query error:", err);
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  async getFinishes(fighterName, position, method) {
    return new Promise((resolve, reject) => {
      this.db.get(
        `
        SELECT COUNT(*) as count
        FROM events
        WHERE ${position} = ?
        AND Method LIKE ?
      `,
        [fighterName, `%${method}%`],
        (err, result) => {
          if (err) {
            console.error("Error getting finishes:", err);
            resolve(0);
          } else {
            resolve(result.count);
          }
        }
      );
    });
  }
}

// Helper function for getting event link
async function getEventLink() {
  try {
    const response = await axios.get(
      "http://www.ufcstats.com/statistics/events/completed"
    );
    const $ = cheerio.load(response.data);
    const nextEventRow = $('tr:contains("NEXT")');
    const eventLink = nextEventRow.find("a").attr("href");
    return eventLink || null;
  } catch (error) {
    console.error("Error fetching event link:", error);
    return null;
  }
}

async function calculateWinRate(fighterName) {
  try {
    const result = await query(
      `
      SELECT 
        COUNT(CASE WHEN Winner = ? THEN 1 END) as wins,
        COUNT(*) as total_fights
      FROM events
      WHERE Winner = ? OR Loser = ?
    `,
      [fighterName, fighterName, fighterName]
    );

    if (!result || !result[0]) return 0;

    const { wins, total_fights } = result[0];
    return total_fights > 0 ? (wins / total_fights) * 100 : 0;
  } catch (error) {
    console.error(`Error calculating win rate for ${fighterName}:`, error);
    return 0;
  }

  
}



const database = new DatabaseManager();

module.exports = database;