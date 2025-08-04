// const database = require("../database"); // No longer needed
// const web3 = require("@solana/web3.js"); // No longer needed

class PaymentModel {
  // All payment and subscription logic has been removed as the bot is now free.
  // This class remains as a placeholder to prevent potential import errors,
  // but it no longer performs any actions related to payments or subscriptions.

  // Example of a method that might be needed if other parts still call it,
  // but now it does nothing or returns a default value.
  static async checkServerAccess(serverId, eventId = null) {
    // Since the bot is free, access is always granted.
    console.log(`Access check for server ${serverId} (event ${eventId || 'any'}): Always true (Free Bot).`);
    return true; 
  }

  // Other methods like createServerPayment, updatePaymentStatus, 
  // activateServerLifetimeSubscription, activateServerEventAccess, 
  // getServerSubscriptionInfo, cleanupExpiredSubscriptions, 
  // createSubscriptionTable, etc., are removed.
}

module.exports = PaymentModel;
