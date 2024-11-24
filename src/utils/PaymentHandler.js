const { EmbedBuilder, ButtonBuilder, ActionRowBuilder, ButtonStyle, PermissionFlagsBits } = require("discord.js");
const PayPalService = require("./PayPalService");
const PaymentModel = require("../models/PaymentModel");
const database = require("../database");
const SolanaPriceService = require("./SolanaPriceService");

class PaymentHandler {
    // static async handleBuyCommand(message) {
    //     try {
    //         if (!message.guild) {
    //             await message.reply({
    //                 content: "⚠️ This command must be used in a server channel.",
    //                 ephemeral: true
    //             });
    //             return;
    //         }

    //         // Store guild info
    //         const guildId = message.guild.id;
    //         const guildName = message.guild.name;
            
    //         console.log('Processing buy command for server:', { guildId, guildName });

    //         // Check subscription status
    //         const subscription = await database.query(`
    //             SELECT 
    //                 ss.*,
    //                 e.Event as event_name,
    //                 e.Date as event_date,
    //                 datetime(ss.expiration_date) as formatted_expiration
    //             FROM server_subscriptions ss
    //             LEFT JOIN events e ON ss.event_id = e.event_id
    //             WHERE ss.server_id = ?
    //             AND ss.status = 'ACTIVE'
    //             ORDER BY ss.created_at DESC
    //             LIMIT 1
    //         `, [guildId]);

    //         // Get upcoming event
    //         const upcomingEvent = await database.getUpcomingEvent();
    //         if (!upcomingEvent) {
    //             await message.reply({
    //                 content: "Error: Could not find upcoming event information.",
    //                 ephemeral: true
    //             });
    //             return;
    //         }

    //         // Calculate prices with Solana discount
    //         const lifetimeUsdAmount = 50.00;
    //         const eventUsdAmount = 6.99;
    //         const [lifetimeSolAmount, eventSolAmount] = await Promise.all([
    //             SolanaPriceService.getPriceWithDiscount(lifetimeUsdAmount),
    //             SolanaPriceService.getPriceWithDiscount(eventUsdAmount)
    //         ]);

    //         let embed;
    //         let components = [];

    //         if (subscription?.[0]?.subscription_type === 'LIFETIME') {
    //             // Server already has lifetime access
    //             embed = new EmbedBuilder()
    //                 .setColor('#00ff00')
    //                 .setTitle('✅ Lifetime Access Active')
    //                 .setDescription(`This server already has lifetime access to Fight Genie!`);
    //         } else if (subscription?.[0]?.subscription_type === 'EVENT' && 
    //                   new Date(subscription[0].formatted_expiration) > new Date()) {
    //             // Show upgrade offer for active event subscription
    //             embed = new EmbedBuilder()
    //                 .setColor('#0099ff')
    //                 .setTitle('🌟 Upgrade to Lifetime Access')
    //                 .setAuthor({
    //                     name: 'Fight Genie',
    //                     iconURL: 'attachment://FightGenie_Logo_1.PNG'
    //                 })
    //                 .setDescription([
    //                     `Upgrade your server **${guildName}** to lifetime access!`,
    //                     "",
    //                     "**Current Status:**",
    //                     `✅ Active event access for **${subscription[0].event_name}**`,
    //                     `⏰ Expires: ${new Date(subscription[0].formatted_expiration).toLocaleString()}`,
    //                     "",
    //                     "**Why Upgrade?**",
    //                     "• Never pay for predictions again",
    //                     "• Full access to all future events",
    //                     "• Special AI features and priority updates",
    //                     "• Server-wide access for all members"
    //                 ].join('\n'))
    //                 .addFields({
    //                     name: '🌟 Special Launch Offer',
    //                     value: [
    //                         "```",
    //                         "• One-time payment for permanent access",
    //                         "• Save hundreds compared to event passes",
    //                         "• Access for all future UFC events",
    //                         "• All members can use predictions",
    //                         "• Never pay again!",
    //                         "",
    //                         `PayPal: $${lifetimeUsdAmount.toFixed(2)}`,
    //                         `Solana: ${lifetimeSolAmount} SOL (10% discount!)`,
    //                         "```"
    //                     ].join('\n')
    //                 });

    //             components = [
    //                 new ActionRowBuilder()
    //                     .addComponents(
    //                         new ButtonBuilder()
    //                             .setCustomId(`buy_lifetime_paypal_${guildId}`)
    //                             .setLabel("Upgrade with PayPal")
    //                             .setEmoji("🌐")
    //                             .setStyle(ButtonStyle.Primary),
    //                         new ButtonBuilder()
    //                             .setCustomId(`buy_lifetime_solana_${guildId}`)
    //                             .setLabel("Upgrade with Solana (10% Off)")
    //                             .setEmoji("⚡")
    //                             .setStyle(ButtonStyle.Success)
    //                     )
    //             ];
    //         } else {
    //             // Full purchase options
    //             embed = new EmbedBuilder()
    //                 .setColor('#0099ff')
    //                 .setTitle('🌟 Fight Genie Server Access')
    //                 .setAuthor({
    //                     name: 'Fight Genie',
    //                     iconURL: 'attachment://FightGenie_Logo_1.PNG'
    //                 })
    //                 .setDescription([
    //                     `Choose your payment method and access type below.`,
    //                     `All members in **${guildName}** will be able to use predictions!`
    //                 ].join('\n'))
    //                 .addFields(
    //                     {
    //                         name: '🌟 Server Lifetime Access - Special Launch Offer!',
    //                         value: [
    //                             "```",
    //                             "• One-time payment for permanent access",
    //                             "• Server-wide access to all predictions",
    //                             "• All members can use predictions",
    //                             "• Never pay again!",
    //                             "",
    //                             `PayPal: $${lifetimeUsdAmount.toFixed(2)}`,
    //                             `Solana: ${lifetimeSolAmount} SOL (10% discount!)`,
    //                             "```"
    //                         ].join('\n'),
    //                         inline: false
    //                     }
    //                 );

    //             if (upcomingEvent) {
    //                 embed.addFields({
    //                     name: `🎟️ Event Access - ${upcomingEvent.Event}`,
    //                     value: [
    //                         "```",
    //                         `• Access for ${upcomingEvent.Event}`,
    //                         `• Event Date: ${new Date(upcomingEvent.Date).toLocaleString("en-US", {
    //                             timeZone: "America/New_York",
    //                             month: "long",
    //                             day: "numeric",
    //                             year: "numeric",
    //                             hour: "numeric",
    //                             minute: "2-digit",
    //                             timeZoneName: "short"
    //                         })}`,
    //                         "• Server-wide access for one event",
    //                         "• Perfect for watch parties",
    //                         "",
    //                         `PayPal: $${eventUsdAmount.toFixed(2)}`,
    //                         `Solana: ${eventSolAmount} SOL (10% discount!)`,
    //                         "```"
    //                     ].join('\n'),
    //                     inline: false
    //                 });
    //             }

    //             components = [
    //                 new ActionRowBuilder()
    //                     .addComponents(
    //                         new ButtonBuilder()
    //                             .setCustomId(`buy_lifetime_paypal_${guildId}`)
    //                             .setLabel("Lifetime Access - PayPal")
    //                             .setEmoji("🌐")
    //                             .setStyle(ButtonStyle.Primary),
    //                         new ButtonBuilder()
    //                             .setCustomId(`buy_lifetime_solana_${guildId}`)
    //                             .setLabel("Lifetime Access - Solana (10% Off)")
    //                             .setEmoji("⚡")
    //                             .setStyle(ButtonStyle.Success)
    //                     )
    //             ];

    //             if (upcomingEvent) {
    //                 components.push(
    //                     new ActionRowBuilder()
    //                         .addComponents(
    //                             new ButtonBuilder()
    //                                 .setCustomId(`buy_event_paypal_${guildId}`)
    //                                 .setLabel("Event Access - PayPal")
    //                                 .setEmoji("🌐")
    //                                 .setStyle(ButtonStyle.Secondary),
    //                             new ButtonBuilder()
    //                                 .setCustomId(`buy_event_solana_${guildId}`)
    //                                 .setLabel("Event Access - Solana (10% Off)")
    //                                 .setEmoji("⚡")
    //                                 .setStyle(ButtonStyle.Secondary)
    //                         )
    //                 );
    //             }
    //         }

    //         // Send ephemeral message in server
    //         await message.author.send({
    //             embeds: [embed],
    //             components,
    //             files: [{
    //                 attachment: './src/images/FightGenie_Logo_1.PNG',
    //                 name: 'FightGenie_Logo_1.PNG'
    //             }]
    //         });

    //         // Send confirmation in channel that DM was sent
    //         await message.reply({
    //             content: "✅ Payment options have been sent to your DMs!",
    //             ephemeral: true
    //         });

    //     } catch (error) {
    //         console.error("Error handling buy command:", error);
    //         if (error.code === 50007) {
    //             // Cannot send DM to user
    //             await message.reply({
    //                 content: "❌ Unable to send payment options. Please enable DMs from server members and try again.",
    //                 ephemeral: true
    //             });
    //         } else {
    //             await message.reply({
    //                 content: "Error processing server purchase request. Please try again.",
    //                 ephemeral: true
    //             });
    //         }
    //     }
    // }

    static async handlePayment(interaction) {
        try {
            if (!interaction.deferred && !interaction.replied) {
                await interaction.deferUpdate();
            }
    
            const [action, type, method, guildId] = interaction.customId.split('_');
            const userId = interaction.user.id;
            const userName = interaction.user.username;
            
            if (!guildId || !userId) {
                console.error('Missing guild or user information:', { guildId, userId });
                await interaction.editReply({
                    content: "Error: Unable to process payment. Please try again.",
                    ephemeral: true
                });
                return;
            }
    
            console.log('Processing payment for:', { guildId, userId, userName });
    
            const isLifetime = type === 'lifetime';
            const isSolana = method === 'solana';
            const amount = isLifetime ? 50.00 : 6.99;
    
            const upcomingEvent = await database.getUpcomingEvent();
            if (!upcomingEvent && !isLifetime) {
                await interaction.editReply({
                    content: "Error: Could not find upcoming event information.",
                    ephemeral: true
                });
                return;
            }
    
            const eventDate = upcomingEvent ? new Date(upcomingEvent.Date).toLocaleString('en-US', {
                timeZone: 'America/New_York',
                month: 'long',
                day: 'numeric',
                year: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
                timeZoneName: 'short'
            }) : null;
    
            if (isSolana) {
                await this.handleSolanaPayment(interaction, {
                    amount,
                    isLifetime,
                    upcomingEvent,
                    eventDate,
                    guildId,
                    userId,
                    userName
                });
            } else {
                await this.handlePayPalPayment(interaction, {
                    amount,
                    isLifetime,
                    upcomingEvent,
                    eventDate,
                    guildId,
                    userId,
                    userName
                });
            }
    
        } catch (error) {
            console.error('Payment handling error:', error);
            await interaction.editReply({
                content: 'Error processing payment request. Please try again.',
                ephemeral: true
            });
        }
    }
    
    static async handlePayPalPayment(interaction, { amount, isLifetime, upcomingEvent, eventDate, guildId, userId, userName }) {
        try {
            console.log('Creating PayPal payment for:', { userId, guildId, amount, isLifetime });
    
            // Create PayPal order
            const order = await PayPalService.createPaymentOrder(
                userId,
                guildId,
                amount,
                isLifetime ? 'SERVER_LIFETIME' : 'SERVER_EVENT'
            );
    
            if (!order) {
                throw new Error('Failed to create PayPal order');
            }
    
            const embed = new EmbedBuilder()
                .setColor('#0099ff')
                .setTitle('🌐 Complete Your PayPal Purchase')
                .setAuthor({
                    name: 'Fight Genie',
                    iconURL: 'attachment://FightGenie_Logo_1.PNG'
                })
                .setDescription(
                    `Complete your payment of $${amount.toFixed(2)} through PayPal to activate ${isLifetime ? 'lifetime' : 'event'} access.`
                )
                .addFields(
                    {
                        name: isLifetime ? '🌟 Lifetime Access' : `🎟️ Event Access - ${upcomingEvent.Event}`,
                        value: isLifetime 
                            ? '• One-time payment for permanent access\n• Server-wide access to all predictions\n• Never pay again!'
                            : `• Access for ${upcomingEvent.Event}\n• Event Date: ${eventDate}\n• Server-wide access for one event\n• Perfect for watch parties`,
                        inline: false
                    },
                    {
                        name: 'Next Steps',
                        value: [
                            '1. Click the PayPal button below',
                            '2. Complete payment on PayPal',
                            '3. Return here and click "Verify Payment"',
                            '4. Start using Fight Genie predictions!'
                        ].join('\n')
                    }
                );
    
            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setLabel('Pay with PayPal')
                        .setURL(order.approveLink)
                        .setStyle(ButtonStyle.Link),
                    new ButtonBuilder()
                        .setCustomId(`verify_payment_${order.orderId}_${guildId}`)
                        .setLabel('Verify Payment')
                        .setEmoji('✅')
                        .setStyle(ButtonStyle.Success)
                );
    
            await interaction.editReply({
                embeds: [embed],
                components: [row],
                files: [{
                    attachment: './src/images/FightGenie_Logo_1.PNG',
                    name: 'FightGenie_Logo_1.PNG'
                }],
                ephemeral: true
            });
    
        } catch (error) {
            console.error('PayPal payment error:', error);
            await interaction.editReply({
                content: "Error creating PayPal payment. Please try again.",
                ephemeral: true
            });
        }
    }
    
    static async handlePaymentVerification(interaction) {
        try {
            const [_, __, orderId, serverId] = interaction.customId.split("_");
            console.log("Verifying payment:", { orderId, serverId });
    
            if (!interaction.deferred && !interaction.replied) {
                await interaction.deferUpdate();
            }
    
            const loadingEmbed = new EmbedBuilder()
                .setColor("#ffff00")
                .setTitle("🔄 Verifying Payment")
                .setDescription("Please wait while we verify your payment with PayPal...");
    
            await interaction.editReply({
                embeds: [loadingEmbed],
                components: []
            });
    
            let attempts = 0;
            let paymentStatus = null;
    
            while (attempts < 3 && !paymentStatus?.success) {
                paymentStatus = await PayPalService.verifyPayment(orderId);
                if (!paymentStatus.success) {
                    await new Promise((resolve) => setTimeout(resolve, 2000));
                    attempts++;
                }
            }
    
            if (paymentStatus.success) {
                const amount = parseFloat(paymentStatus.amount);
                const isLifetime = amount === 50.0;
    
                console.log("Payment verified:", { amount, isLifetime });
    
                if (isLifetime) {
                    await PaymentModel.activateServerLifetimeSubscription(serverId, orderId);
                    console.log("Lifetime subscription activated for server:", serverId);
                } else {
                    await PaymentModel.activateServerEventAccess(serverId, orderId);
                    console.log("Event access activated for server:", serverId);
                }
    
                const successEmbed = new EmbedBuilder()
                    .setColor("#00ff00")
                    .setTitle("✅ Payment Successful!")
                    .setDescription(
                        isLifetime 
                            ? "Your server now has lifetime access to Fight Genie!"
                            : "Your server now has event access to Fight Genie!"
                    )
                    .addFields({
                        name: "🎯 Premium Features Unlocked",
                        value: [
                            "• AI Fight Predictions",
                            "• Detailed Fighter Analysis",
                            "• Live Odds Integration",
                            "• Betting Analysis & Tips",
                            "• Props & Parlay Recommendations"
                        ].join("\n"),
                    })
                    .addFields({
                        name: "🎉 What's Next?",
                        value: "Use `$upcoming` to see the next UFC event and start getting predictions!"
                    });
    
                await interaction.editReply({
                    embeds: [successEmbed],
                    components: []
                });
    
            } else {
                const paymentEmbed = new EmbedBuilder()
                    .setColor('#0099ff')
                    .setTitle('🌐 Complete Your PayPal Purchase')
                    .setDescription(
                        `Complete your payment of $50.00 through PayPal to activate lifetime access.`
                    )
                    .addFields(
                        {
                            name: '🌟 Lifetime Access',
                            value: [
                                '• One-time payment for permanent access',
                                '• Server-wide access to all predictions',
                                '• Never pay again!'
                            ].join('\n'),
                            inline: false
                        },
                        {
                            name: 'Next Steps',
                            value: [
                                '1. Click the PayPal button below',
                                '2. Complete payment on PayPal', 
                                '3. Return here and click "Verify Payment"',
                                '4. Start using Fight Genie predictions!'
                            ].join('\n')
                        }
                    );
    
                const errorEmbed = new EmbedBuilder()
                    .setColor("#ff0000")
                    .setTitle("❌ Payment Verification Failed")
                    .setDescription(
                        paymentStatus.message || 
                        "Please complete your payment in PayPal before verifying. If you've already paid, wait a few moments and try again."
                    )
                    .addFields({
                        name: "What to do",
                        value: [
                            "1. Make sure you completed payment in PayPal",
                            "2. Wait a few moments",
                            "3. Click 'Try Verification Again'"
                        ].join("\n")
                    });
    
                const retryRow = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setLabel('Pay with PayPal')
                            .setURL(PayPalService.CHECKOUT_BASE + `?token=${orderId}`)
                            .setStyle(ButtonStyle.Link),
                        new ButtonBuilder()
                            .setCustomId(`verify_payment_${orderId}_${serverId}`)
                            .setLabel('Verify Payment')
                            .setEmoji('✅')
                            .setStyle(ButtonStyle.Success)
                    );
    
                await interaction.editReply({
                    embeds: [errorEmbed, paymentEmbed],
                    components: [retryRow]
                });
            }
            
        } catch (error) {
            console.error("Error in payment verification:", error);
            await interaction.editReply({
                content: "Error verifying payment. Please try again or contact support.",
                components: []
            });
        }
    }
    
static async handleSolanaVerification(interaction, paymentId, serverId, expectedAmount) {
      try {
          if (!interaction.deferred && !interaction.replied) {
              await interaction.deferUpdate();
          }

          const loadingEmbed = new EmbedBuilder()
              .setColor("#ffff00")
              .setTitle("⚡ Verifying Solana Payment")
              .setDescription("Please wait while we verify your transaction...");

          await interaction.editReply({
              embeds: [loadingEmbed],
              components: [],
              ephemeral: true
          });

          const verificationResult = await PaymentModel.verifySolanaPayment(paymentId, expectedAmount);

          if (!verificationResult.success) {
              const pendingEmbed = new EmbedBuilder()
                  .setColor("#ff9900")
                  .setTitle("⏳ Transaction Pending")
                  .setDescription([
                      "Your Solana transaction has not been detected yet.",
                      "",
                      "Please ensure you've sent the exact amount of SOL to the provided address.",
                      "The transaction may take up to 30 seconds to confirm.",
                      "",
                      "Click 'Verify Payment' again after sending the payment."
                  ].join('\n'))
                  .setFooter({ text: 'Fight Genie Payment System' });

              const row = new ActionRowBuilder()
                  .addComponents(
                      new ButtonBuilder()
                          .setCustomId(`verify_solana_${paymentId}_${serverId}_${expectedAmount}`)
                          .setLabel('Verify Payment')
                          .setEmoji('⚡')
                          .setStyle(ButtonStyle.Success)
                  );

              await interaction.editReply({
                  embeds: [pendingEmbed],
                  components: [row],
                  ephemeral: true
              });
              return;
            }

            // Transaction successful, activate subscription
            const amount = parseFloat(expectedAmount);
            const paymentType = amount >= 50 ? 'SERVER_LIFETIME' : 'SERVER_EVENT';
  
            if (paymentType === 'SERVER_LIFETIME') {
                await PaymentModel.activateServerLifetimeSubscription(serverId, paymentId);
            } else {
                await PaymentModel.activateServerEventAccess(serverId, paymentId);
            }
  
            const successEmbed = new EmbedBuilder()
                .setColor("#00ff00")
                .setTitle("✅ Solana Payment Successful!")
                .setDescription([
                    `Your payment of ${expectedAmount} SOL has been verified.`,
                    `Transaction: ${verificationResult.signature}`,
                    "",
                    paymentType === 'SERVER_LIFETIME' 
                        ? "🌟 Lifetime access has been activated for this server!"
                        : "🎟️ Event access has been activated for this server!",
                    "",
                    "You can now use all Fight Genie features:",
                    "• AI-powered fight predictions",
                    "• Detailed fighter analysis",
                    "• Betting insights",
                    "• Live odds integration"
                ].join('\n'))
                .setFooter({ text: 'Fight Genie Payment System' });
  
            await interaction.editReply({
                embeds: [successEmbed],
                components: [],
                ephemeral: true
            });
  
        } catch (error) {
            console.error("Solana verification error:", error);
            
            const errorEmbed = new EmbedBuilder()
                .setColor("#ff0000")
                .setTitle("❌ Verification Error")
                .setDescription([
                    "An error occurred while verifying your Solana payment.",
                    "Please try again or contact support if the issue persists.",
                    "",
                    "If you completed the transaction, your access will be",
                    "activated automatically within a few minutes."
                ].join('\n'));
  
            await interaction.editReply({
                embeds: [errorEmbed],
                components: [],
                ephemeral: true
            });
        }
    }
  }
  
  module.exports = PaymentHandler;