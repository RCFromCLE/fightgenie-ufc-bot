const { EmbedBuilder } = require('discord.js');
const database = require('../database');

class SubscriptionCommand {
    static async handleSubscriptionStatus(message) {
        try {
            if (!message.guild) {
                await message.reply('❌ This command must be used in a server.');
                return;
            }

            const serverId = message.guild.id;
            
            // Query all subscription data
            const subscriptions = await database.query(`
                SELECT 
                    ss.*,
                    pl.amount,
                    pl.payment_id as paypal_id,
                    pl.created_at as purchase_date,
                    e.Event as event_name,
                    e.Date as event_date
                FROM server_subscriptions ss
                LEFT JOIN payment_logs pl ON ss.payment_id = pl.payment_id
                LEFT JOIN events e ON ss.event_id = e.event_id
                WHERE ss.server_id = ?
                ORDER BY ss.created_at DESC
            `, [serverId]);

            const embed = new EmbedBuilder()
                .setColor('#0099ff')
                .setTitle(`📊 Subscription Status - ${message.guild.name}`)
                .setDescription('Current Fight Genie subscription information');

            if (subscriptions.length === 0) {
                embed.addFields({
                    name: '❌ No Active Subscription',
                    value: 'This server does not have an active subscription.\nUse `$buy` to purchase access to Fight Genie!',
                    inline: false
                });
            } else {
                for (const sub of subscriptions) {
                    if (sub.subscription_type === 'LIFETIME' && sub.status === 'ACTIVE') {
                        embed.addFields({
                            name: '🌟 Lifetime Access',
                            value: [
                                '```',
                                'Status: Active',
                                `Purchased: ${new Date(sub.purchase_date).toLocaleString()}`,
                                `PayPal ID: ${sub.paypal_id || 'N/A'}`,
                                `Amount: $${sub.amount || '50.00'}`,
                                '```'
                            ].join('\n'),
                            inline: false
                        });
                    } else if (sub.subscription_type === 'EVENT' && sub.status === 'ACTIVE') {
                        const expirationDate = new Date(sub.expiration_date);
                        const isExpired = expirationDate < new Date();
                        
                        embed.addFields({
                            name: '🎟️ Event Access',
                            value: [
                                '```',
                                `Status: ${isExpired ? 'Expired' : 'Active'}`,
                                `Event: ${sub.event_name || 'Unknown Event'}`,
                                `Event Date: ${sub.event_date ? new Date(sub.event_date).toLocaleDateString() : 'N/A'}`,
                                `Expires: ${expirationDate.toLocaleString()}`,
                                `Purchased: ${new Date(sub.purchase_date).toLocaleString()}`,
                                `PayPal ID: ${sub.paypal_id || 'N/A'}`,
                                `Amount: $${sub.amount || '6.99'}`,
                                '```'
                            ].join('\n'),
                            inline: false
                        });
                    }
                }

                // Add recent payments from payment_logs
                const recentPayments = await database.query(`
                    SELECT *
                    FROM payment_logs
                    WHERE server_id = ?
                    ORDER BY created_at DESC
                    LIMIT 5
                `, [serverId]);

                if (recentPayments.length > 0) {
                    const paymentsList = recentPayments.map(payment => 
                        `• ${new Date(payment.created_at).toLocaleString()}: ` +
                        `${payment.payment_type} - $${payment.amount} (${payment.status})`
                    ).join('\n');

                    embed.addFields({
                        name: '💳 Recent Payments',
                        value: `\`\`\`${paymentsList}\`\`\``,
                        inline: false
                    });
                }
            }

            // Add help field
            embed.addFields({
                name: '❓ Need Help?',
                value: 'If you\'re experiencing any issues with your subscription, please use the `$buy` command to view purchase options.',
                inline: false
            });

            embed.setFooter({
                text: 'Fight Genie Subscription System',
                iconURL: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/92/UFC_Logo.svg/2560px-UFC_Logo.svg.png'
            });

            await message.reply({ embeds: [embed] });

        } catch (error) {
            console.error('Error checking subscription status:', error);
            await message.reply('An error occurred while checking subscription status. Please try again later.');
        }
    }
}

module.exports = SubscriptionCommand;