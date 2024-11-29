const axios = require('axios');
const database = require('../database');

class PayPalService {
    static API_BASE = process.env.NODE_ENV === 'production'
        ? 'https://api-m.paypal.com'
        : 'https://api-m.sandbox.paypal.com';

    static createCheckoutUrl(orderId) {
        if (!orderId) return null;

        // Create PayPal checkout URL based on environment
        return process.env.NODE_ENV === 'production'
            ? `https://www.paypal.com/checkoutnow?token=${orderId}`
            : `https://www.sandbox.paypal.com/checkoutnow?token=${orderId}`;
    }

    static async getCheckoutUrl(orderId) {
        try {
            if (!orderId) {
                throw new Error('Order ID is required');
            }

            // First try to get order details to ensure it exists
            const orderDetails = await this.getOrderDetails(orderId);
            if (!orderDetails) {
                throw new Error('Order not found');
            }

            // Find the approval URL from order links
            const approveLink = orderDetails.links?.find(link =>
                link.rel === "approve" ||
                link.rel === "payer-action"
            )?.href;

            // Return approval URL if found, otherwise create standard checkout URL
            return approveLink || this.createCheckoutUrl(orderId);

        } catch (error) {
            console.error('Error getting checkout URL:', error);
            // Fallback to basic checkout URL
            return this.createCheckoutUrl(orderId);
        }
    }
    static async getAccessToken() {
        try {
            if (!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_CLIENT_SECRET) {
                throw new Error('PayPal credentials not configured');
            }

            // Properly format credentials and remove any whitespace
            const credentials = Buffer.from(
                `${process.env.PAYPAL_CLIENT_ID.trim()}:${process.env.PAYPAL_CLIENT_SECRET.trim()}`
            ).toString('base64');

            console.log('Getting PayPal access token...');
            const response = await axios({
                method: 'post',
                url: `${this.API_BASE}/v1/oauth2/token`,
                headers: {
                    'Authorization': `Basic ${credentials}`,
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                data: 'grant_type=client_credentials',
                validateStatus: status => status < 500 // Don't throw on 4xx errors
            });

            if (response.status === 401) {
                console.error('PayPal authentication failed:', response.data);
                throw new Error('Invalid PayPal credentials');
            }

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
            throw new Error('Failed to authenticate with PayPal');
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

            console.log('Creating PayPal order with data:', orderData);

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
            
            console.log(`Verifying payment status for order: ${orderId}`);
            const response = await axios.get(
                `${this.API_BASE}/v2/checkout/orders/${orderId}`,
                {
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Content-Type': 'application/json'
                    }
                }
            );
    
            const orderStatus = response.data.status;
            console.log('PayPal order status:', orderStatus);
    
            if (orderStatus === 'COMPLETED') {
                const purchaseUnit = response.data.purchase_units[0];
                const customData = purchaseUnit.custom_id?.split(':') || [];
                const [userId, serverId, paymentType] = customData;
    
                return {
                    success: true,
                    status: 'COMPLETED',
                    userId,
                    serverId,
                    paymentType,
                    amount: parseFloat(purchaseUnit.amount.value)
                };
            }
    
            // Handle APPROVED status
            if (orderStatus === 'APPROVED') {
                // Try to capture the payment
                const captureResponse = await this.capturePayment(orderId, accessToken);
                if (captureResponse.status === 'COMPLETED') {
                    const purchaseUnit = captureResponse.purchase_units[0];
                    const customData = purchaseUnit.custom_id?.split(':') || [];
                    const [userId, serverId, paymentType] = customData;
    
                    return {
                        success: true,
                        status: 'COMPLETED',
                        userId,
                        serverId,
                        paymentType,
                        amount: parseFloat(purchaseUnit.amount.value)
                    };
                }
            }
    
            return {
                success: false,
                status: orderStatus,
                message: `Payment needs completion. Current status: ${orderStatus}`
            };
        } catch (error) {
            console.error('PayPal verification error:', error.response?.data || error.message);
            return {
                success: false,
                status: 'ERROR',
                message: 'Error verifying payment'
            };
        }
    }
    
    static async capturePayment(orderId, accessToken) {
        try {
            const response = await axios.post(
                `${this.API_BASE}/v2/checkout/orders/${orderId}/capture`,
                {},
                {
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Content-Type': 'application/json',
                        'PayPal-Request-Id': `FG-CAPTURE-${Date.now()}-${Math.random().toString(36).substring(7)}`
                    }
                }
            );
            
            console.log('Payment capture response:', response.data);
            return response.data;
        } catch (error) {
            console.error('Payment capture error:', error.response?.data || error.message);
            throw error;
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