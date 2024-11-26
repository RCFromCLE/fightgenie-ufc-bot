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