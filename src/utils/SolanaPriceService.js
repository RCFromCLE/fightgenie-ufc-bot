const axios = require('axios');

class SolanaPriceService {
    static JUPITER_API_URL = 'https://api.jup.ag/price/v2';
    static SOL_MINT = 'So11111111111111111111111111111111111111112';

    static async getCurrentSolPrice() {
        try {
            const response = await axios.get(`${this.JUPITER_API_URL}?ids=${this.SOL_MINT}`);
            
            if (response.data?.data?.[this.SOL_MINT]?.price) {
                return parseFloat(response.data.data[this.SOL_MINT].price);
            }
            
            throw new Error('Unable to fetch SOL price');
        } catch (error) {
            console.error('Error fetching SOL price:', error);
            throw error;
        }
    }

    static async calculateSolAmount(usdAmount) {
        try {
            const solPrice = await this.getCurrentSolPrice();
            const solAmount = usdAmount / solPrice;
            
            // Round to 4 decimal places for better UX
            return parseFloat(solAmount.toFixed(4));
        } catch (error) {
            console.error('Error calculating SOL amount:', error);
            throw error;
        }
    }

    static async getPriceWithDiscount(usdAmount, discountPercentage = 0.10) {
        try {
            // First calculate SOL amount
            const baseSolAmount = await this.calculateSolAmount(usdAmount);
            
            // Apply discount
            const discountedSolAmount = baseSolAmount * (1 - discountPercentage);
            
            // Round to 4 decimal places
            return parseFloat(discountedSolAmount.toFixed(4));
        } catch (error) {
            console.error('Error calculating discounted price:', error);
            throw error;
        }
    }

    static async getQuoteWithExtra() {
        try {
            const response = await axios.get(
                `${this.JUPITER_API_URL}?ids=${this.SOL_MINT}&showExtraInfo=true`
            );
            
            return response.data?.data?.[this.SOL_MINT] || null;
        } catch (error) {
            console.error('Error fetching detailed SOL quote:', error);
            throw error;
        }
    }
}

module.exports = SolanaPriceService;