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
const SolanaPaymentService = require("./SolanaPaymentService");
const QRCode = require("qrcode");
const { AttachmentBuilder } = require("discord.js");
const StripePaymentService = require('./StripePaymentService');


class PaymentHandler {
  static PAYMENT_TIMEOUT_MINS = 30;

  static async handlePayment(interaction) {
    try {
      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferUpdate();
      }

      const [action, purchaseType, method, guildId] = interaction.customId.split("_");
      const userId = interaction.user.id;
      const userName = interaction.user.username;

      // Handle initial payment setup
      if (action === "buy") {
        const isLifetime = purchaseType === "lifetime";
        const baseAmount = isLifetime ? 50.0 : 6.99;

        // Get upcoming event info for payment messages
        const upcomingEvent = await database.query(`
                SELECT event_id, Event, Date,
                       datetime(Date, '+2 day', '1:30:00') as expiration_date,
                       City, Country
                FROM events 
                WHERE Date >= datetime('now')
                ORDER BY Date ASC
                LIMIT 1
            `);

        const eventInfo = upcomingEvent[0];
        const eventDate = new Date(eventInfo.Date);
        eventDate.setDate(eventDate.getDate() + 1);
        const expirationDate = new Date(eventInfo.expiration_date);
        expirationDate.setDate(expirationDate.getDate() + 1);

        switch (method) {
          case "stripe":
            // Create Stripe payment session
            const session = await StripePaymentService.createPaymentSession(
              guildId,
              isLifetime ? 'SERVER_LIFETIME' : 'SERVER_EVENT',
              userId
            );

            const stripeEmbed = new EmbedBuilder()
              .setColor('#0099ff')
              .setTitle('💳 Complete Your Purchase')
              .setDescription([
                '',
                'IMPORTANT: After completing your purchase you must verify payment to activate access!',
                '',
                '🔒 Secure payment via Stripe',
                '📱 Apple Pay available on compatible devices',
                '💳 All major cards accepted',
                '',
                isLifetime ? [
                  '🌟 Lifetime Server Access',
                  '• Access to all future UFC events',
                  '• Never pay again',
                  '• Premium features included',
                  '',
                  `💰 Amount: $${baseAmount.toFixed(2)}`
                ].join('\n') : [
                  '🎟️ Event Access',
                  `Event: ${eventInfo.Event}`,
                  // `Date: ${eventDate.toLocaleString()}`,
                  // `Location: ${eventInfo.City}, ${eventInfo.Country}`,
                  // `Expires: ${new Date(upcomingEvent.Date).setHours(25, 30, 0, 0).toLocaleString()}`                            '',
                  `💰 Amount: $${baseAmount.toFixed(2)}`
                ].join('\n'),
                '',
                '1️⃣ Click the payment button below',
                '2️⃣ Complete payment on Stripe via Apple Pay or card',
                '3️⃣ Return here and click "Verify Payment"'
              ].join('\n'));

            const stripeButtons = new ActionRowBuilder()
              .addComponents(
                new ButtonBuilder()
                  .setLabel('Pay with Apple Pay/Card')
                  .setStyle(ButtonStyle.Link)
                  .setURL(session.url),
                new ButtonBuilder()
                  .setCustomId(`verify_stripe_${session.sessionId}_${guildId}`)
                  .setLabel('Verify Payment')
                  .setEmoji('✅')
                  .setStyle(ButtonStyle.Success)
              );

            await interaction.editReply({
              embeds: [stripeEmbed],
              components: [stripeButtons]
            });
            break;

          case "solana":
            // Get SOL amount with 10% discount
            const solAmount = await SolanaPriceService.getPriceWithDiscount(baseAmount);
            await this.handleSolanaPayment(interaction, {
              amount: solAmount,
              isLifetime,
              guildId,
              userId,
              userName,
              eventInfo
            });
            break;

          case "paypal":
            await this.handlePayPalPayment(interaction, {
              amount: baseAmount,
              isLifetime,
              guildId,
              userId,
              userName,
              eventInfo
            });
            break;
        }
        return;
      }

      // Handle payment verification
      if (action === "verify") {
        const [paymentMethod, paymentId, serverId] = interaction.customId.split("_").slice(1);

        if (!interaction.deferred && !interaction.replied) {
          await interaction.deferUpdate();
        }

        const loadingEmbed = new EmbedBuilder()
          .setColor('#ffff00')
          .setTitle('🔄 Verifying Payment')
          .setDescription('Please wait while we verify your payment...');

        await interaction.editReply({
          embeds: [loadingEmbed],
          components: []
        });

        const upcomingEvent = await database.getUpcomingEvent();

        switch (paymentMethod) {
          case "stripe":
            const stripeResult = await StripePaymentService.verifyPayment(paymentId);
            if (stripeResult.success) {
              const isLifetime = stripeResult.amount === 50.00;

              if (isLifetime) {
                await PaymentModel.activateServerLifetimeSubscription(serverId, paymentId);
              } else {
                await PaymentModel.activateServerEventAccess(serverId, paymentId);
              }

              const successEmbed = new EmbedBuilder()
                .setColor('#00ff00')
                .setTitle('✅ Payment Successful!')
                .setDescription([
                  `Payment of $${stripeResult.amount.toFixed(2)} confirmed!`,
                  '',
                  isLifetime ?
                    '🌟 Lifetime access has been activated for your server!' :
                    [
                      '🎟️ Event access has been activated!',
                      '',
                      `Event: ${upcomingEvent.Event}`,
                      // `Date: ${new Date(upcomingEvent.Date).toLocaleString()}`,
                      // upcomingEvent.City ? `Location: ${upcomingEvent.City}, ${upcomingEvent.Country}` : '',
                      // `Access Expires: ${new Date(upcomingEvent.Date).setHours(25, 30, 0, 0).toLocaleString()}`
                    ].join('\n'),
                  '',
                  'You can now use all Fight Genie features:',
                  '• AI-powered fight predictions',
                  '• Detailed fighter analysis',
                  '• Live odds integration',
                  '• Betting insights',
                  '',
                  'Navigate to your Discord Server and type `$upcoming` to start viewing predictions!'
                ].join('\n'));

              await interaction.editReply({
                embeds: [successEmbed],
                components: []
              });
            } else {
              const pendingEmbed = new EmbedBuilder()
                .setColor('#ff9900')
                .setTitle('⏳ Payment Pending')
                .setDescription([
                  'Your payment has not been confirmed yet.',
                  '',
                  'If you\'ve just completed payment,',
                  'please wait a moment and try verifying again.',
                  '',
                  'Need help? Contact support in our server.'
                ].join('\n'));

              const verifyButton = new ActionRowBuilder()
                .addComponents(
                  new ButtonBuilder()
                    .setCustomId(`verify_stripe_${paymentId}_${serverId}`)
                    .setLabel('Verify Payment')
                    .setEmoji('✅')
                    .setStyle(ButtonStyle.Success)
                );

              await interaction.editReply({
                embeds: [pendingEmbed],
                components: [verifyButton]
              });
            }
            break;

          case "solana":
            const result = await SolanaPaymentService.verifyPayment(paymentId);
            if (result.success) {
              if (result.amount >= 0.5) {
                await PaymentModel.activateServerLifetimeSubscription(serverId, paymentId);
              } else {
                await PaymentModel.activateServerEventAccess(serverId, paymentId);
              }
              await this.handleSolanaVerification(interaction, paymentId, serverId, result.amount);
            } else {
              await this.handleSolanaVerification(interaction, paymentId, serverId, result.amount);
            }
            break;

          case "paypal":
            await this.handlePayPalVerification(interaction, paymentId, serverId);
            break;

          default:
            await interaction.editReply({
              content: "Invalid payment verification method.",
              ephemeral: true
            });
        }
      }
    } catch (error) {
      console.error("Payment handling error:", error);
      await interaction.editReply({
        content: "Error processing payment request. Please try again.",
        ephemeral: true
      });
    }
  }

  static async handleSolanaPayment(
    interaction,
    { amount, isLifetime, guildId, userId, userName }
  ) {
    try {
      const paymentType = isLifetime ? 'LIFETIME' : 'EVENT';

      // Pass guildId as serverId and payment type
      const payment = await SolanaPaymentService.generatePaymentAddress(guildId, paymentType);

      if (!payment) {
        throw new Error("Failed to generate payment address");
      }

      // Generate QR code
      const qrBuffer = await QRCode.toBuffer(payment.address, {
        errorCorrectionLevel: "H",
        margin: 2,
        width: 400,
        color: {
          dark: "#000000",
          light: "#ffffff",
        },
      });

      const qrAttachment = new AttachmentBuilder(qrBuffer, {
        name: "payment_qr.png",
      });

      const embed = new EmbedBuilder()
        .setColor("#0099ff")
        .setTitle(`⚡ Send ${payment.amount} SOL`)
        .setAuthor({
          name: "Fight Genie",
          iconURL: "attachment://FightGenie_Logo_1.PNG",
        })
        .addFields(
          {
            name: "💰 Payment Amount",
            value: `\`\`\`\n${payment.amount} SOL\n\`\`\``,
            inline: false,
          },
          {
            name: "📝 Payment Address",
            value: `\`\`\`\n${payment.address}\n\`\`\``,
            inline: false,
          },
          {
            name: "⚠️ Important",
            value: "Send exactly the specified amount to ensure automatic verification.",
            inline: false,
          },
          {
            name: isLifetime ? "🌟 Lifetime Access" : "🎟️ Event Access",

            value: isLifetime
              ? [
                'IMPORTANT: After completing purchase you must verify payment to activate access!',
                "",
                "• One-time payment for permanent access",
                "• Server-wide access to all predictions",
                "• Never pay again!",
              ].join("\n")
              : [
                "• Access for next upcoming event",
                "• Server-wide event access",
                "• Perfect for watch parties",
              ].join("\n"),
            inline: false,
          }
        )
        .setImage("attachment://payment_qr.png");

      const verifyButton = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`verify_solana_${payment.paymentId}_${guildId}_${payment.amount}`)
          .setLabel("Verify Payment")
          .setEmoji("⚡")
          .setStyle(ButtonStyle.Success)
      );

      await interaction.editReply({
        embeds: [embed],
        components: [verifyButton],
        files: [
          {
            attachment: "./src/images/FightGenie_Logo_1.PNG",
            name: "FightGenie_Logo_1.PNG",
          },
          qrAttachment,
        ],
        ephemeral: true,
      });
    } catch (error) {
      console.error("Solana payment error:", error);
      await interaction.editReply({
        content: "Error creating Solana payment. Please try again.",
        ephemeral: true,
      });
    }
  }

  static async handlePayPalPayment(
    interaction,
    { amount, isLifetime, guildId, userId, userName }
  ) {
    try {
      // Get current event first for event purchases
      const event = await database.query(`
            SELECT * FROM events 
            WHERE Date >= date('now') 
            ORDER BY Date ASC 
            LIMIT 1
        `);

      // For event purchases, verify we have event data
      if (!isLifetime && (!event || !event[0])) {
        await interaction.editReply({
          content: "❌ No upcoming event found. Please try again later.",
          ephemeral: true
        });
        return;
      }

      console.log("Creating PayPal payment for:", {
        userId,
        guildId,
        amount,
        isLifetime,
        event: event?.[0]?.Event
      });

      const expirationTime = new Date(
        Date.now() + this.PAYMENT_TIMEOUT_MINS * 60 * 1000
      );

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
        "",
        "⏰ **Payment Window**",
        `This payment link will expire in ${this.PAYMENT_TIMEOUT_MINS} minutes at ${expirationTime.toLocaleTimeString()}.`,
        "After expiration, you'll need to generate a new payment request.",
      ].join("\n");

      const embed = new EmbedBuilder()
        .setColor("#0099ff")
        .setTitle("🌐 Complete Your PayPal Purchase")
        .setAuthor({
          name: "Fight Genie",
          iconURL: "attachment://FightGenie_Logo_1.PNG",
        })
        .setDescription([
          'IMPORTANT: After completing purchase you must verify payment to activate access!',
          "",
          `Complete your payment of $${amount.toFixed(2)} through PayPal to activate ${isLifetime ? "lifetime" : "event"} access.`,
          timeoutWarning,
        ].join("\n"))
        .addFields(
          {
            name: isLifetime ? "🌟 Lifetime Access" : `🎟️ Event Access ${event?.[0]?.Event ? `- ${event[0].Event}` : ''}`,
            value: isLifetime
              ? "• One-time payment for permanent access\n• Server-wide access to all predictions\n• Never pay again!"
              : `• Access until event completion\n• Server-wide access for one event\n• Perfect for watch parties`,
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
          SELECT payment_id, status, created_at, payment_type, amount,
                 datetime(datetime(created_at, '+30 minutes')) as expires_at
          FROM payment_logs 
          WHERE payment_id = ?
          UNION ALL
          SELECT payment_id, status, created_at, payment_type, amount_sol as amount,
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
          await new Promise(resolve => setTimeout(resolve, 2000));
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
          .setColor('#00ff00')
          .setTitle('✅ Payment Successful!')
          .setDescription(isLifetime ?
            '🌟 Your server now has lifetime access to Fight Genie!' :
            '🎟️ Event Access Activated!')
          .addFields({
            name: '🎯 Premium Features Unlocked',
            value: [
              '• AI Fight Predictions',
              '• Detailed Fighter Analysis',
              '• Live Odds Integration',
              '• Betting Analysis & Tips',
              '• Props & Parlay Recommendations'
            ].join('\n')
          })
          .addFields({
            name: '🎉 What\'s Next?',
            value: 'Use `$upcoming` to see the next UFC event and start getting predictions!'
          });

        await interaction.editReply({
          embeds: [successEmbed],
          components: []
        });
      } else {

        // Get event info for non-lifetime purchases
        const upcomingEvent = !paymentRecord[0].payment_type?.includes('LIFETIME') ?
          await database.query(`
        SELECT e.event_id, e.Event, e.Date, e.City, e.Country
        FROM events e
        WHERE e.Date >= date('now')
        ORDER BY e.Date ASC
        LIMIT 1
    `) : null;

        const paymentEmbed = new EmbedBuilder()
          .setColor("#0099ff")
          .setTitle("🌐 Complete Your PayPal Purchase")
          .setDescription(
            'IMPORTANT: After completing purchase you must verify payment to activate access!',
            "",
            `Complete your payment of $${paymentRecord[0].amount.toFixed(2)} through PayPal to activate ${paymentRecord[0].payment_type?.includes('LIFETIME') ? 'lifetime' : 'event'
            } access.`
          )
          .addFields(
            {
              name: paymentRecord[0].payment_type?.includes('LIFETIME') ?
                "🌟 Lifetime Access" :
                `🎟️ Event Access - ${upcomingEvent?.[0]?.Event || 'Upcoming Event'}`,
              value: paymentRecord[0].payment_type?.includes('LIFETIME') ?
                [
                  "• One-time payment for permanent access",
                  "• Server-wide access to all predictions",
                  "• Never pay again!"
                ].join("\n") :
                [
                  "• Access until event completion",
                  // `• Event Date: 12/7/2024`,  // Hardcoded correct date for UFC 310
                  upcomingEvent?.[0] ? `• Location: ${upcomingEvent[0].City}, ${upcomingEvent[0].Country}` : '',
                  "• Server-wide access for one event",
                  "• Perfect for watch parties"
                ].join("\n"),
              inline: false
            },
            {
              name: "Next Steps",
              value: [
                "1. Click the PayPal button below",
                "2. Complete payment on PayPal",
                '3. Return here and click "Verify Payment"',
                "4. Start using Fight Genie predictions!"
              ].join("\n")
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

        const retryRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setLabel("Complete Payment")
            .setURL(paymentStatus.checkoutUrl || PayPalService.createCheckoutUrl(orderId))
            .setStyle(ButtonStyle.Link),
          new ButtonBuilder()
            .setCustomId(`verify_payment_${orderId}_${serverId}`)
            .setLabel("Verify Payment")
            .setEmoji("✅")
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

  static async verifySolanaPayment(paymentId, expectedAmount) {
    try {
      // First get the payment record from database
      const paymentRecord = await database.query(
        `
            SELECT payment_address, status
            FROM solana_payments
            WHERE payment_id = ?
            AND status = 'PENDING'
        `,
        [paymentId]
      );

      if (!paymentRecord?.[0]) {
        console.log("No pending payment record found:", paymentId);
        return {
          success: false,
          message: "Payment record not found or already processed",
        };
      }

      // Verify we have a valid merchant wallet address
      if (!this.SOLANA_CONFIG.MERCHANT_WALLET) {
        console.error("Merchant wallet address not configured");
        throw new Error("Merchant wallet not configured");
      }

      try {
        const connection = new web3.Connection(this.SOLANA_CONFIG.RPC_ENDPOINT);
        const merchantWallet = new web3.PublicKey(
          this.SOLANA_CONFIG.MERCHANT_WALLET.trim()
        );

        console.log(
          "Checking transactions for wallet:",
          merchantWallet.toString()
        );

        // Get recent transactions
        const signatures = await connection.getSignaturesForAddress(
          merchantWallet,
          { limit: 10 }
        );

        // Check transactions
        for (const sigInfo of signatures) {
          try {
            const tx = await connection.getTransaction(sigInfo.signature, {
              maxSupportedTransactionVersion: 0,
            });

            if (!tx?.meta) continue;

            const preBalance = tx.meta.preBalances[0] || 0;
            const postBalance = tx.meta.postBalances[0] || 0;
            const amountReceived =
              (postBalance - preBalance) / web3.LAMPORTS_PER_SOL;

            console.log("Found transaction:", {
              signature: sigInfo.signature,
              amountReceived,
              expectedAmount,
            });

            // Compare with 1% tolerance for rounding
            const tolerance = expectedAmount * 0.01;
            if (Math.abs(amountReceived - expectedAmount) <= tolerance) {
              // Update payment status
              await database.query(
                `
                            UPDATE solana_payments
                            SET 
                                status = 'COMPLETED',
                                transaction_signature = ?,
                                amount_sol = ?,
                                completed_at = datetime('now')
                            WHERE payment_id = ?
                        `,
                [sigInfo.signature, amountReceived, paymentId]
              );

              return {
                success: true,
                signature: sigInfo.signature,
                amount: amountReceived,
              };
            }
          } catch (txError) {
            console.error("Error checking transaction:", txError);
            continue;
          }
        }

        return {
          success: false,
          message: "Payment not found or amount mismatch",
        };
      } catch (solanaError) {
        console.error("Solana connection/transaction error:", solanaError);
        throw solanaError;
      }
    } catch (error) {
      console.error("Error verifying Solana payment:", error);
      throw error;
    }
  }

  static async handleSolanaVerification(interaction, paymentId, serverId, amount) {
    try {
      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferUpdate();
      }
  
      const loadingEmbed = new EmbedBuilder()
        .setColor('#ffff00')
        .setTitle('⚡ Verifying Solana Payment')
        .setDescription([
          'Checking for your transaction...',
          'This may take a few moments.',
          '',
          'Please ensure you:',
          `1. Sent exactly ${amount} SOL`,
          '2. Sent to the correct address',
          '3. Waited for network confirmation (~30 seconds)'
        ].join('\n'));
  
      await interaction.editReply({
        embeds: [loadingEmbed],
        components: []
      });
  
      // Get the payment record to check the intended payment type
      const paymentRecord = await database.query(`
        SELECT payment_type
        FROM solana_payments
        WHERE payment_id = ?
      `, [paymentId]);
  
      if (!paymentRecord?.[0]) {
        throw new Error('Payment record not found');
      }
  
      const result = await SolanaPaymentService.verifyPayment(paymentId, parseFloat(amount));
  
      if (result.success) {
        // Determine subscription type based on the original payment_type, not the amount
        const isLifetime = paymentRecord[0].payment_type === 'SERVER_LIFETIME';
  
        // Get event info for event access
        let eventInfo = null;
        let expirationDate = null;
  
        if (!isLifetime) {
          // Get upcoming event info
          const event = await database.query(`
            SELECT event_id, Event, Date 
            FROM events 
            WHERE Date >= date('now') 
            ORDER BY Date ASC 
            LIMIT 1
          `);
  
          if (event?.[0]) {
            eventInfo = event[0];
            // Set expiration to 1:30 AM EST the day after the event
            expirationDate = new Date(event[0].Date);
            expirationDate.setDate(expirationDate.getDate() + 1);
            expirationDate.setHours(1, 30, 0, 0);
          }
        }
  
        // Record payment in payment_logs
        await database.query(`
          INSERT INTO payment_logs (
            payment_id,
            server_id,
            admin_id,
            payment_type,
            amount,
            status,
            provider,
            provider_response,
            created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        `, [
          paymentId,
          serverId,
          interaction.user.id,
          paymentRecord[0].payment_type, // Use the original payment type
          parseFloat(amount),
          'COMPLETED',
          'SOLANA',
          JSON.stringify({
            signature: result.signature,
            timestamp: result.timestamp,
            amount: result.amount
          })
        ]);
  
        // Activate appropriate subscription based on original payment type
        if (isLifetime) {
          await PaymentModel.activateServerLifetimeSubscription(serverId, paymentId);
        } else {
          await PaymentModel.activateServerEventAccess(serverId, paymentId);
        }
  
        const solscanUrl = `https://solscan.io/tx/${result.signature}`;
  
        const successEmbed = new EmbedBuilder()
          .setColor('#00ff00')
          .setTitle('✅ Solana Payment Verified!')
          .setDescription([
            `Your payment of ${amount} SOL has been verified.`,
            `[View Transaction on Solscan](${solscanUrl})`,
            '',
            isLifetime ?
              '🌟 Lifetime access has been activated for your server!' :
              [
                '🎟️ Event access has been activated for your server!',
                '',
                `Event: ${eventInfo?.Event}`,
              ].join('\n'),
            '',
            'You can now use all Fight Genie features:',
            '• AI-powered fight predictions',
            '• Detailed fighter analysis',
            '• Live odds integration',
            '• Betting insights',
            '',
            'Use `$upcoming` to start viewing predictions!'
          ].join('\n'));
  
        await interaction.editReply({
          embeds: [successEmbed],
          components: []
        });
  
      } else {        const pendingEmbed = new EmbedBuilder()
          .setColor('#ff9900')
          .setTitle('⏳ Transaction Pending')
          .setDescription([
            'Your Solana transaction has not been detected yet.',
            '',
            'Please ensure you have:',
            `1. Sent exactly ${amount} SOL`,
            '2. Sent to the correct address',
            '3. Waited for network confirmation',
            '',
            'Click "Verify Payment" again after sending the payment.'
          ].join('\n'));

        const verifyButton = new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder()
              .setCustomId(`verify_solana_${paymentId}_${serverId}_${amount}`)
              .setLabel('Verify Payment')
              .setEmoji('⚡')
              .setStyle(ButtonStyle.Success)
          );

        await interaction.editReply({
          embeds: [pendingEmbed],
          components: [verifyButton]
        });
      }
    } catch (error) {
      console.error('Error verifying Solana payment:', error);
      await interaction.editReply({
        content: 'Error verifying payment. Please try again or contact support.',
        components: []
      });
    }
  }

}
module.exports = PaymentHandler;