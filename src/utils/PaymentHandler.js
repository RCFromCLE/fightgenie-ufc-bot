const {
  EmbedBuilder,
  ButtonBuilder,
  ActionRowBuilder,
  ButtonStyle,
  PermissionFlagsBits,
} = require("discord.js");
const PayPalService = require("./PayPalService");
const PaymentModel = require("../models/PaymentModel");
const database = require("../database");
const SolanaPriceService = require("./SolanaPriceService");
const SolanaPaymentService = require('./SolanaPaymentService');
const QRCode = require('qrcode');
const { AttachmentBuilder } = require('discord.js');

class PaymentHandler {
  static PAYMENT_TIMEOUT_MINS = 30;

  static async handlePayment(interaction) {
    try {
        if (!interaction.deferred && !interaction.replied) {
            await interaction.deferUpdate();
        }

        const [action, type, method, guildId] = interaction.customId.split("_");
        const userId = interaction.user.id;
        const userName = interaction.user.username;

        if (!guildId || !userId) {
            console.error("Missing guild or user information:", {
                guildId,
                userId,
            });
            await interaction.editReply({
                content: "Error: Unable to process payment. Please try again.",
                ephemeral: true
            });
            return;
        }

        console.log("Processing payment for:", { guildId, userId, userName });

        const isLifetime = type === "lifetime";
        const isSolana = method === "solana";
        const baseAmount = isLifetime ? 50.0 : 6.99;

        const upcomingEvent = await database.getUpcomingEvent();
        if (!upcomingEvent && !isLifetime) {
            await interaction.editReply({
                content: "Error: Could not find upcoming event information.",
                ephemeral: true
            });
            return;
        }

        // Get formatted event date
        const eventDate = upcomingEvent
            ? new Date(upcomingEvent.Date).toLocaleString("en-US", {
                timeZone: "America/New_York",
                month: "long",
                day: "numeric",
                year: "numeric",
                hour: "numeric",
                minute: "2-digit",
                timeZoneName: "short",
            })
            : null;

        // Calculate amount with any discounts
        let amount = baseAmount;
        if (isSolana) {
            amount = await SolanaPriceService.getPriceWithDiscount(baseAmount);
        }

        const paymentConfig = {
            amount,
            isLifetime,
            upcomingEvent,
            eventDate,
            guildId,
            userId,
            userName
        };

        if (isSolana) {
            await PaymentHandler.handleSolanaPayment(interaction, paymentConfig);
        } else {
            await PaymentHandler.handlePayPalPayment(interaction, paymentConfig);
        }

    } catch (error) {
        console.error("Payment handling error:", error);
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({
                content: "Error processing payment request. Please try again.",
                ephemeral: true
            });
        } else {
            await interaction.editReply({
                content: "Error processing payment request. Please try again.",
                ephemeral: true
            });
        }
    }
}

static async handleSolanaPayment(interaction, { amount, isLifetime, upcomingEvent, eventDate, guildId, userId, userName }) {
  try {
      console.log("Creating Solana payment for:", { userId, guildId, amount, isLifetime });
      const PAYMENT_TIMEOUT_MINS = 30;
      const expirationTime = new Date(Date.now() + (PAYMENT_TIMEOUT_MINS * 60 * 1000));
      const paymentAddress = await SolanaPaymentService.generatePaymentAddress();
      
      if (!paymentAddress) {
          throw new Error("Failed to generate Solana payment address");
      }

      // Generate QR code locally
      const qrBuffer = await QRCode.toBuffer(paymentAddress.address, {
          errorCorrectionLevel: 'H',
          margin: 2,
          width: 400,  // Increased size
          color: {
              dark: '#000000',
              light: '#ffffff'
          }
      });

      const qrAttachment = new AttachmentBuilder(qrBuffer, { name: 'payment_qr.png' });

      const embed = new EmbedBuilder()
          .setColor('#0099ff')
          .setTitle(`⚡ Send ${amount} SOL`)  // Made amount prominent in title
          .setAuthor({
              name: 'Fight Genie',
              iconURL: 'attachment://FightGenie_Logo_1.PNG'
          })
          .addFields(
              {
                  name: '💰 Payment Amount',
                  value: `\`\`\`\n${amount} SOL\n\`\`\``,
                  inline: false
              },
              {
                  name: '📝 Payment Address',
                  value: `\`\`\`\n${paymentAddress.address}\n\`\`\``,
                  inline: false
              },
              {
                  name: '⚠️ Important',
                  value: 'Send exactly the specified amount to ensure automatic verification.',
                  inline: false
              },
              {
                  name: '⏰ Payment Window',
                  value: [
                      `Expires in ${PAYMENT_TIMEOUT_MINS} minutes at ${expirationTime.toLocaleTimeString()}.`,
                      'After expiration, you\'ll need to generate a new payment request.'
                  ].join('\n'),
                  inline: false
              },
              {
                  name: isLifetime ? '🌟 Lifetime Access' : `🎟️ Event Access`,
                  value: isLifetime ?
                      [
                          '• One-time payment for permanent access',
                          '• Server-wide access to all predictions',
                          '• Never pay again!'
                      ].join('\n') :
                      [
                          `• Access for ${upcomingEvent.Event}`,
                          `• Event Date: ${eventDate}`,
                          '• Server-wide access for one event',
                          '• Perfect for watch parties'
                      ].join('\n'),
                  inline: false
              },
              {
                  name: '📋 Next Steps',
                  value: [
                      `1. Send ${amount} SOL to the address above`,
                      '2. Wait for network confirmation (~30 seconds)',
                      '3. Click "Verify Payment" below',
                      '4. Start using Fight Genie predictions!'
                  ].join('\n'),
                  inline: false
              }
          )
          .setImage('attachment://payment_qr.png');

      const buttonRow = new ActionRowBuilder()
          .addComponents(
              new ButtonBuilder()
                  .setCustomId(`verify_solana_${paymentAddress.paymentId}_${guildId}_${amount}`)
                  .setLabel('Verify Payment')
                  .setEmoji('⚡')
                  .setStyle(ButtonStyle.Success)
          );

      await interaction.editReply({
          embeds: [embed],
          components: [buttonRow],
          files: [
              {
                  attachment: './src/images/FightGenie_Logo_1.PNG',
                  name: 'FightGenie_Logo_1.PNG'
              },
              qrAttachment
          ],
          ephemeral: true
      });

  } catch (error) {
      console.error('Solana payment error:', error);
      await interaction.editReply({
          content: 'Error creating Solana payment. Please try again.',
          ephemeral: true
      });
  }
}

static async handlePayPalPayment(interaction, { amount, isLifetime, upcomingEvent, eventDate, guildId, userId, userName }) {
  try {
    console.log("Creating PayPal payment for:", {
      userId,
      guildId,
      amount,
      isLifetime,
    });

    const expirationTime = new Date(Date.now() + (this.PAYMENT_TIMEOUT_MINS * 60 * 1000));

    // Create PayPal order with expiration
    const order = await PayPalService.createPaymentOrder(
      userId,
      guildId,
      amount,
      isLifetime ? "SERVER_LIFETIME" : "SERVER_EVENT",
      expirationTime
    );

    if (!order) {
      throw new Error("Failed to create PayPal order");
    }

    const timeoutWarning = [
      '',
      '⏰ **Payment Window**',
      `This payment link will expire in ${this.PAYMENT_TIMEOUT_MINS} minutes at ${expirationTime.toLocaleTimeString()}.`,
      'After expiration, you\'ll need to generate a new payment request.'
    ].join('\n');

    const embed = new EmbedBuilder()
      .setColor("#0099ff")
      .setTitle("🌐 Complete Your PayPal Purchase")
      .setAuthor({
        name: "Fight Genie",
        iconURL: "attachment://FightGenie_Logo_1.PNG",
      })
      .setDescription(
        [
          `Complete your payment of $${amount.toFixed(
            2
          )} through PayPal to activate ${
            isLifetime ? "lifetime" : "event"
          } access.`,
          timeoutWarning
        ].join('\n')
      )
      .addFields(
        {
          name: isLifetime
            ? "🌟 Lifetime Access"
            : `🎟️ Event Access - ${upcomingEvent.Event}`,
          value: isLifetime
            ? "• One-time payment for permanent access\n• Server-wide access to all predictions\n• Never pay again!"
            : `• Access for ${upcomingEvent.Event}\n• Event Date: ${eventDate}\n• Server-wide access for one event\n• Perfect for watch parties`,
          inline: false,
        },
        {
          name: "Next Steps",
          value: [
            "1. Click the PayPal button below",
            "2. Complete payment on PayPal",
            '3. Return here and click "Verify Payment"',
            "4. Start using Fight Genie predictions!",
          ].join("\n"),
        }
      );

    const buttonRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel("Pay with PayPal")
        .setURL(order.approveLink)
        .setStyle(ButtonStyle.Link),
      new ButtonBuilder()
        .setCustomId(`verify_payment_${order.orderId}_${guildId}`)
        .setLabel("Verify Payment")
        .setEmoji("✅")
        .setStyle(ButtonStyle.Success)
    );

    await interaction.editReply({
      embeds: [embed],
      components: [buttonRow],
      files: [
        {
          attachment: "./src/images/FightGenie_Logo_1.PNG",
          name: "FightGenie_Logo_1.PNG",
        },
      ],
      ephemeral: true,
    });
  } catch (error) {
    console.error("PayPal payment error:", error);
    await interaction.editReply({
      content: "Error creating PayPal payment. Please try again.",
      ephemeral: true,
    });
  }
}

static async handlePaymentVerification(interaction, orderId, serverId) {
  try {
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferUpdate();
    }

    // Check both payment tables with proper expiration logic
    const paymentRecord = await database.query(`
      SELECT payment_id, status, created_at, 
             datetime(datetime(created_at, '+30 minutes')) as expires_at
      FROM payment_logs 
      WHERE payment_id = ?
      UNION ALL
      SELECT payment_id, status, created_at,
             datetime(datetime(created_at, '+30 minutes')) as expires_at
      FROM solana_payments 
      WHERE payment_id = ?
    `, [orderId, orderId]);

    if (!paymentRecord?.[0]) {
      await interaction.editReply({
        content: "Payment record not found. Please generate a new payment request.",
        ephemeral: true
      });
      return;
    }

    // Check if payment has expired
    const expirationTime = new Date(paymentRecord[0].expires_at);
    const now = new Date();

    if (now > expirationTime) {
      await interaction.editReply({
        content: "This payment request has expired. Please generate a new payment request.",
        ephemeral: true
      });
      return;
    }

    // Rest of verification logic remains the same...
    const loadingEmbed = new EmbedBuilder()
      .setColor("#ffff00")
      .setTitle("🔄 Verifying Payment")
      .setDescription("Please wait while we verify your payment with PayPal...");

    await interaction.editReply({
      embeds: [loadingEmbed],
      components: [],
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
        await PaymentModel.activateServerLifetimeSubscription(
          serverId,
          orderId
        );
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
            "• Props & Parlay Recommendations",
          ].join("\n"),
        })
        .addFields({
          name: "🎉 What's Next?",
          value:
            "Use `$upcoming` to see the next UFC event and start getting predictions!",
        });

      await interaction.editReply({
        embeds: [successEmbed],
        components: [],
      });
    } else {
      const paymentEmbed = new EmbedBuilder()
        .setColor("#0099ff")
        .setTitle("🌐 Complete Your PayPal Purchase")
        .setDescription(
          `Complete your payment of $50.00 through PayPal to activate lifetime access.`
        )
        .addFields(
          {
            name: "🌟 Lifetime Access",
            value: [
              "• One-time payment for permanent access",
              "• Server-wide access to all predictions",
              "• Never pay again!",
            ].join("\n"),
            inline: false,
          },
          {
            name: "Next Steps",
            value: [
              "1. Click the PayPal button below",
              "2. Complete payment on PayPal",
              '3. Return here and click "Verify Payment"',
              "4. Start using Fight Genie predictions!",
            ].join("\n"),
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
            "3. Click 'Try Verification Again'",
          ].join("\n"),
        });

      const retryRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel("Complete Payment")
          .setURL(
            paymentStatus.checkoutUrl ||
              PayPalService.createCheckoutUrl(orderId)
          )
          .setStyle(ButtonStyle.Link),
        new ButtonBuilder()
          .setCustomId(`verify_payment_${orderId}_${serverId}`)
          .setLabel("Verify Payment")
          .setEmoji("✅")
          .setStyle(ButtonStyle.Success)
      );
      await interaction.editReply({
        embeds: [errorEmbed, paymentEmbed],
        components: [retryRow],
      });
    }
  } catch (error) {
    console.error("Error in payment verification:", error);
    await interaction.editReply({
      content:
        "Error verifying payment. Please try again or contact support.",
      components: [],
    });
  }
}

static async handleSolanaVerification(
  interaction,
  paymentId,
  serverId,
  expectedAmount
) {
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
      ephemeral: true,
    });

    const verificationResult = await PaymentModel.verifySolanaPayment(
      paymentId,
      expectedAmount
    );

    if (!verificationResult.success) {
      const pendingEmbed = new EmbedBuilder()
        .setColor("#ff9900")
        .setTitle("⏳ Transaction Pending")
        .setDescription(
          [
            "Your Solana transaction has not been detected yet.",
            "",
            "Please ensure you've sent the exact amount of SOL to the provided address.",
            "The transaction may take up to 30 seconds to confirm.",
            "",
            "Click 'Verify Payment' again after sending the payment.",
          ].join("\n")
        )
        .setFooter({ text: "Fight Genie Payment System" });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(
            `verify_solana_${paymentId}_${serverId}_${expectedAmount}`
          )
          .setLabel("Verify Payment")
          .setEmoji("⚡")
          .setStyle(ButtonStyle.Success)
      );

      await interaction.editReply({
        embeds: [pendingEmbed],
        components: [row],
        ephemeral: true,
      });
      return;
    }

    // Transaction successful, activate subscription
    const amount = parseFloat(expectedAmount);
    const paymentType = amount >= 50 ? "SERVER_LIFETIME" : "SERVER_EVENT";

    if (paymentType === "SERVER_LIFETIME") {
      await PaymentModel.activateServerLifetimeSubscription(
        serverId,
        paymentId
      );
    } else {
      await PaymentModel.activateServerEventAccess(serverId, paymentId);
    }

    const successEmbed = new EmbedBuilder()
      .setColor("#00ff00")
      .setTitle("✅ Solana Payment Successful!")
      .setDescription(
        [
          `Your payment of ${expectedAmount} SOL has been verified.`,
          `Transaction: ${verificationResult.signature}`,
          "",
          paymentType === "SERVER_LIFETIME"
            ? "🌟 Lifetime access has been activated for this server!"
            : "🎟️ Event access has been activated for this server!",
          "",
          "You can now use all Fight Genie features:",
          "• AI-powered fight predictions",
          "• Detailed fighter analysis",
          "• Betting insights",
          "• Live odds integration",
        ].join("\n")
      )
      .setFooter({ text: "Fight Genie Payment System" });

    await interaction.editReply({
      embeds: [successEmbed],
      components: [],
      ephemeral: true,
    });
  } catch (error) {
    console.error("Solana verification error:", error);

    const errorEmbed = new EmbedBuilder()
      .setColor("#ff0000")
      .setTitle("❌ Verification Error")
      .setDescription(
        [
          "An error occurred while verifying your Solana payment.",
          "Please try again or contact support if the issue persists.",
          "",
          "If you completed the transaction, your access will be",
          "activated automatically within a few minutes.",
        ].join("\n")
      );

    await interaction.editReply({
      embeds: [errorEmbed],
      components: [],
      ephemeral: true,
    });
  }
}
}

module.exports = PaymentHandler;