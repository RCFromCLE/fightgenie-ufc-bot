const database = require("../database");
const web3 = require("@solana/web3.js");

class PaymentModel {
  static PAYMENT_TYPES = {
    SERVER_LIFETIME: {
      price: 50.0,
      name: "Server Lifetime Access",
      description: "🌟 SPECIAL OFFER: Lifetime access for all server members",
    },
    SERVER_EVENT: {
      price: 6.99,
      name: "Server Event Access",
      description: "Event access for all server members",
    },
  };
  static SOLANA_CONFIG = {
    MERCHANT_WALLET: process.env.SOLANA_MERCHANT_WALLET,
    RPC_ENDPOINT:
      process.env.SOLANA_RPC_ENDPOINT || "https://api.mainnet-beta.solana.com",
    NETWORK: "mainnet-beta",
  };

  static async createServerPayment(
    serverId,
    adminId,
    paymentType,
    paymentMethod = "PAYPAL"
  ) {
    try {
      console.log("Creating server payment:", {
        serverId,
        adminId,
        paymentType,
        paymentMethod,
      });
      const payment = await database.query(
        `
                INSERT INTO payment_logs (
                    server_id,
                    admin_id,
                    payment_id,
                    payment_type,
                    amount,
                    status,
                    provider,
                    created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
                RETURNING payment_id
            `,
        [
          serverId,
          adminId,
          `PAY-${Date.now()}`,
          paymentType,
          this.PAYMENT_TYPES[paymentType].price,
          "PENDING",
          paymentMethod,
        ]
      );

      console.log("Payment created:", payment[0]);
      return payment[0].payment_id;
    } catch (error) {
      console.error("Error creating server payment:", error);
      throw error;
    }
  }

  static async updatePaymentStatus(paymentId, status, providerResponse = null) {
    try {
      console.log("Updating payment status:", { paymentId, status });

      await database.query(
        `
                UPDATE payment_logs 
                SET status = ?, 
                    provider_response = ?,
                    updated_at = datetime('now')
                WHERE payment_id = ?
            `,
        [status, JSON.stringify(providerResponse), paymentId]
      );

      if (status === "COMPLETED") {
        const payment = await database.query(
          "SELECT * FROM payment_logs WHERE payment_id = ?",
          [paymentId]
        );

        if (payment[0].payment_type === "SERVER_LIFETIME") {
          await this.activateServerLifetimeSubscription(
            payment[0].server_id,
            paymentId
          );
        } else if (payment[0].payment_type === "SERVER_EVENT") {
          await this.activateServerEventAccess(payment[0].server_id, paymentId);
        }

        console.log("Payment completed and subscription activated");
      }
    } catch (error) {
      console.error("Error updating payment status:", error);
      throw error;
    }
  }

  static async generateSolanaPaymentAddress() {
    try {
      if (!this.SOLANA_CONFIG.MERCHANT_WALLET) {
        throw new Error("Solana merchant wallet not configured");
      }

      const merchantWallet = new web3.PublicKey(
        this.SOLANA_CONFIG.MERCHANT_WALLET
      );
      const paymentId = `PAY-${Date.now()}`;

      // Insert with explicit types and error handling
      const query = `
                INSERT INTO solana_payments (
                    payment_id,
                    payment_address,
                    status,
                    created_at
                ) VALUES (?, ?, ?, datetime('now'))
            `;

      await database.query(query, [
        paymentId,
        merchantWallet.toString(),
        "PENDING",
      ]);

      console.log("Solana payment setup:", {
        merchantWallet: merchantWallet.toString(),
        paymentId,
      });

      return {
        address: merchantWallet.toString(),
        paymentId,
        status: "PENDING",
      };
    } catch (error) {
      console.error("Error setting up Solana payment:", error);
      throw error;
    }
  }

  static async handleSolanaVerification(interaction) {
    try {
        if (!interaction.deferred && !interaction.replied) {
            await interaction.deferUpdate();
        }

        // Extract payment info from customId
        const [_, __, paymentId, serverId, amount] = interaction.customId.split('_');
        
        console.log('Verifying Solana payment:', { paymentId, serverId, amount });

        const loadingEmbed = new EmbedBuilder()
            .setColor('#ffff00')
            .setTitle('⚡ Verifying Solana Payment')
            .setDescription([
                'Please wait while we verify your transaction...',
                '',
                `Amount Expected: ${amount} SOL`,
                'This may take up to 30 seconds.'
            ].join('\n'));

        await interaction.editReply({
            embeds: [loadingEmbed],
            components: [],
            ephemeral: true
        });

        const verificationResult = await SolanaPaymentService.verifyPayment(paymentId);

        if (!verificationResult.success) {
            const pendingEmbed = new EmbedBuilder()
                .setColor('#ff9900')
                .setTitle('⏳ Payment Not Found')
                .setDescription([
                    'Your Solana transaction has not been detected yet.',
                    '',
                    'Please ensure you:',
                    `• Sent exactly ${amount} SOL`,
                    '• Used the correct wallet address',
                    '• Waited for network confirmation (~30 seconds)',
                    '',
                    'Click "Verify Payment" again after transaction confirms.'
                ].join('\n'));

            const retryButton = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`verify_solana_${paymentId}_${serverId}_${amount}`)
                        .setLabel('Verify Payment')
                        .setEmoji('⚡')
                        .setStyle(ButtonStyle.Success)
                );

            await interaction.editReply({
                embeds: [pendingEmbed],
                components: [retryButton],
                ephemeral: true
            });
            return;
        }

        // Activate subscription based on amount
        const paymentAmount = parseFloat(amount);
        const isLifetime = paymentAmount >= 49;

        if (isLifetime) {
            await PaymentModel.activateServerLifetimeSubscription(serverId, paymentId);
        } else {
            await PaymentModel.activateServerEventAccess(serverId, paymentId);
        }

        const successEmbed = new EmbedBuilder()
            .setColor('#00ff00')
            .setTitle('✅ Payment Successful!')
            .setDescription([
                `Payment of ${amount} SOL confirmed!`,
                `Transaction: ${verificationResult.signature}`,
                '',
                isLifetime ? 
                    '🌟 Lifetime access activated for your server!' :
                    '🎟️ Event access activated for your server!',
                '',
                'All premium features are now unlocked:',
                '• AI Fight Predictions',
                '• Detailed Fighter Analysis',
                '• Betting Analysis & Tips',
                '• Fight Genie Parlays & Value Picks',
                '',
                'Move to your Discord server and use $upcoming to start viewing predictions and analysis!'
            ].join('\n'));

        await interaction.editReply({
            embeds: [successEmbed],
            components: [],
            ephemeral: true
        });

    } catch (error) {
        console.error('Error verifying Solana payment:', error);
        
        const errorEmbed = new EmbedBuilder()
            .setColor('#ff0000')
            .setTitle('❌ Verification Error')
            .setDescription([
                'An error occurred while verifying your payment.',
                'Please try again in a few moments.',
                '',
                'If you completed the transaction, your access',
                'will be activated automatically within a few minutes.'
            ].join('\n'));

        await interaction.editReply({
            embeds: [errorEmbed],
            components: [],
            ephemeral: true
        });
    }
}

  static async activateServerLifetimeSubscription(serverId, paymentId) {
    try {
      console.log("Activating lifetime subscription:", { serverId, paymentId });

      await database.query(
        `
                INSERT OR REPLACE INTO server_subscriptions (
                    server_id,
                    subscription_type,
                    payment_id,
                    status,
                    created_at,
                    updated_at
                ) VALUES (?, 'LIFETIME', ?, 'ACTIVE', datetime('now'), datetime('now'))
            `,
        [serverId, paymentId]
      );

      console.log("Lifetime subscription activated");
    } catch (error) {
      console.error("Error activating server lifetime subscription:", error);
      throw error;
    }
  }


  static async activateServerEventAccess(serverId, paymentId) {
      try {
          // First check if a subscription already exists
          const existingSubscription = await database.query(`
              SELECT * FROM server_subscriptions 
              WHERE server_id = ? AND status = 'ACTIVE'
          `, [serverId]);
  
          // Get the next event's date for expiration
          const event = await database.query(`
              SELECT event_id, Date 
              FROM events 
              WHERE Date >= date('now') 
              ORDER BY Date ASC 
              LIMIT 1
          `);
  
          if (!event || !event[0]) {
              throw new Error('No upcoming event found');
          }
  
          // Set expiration to 1:30 AM EST the day after event
          const eventDate = new Date(event[0].Date);
          const expirationDate = new Date(eventDate);
          expirationDate.setDate(eventDate.getDate() + 1);
          expirationDate.setUTCHours(6, 30, 0, 0);
  
          if (existingSubscription && existingSubscription.length > 0) {
              // Update existing subscription
              await database.query(`
                  UPDATE server_subscriptions 
                  SET 
                      payment_id = ?,
                      event_id = ?,
                      expiration_date = ?,
                      updated_at = datetime('now')
                  WHERE server_id = ? AND status = 'ACTIVE'
              `, [paymentId, event[0].event_id, expirationDate.toISOString(), serverId]);
          } else {
              // Insert new subscription
              await database.query(`
                  INSERT INTO server_subscriptions (
                      server_id,
                      subscription_type,
                      payment_id,
                      status,
                      event_id,
                      expiration_date,
                      created_at
                  ) VALUES (?, 'EVENT', ?, 'ACTIVE', ?, ?, datetime('now'))
              `, [serverId, paymentId, event[0].event_id, expirationDate.toISOString()]);
          }
  
          return {
              eventId: event[0].event_id,
              expirationDate: expirationDate
          };
      } catch (error) {
          console.error('Error activating server event access:', error);
          throw error;
      }
  }

  static async checkServerAccess(serverId, eventId = null) {
    try {
      console.log("\n=== Server Access Verification Started ===");
      console.log(`🔍 Checking access for Server ID: ${serverId}`);
      console.log(`🎯 Event ID: ${eventId || "No specific event"}`);

      // First check for lifetime access
      const lifetimeAccess = await database.query(
        `
                SELECT * FROM server_subscriptions 
                WHERE server_id = ? 
                AND subscription_type = 'LIFETIME'
                AND status = 'ACTIVE'
            `,
        [serverId]
      );

      if (lifetimeAccess.length > 0) {
        console.log("✅ LIFETIME ACCESS VERIFIED");
        return true;
      }

      // If no lifetime access and no specific event requested, check for any active event access
      if (!eventId) {
        const anyEventAccess = await database.query(
          `
                    SELECT * FROM server_subscriptions
                    WHERE server_id = ?
                    AND subscription_type = 'EVENT'
                    AND status = 'ACTIVE'
                    AND expiration_date > datetime('now')
                `,
          [serverId]
        );

        if (anyEventAccess.length > 0) {
          console.log("✅ ACTIVE EVENT ACCESS FOUND");
          return true;
        }
      }

      // Check for specific event access if eventId provided
      if (eventId) {
        const eventAccess = await database.query(
          `
                    SELECT * FROM server_subscriptions
                    WHERE server_id = ?
                    AND event_id = ?
                    AND subscription_type = 'EVENT'
                    AND status = 'ACTIVE'
                    AND expiration_date > datetime('now')
                `,
          [serverId, eventId]
        );

        if (eventAccess.length > 0) {
          console.log(`✅ EVENT ACCESS VERIFIED FOR EVENT ${eventId}`);
          return true;
        }
      }

      console.log("❌ NO VALID ACCESS FOUND");
      return false;
    } catch (error) {
      console.error("Error verifying access:", error);
      return false;
    }
  }

  static async getServerSubscriptionInfo(serverId) {
    try {
      console.log("Getting subscription info for server:", serverId);

      const subInfo = await database.query(
        `
                SELECT 
                    s.*,
                    p.admin_id,
                    p.amount,
                    p.created_at as purchase_date,
                    e.Event as event_name,
                    e.Date as event_date
                FROM server_subscriptions s
                LEFT JOIN payment_logs p ON s.payment_id = p.payment_id
                LEFT JOIN events e ON s.event_id = e.event_id
                WHERE s.server_id = ?
                AND s.status = 'ACTIVE'
            `,
        [serverId]
      );

      console.log(
        "Found subscription info:",
        subInfo[0] || "No active subscription"
      );
      return subInfo[0] || null;
    } catch (error) {
      console.error("Error getting server subscription info:", error);
      return null;
    }
  }

  static async cleanupExpiredSubscriptions() {
    try {
      console.log("Starting subscription cleanup");

      const result = await database.query(`
                UPDATE server_subscriptions
                SET status = 'EXPIRED'
                WHERE subscription_type = 'EVENT'
                AND status = 'ACTIVE'
                AND expiration_date < datetime('now')
            `);

      console.log("Cleanup complete. Updated subscriptions:", result);
    } catch (error) {
      console.error("Error cleaning up expired subscriptions:", error);
      throw error;
    }
  }

  static async createSubscriptionTable() {
    try {
      await database.query(`
                CREATE TABLE IF NOT EXISTS server_subscriptions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    server_id TEXT NOT NULL,
                    subscription_type TEXT NOT NULL,
                    payment_id TEXT UNIQUE,
                    status TEXT NOT NULL,
                    event_id TEXT,
                    expiration_date DATETIME,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `);

      await database.query(`
                CREATE INDEX IF NOT EXISTS idx_server_subs_server 
                ON server_subscriptions(server_id)
            `);

      await database.query(`
                CREATE INDEX IF NOT EXISTS idx_server_subs_expiration 
                ON server_subscriptions(expiration_date)
            `);

      await database.query(`
                CREATE TABLE IF NOT EXISTS payment_logs (
                    payment_id TEXT PRIMARY KEY,
                    server_id TEXT NOT NULL,
                    admin_id TEXT NOT NULL,
                    payment_type TEXT NOT NULL,
                    amount DECIMAL(10,2) NOT NULL,
                    status TEXT NOT NULL,
                    provider TEXT NOT NULL,
                    provider_response TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `);

      console.log("Subscription and payment tables created/verified");
    } catch (error) {
      console.error("Error creating subscription tables:", error);
      throw error;
    }
  }
}

module.exports = PaymentModel;
