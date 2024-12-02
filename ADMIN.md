# fightgenie-ufc-bot
Fight Genie is an AI-integrated UFC prediction Discord bot.


Helpful SQL Commands:

Get all active subscriptions, lifetime and event-based:
```sql
SELECT 
    server_id,
    CASE 
        WHEN payment_type = 'SERVER_LIFETIME' THEN 'Lifetime'
        WHEN payment_type = 'SERVER_EVENT' THEN 'Event'
    END as subscription_type,
    amount,
    status,
    provider,
    created_at,
    updated_at
FROM payment_logs 
WHERE status = 'COMPLETED'
AND payment_type IN ('SERVER_LIFETIME', 'SERVER_EVENT')
ORDER BY created_at DESC;
```

Get all active subscriptions, lifetime only:
```sql

-- Remove all subscriptions for MisfitsUnited Discord server
DELETE FROM server_subscriptions WHERE server_id = 496121279712329756;

-- Remove payment logs for MisfitsUnited Discord server
DELETE FROM payment_logs WHERE server_id = 496121279712329756;
```

# Fight Genie Promo Code System

## Commands
- `$promo CODE` - Users can redeem a promo code for event access
- `$checkpromos` - Admin only: View status of all promo codes
- `$createnewcodes` - Admin only: Generate new codes for next event

## How It Works
- Each code is single-use and tied to the next upcoming event only
- When redeemed, gives server access to that specific event
- Access expires at 1:30 AM EST the day after the event
- Codes cannot be reused or transferred
- A server can only use one promo code per event

## Admin Notes
- Check code status with `$checkpromos`
- Use SQL to manually generate new codes
- Codes are automatically tied to next scheduled event
- No manual cleanup needed - codes expire with the event

-- Get the next event ID
WITH next_event AS (
    SELECT event_id 
    FROM events 
    WHERE Date > date('now') 
    ORDER BY Date ASC 
    LIMIT 1
)

-- Insert 10 new codes
INSERT INTO promo_codes (code, event_id, max_uses) 
SELECT 'FGVIP' || printf('%03d', rowid), event_id, 1
FROM (SELECT rowid FROM sqlite_master WHERE type='table' LIMIT 10), next_event;

-- Check the new codes
SELECT 
    p.code, 
    e.Event as event_name,
    e.Date as event_date,
    p.max_uses,
    p.current_uses,
    p.is_active
FROM promo_codes p
JOIN events e ON p.event_id = e.event_id
WHERE p.code LIKE 'FGVIP%'
ORDER BY p.code;

This will create 10 new codes in the format FGVIP001, FGVIP002, etc., all tied to the next upcoming event. To verify the codes were created and see what event they're for, run that final SELECT query.

$syncpredictions - add predictions from stored_predictions to prediction_outcomes - NO LONGER NEEDED

# Fight Genie Tweet Schedule Documentation

## Regular Weekly Schedule

### Sunday
- **Time**: 2:00 PM
- **Content**: Model Competition / Battle Report
- Shows comparison between GPT-4 and Claude's prediction accuracy
- Includes win rates, method accuracy, and confidence metrics

### Monday
- **Time**: 12:00 PM (Noon)
- **Content**: Weekly Schedule Tweet
- Outlines the schedule for the week
- Includes basic promotional information

### Thursday
- **Time**: 3:00 PM
- **Content**: Value Picks
- High confidence picks (70%+) for the upcoming event
- Includes reasoning and stats

### Saturday
- **Time**: 3:00 PM
- **Content**: Comprehensive Update
- Fight analysis
- Value picks
- Promotional tweet (if it's event day)

## Fight Week (7 Days Before Event)

During fight week, the system randomly schedules two additional types of content:

### Main Card Analysis (Monday-Friday)
- **Time Window**: 9:00 AM - 8:00 PM
- **Frequency**: Once per week
- **Selection**: Random fight from main card
- **Content**: Three-tweet thread analyzing the matchup
- System checks daily at 9 AM for opportunity to post
- 50% chance each day if not yet posted

### Prelim Analysis (Monday-Friday)
- **Time Window**: 9:00 AM - 8:00 PM
- **Frequency**: Once per week
- **Selection**: Random fight from prelims
- **Content**: Three-tweet thread analyzing the matchup
- System checks daily at 9 AM for opportunity to post
- 50% chance each day if not yet posted

## Event Day Schedule

### 12:00 PM (Noon)
1. Promotional tweet
2. Wait 30 minutes
3. Fight analysis thread

### 4:00 PM
- Value picks with confidence ratings

### 8:00 PM
1. Model comparison tweet
2. Wait 30 minutes
3. Final promotional tweet

## Reliability Features

### Tweet Logging
- All tweets are logged in the database
- Includes: type, event_id, content, timestamp
- Prevents duplicate posts if system restarts

### Recovery System
- On startup, checks for missed scheduled tweets
- Will post missed content if within appropriate timeframe
- Maintains schedule integrity even after downtime

### Error Handling
- All tweet attempts are logged
- Failed tweets are reported in console
- System continues operating even if individual tweets fail

## Common Issues & Solutions

### If Bot Restarts:
1. System checks tweet_logs table
2. Identifies any missed scheduled content
3. Posts missing content if still relevant
4. Resumes normal schedule

### Tweet Verification:
- Use `SELECT * FROM tweet_logs WHERE date(created_at) = date('now');` to see today's tweets
- Use `SELECT * FROM tweet_logs WHERE event_id = [EVENT_ID];` to see all tweets for specific event

### Schedule Conflicts:
- System enforces minimum 30-minute gaps between tweets
- Event day schedule takes precedence over regular schedule
- Fight week analysis won't post on event day

## Notes for Admins

1. All times are in server's local timezone
2. Test mode can be enabled with environment variable TWEET_TEST_MODE=true
3. Failed tweets are logged but won't retry automatically
4. Monitor console logs for real-time status updates
5. Database maintains complete history of all tweets

## Database Schema

```sql
CREATE TABLE tweet_logs (
    log_id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER,
    tweet_type TEXT NOT NULL,
    content TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    status TEXT DEFAULT 'completed',
    FOREIGN KEY (event_id) REFERENCES events(event_id)
);
```

### Environment Setup
```bash
# For testing (no actual tweets)
TWEET_TEST_MODE=true

# For live tweeting
TWEET_TEST_MODE=false
```

### Testing
Use `$testpost` command to generate sample posts for all content types. Results are saved to `tweet-logs.txt` for review.

### Note
- All times are in EST
- Test mode can be enabled via environment variable `TWEET_TEST_MODE=true`
- Website link (https://fightgenie.ai) included in promotional tweets
- Discord bot link referenced as "in bio" to comply with Twitter's link policy