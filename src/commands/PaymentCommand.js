const {
    EmbedBuilder,
    ButtonBuilder,
    ActionRowBuilder,
    ButtonStyle,
} = require("discord.js");
const database = require("../database");
const SolanaPriceService = require("../utils/SolanaPriceService");

class PaymentCommand {
    static async checkLifetimeAccess(serverId) {
        try {
            const subscriptions = await database.query(`
                SELECT 1
                FROM server_subscriptions
                WHERE server_id = ?
                AND subscription_type = 'LIFETIME'
                AND status = 'ACTIVE'
                LIMIT 1
            `, [serverId]);

            return subscriptions?.length > 0;
        } catch (error) {
            console.error("Error checking lifetime access:", error);
            return false;
        }
    }

    static async handleBuyCommand(message) {
        try {
            if (!message.guild) {
                await message.reply({
                    content: "⚠️ This command must be used in a server channel.",
                    ephemeral: true
                });
                return;
            }

            const guildId = message.guild.id;
            const guildName = message.guild.name;

            // Check for lifetime access first
            const hasLifetime = await this.checkLifetimeAccess(guildId);

            if (hasLifetime) {
                const lifetimeEmbed = new EmbedBuilder()
                    .setColor('#00ff00')
                    .setTitle('✅ Fight Genie Lifetime Access')
                    .setDescription([
                        `Your server **${guildName}** has lifetime access to Fight Genie!`,
                        "",
                        "**Active Benefits:**",
                        "• Access to all UFC events",
                        "• Premium predictions and analysis",
                        "• AI-powered fight insights",
                        "• Unlimited server member access",
                        "",
                        "Thank you for your support! Enjoy the predictions!"
                    ].join('\n'));

                await message.author.send({
                    embeds: [lifetimeEmbed],
                    files: [{
                        attachment: './src/images/FightGenie_Logo_1.PNG',
                        name: 'FightGenie_Logo_1.PNG'
                    }]
                });

                await message.reply({
                    content: "✅ Server Status: Lifetime access active - subscription details sent to DMs!",
                    ephemeral: true
                });
                return;
            }

            // Modified query to check for EVENT subscription
            const subscription = await database.query(`
                SELECT 
                    ss.*,
                    e.Event as event_name,
                    e.Date as event_date,
                    datetime(ss.expiration_date) as formatted_expiration
                FROM server_subscriptions ss
                LEFT JOIN events e ON ss.event_id = e.event_id
                WHERE ss.server_id = ?
                AND ss.status = 'ACTIVE'
                AND ss.subscription_type = 'EVENT'
                AND datetime(ss.expiration_date) > datetime('now')
                ORDER BY ss.created_at DESC
                LIMIT 1
            `, [guildId]);

            const lifetimeUsdAmount = 50.00;
            const lifetimeSolAmount = await SolanaPriceService.getPriceWithDiscount(lifetimeUsdAmount);
            

            // Handle Active Event Access
            if (subscription?.[0]?.subscription_type === 'EVENT' &&
                new Date(subscription[0].formatted_expiration) > new Date()) {

                const upgradeEmbed = new EmbedBuilder()
                    .setColor('#0099ff')
                    .setTitle('🌟 Fight Genie Server Status')
                    .setDescription([
                        `Your server **${guildName}** currently has:`,
                        `✅ Active access for **${subscription[0].event_name}**`,
                        `⏰ Access expires: ${new Date(subscription[0].formatted_expiration).toLocaleString()}`,
                        "",
                        "**⚠️ Important Note**",
                        "You'll need to wait until your current event access expires",
                        "before purchasing access to the next event.",
                        "",
                        "**🔥 SPECIAL UPGRADE OFFER**",
                        "Want instant access to all future events?",
                        "Convert to lifetime access today!",
                        "",
                        "**Lifetime Benefits:**",
                        "• Never pay for predictions again",
                        "• Access to ALL future UFC events",
                        "• Premium features and priority updates",
                        "• Unlimited server member access",
                        "",
                        "**One-Time Upgrade Pricing:**",
                        `• Apple Pay: $${lifetimeUsdAmount.toFixed(2)}`,
                        `• PayPal: $${lifetimeUsdAmount.toFixed(2)}`,
                        `• Solana: ${lifetimeSolAmount} SOL (10% discount!)`
                    ].join('\n'));

                const upgradeButtons = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId(`buy_lifetime_stripe_${guildId}`)
                            .setLabel("Upgrade with Apple Pay")
                            .setEmoji("💳")
                            .setStyle(ButtonStyle.Primary),
                        new ButtonBuilder()
                            .setCustomId(`buy_lifetime_paypal_${guildId}`)
                            .setLabel("Upgrade with PayPal")
                            .setEmoji("🌐")
                            .setStyle(ButtonStyle.Primary),
                        new ButtonBuilder()
                            .setCustomId(`buy_lifetime_solana_${guildId}`)
                            .setLabel("Upgrade with Solana (10% Off)")
                            .setEmoji("⚡")
                            .setStyle(ButtonStyle.Success)
                    );

                await message.author.send({
                    embeds: [upgradeEmbed],
                    components: [upgradeButtons],
                    files: [{
                        attachment: './src/images/FightGenie_Logo_1.PNG',
                        name: 'FightGenie_Logo_1.PNG'
                    }]
                });

                await message.reply({
                    content: `✅ Server Status: Active event access for ${subscription[0].event_name} (expires ${new Date(subscription[0].formatted_expiration).toLocaleString()}) - please wait until expiration to purchase next event, or upgrade to lifetime access (options sent to DMs)!`,
                    ephemeral: true
                });
                return;
            }

            const upcomingEvent = await database.getUpcomingEvent();
            if (!upcomingEvent) {
                await message.reply({
                    content: "Error: Could not find upcoming event information.",
                    ephemeral: true
                });
                return;
            }

            const eventUsdAmount = 6.99;
            const eventSolAmount = await SolanaPriceService.getPriceWithDiscount(eventUsdAmount);

            const purchaseEmbed = new EmbedBuilder()
                .setColor('#0099ff')
                .setTitle('🎯 Fight Genie Access Options')
                .setDescription([
                    `Access options for server **${guildName}**:`,
                    "• All members get access to predictions",
                    "• AI-powered fight analysis",
                    "• Premium betting insights",
                    "• Real-time odds integration",
                    "",
                    "Choose your subscription below:"
                ].join('\n'))
                .addFields(
                    {
                        name: '🌟 Lifetime Server Access',
                        value: [
                            "```",
                            "• Access ALL future UFC events",
                            "• One-time payment - never pay again",
                            "• Premium features included",
                            "• Priority support access",
                            "",
                            "Apple Pay: $" + lifetimeUsdAmount.toFixed(2),
                            `PayPal: $${lifetimeUsdAmount.toFixed(2)}`,
                            `Solana: ${lifetimeSolAmount} SOL (10% off!)`,
                            "```"
                        ].join('\n'),
                        inline: false
                    },
                    {
                        name: `🎟️ ${upcomingEvent.Event} Access`,
                        value: [
                            "```",
                            `• Full access for ${upcomingEvent.Event}`,
                            `• Event Date: ${new Date(upcomingEvent.Date).toLocaleString()}`,
                            "• Access until event completion",
                            "• Perfect for single event access",
                            "",
                            "Apple Pay: $" + eventUsdAmount.toFixed(2),
                            `PayPal: $${eventUsdAmount.toFixed(2)}`,
                            `Solana: ${eventSolAmount} SOL (10% off!)`,
                            "```"
                        ].join('\n'),
                        inline: false
                    },
                    {
                        name: '💡 Need Help?',
                        value: 'Click a payment button below to get started.\nYour selected payment method will guide you through the process.',
                        inline: false
                    }
                );

                const purchaseButtons = [
                    new ActionRowBuilder()
                        .addComponents(
                            new ButtonBuilder()
                                .setCustomId(`buy_lifetime_stripe_${guildId}`)
                                .setLabel("Lifetime Access - Apple Pay")
                                .setEmoji("💳")
                                .setStyle(ButtonStyle.Primary),
                            new ButtonBuilder()
                                .setCustomId(`buy_lifetime_paypal_${guildId}`)
                                .setLabel("Lifetime Access - PayPal")
                                .setEmoji("🌐")
                                .setStyle(ButtonStyle.Primary),
                            new ButtonBuilder()
                                .setCustomId(`buy_lifetime_solana_${guildId}`)
                                .setLabel("Lifetime Access - Solana")
                                .setEmoji("⚡")
                                .setStyle(ButtonStyle.Success)
                        ),
                    new ActionRowBuilder()
                        .addComponents(
                            new ButtonBuilder()
                                .setCustomId(`buy_event_stripe_${guildId}`)
                                .setLabel("Event Access - Apple Pay")
                                .setEmoji("💳")
                                .setStyle(ButtonStyle.Secondary),
                            new ButtonBuilder()
                                .setCustomId(`buy_event_paypal_${guildId}`)
                                .setLabel("Event Access - PayPal")
                                .setEmoji("🎟️")
                                .setStyle(ButtonStyle.Secondary),
                            new ButtonBuilder()
                                .setCustomId(`buy_event_solana_${guildId}`)
                                .setLabel("Event Access - Solana")
                                .setEmoji("⚡")
                                .setStyle(ButtonStyle.Secondary)
                        )
                ];

            await message.author.send({
                embeds: [purchaseEmbed],
                components: purchaseButtons,
                files: [{
                    attachment: './src/images/FightGenie_Logo_1.PNG',
                    name: 'FightGenie_Logo_1.PNG'
                }]
            });

            await message.reply({
                content: "✅ Server Status: No active subscription - payment options sent to DMs!",
                ephemeral: true
            });

        } catch (error) {
            console.error("Error handling buy command:", error);
            if (error.code === 50007) {
                await message.reply({
                    content: "❌ Unable to send payment options. Please enable DMs from server members and try again.",
                    ephemeral: true
                });
            } else {
                await message.reply({
                    content: "Error processing server purchase request. Please try again.",
                    ephemeral: true
                });
            }
        }
    }
}

module.exports = PaymentCommand;