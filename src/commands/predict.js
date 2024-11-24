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
          content: "No upcoming events found.",
          ephemeral: true,
        });
        return;
      }

      // Check current state of prelims visibility from the embed
      const currentEmbed = interaction.message.embeds[0];
      const showPrelims = currentEmbed.fields.some(
        (field) => field.name && field.name.includes("PRELIMINARY CARD")
      );

      const response = await EventHandlers.createEventEmbed(event, showPrelims);
      await interaction.message.edit(response);
    } catch (error) {
      console.error("Error showing event:", error);
      await interaction.followUp({
        content: "Error displaying event. Please try again.",
        ephemeral: true,
      });
    }
  }

  static async handlePrelimToggle(interaction) {
    // Redirect to EventHandlers
    return EventHandlers.handlePrelimToggle(interaction);
  }
}

module.exports = PredictCommand;
