const {
  EmbedBuilder,
  ButtonBuilder,
  ActionRowBuilder,
  ButtonStyle,
} = require("discord.js");
const database = require("../database");
const ModelCommand = require("../commands/ModelCommand");
const { generateEnhancedPredictionsWithAI } = require("./llmhelper");
const FighterStats = require("./fighterStats");
const OddsAnalysis = require("./OddsAnalysis");
const MarketAnalysis = require('../utils/MarketAnalysis');
const { processEventFights, processFightData } = require('./fightDataProcessor');
const PredictionState = require('./PredictionState');

class PredictionHandler {

  static async getCurrentEvent() {
    try {
        // Use a window of time that includes the current day and previous day for late events
        const query = `
            SELECT DISTINCT 
                event_id, Date, Event, City, State, 
                Country, event_link, event_time
            FROM events 
            WHERE Date IN (date('now', '-1 day'), date('now'))
            AND Event LIKE 'UFC%'
            AND is_completed = 0 -- Added this check
            ORDER BY Date DESC
            LIMIT 1
        `;
 
        const result = await database.query(query, []);
        
        if (result?.length > 0) {
            console.log(`Found current event: ${result[0].Event}`);
            return result[0];
        }
        
        console.log("No current event found");
        return null;
    } catch (error) {
        console.error("Error in getCurrentEvent:", error);
        throw error;
    }
 }
     
    static async getUpcomingEvent() {
      try {
          // First try to get current event
          let event = await this.getCurrentEvent();
          
          // If no current event, get next upcoming
          if (!event) {
              const query = `
                  SELECT DISTINCT 
                      event_id, Date, Event, City, State, 
                      Country, event_link, event_time
                  FROM events 
                  WHERE Date >= date('now')
                  AND Event LIKE 'UFC%'
                  AND is_completed = 0 -- Added this check
                  ORDER BY Date ASC 
                  LIMIT 1
              `;
   
              const result = await database.query(query, []);
              if (result?.length > 0) {
                  event = result[0];
              }
          }
   
          if (!event) {
              throw new Error("No current or upcoming events found.");
          }
   
          // Get fights for the event
          const fights = await database.getEventFights(event.Event);
          if (!fights || fights.length === 0) {
              console.log("No fights found for event:", event.Event);
          }
   
          return event;
      } catch (error) {
          console.error("Error in getUpcomingEvent:", error);
          throw error;
      }
   }

  async isEventCompleted(eventLink) {
    try {
      if (!eventLink) return false;

      const response = await axios.get(eventLink);
      const $ = cheerio.load(response.data);

      // Check if there are any fight results
      const hasResults = $('.b-fight-details__table-col:contains("W/L")').length > 0;
      const allFightsCompleted = $('.b-fight-details__table-row').toArray().every(row => {
        const method = $(row).find('.b-fight-details__table-col:nth-child(8)').text().trim();
        return method !== "";
      });

      console.log(`Event completion check - Has results: ${hasResults}, All fights completed: ${allFightsCompleted}`);
      return hasResults && allFightsCompleted;

    } catch (error) {
      console.error('Error checking event completion:', error);
      return false;
    }
  }

  static async handlePredictionRequest(interaction, cardType, model) {
    try {
      // Check if interaction is still valid before processing - be very conservative
      const interactionAge = Date.now() - interaction.createdTimestamp;
      if (interactionAge > 2500) { // 2.5 seconds for initial response
        console.log(`Prediction interaction too old (${interactionAge}ms), ignoring to prevent errors`);
        return;
      }

      // Only defer if not already deferred or replied
      if (!interaction.deferred && !interaction.replied) {
        try {
          await interaction.deferUpdate();
        } catch (error) {
          console.error("Failed to defer interaction:", error);
          return;
        }
      }

      const event = await this.getUpcomingEvent();
      if (!event) {
        try {
          await interaction.editReply({
            content: "No upcoming events found.",
            ephemeral: true,
          });
        } catch (error) {
          console.error("Failed to edit reply:", error);
        }
        return;
      }

      // Clean up any stale prediction sessions
      PredictionState.cleanup();

      // Check if predictions are already being generated for this event
      if (PredictionState.isPredictionRunning(event.event_id)) {
        console.log(`Predictions already being generated for event ${event.event_id}`);
        
        // Queue this request
        PredictionState.queuePredictionRequest(event.event_id, interaction);
        
        // Show waiting message
        const waitingEmbed = new EmbedBuilder()
          .setColor("#FFA500")
          .setTitle("⏳ Predictions Currently Being Generated")
          .setDescription([
            `Another user is already generating predictions for ${event.Event}.`,
            "",
            "**What's happening:**",
            "• Fight Genie is analyzing all fights for this event",
            "• This ensures everyone gets the same high-quality predictions",
            "• You'll receive the results automatically when ready",
            "",
            "Please wait while the analysis completes..."
          ].join("\n"))
          .setFooter({
            text: "Fight Genie - Universal prediction system active",
          });

        await interaction.editReply({ embeds: [waitingEmbed], components: [] });
        return;
      }

      // Check for valid stored predictions with improved validation
      const storedPredictions = await this.getStoredPredictionWithValidation(event.event_id, cardType, model);
      
      if (storedPredictions) {
        // We have valid stored predictions, display them
        await this.displayPredictions(interaction, storedPredictions, event, model, cardType);
        return;
      }

      // No valid stored predictions, need to generate new ones
      // Start prediction session
      const started = PredictionState.startPrediction(event.event_id, interaction.user.id, interaction.guild?.id);
      
      if (!started) {
        // This shouldn't happen due to our earlier check, but handle it just in case
        console.log("Failed to start prediction session - already running");
        return;
      }

      // Generate new predictions
      await this.generateNewPredictionsWithState(interaction, event, cardType, model);
      
    } catch (error) {
      console.error("Error handling prediction request:", error);
      
      // Clean up state on error
      const event = await this.getUpcomingEvent().catch(() => null);
      if (event) {
        PredictionState.endPrediction(event.event_id);
      }
      
      await interaction.editReply({
        content: "Error generating predictions. Please try again.",
        ephemeral: true,
      });
    }
  }

  static async getStoredPredictionWithValidation(eventId, cardType, model) {
    try {
      // Get stored predictions
      const storedPredictions = await this.getStoredPrediction(eventId, cardType, model);
      
      if (!storedPredictions || !storedPredictions.fights || storedPredictions.fights.length === 0) {
        console.log(`No stored predictions found for event ${eventId}, card ${cardType}, model ${model}`);
        return null;
      }
      
      console.log(`Found stored predictions for event ${eventId}, card ${cardType}, model ${model} with ${storedPredictions.fights.length} fights`);
      
      // Check if predictions are too old (older than 7 days) - more reasonable timeframe
      const results = await database.query(
        `SELECT created_at FROM stored_predictions 
         WHERE event_id = ? AND card_type = ? AND model_used = ?
         ORDER BY created_at DESC LIMIT 1`,
        [eventId, cardType, model]
      );
      
      if (results && results.length > 0) {
        const createdAt = new Date(results[0].created_at);
        const hoursOld = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60);
        
        // Only consider predictions stale if they're older than 7 days (168 hours)
        if (hoursOld > 168) {
          console.log(`Stored predictions are ${hoursOld.toFixed(1)} hours old (${(hoursOld/24).toFixed(1)} days), considering them stale`);
          return null;
        }
        
        console.log(`Stored predictions are ${hoursOld.toFixed(1)} hours old, still valid`);
      }
      
      // Get current event to validate it's for the same event
      const currentEvent = await this.getUpcomingEvent();
      if (!currentEvent || currentEvent.event_id !== eventId) {
        console.log(`Event ID mismatch: stored predictions for ${eventId}, current event is ${currentEvent?.event_id}`);
        return null;
      }
      
      // Basic validation: ensure predictions have required fields
      const validPredictions = storedPredictions.fights.every(prediction => 
        prediction.fighter1 && 
        prediction.fighter2 && 
        prediction.predictedWinner && 
        typeof prediction.confidence === 'number' &&
        prediction.method
      );
      
      if (!validPredictions) {
        console.log(`Stored predictions have invalid data structure, regenerating`);
        return null;
      }
      
      console.log(`Stored predictions validated successfully for event ${eventId}`);
      return storedPredictions;
    } catch (error) {
      console.error("Error validating stored predictions:", error);
      return null;
    }
  }

  static async generateNewPredictionsWithState(interaction, event, cardType, model) {
    try {
      // Generate the predictions
      await this.generateNewPredictions(interaction, event, cardType, model);
      
      // After successful generation, notify waiting users
      const nextRequest = PredictionState.endPrediction(event.event_id);
      
      if (nextRequest) {
        console.log(`Processing next queued request for event ${event.event_id}`);
        
        // Get the newly stored predictions
        const storedPredictions = await this.getStoredPrediction(event.event_id, cardType, model);
        
        if (storedPredictions) {
          try {
            await this.displayPredictions(nextRequest, storedPredictions, event, model, cardType);
          } catch (error) {
            console.error("Error sending predictions to queued user:", error);
          }
        }
      }
    } catch (error) {
      // Clean up state on error
      PredictionState.endPrediction(event.event_id);
      throw error;
    }
  }

  static async displayPredictions(interaction, predictions, event, model, cardType = "main") {
    try {
        // Add logging
        console.log("Displaying predictions:", {
            hasData: !!predictions,
            fights: predictions?.fights?.length || 0,
            model,
            cardType
        });

        // Count locks (high confidence picks)
        const locks = predictions.fights.filter(pred => pred.confidence >= 75);
        const lowConfidenceWarning = locks.length <= 1;

        // Create warning message based on card type
        let warningMessage;
        if (lowConfidenceWarning) {
            if (cardType === "main") {
                warningMessage = "⚠️ **PARLAY WARNING:** Only " + 
                    (locks.length === 0 ? "no" : "one") + 
                    " high-confidence pick found on the main card. Exercise extreme caution with parlays. " +
                    "Consider single bets or waiting for better opportunities.";
            } else {
                warningMessage = "⚠️ **BETTING CAUTION:** Limited high-confidence picks available on prelims. " +
                    "Higher variance expected. Consider reducing bet sizes or focusing on props.";
            }
        }

        const embed = this.createSplitPredictionEmbeds(predictions, event, model, cardType)[0];
        
        // Add warning to embed if necessary
        if (lowConfidenceWarning) {
            embed.addFields({
                name: "🚨 Risk Alert",
                value: warningMessage,
                inline: false
            });
        }

        const modelName = model === "gpt" ? "GPT" : "Claude";

        // Create two rows of buttons for better organization
        const mainButtonsRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`get_analysis_${event.event_id}`)
                .setLabel(`DM ${modelName} Full Analysis`)
                .setEmoji("📝")
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId(`market_analysis_${event.event_id}`)
                .setLabel(`${modelName} Market Intelligence`)
                .setEmoji("🎯")
                .setStyle(ButtonStyle.Success)
        );

        const secondaryButtonsRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`betting_analysis_${event.event_id}`)
                .setLabel(`${modelName} Parlays & Props`)
                .setEmoji("💰")
                .setStyle(lowConfidenceWarning ? ButtonStyle.Secondary : ButtonStyle.Primary), // Change style if low confidence
            new ButtonBuilder()
                .setCustomId(`show_event_${event.event_id}`)
                .setLabel("Back to Event")
                .setEmoji("↩️")
                .setStyle(ButtonStyle.Secondary)
        );

        await interaction.editReply({
            embeds: [embed],
            components: [mainButtonsRow, secondaryButtonsRow],
        });

        // If low confidence, send an additional ephemeral message
        if (lowConfidenceWarning) {
            setTimeout(async () => {
                try {
                    // Check if the interaction object has a followUp method
                    if (interaction.followUp) {
                        await interaction.followUp({
                            content: `${warningMessage}\n\n*This message is only visible to you.*`,
                            ephemeral: true
                        });
                    } else if (interaction.channel && interaction.user) {
                        // Alternative approach if followUp is not available
                        // This handles mock interactions created for commands like runallpredictions
                        console.log("Using alternative warning display method");
                        // Add warning to the main message instead
                        const updatedEmbed = EmbedBuilder.from(embed)
                            .setFooter({
                                text: `${modelName} Analysis • Fight Genie 1.1 • ${warningMessage}`,
                                iconURL: "https://upload.wikimedia.org/wikipedia/commons/thumb/9/92/UFC_Logo.svg/2560px-UFC_Logo.svg.png"
                            });
                        
                        await interaction.editReply({
                            embeds: [updatedEmbed],
                            components: [mainButtonsRow, secondaryButtonsRow]
                        });
                    }
                } catch (error) {
                    console.error("Error sending warning followup:", error);
                }
            }, 1000); // Small delay to ensure main message is sent first
        }

    } catch (error) {
        console.error("Error displaying predictions:", error);
        await interaction.editReply({
            content: "Error displaying predictions. Please try again.",
            ephemeral: true
        });
    }
}

  static createSplitPredictionEmbeds(
    predictions,
    event,
    model,
    cardType = "main"
  ) {
    const modelName = model.toLowerCase() === "gpt" ? "GPT" : "Claude";
    const modelEmoji = model === "gpt" ? "🧠" : "🤖";

    // Get high confidence picks
    const locks = predictions.fights.filter((pred) => pred.confidence >= 75);

    const embed = new EmbedBuilder()
      .setColor("#00ff00")
      .setTitle(`${modelEmoji} ${event.Event}`)
      .setDescription(
        [
          `📍 ${event.City}, ${event.Country}`,
          `📅 ${new Date(new Date(event.Date).getTime() + (24 * 60 * 60 * 1000)).toLocaleDateString()}`,
          "\n━━━━━━━━━━━━━━━━━━━━━━",
          cardType === "main"
            ? "📊 **MAIN CARD PREDICTIONS**\n"
            : "📊 **PRELIMINARY CARD PREDICTIONS**\n",
        ].join("\n")
      )
      .setThumbnail(
        "https://upload.wikimedia.org/wikipedia/commons/thumb/9/92/UFC_Logo.svg/2560px-UFC_Logo.svg.png"
      );
    // Add concise fight predictions
    predictions.fights.forEach((pred) => {
      const confidenceEmoji =
        pred.confidence >= 75 ? "🔒" : pred.confidence >= 60 ? "✅" : "⚖️";

      const methodEmoji = pred.method.includes("KO")
        ? "👊"
        : pred.method.includes("Sub")
          ? "🔄"
          : pred.method.includes("Dec")
            ? "⚖️"
            : "⚔️";

      embed.addFields({
        name: `${pred.fighter1} vs ${pred.fighter2}`,
        value: [
          `${confidenceEmoji} **${pred.predictedWinner}** (${pred.confidence}%)`,
          `${methodEmoji} ${pred.method}`,
          `▸ KO ${pred.probabilityBreakdown.ko_tko}% • Sub ${pred.probabilityBreakdown.submission}% • Dec ${pred.probabilityBreakdown.decision}%`,
        ].join("\n"),
        inline: false,
      });
    });

    // Add high confidence picks section after predictions
    if (locks.length > 0) {
      embed.addFields({
        name: "━━━━━━━━━━━━━━━━━━━━━━\n🔒 **HIGH CONFIDENCE PICKS**",
        value: locks
          .map(
            (l) => `▸ ${l.predictedWinner} (${l.confidence}%) by ${l.method}`
          )
          .join("\n"),
        inline: false,
      });
    }

    // Always add parlay recommendations - improved logic
    const parlayContent = this.generateSmartParlayRecommendations(predictions.fights);
    if (parlayContent) {
      embed.addFields({
        name: "━━━━━━━━━━━━━━━━━━━━━━\n💰 **RECOMMENDED PARLAYS**\n",
        value: parlayContent,
        inline: false,
      });
    }

    embed.setFooter({
      text: `${modelName} Analysis • Fight Genie 1.1 • Stats from UFCStats.com`,
      iconURL:
        "https://upload.wikimedia.org/wikipedia/commons/thumb/9/92/UFC_Logo.svg/2560px-UFC_Logo.svg.png",
    });

    return [embed];
  }

  static generateSmartParlayRecommendations(fights) {
    if (!fights || fights.length === 0) return "No fights available for parlay analysis.";

    // Sort fights by confidence
    const sortedFights = [...fights].sort((a, b) => b.confidence - a.confidence);
    
    const locks = sortedFights.filter(f => f.confidence >= 75);
    const highValue = sortedFights.filter(f => f.confidence >= 65);
    const decent = sortedFights.filter(f => f.confidence >= 55);
    
    let parlayText = [];

    // High Confidence Parlays (75%+)
    if (locks.length >= 2) {
      parlayText.push("🔒 **LOCK PARLAYS** (High Confidence):");
      for (let i = 0; i < Math.min(locks.length - 1, 3); i++) {
        const avgConf = ((locks[i].confidence + locks[i + 1].confidence) / 2).toFixed(1);
        parlayText.push(`• ${locks[i].predictedWinner} + ${locks[i + 1].predictedWinner}`);
        parlayText.push(`  └ Combined: ${avgConf}% confidence`);
      }
      
      // Triple lock if available
      if (locks.length >= 3) {
        const avgConf = ((locks[0].confidence + locks[1].confidence + locks[2].confidence) / 3).toFixed(1);
        parlayText.push(`• Triple Lock: ${locks[0].predictedWinner} + ${locks[1].predictedWinner} + ${locks[2].predictedWinner}`);
        parlayText.push(`  └ Combined: ${avgConf}% confidence`);
      }
      parlayText.push("");
    }

    // Value Parlays (65%+)
    if (highValue.length >= 2) {
      parlayText.push("✅ **VALUE PARLAYS** (Good Confidence):");
      const topTwo = highValue.slice(0, 2);
      const avgConf = ((topTwo[0].confidence + topTwo[1].confidence) / 2).toFixed(1);
      parlayText.push(`• ${topTwo[0].predictedWinner} + ${topTwo[1].predictedWinner}`);
      parlayText.push(`  └ Combined: ${avgConf}% confidence`);
      
      if (highValue.length >= 3) {
        const topThree = highValue.slice(0, 3);
        const avgConf = (topThree.reduce((sum, f) => sum + f.confidence, 0) / 3).toFixed(1);
        parlayText.push(`• ${topThree.map(f => f.predictedWinner).join(" + ")}`);
        parlayText.push(`  └ Combined: ${avgConf}% confidence`);
      }
      parlayText.push("");
    }

    // Method-Based Parlays
    const koFighters = sortedFights.filter(f => f.probabilityBreakdown?.ko_tko >= 50 && f.confidence >= 60);
    const subFighters = sortedFights.filter(f => f.probabilityBreakdown?.submission >= 35 && f.confidence >= 60);
    
    if (koFighters.length >= 2 || subFighters.length >= 2) {
      parlayText.push("👊 **METHOD PARLAYS**:");
      
      if (koFighters.length >= 2) {
        parlayText.push(`• ${koFighters[0].predictedWinner} + ${koFighters[1].predictedWinner} by KO/TKO`);
        parlayText.push(`  └ Finish probability parlay`);
      }
      
      if (subFighters.length >= 2) {
        parlayText.push(`• ${subFighters[0].predictedWinner} + ${subFighters[1].predictedWinner} by Submission`);
        parlayText.push(`  └ Grappling specialist parlay`);
      }
      parlayText.push("");
    }

    // Conservative Parlays (for when confidence is lower)
    if (locks.length < 2 && decent.length >= 2) {
      parlayText.push("⚖️ **CONSERVATIVE PARLAYS** (Moderate Risk):");
      const topTwo = decent.slice(0, 2);
      const avgConf = ((topTwo[0].confidence + topTwo[1].confidence) / 2).toFixed(1);
      parlayText.push(`• ${topTwo[0].predictedWinner} + ${topTwo[1].predictedWinner}`);
      parlayText.push(`  └ Combined: ${avgConf}% confidence`);
      parlayText.push(`  └ *Lower stakes recommended*`);
    }

    // If no good parlays available
    if (parlayText.length === 0) {
      parlayText.push("⚠️ **LIMITED PARLAY OPTIONS**");
      parlayText.push("Consider single bets or wait for better opportunities.");
      parlayText.push("");
      parlayText.push("**Best Single Bets:**");
      sortedFights.slice(0, 3).forEach(fight => {
        parlayText.push(`• ${fight.predictedWinner} (${fight.confidence}%)`);
      });
    }

    return parlayText.join("\n");
  }

  static splitAnalysis(fight) {
    const MAX_FIELD_LENGTH = 1000; // Safe limit below Discord's 1024
    const sections = [];

    // First part: Fighter names and prediction (guaranteed short enough)
    sections.push({
      name: '🥊 Fight',
      value: [
        `**${fight.fighter1} vs ${fight.fighter2}**`,
        `${this.getConfidenceEmoji(fight.confidence)} **Prediction:** ${fight.predictedWinner} (${fight.confidence}% confidence)`,
        `${this.getMethodEmoji(fight.method)} **Method:** ${fight.method}`
      ].join('\n'),
      inline: false
    });

    // Add probability breakdown (guaranteed short enough)
    sections.push({
      name: '📊 Probability',
      value: [
        `KO/TKO: ${fight.probabilityBreakdown?.ko_tko || 0}%`,
        `Submission: ${fight.probabilityBreakdown?.submission || 0}%`,
        `Decision: ${fight.probabilityBreakdown?.decision || 0}%`
      ].join('\n'),
      inline: true
    });

    // Split key factors into chunks if needed
    let currentFactors = '';
    let factorCount = 0;

    for (const factor of fight.keyFactors) {
      const factorText = `• ${factor}\n`;
      if (currentFactors.length + factorText.length > MAX_FIELD_LENGTH) {
        // Current chunk is full, push it and start a new one
        sections.push({
          name: factorCount === 0 ? '💡 Key Factors' : '💡 Factors (cont.)',
          value: currentFactors.trim(),
          inline: false
        });
        currentFactors = factorText;
        factorCount++;
      } else {
        currentFactors += factorText;
      }
    }

    // Push remaining factors if any
    if (currentFactors) {
      sections.push({
        name: factorCount === 0 ? '💡 Key Factors' : '💡 Factors (cont.)',
        value: currentFactors.trim(),
        inline: false
      });
    }

    // Split analysis into proper chunks
    const sentences = fight.reasoning.split('. ');
    let currentChunk = '';
    let chunkCount = 0;

    for (const sentence of sentences) {
      const nextSentence = sentence + (sentence.endsWith('.') ? '' : '.');

      // Check if adding next sentence would exceed limit
      if (currentChunk.length + nextSentence.length + 1 > MAX_FIELD_LENGTH) {
        // Push current chunk
        if (currentChunk) {
          sections.push({
            name: chunkCount === 0 ? '📝 Analysis' : '📝 Analysis (cont.)',
            value: currentChunk.trim(),
            inline: false
          });
          chunkCount++;
          currentChunk = nextSentence;
        }
      } else {
        currentChunk += ' ' + nextSentence;
      }
    }

    // Push final chunk if any
    if (currentChunk.trim()) {
      sections.push({
        name: chunkCount === 0 ? '📝 Analysis' : '📝 Analysis (cont.)',
        value: currentChunk.trim(),
        inline: false
      });
    }

    // Add separator (guaranteed short)
    sections.push({
      name: '\u200b',
      value: '═══════════',
      inline: false
    });

    return sections;
  }

  static getConfidenceEmoji(confidence) {
    return confidence >= 75 ? "🔒" :
      confidence >= 65 ? "✅" : "⚖️";
  }

  static getMethodEmoji(method) {
    return method.toLowerCase().includes("ko") ? "👊" :
      method.toLowerCase().includes("sub") ? "🔄" : "📋";
  }

  static async sendDetailedAnalysis(interaction, predictions, event, model) {
    try {
      console.log('Starting sendDetailedAnalysis:', {
        hasPredictions: !!predictions,
        hasFights: !!predictions?.fights,
        fightsCount: predictions?.fights?.length || 0,
        eventId: event.event_id,
        model: model
      });
      
      if (!predictions?.fights) {
        await interaction.editReply({
          content: "No prediction data available. Please generate predictions first.",
          ephemeral: true
        });
        return;
      }

      const modelName = model === "gpt" ? "GPT" : "Claude";
      const modelEmoji = model === "gpt" ? "🧠" : "🤖";

      // Update status message
      await interaction.editReply({
        content: "⏳ Preparing detailed analysis...",
        ephemeral: true
      });

      // Get predictions from database
      console.log('Fetching predictions from database...');
      const mainCardPredictions = await this.getStoredPrediction(event.event_id, "main", model);
      const prelimPredictions = await this.getStoredPrediction(event.event_id, "prelims", model);
      
      console.log('Predictions fetched:', {
        mainCard: mainCardPredictions ? mainCardPredictions.fights?.length : 0,
        prelims: prelimPredictions ? prelimPredictions.fights?.length : 0
      });

      // Create embeds for main card fights
      const mainCardEmbeds = [];
      let currentEmbed = new EmbedBuilder()
        .setColor("#0099ff")
        .setTitle(`${event.Event} - Detailed Analysis`)
        .setDescription([
          `*${modelEmoji} Detailed Analysis by ${modelName}*`,
         `📅 ${new Date(new Date(event.Date).getTime() + (24 * 60 * 60 * 1000)).toLocaleDateString()}`,
          '',
          '**MAIN CARD PREDICTIONS**',
          '═══════════════════════'
        ].join('\n'));

      let fieldCount = 0;
      const MAX_FIELDS = 25;

      // Helper function to create a new embed with proper header
      const createNewEmbed = (pageNumber, cardType) => {
        return new EmbedBuilder()
          .setColor("#0099ff")
          .setTitle(`${event.Event} - Detailed Analysis (Page ${pageNumber})`)
          .setDescription([
            `*${modelEmoji} Detailed Analysis by ${modelName} (Continued)*`,
            `📅 ${new Date(new Date(event.Date).getTime() + (24 * 60 * 60 * 1000)).toLocaleDateString()}`,
            '',
            cardType === 'main' ?
              '**MAIN CARD PREDICTIONS (Continued)**' :
              '**PRELIMINARY CARD PREDICTIONS**',
            '═══════════════════════'
          ].join('\n'));
      };

      // Process main card fights
      if (mainCardPredictions?.fights) {
        for (const fight of mainCardPredictions.fights) {
          const sections = this.splitAnalysis(fight);

          for (const section of sections) {
            if (fieldCount >= MAX_FIELDS) {
              mainCardEmbeds.push(currentEmbed);
              currentEmbed = createNewEmbed(mainCardEmbeds.length + 1, 'main');
              fieldCount = 0;
            }

            currentEmbed.addFields(section);
            fieldCount++;
          }
        }
        if (fieldCount > 0) {
          mainCardEmbeds.push(currentEmbed);
        }
      }

      // Create embeds for prelim fights
      const prelimEmbeds = [];
      if (prelimPredictions?.fights) {
        // Reset for prelims
        fieldCount = 0;
        currentEmbed = new EmbedBuilder()
          .setColor("#0099ff")
          .setTitle(`${event.Event} - Preliminary Card Analysis`)
          .setDescription([
            `*${modelEmoji} Detailed Analysis by ${modelName}*`,
           `📅 ${new Date(new Date(event.Date).getTime() + (24 * 60 * 60 * 1000)).toLocaleDateString()}`,
            '',
            '**PRELIMINARY CARD PREDICTIONS**',
            '═══════════════════════'
          ].join('\n'));

        for (const fight of prelimPredictions.fights) {
          const sections = this.splitAnalysis(fight);

          for (const section of sections) {
            if (fieldCount >= MAX_FIELDS) {
              prelimEmbeds.push(currentEmbed);
              currentEmbed = createNewEmbed(prelimEmbeds.length + 1, 'prelims');
              fieldCount = 0;
            }

            currentEmbed.addFields(section);
            fieldCount++;
          }
        }
        if (fieldCount > 0) {
          prelimEmbeds.push(currentEmbed);
        }
      }

      // Check if we have any embeds to send
      if (mainCardEmbeds.length === 0 && prelimEmbeds.length === 0) {
        console.log('No embeds created - no predictions available');
        await interaction.editReply({
          content: "❌ No predictions available to analyze. Please generate predictions first using the Main Card or Prelims buttons.",
          ephemeral: true
        });
        return;
      }

      // Send all embeds to user's DMs
      try {
        console.log(`Sending ${mainCardEmbeds.length} main card embeds and ${prelimEmbeds.length} prelim embeds to DMs`);
        
        // Send initial DM to test if DMs are open
        await interaction.user.send({
          content: `📊 **${event.Event} - Full Analysis**\n${modelEmoji} Generated by ${modelName}\n\nDetailed predictions below:`
        });
        
        // Send main card embeds
        for (let i = 0; i < mainCardEmbeds.length; i++) {
          console.log(`Sending main card embed ${i + 1}/${mainCardEmbeds.length}`);
          await interaction.user.send({ embeds: [mainCardEmbeds[i]] });
          // Add small delay to avoid rate limiting
          if (i < mainCardEmbeds.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        }

        // Send prelim embeds if they exist
        if (prelimEmbeds.length > 0) {
          for (let i = 0; i < prelimEmbeds.length; i++) {
            console.log(`Sending prelim embed ${i + 1}/${prelimEmbeds.length}`);
            await interaction.user.send({ embeds: [prelimEmbeds[i]] });
            // Add small delay to avoid rate limiting
            if (i < prelimEmbeds.length - 1) {
              await new Promise(resolve => setTimeout(resolve, 500));
            }
          }
        }

        // Send enhanced betting analysis using the new methods
        const allFights = [...(mainCardPredictions?.fights || []), ...(prelimPredictions?.fights || [])];
        if (allFights.length > 0) {
          const bettingAnalysisEmbed = new EmbedBuilder()
            .setColor("#ffd700")
            .setTitle(`💰 ${modelName} Betting Analysis`)
            .setDescription("Enhanced Parlay & Prop Recommendations");

          // Use the enhanced methods for comprehensive analysis
          const parlaySection = this.generateEnhancedParlayRecommendations(allFights);
          bettingAnalysisEmbed.addFields({
            name: "🎲 Parlay Recommendations",
            value: parlaySection,
            inline: false,
          });

          const propSection = this.generateEnhancedPropRecommendations(allFights);
          bettingAnalysisEmbed.addFields({
            name: "👊 Method & Round Props",
            value: propSection,
            inline: false,
          });

          const valuePlays = this.generateValuePlays(allFights);
          bettingAnalysisEmbed.addFields({
            name: "💎 Value Opportunities",
            value: valuePlays,
            inline: false,
          });

          await interaction.user.send({ embeds: [bettingAnalysisEmbed] });
        }

        // Confirm in channel
        await interaction.editReply({
          content: "✅ Detailed analysis has been sent to your DMs!",
          ephemeral: true
        });
      } catch (dmError) {
        if (dmError.code === 50007) {
          await interaction.editReply({
            content: "❌ Unable to send detailed analysis. Please make sure your DMs are open.",
            ephemeral: true
          });
        } else {
          throw dmError;
        }
      }
    } catch (error) {
      console.error("Error sending detailed analysis:", error);
      await interaction.editReply({
        content: "Error generating detailed analysis. Please try again.",
        ephemeral: true
      });
    }
  }
  
  static async handleBettingAnalysis(interaction, eventId) {
    try {
      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferUpdate();
      }

      const currentModel = ModelCommand.getCurrentModel(interaction?.guild?.id);
      
      // Get both main card and prelim predictions for comprehensive analysis
      const mainCardPredictions = await this.getStoredPrediction(eventId, "main", currentModel);
      const prelimPredictions = await this.getStoredPrediction(eventId, "prelims", currentModel);

      // Combine all available fights
      const allFights = [
        ...(mainCardPredictions?.fights || []),
        ...(prelimPredictions?.fights || [])
      ];

      if (!allFights || allFights.length === 0) {
        await interaction.editReply({
          content: "No predictions found. Please generate predictions first using the Main Card or Prelims buttons.",
          ephemeral: true,
        });
        return;
      }

      const modelName = currentModel === "gpt" ? "GPT" : "Claude";
      const modelEmoji = currentModel === "gpt" ? "🧠" : "🤖";

      const bettingEmbed = new EmbedBuilder()
        .setColor("#ffd700")
        .setTitle(`💰 ${modelName} Betting Analysis ${modelEmoji}`)
        .setDescription([
          "Enhanced Parlay & Prop Recommendations",
          `Analyzing ${allFights.length} fights from both cards`,
          ""
        ].join("\n"));

      // Generate comprehensive parlay recommendations
      const parlaySection = this.generateEnhancedParlayRecommendations(allFights);
      bettingEmbed.addFields({
        name: "🎲 Parlay Recommendations",
        value: parlaySection,
        inline: false,
      });

      // Generate comprehensive prop recommendations
      const propSection = this.generateEnhancedPropRecommendations(allFights);
      bettingEmbed.addFields({
        name: "👊 Method & Round Props",
        value: propSection,
        inline: false,
      });

      // Generate value plays
      const valuePlays = this.generateValuePlays(allFights);
      bettingEmbed.addFields({
        name: "💎 Value Opportunities",
        value: valuePlays,
        inline: false,
      });

      const navigationRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`predict_main_${currentModel}_${eventId}`)
          .setLabel("Back to Predictions")
          .setEmoji("📊")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`show_event_${eventId}`)
          .setLabel("Back to Event")
          .setEmoji("↩️")
          .setStyle(ButtonStyle.Success)
      );

      await interaction.editReply({
        embeds: [bettingEmbed],
        components: [navigationRow],
      });
    } catch (error) {
      console.error("Error handling betting analysis:", error);
      await interaction.editReply({
        content: "Error generating betting analysis. Please try again.",
        ephemeral: true,
      });
    }
  }

  static generateEnhancedParlayRecommendations(fights) {
    if (!fights || fights.length === 0) return "No fights available for parlay analysis.";

    // Sort fights by confidence
    const sortedFights = [...fights].sort((a, b) => b.confidence - a.confidence);
    
    const locks = sortedFights.filter(f => f.confidence >= 75);
    const highValue = sortedFights.filter(f => f.confidence >= 65);
    const decent = sortedFights.filter(f => f.confidence >= 55);
    
    let parlayText = [];

    // High Confidence Parlays (75%+)
    if (locks.length >= 2) {
      parlayText.push("🔒 **LOCK PARLAYS** (High Confidence):");
      for (let i = 0; i < Math.min(locks.length - 1, 2); i++) {
        const avgConf = ((locks[i].confidence + locks[i + 1].confidence) / 2).toFixed(1);
        parlayText.push(`• ${locks[i].predictedWinner} + ${locks[i + 1].predictedWinner}`);
        parlayText.push(`  └ Combined: ${avgConf}% confidence`);
      }
      
      // Triple lock if available
      if (locks.length >= 3) {
        const avgConf = ((locks[0].confidence + locks[1].confidence + locks[2].confidence) / 3).toFixed(1);
        parlayText.push(`• Triple Lock: ${locks[0].predictedWinner} + ${locks[1].predictedWinner} + ${locks[2].predictedWinner}`);
        parlayText.push(`  └ Combined: ${avgConf}% confidence`);
      }
      parlayText.push("");
    }

    // Value Parlays (65%+)
    if (highValue.length >= 2 && locks.length < 2) {
      parlayText.push("✅ **VALUE PARLAYS** (Good Confidence):");
      const topTwo = highValue.slice(0, 2);
      const avgConf = ((topTwo[0].confidence + topTwo[1].confidence) / 2).toFixed(1);
      parlayText.push(`• ${topTwo[0].predictedWinner} + ${topTwo[1].predictedWinner}`);
      parlayText.push(`  └ Combined: ${avgConf}% confidence`);
      parlayText.push("");
    }

    // Method-Based Parlays
    const koFighters = sortedFights.filter(f => f.probabilityBreakdown?.ko_tko >= 50 && f.confidence >= 60);
    const subFighters = sortedFights.filter(f => f.probabilityBreakdown?.submission >= 35 && f.confidence >= 60);
    
    if (koFighters.length >= 2 || subFighters.length >= 2) {
      parlayText.push("👊 **METHOD PARLAYS**:");
      
      if (koFighters.length >= 2) {
        parlayText.push(`• ${koFighters[0].predictedWinner} + ${koFighters[1].predictedWinner} by KO/TKO`);
        parlayText.push(`  └ Finish probability parlay`);
      }
      
      if (subFighters.length >= 2) {
        parlayText.push(`• ${subFighters[0].predictedWinner} + ${subFighters[1].predictedWinner} by Submission`);
        parlayText.push(`  └ Grappling specialist parlay`);
      }
      parlayText.push("");
    }

    // Conservative Parlays (for when confidence is lower)
    if (locks.length < 2 && decent.length >= 2) {
      parlayText.push("⚖️ **CONSERVATIVE PARLAYS** (Moderate Risk):");
      const topTwo = decent.slice(0, 2);
      const avgConf = ((topTwo[0].confidence + topTwo[1].confidence) / 2).toFixed(1);
      parlayText.push(`• ${topTwo[0].predictedWinner} + ${topTwo[1].predictedWinner}`);
      parlayText.push(`  └ Combined: ${avgConf}% confidence`);
      parlayText.push(`  └ *Lower stakes recommended*`);
      parlayText.push("");
    }

    // If no good parlays available
    if (parlayText.length === 0) {
      parlayText.push("⚠️ **LIMITED PARLAY OPTIONS**");
      parlayText.push("Consider single bets or wait for better opportunities.");
      parlayText.push("");
      parlayText.push("**Best Single Bets:**");
      sortedFights.slice(0, 3).forEach(fight => {
        parlayText.push(`• ${fight.predictedWinner} (${fight.confidence}%)`);
      });
    }

    return parlayText.join("\n");
  }

  static generateEnhancedPropRecommendations(fights) {
    if (!fights || fights.length === 0) return "No fights available for prop analysis.";

    const props = [];

    fights.forEach((fight) => {
      const { probabilityBreakdown, predictedWinner, fighter1, fighter2, confidence } = fight;
      if (!probabilityBreakdown) return;

      // Fight doesn't go to decision (high finish rate)
      const finishRate = probabilityBreakdown.ko_tko + probabilityBreakdown.submission;
      if (finishRate > 60) {
        props.push(`• ${fighter1} vs ${fighter2} doesn't reach decision (${finishRate}%)`);
      }

      // Method specific props for decent confidence
      if (confidence >= 60) {
        if (probabilityBreakdown.ko_tko >= 45) {
          props.push(`• ${predictedWinner} to win by KO/TKO (${probabilityBreakdown.ko_tko}%)`);
        }
        if (probabilityBreakdown.submission >= 30) {
          props.push(`• ${predictedWinner} to win by Submission (${probabilityBreakdown.submission}%)`);
        }
        if (probabilityBreakdown.decision >= 55) {
          props.push(`• ${predictedWinner} to win by Decision (${probabilityBreakdown.decision}%)`);
        }
      }

      // Round props for high finish probability
      if (probabilityBreakdown.ko_tko >= 50 && confidence >= 65) {
        props.push(`• ${predictedWinner} to win in Round 1-2 (High KO probability)`);
      }
    });

    // Add general props if specific ones are limited
    if (props.length < 3) {
      const highConfidenceFights = fights.filter(f => f.confidence >= 70);
      highConfidenceFights.forEach(fight => {
        props.push(`• ${fight.predictedWinner} to win (${fight.confidence}% confidence)`);
      });
    }

    return props.length > 0 ? props.join("\n") : "No prop opportunities identified at this time.";
  }

  static generateValuePlays(fights) {
    if (!fights || fights.length === 0) return "No fights available for value analysis.";

    const valuePlays = [];

    fights.forEach((fight) => {
      const { confidence, predictedWinner, probabilityBreakdown } = fight;

      if (confidence >= 60 && probabilityBreakdown) {
        const dominantMethod = this.getDominantMethod(probabilityBreakdown);
        if (dominantMethod) {
          valuePlays.push(`• ${predictedWinner} ${dominantMethod.description} (${dominantMethod.probability}%)`);
        }
      }
    });

    // Add straight bets for high confidence picks
    const highConfidence = fights.filter(f => f.confidence >= 70);
    highConfidence.forEach(fight => {
      valuePlays.push(`• ${fight.predictedWinner} straight bet (${fight.confidence}% confidence)`);
    });

    return valuePlays.length > 0
      ? valuePlays.join("\n") + "\n\n*Consider these for straight bets or parlay pieces*"
      : "No specific value plays identified at this time.";
  }

  static getDominantMethod(probabilityBreakdown) {
    const { ko_tko, submission, decision } = probabilityBreakdown;

    if (ko_tko > Math.max(submission, decision) && ko_tko >= 45) {
      return { description: "by KO/TKO", probability: ko_tko };
    }
    if (submission > Math.max(ko_tko, decision) && submission >= 30) {
      return { description: "by Submission", probability: submission };
    }
    if (decision > Math.max(ko_tko, submission) && decision >= 55) {
      return { description: "by Decision", probability: decision };
    }
    return null;
  }

  static formatBettingValue(value) {
    if (!value) return 'None available';
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) {
      return value.map(item => {
        if (typeof item === 'string') return `• ${item}`;
        if (typeof item === 'object') {
          const { prediction, reasoning, combination, opportunity } = item;
          if (prediction && reasoning)
            return `• ${prediction}\n  └ ${reasoning}`;
          if (combination)
            return `• ${combination.join(" + ")}\n  └ ${item.reasoning}`;
          if (opportunity)
            return `• ${opportunity}\n  └ ${item.reasoning}`;
          return Object.entries(item)
            .map(([key, val]) => `• ${key}: ${val}`)
            .join('\n');
        }
        return `• ${JSON.stringify(item)}`;
      }).join('\n');
    }
    if (typeof value === 'object') {
      return Object.entries(value)
        .map(([key, val]) => `• ${key}: ${val}`)
        .join('\n');
    }
    return String(value);
  }

  static async cleanupOldPredictions(daysToKeep = 30) {
    try {
      await database.query(
        `DELETE FROM stored_predictions
              WHERE created_at < datetime('now', '-' || ? || ' days')`,
        [daysToKeep]
      );
      console.log(`Cleaned up predictions older than ${daysToKeep} days`);
    } catch (error) {
      console.error("Error cleaning up old predictions:", error);
    }
  }

  static async storePredictions(eventId, cardType, model, predictions) {
    try {
      await database.query(
        `INSERT INTO stored_predictions (
                  event_id, card_type, model_used, prediction_data, created_at
              ) VALUES (?, ?, ?, ?, datetime('now'))`,
        [eventId, cardType, model, JSON.stringify(predictions)]
      );
      console.log(
        `Stored predictions for event ${eventId}, card type ${cardType}`
      );
    } catch (error) {
      console.error("Error storing predictions:", error);
      throw error;
    }
  }

  static async getStoredPrediction(eventId, cardType, model) {
    try {
      const results = await database.query(
        `SELECT prediction_data
              FROM stored_predictions
              WHERE event_id = ? AND card_type = ? AND model_used = ?
              ORDER BY created_at DESC LIMIT 1`,
        [eventId, cardType, model]
      );

      return results?.length > 0
        ? JSON.parse(results[0].prediction_data)
        : null;
    } catch (error) {
      console.error("Error getting stored prediction:", error);
      return null;
    }
  }

  static async getPredictionStats(model = null) {
    try {
      const baseQuery = `
        SELECT 
            model_used,
            COUNT(DISTINCT event_id) as events_predicted,
            COUNT(*) as total_predictions,
            MIN(created_at) as first_prediction,
            MAX(created_at) as last_prediction,
            AVG(json_extract(prediction_data, '$.accuracy')) as avg_accuracy
        FROM stored_predictions
    `;

      const query = model
        ? `${baseQuery} WHERE model_used = ? GROUP BY model_used`
        : `${baseQuery} GROUP BY model_used`;

      return await database.query(query, model ? [model] : []);
    } catch (error) {
      console.error("Error getting prediction stats:", error);
      return [];
    }
  }

  static async generateNewPredictions(interaction, event, cardType, model) {
    try {
        const loadingEmbed = new EmbedBuilder()
            .setColor("#ffff00")
            .setTitle("🤖 Fight Genie Analysis in Progress")
            .setDescription([
                `Analyzing ${cardType === "main" ? "Main Card" : "Preliminary Card"} fights for ${event.Event}`,
                "**Processing:**",
                "• Gathering fighter statistics and historical data",
                "• Analyzing style matchups and recent performance",
                "• Calculating win probabilities and confidence levels",
                "• Generating parlay and prop recommendations",
                "",
                `Using ${model.toUpperCase() === "GPT" ? "GPT" : "Claude"} for enhanced fight analysis...`
            ].join("\n"));

        await interaction.editReply({ embeds: [loadingEmbed] });

        // Get all fights and process them
        const allFights = await database.getEventFights(event.Event);
        const processedFights = await processEventFights(allFights);

        // Select the appropriate fights based on card type
        const fights = cardType === "main" 
            ? processedFights.mainCard 
            : processedFights.prelims;

        if (!fights || fights.length === 0) {
            throw new Error(`No fights found for ${cardType} card`);
        }

        // Cache odds for the fights
        await OddsAnalysis.cacheEventOdds(event.event_id, fights);

        console.log(`Processing ${fights.length} fights for ${cardType} card:`,
            fights.map(f => `${f.fighter1} vs ${f.fighter2}`));

        // Process fights in batches
        const maxBatchSize = 3;
        const predictions = [];
        let bettingAnalysis = null;
        let successfulPredictions = 0;

        for (let i = 0; i < fights.length; i += maxBatchSize) {
            const batch = fights.slice(i, i + maxBatchSize);
            console.log(`Processing batch ${Math.floor(i / maxBatchSize) + 1} of ${Math.ceil(fights.length / maxBatchSize)}`);

            try {
                const batchPredictions = await generateEnhancedPredictionsWithAI(batch, event, model);

                if (batchPredictions && Array.isArray(batchPredictions.fights)) {
                    predictions.push(...batchPredictions.fights);
                    successfulPredictions += batchPredictions.fights.length;

                    // Keep betting analysis from final batch
                    if (i + maxBatchSize >= fights.length) {
                        bettingAnalysis = batchPredictions.betting_analysis;
                    }
                }
            } catch (batchError) {
                console.error(`Error processing batch ${Math.floor(i / maxBatchSize) + 1}:`, batchError);
                continue; // Continue with next batch
            }

            // Add delay between batches
            if (i + maxBatchSize < fights.length) {
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }

        // Check if we have at least some valid predictions
        if (successfulPredictions === 0) {
            throw new Error("No valid predictions generated");
        }

        // Create prediction data structure with any valid predictions
        const predictionData = {
            fights: predictions,
            betting_analysis: bettingAnalysis || {
                upsets: "Unable to generate detailed analysis at this time.",
                parlays: "Unable to generate parlay suggestions at this time.",
                props: "Unable to generate prop bet suggestions at this time."
            }
        };

        // Store predictions in database
        await this.storePredictions(event.event_id, cardType, model, predictionData);

        // Display predictions, showing what we have even if incomplete
        await this.displayPredictions(interaction, predictionData, event, model, cardType);

        // If we didn't get predictions for all fights, add a notice
        if (successfulPredictions < fights.length) {
            const warningEmbed = new EmbedBuilder()
                .setColor("#FFA500")
                .setTitle("⚠️ Partial Predictions Generated")
                .setDescription(`Successfully generated predictions for ${successfulPredictions} out of ${fights.length} fights. Some fights may be missing from the analysis.`);

            await interaction.followUp({ embeds: [warningEmbed], ephemeral: true });
        }

    } catch (error) {
        console.error("Error generating new predictions:", error);

        const errorEmbed = new EmbedBuilder()
            .setColor("#ff0000")
            .setTitle("❌ Error Generating Predictions")
            .setDescription([
                "An error occurred while generating predictions.",
                "",
                "This can happen if:",
                "• Fighter data is missing or incomplete",
                "• The model is temporarily unavailable",
                "• There are connection issues",
                "",
                "Please try again in a few moments."
            ].join("\n"));

        await interaction.editReply({
            embeds: [errorEmbed],
            components: []
        });

        throw error;
    }
  }

  // Helper method to validate predictions
  static validatePredictions(predictions) {
    if (!predictions || !Array.isArray(predictions.fights)) {
      return false;
    }

    return predictions.fights.every(fight =>
      fight.fighter1 &&
      fight.fighter2 &&
      fight.predictedWinner &&
      typeof fight.confidence === 'number' &&
      fight.method &&
      fight.probabilityBreakdown
    );
  }
}

module.exports = PredictionHandler;
