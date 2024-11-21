const axios = require('axios');
const database = require('../database');

class PayPalService {
    static API_BASE = process.env.NODE_ENV === 'production' 
        ? 'https://api-m.paypal.com'
        : 'https://api.sandbox.paypal.com';

    static CHECKOUT_BASE = process.env.NODE_ENV === 'production'
        ? 'https://www.paypal.com'
        : 'https://www.sandbox.paypal.com';

    static async getAccessToken() {
        try {
            const auth = Buffer.from(
                `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`
            ).toString('base64');

            console.log('Getting PayPal access token...');
            const response = await axios({
                method: 'post',
                url: `${PayPalService.API_BASE}/v1/oauth2/token`,
                data: 'grant_type=client_credentials',
                headers: {
                    'Authorization': `Basic ${auth}`,
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            });

            console.log('Access token received');
            return response.data.access_token;
        } catch (error) {
            console.error('PayPal Auth Error:', error.response?.data || error);
            throw error;
        }
    }

    static async createPaymentOrder(userId, serverId, amount, paymentType) {
        try {
            const accessToken = await PayPalService.getAccessToken();
            const numericAmount = parseFloat(amount);
    
            if (isNaN(numericAmount) || numericAmount <= 0) {
                throw new Error('Invalid amount specified');
            }
    
            console.log('Creating PayPal order:', {
                userId,
                serverId,
                amount: numericAmount
            });
    
            // Add proper return URLs - replace with your Discord bot's domain
            const baseReturnUrl = 'https://discord.com/channels/@me'; // temporary fallback URL
            
            const order = await axios.post(
                `${PayPalService.API_BASE}/v2/checkout/orders`,
                {
                    intent: 'CAPTURE',
                    purchase_units: [{
                        amount: {
                            currency_code: 'USD',
                            value: numericAmount.toFixed(2)
                        },
                        description: 'Fight Genie Server Lifetime Access',
                        custom_id: `${userId}:${serverId}`
                    }],
                    application_context: {
                        brand_name: 'Fight Genie',
                        landing_page: 'LOGIN',
                        user_action: 'PAY_NOW',
                        return_url: baseReturnUrl,
                        cancel_url: baseReturnUrl,
                        shipping_preference: 'NO_SHIPPING'
                    }
                },
                {
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Content-Type': 'application/json',
                        'PayPal-Request-Id': `FG-${Date.now()}-${Math.random().toString(36).substring(7)}`
                    }
                }
            );
    
            console.log('Order created:', {
                id: order.data.id,
                status: order.data.status
            });
    
            // Extract the approval URL
            const approveLink = order.data.links.find(link => link.rel === 'approve')?.href;
            if (!approveLink) {
                throw new Error('No approval URL found in PayPal response');
            }
    
            return {
                orderId: order.data.id,
                approveLink
            };
        } catch (error) {
            console.error('PayPal Order Error:', error.response?.data || error);
            throw error;
        }
    }
    
    static async storeOrderDetails(orderId, details) {
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
                orderId,
                details.serverId,
                details.userId,
                details.payment_type,
                details.amount,
                details.status,
                'PAYPAL'
            ]);

            console.log('Stored order details:', {
                orderId,
                serverId: details.serverId,
                userId: details.userId,
                status: details.status
            });
        } catch (error) {
            console.error('Error storing order details:', error);
            throw error;
        }
    }

    static async verifyPayment(orderId) {
        try {
            const accessToken = await PayPalService.getAccessToken();
            
            console.log(`Verifying payment for order: ${orderId}`);
            const orderResponse = await axios.get(
                `${PayPalService.API_BASE}/v2/checkout/orders/${orderId}`,
                {
                    headers: {
                        'Authorization': `Bearer ${accessToken}`
                    }
                }
            );

            console.log('Order status:', orderResponse.data.status);

            if (orderResponse.data.status === 'CREATED') {
                const checkoutUrl = `${PayPalService.CHECKOUT_BASE}/checkoutnow?token=${orderId}`;
                return {
                    success: false,
                    status: 'PENDING_PAYMENT',
                    message: 'Payment not yet completed. Please complete payment through PayPal.',
                    checkoutUrl
                };
            }

            if (orderResponse.data.status === 'COMPLETED') {
                const purchaseUnit = orderResponse.data.purchase_units[0];
                const [userId, serverId] = purchaseUnit.custom_id.split(':');

                await database.query(`
                    UPDATE payment_logs 
                    SET status = 'COMPLETED', 
                        updated_at = datetime('now') 
                    WHERE payment_id = ?
                `, [orderId]);

                return {
                    success: true,
                    userId,
                    serverId,
                    amount: purchaseUnit.amount.value,
                    status: 'COMPLETED'
                };
            }

            if (orderResponse.data.status === 'APPROVED') {
                try {
                    const captureResponse = await axios.post(
                        `${PayPalService.API_BASE}/v2/checkout/orders/${orderId}/capture`,
                        {},
                        {
                            headers: {
                                'Authorization': `Bearer ${accessToken}`,
                                'Content-Type': 'application/json',
                                'PayPal-Request-Id': `FG-CAPTURE-${Date.now()}-${Math.random().toString(36).substring(7)}`
                            }
                        }
                    );

                    if (captureResponse.data.status === 'COMPLETED') {
                        const purchaseUnit = captureResponse.data.purchase_units[0];
                        const [userId, serverId] = purchaseUnit.custom_id.split(':');
                        
                        await database.query(`
                            UPDATE payment_logs 
                            SET status = 'COMPLETED', 
                                updated_at = datetime('now') 
                            WHERE payment_id = ?
                        `, [orderId]);

                        return {
                            success: true,
                            userId,
                            serverId,
                            amount: purchaseUnit.amount.value,
                            status: 'COMPLETED'
                        };
                    }
                } catch (captureError) {
                    console.error('Payment capture error:', captureError.response?.data);
                    throw captureError;
                }
            }

            return {
                success: false,
                status: orderResponse.data.status,
                message: `Payment needs to be completed. Current status: ${orderResponse.data.status}`
            };

        } catch (error) {
            console.error('Payment Verification Error:', error.response?.data || error);
            return {
                success: false,
                error: error.response?.status === 404 
                    ? 'Payment not found. Please ensure you completed the PayPal checkout.'
                    : 'Error verifying payment. Please try again or contact support.'
            };
        }
    }
}

// Export an instance of the service for compatibility with existing code
const paypalService = {
    createPaymentOrder: PayPalService.createPaymentOrder.bind(PayPalService),
    verifyPayment: PayPalService.verifyPayment.bind(PayPalService),
    getAccessToken: PayPalService.getAccessToken.bind(PayPalService),
    storeOrderDetails: PayPalService.storeOrderDetails.bind(PayPalService)
};

module.exports = paypalService;