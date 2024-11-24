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

