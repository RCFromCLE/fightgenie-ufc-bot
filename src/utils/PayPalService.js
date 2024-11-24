const axios = require('axios');
const database = require('../database');

class PayPalService {
    static API_BASE = process.env.NODE_ENV === 'production' 
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com';

static async getAccessToken() {
    try {
        if (!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_CLIENT_SECRET) {
            throw new Error('PayPal credentials not configured');
        }

        // Create base64 encoded credentials - matching your working PowerShell script
        const auth = Buffer.from(
            `${process.env.PAYPAL_CLIENT_ID.trim()}:${process.env.PAYPAL_CLIENT_SECRET.trim()}`
        ).toString('base64');

        console.log('Getting PayPal access token...');
        const response = await axios({
            method: 'post',
            url: `${this.API_BASE}/v1/oauth2/token`,
            headers: {
                'Authorization': `Basic ${auth}`,
                'Accept': 'application/json',
                'Accept-Language': 'en_US',
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            data: 'grant_type=client_credentials'
        });

        if (!response.data?.access_token) {
            throw new Error('No access token received from PayPal');
        }

        console.log('Access token received successfully');
        return response.data.access_token;
    } catch (error) {
        console.error('PayPal Auth Error:', {
            message: error.message,
            response: error.response?.data,
            status: error.response?.status
        });
        throw error;
    }
}

static async createPaymentOrder(userId, serverId, amount, paymentType) {
    try {
        const accessToken = await this.getAccessToken();
        
        const orderData = {
            intent: "CAPTURE",
            purchase_units: [{
                reference_id: `${userId}-${serverId}`,
                amount: {
                    currency_code: "USD",
                    value: amount.toFixed(2)
                },
                description: paymentType === 'SERVER_LIFETIME' ? 
                    'Fight Genie Lifetime Server Access' : 
                    'Fight Genie Event Access',
                custom_id: `${userId}:${serverId}:${paymentType}`
            }],
            application_context: {
                brand_name: 'Fight Genie',
                landing_page: 'NO_PREFERENCE',
                user_action: 'PAY_NOW',
                return_url: 'https://discord.com/channels/@me',
                cancel_url: 'https://discord.com/channels/@me'
            }
        };

        const response = await axios.post(
            `${this.API_BASE}/v2/checkout/orders`,
            orderData,
            {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                    'PayPal-Request-Id': `FG-${Date.now()}-${Math.random().toString(36).substring(7)}`
                }
            }
        );

        // Find the approve link
        const approveLink = response.data.links.find(link => 
            link.rel === "approve" || 
            link.rel === "payer-action"
        )?.href;

        if (!approveLink) {
            throw new Error('No approval URL found in PayPal response');
        }

        // Store order details in database
        await this.storeOrderDetails(response.data.id, {
            serverId,
            userId,
            payment_type: paymentType,
            amount: amount,
            status: response.data.status
        });

        return {
            orderId: response.data.id,
            approveLink
        };
    } catch (error) {
        console.error('PayPal Order Creation Error:', {
            message: error.message,
            response: error.response?.data,
            status: error.response?.status
        });
        throw error;
    }
}

    static async storeOrderDetails(orderId, details) {
        try {
            if (!details.serverId || !details.userId) {
                throw new Error('Missing required server or user ID for order storage');
            }
    
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
            const accessToken = await this.getAccessToken();
            
            console.log(`Verifying payment for order: ${orderId}`);
            const response = await axios.get(
                `${this.API_BASE}/v2/checkout/orders/${orderId}`,
                {
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            const status = response.data.status;
            console.log('Order status:', status);

            if (status === 'COMPLETED') {
                return await this.processCompletedPayment(response.data);
            }

            if (status === 'APPROVED') {
                return await this.captureApprovedPayment(orderId, accessToken);
            }

            return {
                success: false,
                status: status,
                message: `Payment needs to be completed. Current status: ${status}`
            };

        } catch (error) {
            console.error('Payment verification error:', error);
            return {
                success: false,
                status: 'ERROR',
                message: 'Error verifying payment. Please try again.',
                error: error.message
            };
        }
    }
    
    static async processCompletedPayment(orderData) {
        try {
            const purchaseUnit = orderData.purchase_units[0];
            
            let userId, serverId, paymentType;
            try {
                if (purchaseUnit?.custom_id) {
                    [userId, serverId, paymentType] = purchaseUnit.custom_id.split(':');
                } else if (purchaseUnit?.custom) {
                    [userId, serverId, paymentType] = purchaseUnit.custom.split(':');
                }
                
                if (!userId || !serverId) {
                    throw new Error('Invalid payment data format');
                }
            } catch (parseError) {
                console.error('Error parsing custom_id:', parseError);
                return {
                    success: false,
                    status: 'INVALID_DATA',
                    message: 'Error processing payment data. Please contact support.',
                    error: 'Invalid payment data format'
                };
            }

            await database.query(`
                UPDATE payment_logs 
                SET status = 'COMPLETED', 
                    updated_at = datetime('now') 
                WHERE payment_id = ?
            `, [orderData.id]);

            return {
                success: true,
                status: 'COMPLETED',
                userId,
                serverId,
                paymentType,
                amount: purchaseUnit.amount.value
            };
        } catch (error) {
            console.error('Error processing completed payment:', error);
            throw error;
        }
    }

    static async captureApprovedPayment(orderId, accessToken) {
        try {
            const captureResponse = await axios.post(
                `${this.API_BASE}/v2/checkout/orders/${orderId}/capture`,
                {},
                {
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Content-Type': 'application/json',
                        'Accept': 'application/json',
                        'Accept-Language': 'en_US',
                        'PayPal-Request-Id': `FG-CAPTURE-${Date.now()}-${Math.random().toString(36).substring(7)}`,
                        'Prefer': 'return=representation'
                    }
                }
            );

            if (captureResponse.data.status === 'COMPLETED') {
                return await this.processCompletedPayment(captureResponse.data);
            }

            return {
                success: false,
                status: captureResponse.data.status,
                message: `Payment capture status: ${captureResponse.data.status}. Please try again.`
            };
        } catch (error) {
            console.error('Payment capture error:', error);
            return {
                success: false,
                status: 'CAPTURE_ERROR',
                message: 'Error capturing payment. Please try again or contact support.',
                error: error.message
            };
        }
    }

    static async getOrderDetails(orderId) {
        try {
            const accessToken = await this.getAccessToken();
            const response = await axios.get(
                `${this.API_BASE}/v2/checkout/orders/${orderId}`,
                {
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Accept': 'application/json',
                        'Accept-Language': 'en_US'
                    }
                }
            );
            return response.data;
        } catch (error) {
            console.error('Error getting order details:', error);
            throw error;
        }
    }

    static async capturePayment(orderId) {
        try {
            const accessToken = await PayPalService.getAccessToken();
            const response = await axios.post(
                `${this.API_BASE}/v2/checkout/orders/${orderId}/capture`,
                {},
                {
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Content-Type': 'application/json',
                        'Accept': 'application/json',
                        'Accept-Language': 'en_US',
                        'PayPal-Request-Id': `FG-CAPTURE-${Date.now()}-${Math.random().toString(36).substring(7)}`,
                        'Prefer': 'return=representation'
                    }
                }
            );
            return response.data;
        } catch (error) {
            console.error('Error capturing payment:', error);
            throw error;
        }
    }
}

module.exports = PayPalService;