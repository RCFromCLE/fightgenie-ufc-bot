const { Connection, PublicKey, LAMPORTS_PER_SOL, Keypair, SystemProgram, Transaction } = require('@solana/web3.js');
const database = require('../database');
const SolanaPriceService = require('../utils/SolanaPriceService');

class SolanaPaymentService {
    static RPC_ENDPOINT = process.env.SOLANA_RPC_ENDPOINT || 'https://api.mainnet-beta.solana.com';
    static MERCHANT_WALLET = process.env.SOLANA_MERCHANT_WALLET;
    static MIN_TRANSACTION_SIZE = 0.01;
    static MAX_RETRIES = 3;
    static BASE_DELAY = 5000;
    static PAYMENT_EXPIRY_MINUTES = 15;
    
    static cache = {
        lastVerification: new Map(),
        transactions: new Map(),
        confirmations: new Map(),
        activePolling: new Map()
    };

    static getCacheValue(cache, key) {
        const value = cache.get(key);
        if (!value) return null;
        if (Date.now() - value.timestamp > 30000) {
            cache.delete(key);
            return null;
        }
        return value.data;
    }

    static setCacheValue(cache, key, value) {
        cache.set(key, {
            data: value,
            timestamp: Date.now()
        });
    }

    static async generatePaymentAddress(serverId, paymentType) {
        try {
            if (!this.MERCHANT_WALLET) {
                throw new Error('Merchant wallet not configured');
            }

            if (!serverId) {
                throw new Error('Server ID is required');
            }

            if (!paymentType) {
                throw new Error('Payment type is required');
            }

            const intermediateWallet = Keypair.generate();
            const intermediatePublicKey = intermediateWallet.publicKey.toString();
            const paymentId = `SOL-${Date.now()}-${Math.random().toString(36).substring(7)}`;

            // Get USD amount based on payment type
            let usdAmount;
            switch(paymentType.toUpperCase()) {
                case 'LIFETIME':
                    usdAmount = 50.00;
                    break;
                case 'EVENT':
                    usdAmount = 6.99;
                    break;
                default:
                    throw new Error(`Invalid payment type: ${paymentType}`);
            }

            // Get current SOL price and calculate amount with discount
            const discountedAmount = await SolanaPriceService.getPriceWithDiscount(usdAmount);

            console.log('Payment calculation:', {
                paymentType,
                usdAmount,
                solAmount: discountedAmount
            });

            const expirationTime = new Date();
            expirationTime.setMinutes(expirationTime.getMinutes() + this.PAYMENT_EXPIRY_MINUTES);

            await database.query(`
                INSERT INTO solana_payments (
                    payment_id,
                    payment_address,
                    intermediate_private_key,
                    server_id,
                    expected_amount,
                    status,
                    payment_type,
                    created_at,
                    expires_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)
            `, [
                paymentId,
                intermediatePublicKey,
                Buffer.from(intermediateWallet.secretKey).toString('base64'),
                serverId,
                discountedAmount,
                'PENDING',
                paymentType.toUpperCase(),
                expirationTime.toISOString()
            ]);

            console.log('Generated payment request:', {
                paymentId,
                address: intermediatePublicKey,
                amount: discountedAmount,
                serverId,
                paymentType,
                expiresAt: expirationTime
            });

            return {
                paymentId,
                address: intermediatePublicKey,
                amount: discountedAmount,
                expiresAt: expirationTime
            };

        } catch (error) {
            console.error('Error generating payment address:', error);
            throw error;
        }
    }
    static async verifyPayment(paymentId) {
        try {
            console.log('Verifying payment:', paymentId);

            const paymentRecord = await database.query(`
                SELECT 
                    payment_address,
                    intermediate_private_key,
                    server_id,
                    expected_amount,
                    status,
                    payment_type
                FROM solana_payments
                WHERE payment_id = ?
                AND status = 'PENDING'
            `, [paymentId]);

            if (!paymentRecord?.[0]) {
                return { 
                    success: false, 
                    message: 'Payment record not found or already processed' 
                };
            }

            const { 
                payment_address, 
                intermediate_private_key,
                expected_amount,
                server_id 
            } = paymentRecord[0];

            const connection = new Connection(this.RPC_ENDPOINT, {
                commitment: 'confirmed'
            });

            const intermediatePublicKey = new PublicKey(payment_address);
            const balance = await connection.getBalance(intermediatePublicKey);
            const balanceInSOL = balance / LAMPORTS_PER_SOL;

            console.log('Wallet balance:', balanceInSOL, 'SOL, Expected:', expected_amount, 'SOL');

            // Accept payment if balance is greater than or equal to expected amount
            if (balanceInSOL >= expected_amount) {
                // Forward to merchant wallet
                const forwardingResult = await this.forwardPaymentToMerchant(
                    payment_address,
                    intermediate_private_key,
                    balanceInSOL
                );

                if (forwardingResult.success) {
                    await this.updatePaymentRecord(paymentId, forwardingResult.signature, balanceInSOL);
                    
                    return {
                        success: true,
                        signature: forwardingResult.signature,
                        amount: balanceInSOL,
                        status: 'completed',
                        serverId: server_id
                    };
                }
            }

            return {
                success: false,
                message: `Received ${balanceInSOL} SOL`,
                serverId: server_id
            };

        } catch (error) {
            console.error('Error verifying payment:', error);
            throw error;
        }
    }

  static async forwardPaymentToMerchant(intermediateAddress, intermediatePrivateKey, amountSOL) {
        try {
            const connection = new Connection(this.RPC_ENDPOINT, {
                commitment: 'confirmed'
            });

            const intermediateKeypair = Keypair.fromSecretKey(
                Buffer.from(intermediatePrivateKey, 'base64')
            );

            const merchantPublicKey = new PublicKey(this.MERCHANT_WALLET.trim());

            // Get total balance
            const balance = await connection.getBalance(intermediateKeypair.publicKey);
            
            // Reserve some SOL for transaction fee
            const fees = 5000; // 0.000005 SOL
            const transferAmount = balance - fees;

            if (transferAmount <= 0) {
                throw new Error('Insufficient balance for transfer after fees');
            }

            const transaction = new Transaction().add(
                SystemProgram.transfer({
                    fromPubkey: intermediateKeypair.publicKey,
                    toPubkey: merchantPublicKey,
                    lamports: transferAmount
                })
            );

            const { blockhash } = await connection.getLatestBlockhash();
            transaction.recentBlockhash = blockhash;
            transaction.feePayer = intermediateKeypair.publicKey;

            transaction.sign(intermediateKeypair);
            
            const signature = await connection.sendRawTransaction(
                transaction.serialize()
            );

            const confirmation = await connection.confirmTransaction(signature);
            
            if (confirmation.value.err) {
                throw new Error('Transaction failed to confirm');
            }

            console.log('Payment forwarded to merchant:', {
                signature,
                amount: amountSOL
            });

            return {
                success: true,
                signature
            };

        } catch (error) {
            console.error('Error forwarding payment to merchant:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    static async getTransactionConfirmation(signature) {
        try {
            const cachedStatus = this.getCacheValue(this.cache.confirmations, signature);
            if (cachedStatus) {
                return cachedStatus;
            }

            const connection = new Connection(this.RPC_ENDPOINT);
            const result = await this.retryWithRateLimit(
                () => connection.getSignatureStatus(signature, {
                    searchTransactionHistory: true
                })
            );

            const status = result.value?.confirmationStatus || 'unknown';
            this.setCacheValue(this.cache.confirmations, signature, status);
            
            return status;
        } catch (error) {
            console.error('Error getting transaction confirmation:', error);
            return 'unknown';
        }
    }

    static async retryWithRateLimit(operation, maxRetries = this.MAX_RETRIES) {
        let lastError;
        let attempt = 1;
        
        while (attempt <= maxRetries) {
            try {
                return await operation();
            } catch (error) {
                lastError = error;
                
                const isRateLimit = 
                    error.response?.status === 429 || 
                    error.message?.includes('429') ||
                    error.message?.includes('Too many requests');

                if (isRateLimit) {
                    const delayMs = this.BASE_DELAY * Math.pow(3, attempt - 1) + 
                                  (Math.random() * 2000);
                    console.log(`Rate limit hit, attempt ${attempt}/${maxRetries}. Waiting ${delayMs}ms before retry...`);
                    await this.sleep(delayMs);
                    attempt++;
                    continue;
                }
                
                throw error;
            }
        }

        throw lastError;
    }

    static async validateTransaction(tx, expectedAmount) {
        try {
            const preBalance = tx.meta.preBalances[0] || 0;
            const postBalance = tx.meta.postBalances[0] || 0;
            const amountReceived = Math.abs(postBalance - preBalance) / LAMPORTS_PER_SOL;

            if (amountReceived < this.MIN_TRANSACTION_SIZE) return null;

            const tolerance = expectedAmount * 0.02;
            if (Math.abs(amountReceived - expectedAmount) <= tolerance) {
                return amountReceived;
            }

            return null;
        } catch (error) {
            console.error('Error validating transaction:', error);
            return null;
        }
    }

    static async updatePaymentRecord(paymentId, signature, amount) {
        await database.query(`
            UPDATE solana_payments
            SET 
                status = 'COMPLETED',
                transaction_signature = ?,
                amount_sol = ?
            WHERE payment_id = ?
        `, [signature, amount, paymentId]);
    }

    static sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

module.exports = SolanaPaymentService;