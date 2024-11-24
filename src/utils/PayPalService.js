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
        throw new Error('Failed to authenticate with PayPal');
    }
}

static async createPaymentOrder(userId, serverId, amount, paymentType) {
    try {
        const accessToken = await PayPalService.getAccessToken();
        const orderData = {
            intent: "CAPTURE",
            purchase_units: [{
                amount: {
                    currency_code: "USD",
                    value: amount.toFixed(2)
                },
                description: 'Fight Genie Server Access',
                custom_id: `${userId}:${serverId}:${paymentType}`
            }],
            application_context: {
                brand_name: 'Fight Genie',
                landing_page: 'BILLING',  // Changed from LOGIN to BILLING
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

        // Find the approve link with payment flow
        const approveLink = response.data.links.find(link => 
            link.rel === "payer-action" || // Look for payer-action first
            link.rel === "approve" ||      // Fallback to approve
            link.href.includes("/checkout/") // Final fallback
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
            approveLink: approveLink
        };
    } catch (error) {
        console.error('PayPal Order Error:', error.response?.data || error);
        throw error;
    }
}

static createCheckoutUrl(orderId) {
    const baseUrl = this.API_BASE === 'https://api-m.paypal.com' 
        ? 'https://www.paypal.com' 
        : 'https://www.sandbox.paypal.com';
    return `${baseUrl}/checkoutnow?token=${orderId}`;
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

// In PayPalService.js

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
            
            // Add defensive checks for custom_id
            let userId, serverId;
            try {
                if (purchaseUnit && purchaseUnit.custom_id) {
                    [userId, serverId] = purchaseUnit.custom_id.split(':');
                } else if (purchaseUnit && purchaseUnit.custom) {
                    // Fallback to check purchaseUnit.custom if custom_id doesn't exist
                    [userId, serverId] = purchaseUnit.custom.split(':');
                }
                
                if (!userId || !serverId) {
                    console.log('Purchase unit data:', purchaseUnit);
                    throw new Error('Missing user or server ID in PayPal response');
                }
            } catch (parseError) {
                console.error('Error parsing custom_id:', parseError);
                console.log('Full purchase unit:', purchaseUnit);
                
                // Return a more graceful error response
                return {
                    success: false,
                    status: 'ERROR',
                    message: 'Error processing payment verification. Please contact support.',
                    error: 'Invalid payment data format'
                };
            }

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
                    
                    // Add the same defensive checks here
                    let userId, serverId;
                    try {
                        if (purchaseUnit && purchaseUnit.custom_id) {
                            [userId, serverId] = purchaseUnit.custom_id.split(':');
                        } else if (purchaseUnit && purchaseUnit.custom) {
                            [userId, serverId] = purchaseUnit.custom.split(':');
                        }
                        
                        if (!userId || !serverId) {
                            console.log('Capture response purchase unit:', purchaseUnit);
                            throw new Error('Missing user or server ID in capture response');
                        }
                    } catch (parseError) {
                        console.error('Error parsing custom_id from capture:', parseError);
                        console.log('Full capture purchase unit:', purchaseUnit);
                        return {
                            success: false,
                            status: 'ERROR',
                            message: 'Error processing payment capture. Please contact support.',
                            error: 'Invalid capture data format'
                        };
                    }

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
                console.error('Payment capture error:', captureError.response?.data || captureError);
                return {
                    success: false,
                    status: 'ERROR',
                    message: 'Error capturing payment. Please try again or contact support.',
                    error: captureError.message
                };
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
                : 'Error verifying payment. Please try again or contact support.',
            details: error.message
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
                    'Authorization': `Bearer ${accessToken}`
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
            return response.data;
        } catch (error) {
            console.error('Error capturing payment:', error);
            throw error;
        }
    }
}

// Export the service
module.exports = PayPalService;