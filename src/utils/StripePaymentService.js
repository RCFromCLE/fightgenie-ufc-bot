const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const database = require('../database');
const { EmbedBuilder, ButtonBuilder, ActionRowBuilder, ButtonStyle } = require('discord.js');
const PaymentModel = require('../models/PaymentModel');

class StripePaymentService {
    
    static PAYMENT_TIMEOUT_MINS = 30;

    static PAYMENT_TYPES = {
        SERVER_LIFETIME: {
            price: 50.00,
            name: "Server Lifetime Access",
            description: "Lifetime access to Fight Genie predictions"
        },
        SERVER_EVENT: {
            price: 6.99,
            name: "Server Event Access",
            description: "Access to upcoming event predictions"
        }
    };
    
    // Constants for payment amounts
    static PAYMENT_TYPES = {
        SERVER_LIFETIME: {
            price: 50.00,
            name: "Server Lifetime Access",
            description: "Lifetime access to Fight Genie predictions"
        },
        SERVER_EVENT: {
            price: 6.99,
            name: "Server Event Access",
            description: "Access to upcoming event predictions"
        }
    };

    static async createPaymentSession(serverId, paymentType, userId) {
        try {
            if (!this.PAYMENT_TYPES[paymentType]) {
                throw new Error('Invalid payment type');
            }

            const paymentDetails = this.PAYMENT_TYPES[paymentType];
            const expirationTime = new Date();
            expirationTime.setMinutes(expirationTime.getMinutes() + this.PAYMENT_TIMEOUT_MINS);

            const session = await stripe.checkout.sessions.create({
                payment_method_types: ['card'],
                line_items: [{
                    price_data: {
                        currency: 'usd',
                        product_data: {
                            name: paymentDetails.name,
                            description: paymentDetails.description,
                            images: ['https://sas3fightgenielogo.blob.core.windows.net/fightgenie-logo/FightGenie_Logo_1.PNG']
                        },
                        unit_amount: Math.round(paymentDetails.price * 100),
                    },
                    quantity: 1,
                }],
                mode: 'payment',
                success_url: 'https://discord.com/channels/@me',
                cancel_url: 'https://discord.com/channels/@me',
                metadata: {
                    server_id: serverId,
                    payment_type: paymentType,
                    expires_at: expirationTime.toISOString()
                },
                expires_at: Math.floor(expirationTime.getTime() / 1000)
            });

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
                    created_at,
                    expires_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)
            `, [
                session.id,
                serverId,
                userId,            
                paymentType,
                paymentDetails.price,
                'PENDING',
                'STRIPE',
                JSON.stringify(session),
                expirationTime.toISOString()
            ]);

            return {
                sessionId: session.id,
                url: session.url,
                expiresAt: expirationTime
            };
        } catch (error) {
            console.error('Error creating Stripe session:', error);
            throw error;
        }
    }


    static async handleWebhook(payload, signature) {
        try {
            // Verify webhook signature
            const event = stripe.webhooks.constructEvent(
                payload,
                signature,
                process.env.STRIPE_WEBHOOK_SECRET
            );

            // Handle different event types
            switch (event.type) {
                case 'checkout.session.completed':
                    await this.handleSuccessfulPayment(event.data.object);
                    break;
                    
                case 'payment_intent.payment_failed':
                    await this.handleFailedPayment(event.data.object);
                    break;
            }

            return { received: true };
        } catch (error) {
            console.error('Error handling webhook:', error);
            throw error;
        }
    }

    static async handleSuccessfulPayment(session) {
        try {
            // Get payment details from database
            const payment = await database.query(`
                SELECT * FROM payment_logs
                WHERE payment_id = ?
                AND status = 'PENDING'
            `, [session.id]);

            if (!payment?.[0]) {
                throw new Error('Payment record not found');
            }

            // Update payment status
            await database.query(`
                UPDATE payment_logs
                SET 
                    status = 'COMPLETED',
                    updated_at = datetime('now'),
                    provider_response = ?
                WHERE payment_id = ?
            `, [JSON.stringify(session), session.id]);

            // Activate subscription based on payment type
            if (payment[0].payment_type === 'SERVER_LIFETIME') {
                await PaymentModel.activateServerLifetimeSubscription(
                    payment[0].server_id,
                    session.id
                );
            } else {
                await PaymentModel.activateServerEventAccess(
                    payment[0].server_id,
                    session.id
                );
            }
        } catch (error) {
            console.error('Error handling successful payment:', error);
            throw error;
        }
    }

    static async handleFailedPayment(paymentIntent) {
        try {
            await database.query(`
                UPDATE payment_logs
                SET 
                    status = 'FAILED',
                    updated_at = datetime('now'),
                    provider_response = ?
                WHERE payment_id = ?
            `, [JSON.stringify(paymentIntent), paymentIntent.id]);
        } catch (error) {
            console.error('Error handling failed payment:', error);
            throw error;
        }
    }
    static async verifyPayment(sessionId) {
        try {
            console.log('Starting Stripe payment verification for session:', sessionId);
            
            // First check if we already processed this payment
            const existingPayment = await database.query(`
                SELECT * FROM payment_logs 
                WHERE payment_id = ? 
                AND status = 'COMPLETED'
            `, [sessionId]);
    
            if (existingPayment?.[0]) {
                console.log('Payment already processed:', sessionId);
                return {
                    success: true,
                    amount: existingPayment[0].amount,
                    status: 'completed'
                };
            }
    
            // Get the stripe session to check payment status
            const session = await stripe.checkout.sessions.retrieve(sessionId);
            console.log('Stripe session status:', session.payment_status);
    
            if (session.payment_status === 'paid') {
                // Update payment record
                await database.query(`
                    UPDATE payment_logs
                    SET status = 'COMPLETED',
                        updated_at = datetime('now'),
                        provider_response = ?
                    WHERE payment_id = ?
                `, [JSON.stringify(session), sessionId]);
    
                // Get the actual amount paid
                const amountPaid = session.amount_total / 100; // Convert from cents
    
                console.log('Payment verified successfully:', {
                    sessionId,
                    amount: amountPaid,
                    status: 'completed'
                });
    
                return {
                    success: true,
                    amount: amountPaid,
                    status: 'completed'
                };
            }
    
            console.log('Payment not yet completed:', session.payment_status);
            return {
                success: false,
                status: session.payment_status,
                message: 'Payment not yet completed'
            };
    
        } catch (error) {
            console.error('Error verifying Stripe payment:', error);
            return {
                success: false,
                status: 'error',
                message: error.message
            };
        }
    }

    static async handleVerificationButton(interaction) {
        try {
            if (!interaction.deferred && !interaction.replied) {
                await interaction.deferUpdate();
            }

            const loadingEmbed = new EmbedBuilder()
                .setColor('#ffff00')
                .setTitle('💳 Verifying Payment')
                .setDescription([
                    'Please wait while we verify your payment with Stripe...',
                    'This may take a few moments.'
                ].join('\n'));

            await interaction.editReply({
                embeds: [loadingEmbed],
                components: []
            });

            // Get the payment ID from the button customId
            const customId = interaction.customId; // e.g., 'verify_stripe_cs_live'
            const userId = interaction.user.id;

            // Get the most recent pending payment for this user
            const pendingPayment = await database.query(`
                SELECT payment_id, server_id, payment_type, amount 
                FROM payment_logs 
                WHERE admin_id = ? 
                AND status = 'PENDING'
                AND provider = 'STRIPE'
                ORDER BY created_at DESC 
                LIMIT 1
            `, [userId]);

            if (!pendingPayment?.[0]) {
                throw new Error('No pending payment found for this user');
            }

            const { payment_id: sessionId, server_id: serverId, payment_type: paymentType, amount } = pendingPayment[0];

            console.log('Found pending payment:', {
                sessionId,
                serverId,
                paymentType,
                amount,
                userId
            });

            const verificationResult = await this.verifyPayment(sessionId);

            if (verificationResult.success) {
                const isLifetime = paymentType === 'SERVER_LIFETIME';

                // Activate appropriate subscription
                if (isLifetime) {
                    await PaymentModel.activateServerLifetimeSubscription(serverId, sessionId);
                } else {
                    await PaymentModel.activateServerEventAccess(serverId, sessionId);
                }

                const successEmbed = new EmbedBuilder()
                    .setColor('#00ff00')
                    .setTitle('✅ Payment Successful!')
                    .setDescription([
                        `Payment of $${amount.toFixed(2)} confirmed!`,
                        '',
                        isLifetime ? 
                            '🌟 Lifetime access has been activated for your server!' :
                            '🎟️ Event access has been activated for your server!',
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
                            .setCustomId(`verify_stripe_${sessionId}_${serverId}`)
                            .setLabel('Verify Payment')
                            .setEmoji('✅')
                            .setStyle(ButtonStyle.Success)
                    );

                await interaction.editReply({
                    embeds: [pendingEmbed],
                    components: [verifyButton]
                });
            }

        } catch (error) {
            console.error('Error handling Stripe verification:', error);
            const errorEmbed = new EmbedBuilder()
                .setColor('#ff0000')
                .setTitle('❌ Error Verifying Payment')
                .setDescription([
                    'Unable to verify your payment at this time.',
                    '',
                    'This can happen if:',
                    '• The payment session has expired',
                    '• No pending payment was found',
                    '• The payment was already processed',
                    '',
                    'Please contact support if you need assistance.'
                ].join('\n'));

            await interaction.editReply({
                embeds: [errorEmbed],
                components: []
            });
        }
    }

    static async storePaymentRecord(sessionId, serverId, userId, paymentType, amount) {
        try {
            await database.query(`
                INSERT INTO payment_logs (
                    payment_id,
                    server_id,
                    admin_id,
                    payment_type,
                    amount,
                    status,
                    provider,
                    created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
            `, [
                sessionId,
                serverId,
                userId,
                paymentType,
                amount,
                'PENDING',
                'STRIPE'
            ]);

            console.log('Stored payment record:', {
                sessionId,
                serverId,
                paymentType,
                amount
            });

        } catch (error) {
            console.error('Error storing payment record:', error);
            throw error;
        }
    }
}

module.exports = StripePaymentService;