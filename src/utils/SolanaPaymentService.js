const { Keypair, Connection, PublicKey, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const database = require('../database');

class SolanaPaymentService {
    static RPC_ENDPOINT = process.env.SOLANA_RPC_ENDPOINT || 'https://api.mainnet-beta.solana.com';
    static MERCHANT_WALLET = process.env.SOLANA_MERCHANT_WALLET;
    static PAYMENT_TIMEOUT_MINS = 30;

    static async generatePaymentAddress() {
        try {
            // Generate new keypair for this payment
            const paymentKeypair = Keypair.generate();
            const paymentAddress = paymentKeypair.publicKey.toString();
            const keypairSecret = Buffer.from(paymentKeypair.secretKey).toString('hex');

            // Generate unique payment ID
            const paymentId = `SOL-${Date.now()}-${Math.random().toString(36).substring(7)}`;

            // Calculate expiration time (30 minutes from now)
            const expirationTime = new Date();
            expirationTime.setMinutes(expirationTime.getMinutes() + this.PAYMENT_TIMEOUT_MINS);

            // Store payment details in database with expiration
            await database.query(`
                INSERT INTO solana_payments (
                    payment_id,
                    payment_address,
                    keypair_secret,
                    status,
                    expires_at,
                    created_at
                ) VALUES (?, ?, ?, ?, datetime(?), datetime('now'))
            `, [
                paymentId,
                paymentAddress,
                keypairSecret,
                'PENDING',
                expirationTime.toISOString()
            ]);

            console.log('Generated Solana payment:', {
                paymentId,
                address: paymentAddress,
                expiresAt: expirationTime
            });

            return {
                paymentId,
                address: paymentAddress
            };
        } catch (error) {
            console.error('Error generating Solana payment address:', error);
            throw error;
        }
    }

    static async verifyPayment(paymentId, expectedAmount) {
        try {
            // Get payment details from database
            const payment = await database.query(`
                SELECT * FROM solana_payments
                WHERE payment_id = ?
                AND status = 'PENDING'
                AND datetime('now') < datetime(expires_at)
            `, [paymentId]);

            if (!payment?.[0]) {
                return { 
                    success: false, 
                    message: 'Payment not found, expired, or already processed' 
                };
            }

            // Connect to Solana network
            const connection = new Connection(this.RPC_ENDPOINT);

            // Get all recent signatures for the address
            const paymentAddress = new PublicKey(payment[0].payment_address);
            const signatures = await connection.getSignaturesForAddress(
                paymentAddress,
                { limit: 10 }
            );

            // Check each transaction
            for (const sigInfo of signatures) {
                const tx = await connection.getTransaction(sigInfo.signature);
                if (!tx) continue;

                const amountReceived = tx.meta?.postBalances[0] - tx.meta?.preBalances[0];
                const solAmount = amountReceived / LAMPORTS_PER_SOL;

                // Verify amount with 0.01 SOL tolerance
                if (Math.abs(solAmount - expectedAmount) <= 0.01) {
                    // Update payment status
                    await database.query(`
                        UPDATE solana_payments
                        SET 
                            status = 'COMPLETED',
                            amount_sol = ?,
                            transaction_signature = ?,
                            completed_at = datetime('now')
                        WHERE payment_id = ?
                    `, [solAmount, sigInfo.signature, paymentId]);

                    return {
                        success: true,
                        signature: sigInfo.signature,
                        amount: solAmount
                    };
                }
            }

            return { 
                success: false, 
                message: 'Payment not found or amount mismatch' 
            };

        } catch (error) {
            console.error('Error verifying Solana payment:', error);
            return { 
                success: false, 
                message: 'Error verifying payment',
                error: error.message 
            };
        }
    }

    static async checkPaymentStatus(paymentId) {
        try {
            const payment = await database.query(`
                SELECT 
                    status, 
                    transaction_signature, 
                    amount_sol,
                    expires_at,
                    datetime('now') > datetime(expires_at) as is_expired
                FROM solana_payments
                WHERE payment_id = ?
            `, [paymentId]);

            return payment?.[0] || null;
        } catch (error) {
            console.error('Error checking payment status:', error);
            return null;
        }
    }

    static async cleanupExpiredPayments() {
        try {
            await database.query(`
                UPDATE solana_payments 
                SET status = 'EXPIRED' 
                WHERE status = 'PENDING' 
                AND datetime('now') > datetime(expires_at)
            `);
        } catch (error) {
            console.error('Error cleaning up expired payments:', error);
        }
    }
}

module.exports = SolanaPaymentService;