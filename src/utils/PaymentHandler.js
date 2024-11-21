const { EmbedBuilder, ButtonBuilder, ActionRowBuilder, ButtonStyle, PermissionFlagsBits } = require("discord.js");
const PayPalService = require("./PayPalService");
const PaymentModel = require("../models/PaymentModel");
const database = require("../database");
const SolanaPriceService = require("./SolanaPriceService");

class PaymentHandler {
    static async handleBuyCommand(message) {
        try {
            if (!message.guild) {
                await message.reply("⚠️ This command must be used in a server channel first.");
                return;
            }

            if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
                await message.reply({
                    content: "⚠️ Only server administrators can purchase Fight Genie access.",
                    ephemeral: true,
                });
                return;
            }

            const hasAccess = await PaymentModel.checkServerAccess(message.guild.id);
            if (hasAccess) {
                await message.reply("✅ This server already has access to Fight Genie!");
                return;
            }

            // Get upcoming event details
            const upcomingEvent = await database.getUpcomingEvent();
            if (!upcomingEvent) {
                await message.reply("Error: Could not find upcoming event information.");
                return;
            }

            const eventDate = new Date(upcomingEvent.Date).toLocaleString('en-US', {
                month: 'long',
                day: 'numeric',
                year: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
                timeZoneName: 'short',
                timeZone: 'America/New_York'
            });

            // Calculate Solana prices with 10% discount
            const lifetimeUsdAmount = 50.00;
            const eventUsdAmount = 6.99;
            
            const [lifetimeSolAmount, eventSolAmount] = await Promise.all([
                SolanaPriceService.getPriceWithDiscount(lifetimeUsdAmount),
                SolanaPriceService.getPriceWithDiscount(eventUsdAmount)
            ]);

            const embed = new EmbedBuilder()
                .setColor("#0099ff")
                .setTitle(`🌟 Fight Genie Server Access - ${message.guild.name}`)
                .setAuthor({ 
                    name: 'Fight Genie',
                    iconURL: 'attachment://FightGenie_Logo_1.PNG'
                })
                .setDescription(
                    "Choose your payment method and access type below. All members will be able to use Fight Genie predictions!"
                )
                .addFields(
                    {
                        name: "🌟 Server Lifetime Access - Special Launch Offer!",
                        value: [
                            "```",
                            "• One-time payment for permanent access",
                            "• Server-wide access to all future predictions",
                            "• All members can use predictions",
                            "• Never pay again!",
                            "",
                            `PayPal: $${lifetimeUsdAmount.toFixed(2)}`,
                            `Solana: ${lifetimeSolAmount} SOL (10% discount!)`,
                            "```"
                        ].join('\n'),
                        inline: false,
                    },
                    {
                        name: `🎟️ Event Access - ${upcomingEvent.Event}`,
                        value: [
                            "```",
                            `• Access for ${upcomingEvent.Event}`,
                            `• Event Date: ${eventDate}`,
                            "• Server-wide access for all members",
                            "• Perfect for watch parties",
                            "",
                            `PayPal: $${eventUsdAmount.toFixed(2)}`,
                            `Solana: ${eventSolAmount} SOL (10% discount!)`,
                            "```"
                        ].join('\n'),
                        inline: false,
                    }
                );

            // First row - Lifetime access buttons
            const lifetimeRow = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId("buy_lifetime_paypal")
                        .setLabel("Lifetime Access - PayPal")
                        .setEmoji("🌐")
                        .setStyle(ButtonStyle.Primary),
                    new ButtonBuilder()
                        .setCustomId("buy_lifetime_solana")
                        .setLabel("Lifetime Access - Solana (10% Off)")
                        .setEmoji("⚡")
                        .setStyle(ButtonStyle.Success)
                );

            // Second row - Event access buttons
            const eventRow = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId("buy_event_paypal")
                        .setLabel("Event Access - PayPal")
                        .setEmoji("🌐")
                        .setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder()
                        .setCustomId("buy_event_solana")
                        .setLabel("Event Access - Solana (10% Off)")
                        .setEmoji("⚡")
                        .setStyle(ButtonStyle.Secondary)
                );

            await message.reply({
                embeds: [embed],
                components: [lifetimeRow, eventRow],
                files: [{
                    attachment: './src/images/FightGenie_Logo_1.PNG',
                    name: 'FightGenie_Logo_1.PNG'
                }]
            });

        } catch (error) {
            console.error("Error handling buy command:", error);
            await message.reply("Error processing server purchase request. Please try again.");
        }
    }

    static async handlePayment(interaction) {
        try {
            if (!interaction.deferred && !interaction.replied) {
                await interaction.deferUpdate();
            }

            const [action, type, method] = interaction.customId.split('_');
            if (action !== 'buy') return;

            const isLifetime = type === 'lifetime';
            const isSolana = method === 'solana';
            const amount = isLifetime ? 50.00 : 6.99;

            // Get upcoming event for event access purchases
            const upcomingEvent = await database.getUpcomingEvent();
            const eventDate = new Date(upcomingEvent.Date).toLocaleString('en-US', {
                month: 'long',
                day: 'numeric',
                year: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
                timeZoneName: 'short',
                timeZone: 'America/New_York'
            });

            if (isSolana) {
                await this.handleSolanaPayment(interaction, { amount, isLifetime, upcomingEvent, eventDate });
            } else {
                await this.handlePayPalPayment(interaction, { amount, isLifetime, upcomingEvent, eventDate });
            }

        } catch (error) {
            console.error('Payment handling error:', error);
            await interaction.editReply({
                content: 'Error processing payment request. Please try again.',
                ephemeral: true
            });
        }
    }static async handlePayPalPayment(interaction, { amount, isLifetime, upcomingEvent, eventDate }) {
      try {
          const paymentType = isLifetime ? 'SERVER_LIFETIME' : 'SERVER_EVENT';
          const order = await PayPalService.createPaymentOrder(
              interaction.user.id,
              interaction.guild.id,
              amount,
              paymentType
          );

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
                      .setCustomId(`verify_payment_${order.orderId}_${interaction.guild.id}`)
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
          throw error;
      }
  }

  static async handleSolanaPayment(interaction, { amount, isLifetime, upcomingEvent, eventDate }) {
      try {
          // Calculate Solana amount with 10% discount
          const solAmount = await SolanaPriceService.getPriceWithDiscount(amount);
          
          // Generate payment address
          const paymentAddress = await PaymentModel.generateSolanaPaymentAddress();
          const paymentType = isLifetime ? 'SERVER_LIFETIME' : 'SERVER_EVENT';
          
          const embed = new EmbedBuilder()
              .setColor('#0099ff')
              .setTitle('⚡ Complete Your Solana Payment')
              .setAuthor({ 
                  name: 'Fight Genie',
                  iconURL: 'attachment://FightGenie_Logo_1.PNG'
              })
              .setDescription([
                  `Complete your payment of ${solAmount} SOL to activate ${isLifetime ? 'lifetime' : 'event'} access.`,
                  '',
                  '**Payment Address:**',
                  `\`${paymentAddress.address}\``,
                  '',
                  '**Amount Due:**',
                  `${solAmount} SOL`,
                  '',
                  '*10% discount applied for Solana payments!*',
                  '*Real-time pricing powered by Jupiter Exchange API*'
              ].join('\n'))
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
                          '1. Send the exact SOL amount to the address above',
                          '2. Wait for transaction confirmation (~30 seconds)',
                          '3. Click "Verify Payment" below',
                          '4. Start using Fight Genie predictions!'
                      ].join('\n')
                  }
              );

          const row = new ActionRowBuilder()
              .addComponents(
                  new ButtonBuilder()
                      .setCustomId(`verify_solana_${paymentAddress.paymentId}_${interaction.guild.id}_${solAmount}`)
                      .setLabel('Verify Payment')
                      .setEmoji('⚡')
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
          console.error('Solana payment error:', error);
          throw error;
      }
  }

  static async handlePaymentVerification(interaction, orderId, serverId) {
      try {
          let hasResponded = false;

          try {
              if (!interaction.deferred && !interaction.replied) {
                  await interaction.deferUpdate();
                  hasResponded = true;
              }
          } catch (err) {
              if (err.code === 40060) {
                  hasResponded = true;
              }
          }

          const loadingEmbed = new EmbedBuilder()
              .setColor("#ffff00")
              .setTitle("💳 Verifying Payment")
              .setDescription("Please wait while we verify your payment...");

          const messageMethod = hasResponded ? 'editReply' : 'followUp';
          await interaction[messageMethod]({
              embeds: [loadingEmbed],
              components: [],
              ephemeral: true
          });

          // Get upcoming event for verification message
          const upcomingEvent = await database.getUpcomingEvent();
          const eventDate = new Date(upcomingEvent.Date).toLocaleString('en-US', {
              month: 'long',
              day: 'numeric',
              year: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
              timeZoneName: 'short',
              timeZone: 'America/New_York'
          });

          // Verify payment with PayPal
          const verificationResult = await PayPalService.verifyPayment(orderId);

          if (!verificationResult.success) {
              const pendingEmbed = new EmbedBuilder()
                  .setColor("#ff9900")
                  .setTitle("⏳ Payment Pending")
                  .setDescription([
                      "Your payment hasn't been completed yet.",
                      "",
                      "Please complete your payment through PayPal first, then click 'Verify Payment' again.",
                      "",
                      `Status: ${verificationResult.status}`,
                      verificationResult.message ? `\nMessage: ${verificationResult.message}` : ''
                  ].join('\n'))
                  .setFooter({ text: 'Fight Genie Payment System' });

              const row = new ActionRowBuilder()
                  .addComponents(
                      new ButtonBuilder()
                          .setLabel('Complete Payment')
                          .setURL(verificationResult.checkoutUrl)
                          .setStyle(ButtonStyle.Link),
                      new ButtonBuilder()
                          .setCustomId(`verify_payment_${orderId}_${serverId}`)
                          .setLabel('Verify Payment')
                          .setEmoji('✅')
                          .setStyle(ButtonStyle.Success)
                  );

              await interaction[messageMethod]({
                  embeds: [pendingEmbed],
                  components: [row],
                  ephemeral: true
              });
              return;
          }

          // Payment successful, activate subscription
          const amount = parseFloat(verificationResult.amount);
          const paymentType = amount >= 50 ? 'SERVER_LIFETIME' : 'SERVER_EVENT';
          
          if (paymentType === 'SERVER_LIFETIME') {
              await PaymentModel.activateServerLifetimeSubscription(serverId, orderId);
          } else {
              await PaymentModel.activateServerEventAccess(serverId, orderId);
          }

          // Create success embed with specific event details for event access
          const successEmbed = new EmbedBuilder()
              .setColor("#00ff00")
              .setTitle("✅ Payment Successful!")
              .setDescription([
                  `Your payment of $${amount.toFixed(2)} has been verified.`,
                  "",
                  paymentType === 'SERVER_LIFETIME' 
                      ? "🌟 Lifetime access has been activated for this server!"
                      : [
                          `🎟️ Event access has been activated for:`,
                          `• ${upcomingEvent.Event}`,
                          `• ${eventDate}`
                        ].join('\n'),
                  "",
                  "You can now use all Fight Genie features:",
                  "• AI-powered fight predictions",
                  "• Detailed fighter analysis",
                  "• Betting insights",
                  "• Live odds integration"
              ].join('\n'))
              .setFooter({ text: 'Fight Genie Payment System' });

          await interaction[messageMethod]({
              embeds: [successEmbed],
              components: [],
              ephemeral: true
          });

      } catch (error) {
          console.error("Payment verification error:", error);
          
          try {
              const errorEmbed = new EmbedBuilder()
                  .setColor("#ff0000")
                  .setTitle("❌ Verification Error")
                  .setDescription([
                      "An error occurred while verifying your payment.",
                      "Please try again or contact support if the issue persists.",
                      "",
                      "If you completed the payment, your access will be",
                      "activated automatically within a few minutes."
                  ].join('\n'));

              try {
                  await interaction.followUp({
                      embeds: [errorEmbed],
                      components: [],
                      ephemeral: true
                  });
              } catch (followUpError) {
                  try {
                      await interaction.editReply({
                          embeds: [errorEmbed],
                          components: [],
                          ephemeral: true
                      });
                  } catch (editError) {
                      console.error("Could not send error message:", editError);
                  }
              }
          } catch (finalError) {
              console.error("Could not send any error message:", finalError);
          }
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