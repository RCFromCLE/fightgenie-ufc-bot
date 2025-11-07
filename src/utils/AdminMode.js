// Admin mode manager for restricting bot commands to admin server only
class AdminMode {
    constructor() {
        this.isAdminMode = false;
        this.adminServerId = "496121279712329756"; // Your admin server ID
    }

    // Enable admin mode
    enableAdminMode() {
        this.isAdminMode = true;
        console.log("🔒 Admin mode ENABLED - Bot will only respond to admin server");
        return true;
    }

    // Disable admin mode
    disableAdminMode() {
        this.isAdminMode = false;
        console.log("🔓 Admin mode DISABLED - Bot will respond to all servers");
        return true;
    }

    // Check if admin mode is enabled
    isEnabled() {
        return this.isAdminMode;
    }

    // Check if interaction is from admin server
    isFromAdminServer(interaction) {
        return interaction.guild?.id === this.adminServerId;
    }

    // Check if command should be allowed
    shouldAllowCommand(interaction) {
        // If admin mode is disabled, allow all commands
        if (!this.isAdminMode) {
            return true;
        }

        // If admin mode is enabled, only allow commands from admin server
        return this.isFromAdminServer(interaction);
    }

    // Get rejection message for non-admin servers when in admin mode
    getRejectionMessage() {
        return "🔒 **Bot is currently in Admin Mode**\n\nThe bot is temporarily restricted for maintenance and testing. Please try again later.";
    }

    // Get status message
    getStatusMessage() {
        if (this.isAdminMode) {
            return `🔒 **Admin Mode: ENABLED**\nBot restricted to admin server only (ID: ${this.adminServerId})`;
        } else {
            return "🔓 **Admin Mode: DISABLED**\nBot responding to all servers normally";
        }
    }
}

// Export singleton instance
module.exports = new AdminMode();
