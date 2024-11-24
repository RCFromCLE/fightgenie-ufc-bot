const {
    EmbedBuilder,
    ButtonBuilder,
    ActionRowBuilder,
    ButtonStyle,
} = require("discord.js");
const PaymentHandler = require("../utils/PaymentHandler");
const database = require("../database");
const SolanaPriceService = require("../utils/SolanaPriceService");

class PaymentCommand {
  static async handleBuyCommand(message) {
    try {
        if (!message.guild) {
            await message.reply({
                content: "⚠️ This command must be used in a server channel.",
                ephemeral: true
            });
            return;
        }

        // Store guild info
        const guildId = message.guild.id;
        const guildName = message.guild.name;
        
        console.log('Processing buy command for server:', { guildId, guildName });

        // Check subscription status
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
            ORDER BY ss.created_at DESC
            LIMIT 1
        `, [guildId]);

        // Get upcoming event
        const upcomingEvent = await database.getUpcomingEvent();
        if (!upcomingEvent) {
            await message.reply({
                content: "Error: Could not find upcoming event information.",
                ephemeral: true
            });
            return;
        }

        // Calculate prices with Solana discount
        const lifetimeUsdAmount = 50.00;
        const eventUsdAmount = 6.99;
        const [lifetimeSolAmount, eventSolAmount] = await Promise.all([
            SolanaPriceService.getPriceWithDiscount(lifetimeUsdAmount),
            SolanaPriceService.getPriceWithDiscount(eventUsdAmount)
        ]);

        let embed;
        let components = [];

        if (subscription?.[0]?.subscription_type === 'LIFETIME') {
            // Server already has lifetime access
            embed = new EmbedBuilder()
                .setColor('#00ff00')
                .setTitle('✅ Lifetime Access Active')
                .setDescription(`This server already has lifetime access to Fight Genie!`);
        } else if (subscription?.[0]?.subscription_type === 'EVENT' && 
                  new Date(subscription[0].formatted_expiration) > new Date()) {
            // Show upgrade offer for active event subscription
            embed = new EmbedBuilder()
                .setColor('#0099ff')
                .setTitle('🌟 Upgrade to Lifetime Access')
                .setAuthor({
                    name: 'Fight Genie',
                    iconURL: 'attachment://FightGenie_Logo_1.PNG'
                })
                .setDescription([
                    `Upgrade your server **${guildName}** to lifetime access!`,
                    "",
                    "**Current Status:**",
                    `✅ Active event access for **${subscription[0].event_name}**`,
                    `⏰ Expires: ${new Date(subscription[0].formatted_expiration).toLocaleString()}`,
                    "",
                    "**Why Upgrade?**",
                    "• Never pay for predictions again",
                    "• Full access to all future events",
                    "• Special AI features and priority updates",
                    "• Server-wide access for all members"
                ].join('\n'))
                .addFields({
                    name: '🌟 Special Launch Offer',
                    value: [
                        "```",
                        "• One-time payment for permanent access",
                        "• Save hundreds compared to event passes",
                        "• Access for all future UFC events",
                        "• All members can use predictions",
                        "• Never pay again!",
                        "",
                        `PayPal: $${lifetimeUsdAmount.toFixed(2)}`,
                        `Solana: ${lifetimeSolAmount} SOL (10% discount!)`,
                        "```"
                    ].join('\n')
                });

            components = [
                new ActionRowBuilder()
                    .addComponents(
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
                    )
            ];
        } else {
            // Full purchase options
            embed = new EmbedBuilder()
                .setColor('#0099ff')
                .setTitle('🌟 Fight Genie Server Access')
                .setAuthor({
                    name: 'Fight Genie',
                    iconURL: 'attachment://FightGenie_Logo_1.PNG'
                })
                .setDescription([
                    `Choose your payment method and access type below.`,
                    `All members in **${guildName}** will be able to use predictions!`
                ].join('\n'))
                .addFields(
                    {
                        name: '🌟 Server Lifetime Access - Special Launch Offer!',
                        value: [
                            "```",
                            "• One-time payment for permanent access",
                            "• Server-wide access to all predictions",
                            "• All members can use predictions",
                            "• Never pay again!",
                            "",
                            `PayPal: $${lifetimeUsdAmount.toFixed(2)}`,
                            `Solana: ${lifetimeSolAmount} SOL (10% discount!)`,
                            "```"
                        ].join('\n'),
                        inline: false
                    }
                );

            if (upcomingEvent) {
                embed.addFields({
                    name: `🎟️ Event Access - ${upcomingEvent.Event}`,
                    value: [
                        "```",
                        `• Access for ${upcomingEvent.Event}`,
                        `• Event Date: ${new Date(upcomingEvent.Date).toLocaleString("en-US", {
                            timeZone: "America/New_York",
                            month: "long",
                            day: "numeric",
                            year: "numeric",
                            hour: "numeric",
                            minute: "2-digit",
                            timeZoneName: "short"
                        })}`,
                        "• Server-wide access for one event",
                        "• Perfect for watch parties",
                        "",
                        `PayPal: $${eventUsdAmount.toFixed(2)}`,
                        `Solana: ${eventSolAmount} SOL (10% discount!)`,
                        "```"
                    ].join('\n'),
                    inline: false
                });
            }

            components = [
                new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId(`buy_lifetime_paypal_${guildId}`)
                            .setLabel("Lifetime Access - PayPal")
                            .setEmoji("🌐")
                            .setStyle(ButtonStyle.Primary),
                        new ButtonBuilder()
                            .setCustomId(`buy_lifetime_solana_${guildId}`)
                            .setLabel("Lifetime Access - Solana (10% Off)")
                            .setEmoji("⚡")
                            .setStyle(ButtonStyle.Success)
                    )
            ];

            if (upcomingEvent) {
                components.push(
                    new ActionRowBuilder()
                        .addComponents(
                            new ButtonBuilder()
                                .setCustomId(`buy_event_paypal_${guildId}`)
                                .setLabel("Event Access - PayPal")
                                .setEmoji("🌐")
                                .setStyle(ButtonStyle.Secondary),
                            new ButtonBuilder()
                                .setCustomId(`buy_event_solana_${guildId}`)
                                .setLabel("Event Access - Solana (10% Off)")
                                .setEmoji("⚡")
                                .setStyle(ButtonStyle.Secondary)
                        )
                );
            }
        }

        // Send ephemeral message in server
        await message.author.send({
            embeds: [embed],
            components,
            files: [{
                attachment: './src/images/FightGenie_Logo_1.PNG',
                name: 'FightGenie_Logo_1.PNG'
            }]
        });

        // Send confirmation in channel that DM was sent
        await message.reply({
            content: "✅ Payment options have been sent to your DMs!",
            ephemeral: true
        });

    } catch (error) {
        console.error("Error handling buy command:", error);
        if (error.code === 50007) {
            // Cannot send DM to user
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