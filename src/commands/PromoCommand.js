const { EmbedBuilder } = require('discord.js');
const database = require('../database');

class PromoCommand {
    static async handlePromoCommand(message, args) {
        try {
            if (!message.guild) {
                await message.reply("⚠️ This command must be used in a server channel.");
                return;
            }

            const serverId = message.guild.id;
            const guildName = message.guild.name;

            if (!args[0]) {
                await message.reply("Please provide a promo code. Usage: $promo CODENAME");
                return;
            }

            const code = args[0].toUpperCase();
            
            // Get next event and validate code
            const validation = await this.validatePromoCode(code, serverId);
            if (!validation.valid) {
                await message.reply(validation.reason);
                return;
            }

            // Redeem code
            const result = await this.redeemPromoCode(code, serverId, validation.event);
            
            const embed = new EmbedBuilder()
                .setColor('#00ff00')
                .setTitle('✅ Promo Code Redeemed!')
                .setDescription([
                    `Successfully activated event access for ${guildName}!`,
                    '',
                    '🎯 Valid only for:',
                    `Event: ${validation.event.Event}`,
                    `Date: ${new Date(validation.event.Date).toLocaleDateString()}`,
                    `Access expires: ${new Date(result.expirationDate).toLocaleString()}`,
                    '',
                    'You can now use all Fight Genie features:',
                    '• AI-powered fight predictions',
                    '• Detailed fighter analysis',
                    '• Live odds integration',
                    '• Betting insights',
                    '',
                    'Use `$upcoming` to start viewing predictions!'
                ].join('\n'));

            await message.reply({ embeds: [embed] });

        } catch (error) {
            console.error('Error handling promo code:', error);
            await message.reply('Error processing promo code. Please try again.');
        }
    }

    static async validatePromoCode(code, serverId) {
        try {
            const promoData = await database.query(`
                SELECT p.*, e.Event, e.Date
                FROM promo_codes p
                JOIN events e ON p.event_id = e.event_id
                WHERE p.code = ?
                AND p.current_uses < p.max_uses
                AND p.is_active = TRUE
                AND e.Date = (
                    SELECT MIN(Date)
                    FROM events
                    WHERE Date >= datetime('now', 'localtime')
                )
            `, [code]);
    
            if (!promoData?.[0]) {
                console.error(`Promo code validation failed: code=${code}, serverId=${serverId}`);
                return { valid: false, reason: '❌ Invalid or expired promo code.' };
            }
    
            const existingAccess = await database.query(`
                SELECT * FROM server_subscriptions
                WHERE server_id = ?
                AND event_id = ?
                AND status = 'ACTIVE'
            `, [serverId, promoData[0].event_id]);
    
            if (existingAccess?.length > 0) {
                return { valid: false, reason: '❌ This server already has access to this event.' };
            }
    
            return { 
                valid: true, 
                event: promoData[0]
            };
        } catch (error) {
            console.error('Error validating promo code:', error);
            throw error;
        }
    }

    
    static async redeemPromoCode(code, serverId, event) {
        try {
            // Start transaction
            await database.query('BEGIN TRANSACTION');

            // Increment usage count
            await database.query(`
                UPDATE promo_codes
                SET current_uses = current_uses + 1
                WHERE code = ?
            `, [code]);

            // Set expiration to 1:30 AM EST the day after the event
            const eventDate = new Date(event.Date);
            const expirationDate = new Date(eventDate);
            expirationDate.setDate(eventDate.getDate() + 2);
            expirationDate.setHours(1, 30, 0, 0);

            // Create subscription
            await database.query(`
                INSERT INTO server_subscriptions (
                    server_id,
                    subscription_type,
                    status,
                    event_id,
                    expiration_date,
                    promo_code
                ) VALUES (?, 'EVENT', 'ACTIVE', ?, ?, ?)
            `, [serverId, event.event_id, expirationDate.toISOString(), code]);

            // Commit transaction
            await database.query('COMMIT');

            return { success: true, expirationDate };

        } catch (error) {
            await database.query('ROLLBACK');
            console.error('Error redeeming promo code:', error);
            throw error;
        }
    }

    static async handleCheckPromos(message) {
        try {
            // Verify admin
            if (!message.member?.permissions.has("Administrator") || 
                message.guild?.id !== "496121279712329756") {
                return;
            }

            const codes = await database.query(`
                SELECT 
                    p.code,
                    p.max_uses,
                    p.current_uses,
                    p.is_active,
                    e.Event as event_name,
                    e.Date as event_date,
                    (SELECT COUNT(*) FROM server_subscriptions WHERE promo_code = p.code) as total_redeemed
                FROM promo_codes p
                JOIN events e ON p.event_id = e.event_id
                ORDER BY p.code_id ASC
            `);

            const embed = new EmbedBuilder()
                .setColor('#0099ff')
                .setTitle('🎟️ Promo Code Status')
                .setDescription(codes.map(code => 
                    `\`${code.code}\`: ${code.current_uses}/${code.max_uses} used | ` +
                    `Event: ${code.event_name} (${new Date(code.event_date).toLocaleDateString()}) ` +
                    `${code.is_active ? '✅' : '❌'}`
                ).join('\n'));

            await message.reply({ embeds: [embed], ephemeral: true });

        } catch (error) {
            console.error('Error checking promo codes:', error);
            await message.reply('Error checking promo codes.');
        }
    }

    // Admin command to create new codes for next event
    static async handleCreateNextEventCodes(message, count = 10) {
        try {
            // Verify admin
            if (!message.member?.permissions.has("Administrator") || 
                message.guild?.id !== "496121279712329756") {
                return;
            }

            // Get next event
            const nextEvent = await database.query(`
                SELECT event_id 
                FROM events 
                WHERE Date > date('now') 
                ORDER BY Date ASC 
                LIMIT 1
            `);

            if (!nextEvent?.[0]) {
                await message.reply("No upcoming event found.");
                return;
            }

            // Create new codes
            const codes = [];
            for (let i = 0; i < count; i++) {
                const code = 'FG' + Math.random().toString(36).substring(2, 8).toUpperCase();
                await database.query(`
                    INSERT INTO promo_codes (code, event_id, max_uses)
                    VALUES (?, ?, 1)
                `, [code, nextEvent[0].event_id]);
                codes.push(code);
            }

            const embed = new EmbedBuilder()
                .setColor('#0099ff')
                .setTitle('🎟️ New Promo Codes Created')
                .setDescription(codes.map(code => `\`${code}\``).join('\n'));

            await message.reply({ embeds: [embed], ephemeral: true });

        } catch (error) {
            console.error('Error creating new promo codes:', error);
            await message.reply('Error creating new promo codes.');
        }
    }
}

module.exports = PromoCommand;