const { EmbedBuilder } = require("discord.js");
const PredictionHandler = require("../utils/PredictionHandler");
const EventHandlers = require("../utils/eventHandlers");
const StatsDisplayHandler = require("../utils/StatsDisplayHandler");
const OddsAnalysis = require("../utils/OddsAnalysis");
const database = require("../database");

class PredictCommand {

    static async handleShowEvent(interaction) {
        try {
            if (!interaction.deferred && !interaction.replied) {
                await interaction.deferUpdate();
            }
            const event = await EventHandlers.getUpcomingEvent();
            if (!event) {
                await interaction.followUp({
                    content: 'No upcoming events found.',
                    ephemeral: true
                });
                return;
            }
            const response = await EventHandlers.createEventEmbed(event, false);
            await interaction.message.edit(response);
        } catch (error) {
            console.error("Error showing event:", error);
            await interaction.followUp({
                content: "Error displaying event. Please try again.",
                ephemeral: true
            });
        }
    }

    static async handlePrelimToggle(interaction) {
        try {
            // Ensure interaction is deferred or replied
            if (!interaction.deferred && !interaction.replied) {
                await interaction.deferUpdate();
            }
    
            const event = await EventHandlers.getUpcomingEvent();
            if (!event) {
                await interaction.followUp({
                    content: "No upcoming event found.",
                    ephemeral: true,
                });
                return;
            }
    
            const showPrelims = !interaction.message.embeds[0].fields.some(
                (f) => f.name === "🥊 PRELIMINARY CARD"
            );
            const response = await EventHandlers.createEventEmbed(event, showPrelims);
    
            await interaction.message.edit(response);
        } catch (error) {
            console.error("Error toggling prelims:", error);
            try {
                await interaction.followUp({
                    content: "An error occurred while toggling prelims.",
                    ephemeral: true,
                });
            } catch (followUpError) {
                console.error("Error sending follow-up:", followUpError);
            }
        }
    }
}
module.exports = PredictCommand;