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

class PredictionHandler {
  static async getUpcomingEvent() {
    try {
        // First try to get current event
        let event = await database.getCurrentEvent();
        
        // If no current event, get next upcoming
        if (!event) {
            event = await database.getUpcomingEvent();
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
        console.error("Error in getUpcomingEvent:", error.message);
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

async getCurrentEvent() {
    try {
        // Get current date in EST
        const estOptions = { timeZone: 'America/New_York' };
        const currentDateEST = new Date().toLocaleString('en-US', estOptions);
        const queryDate = new Date(currentDateEST).toISOString().slice(0, 10);

        console.log(`Looking for current event on ${queryDate} (EST)`);

        // First try to get today's event
        const todayEvent = await this.query(`
            SELECT DISTINCT 
                event_id, Date, Event, City, State, 
                Country, event_link, event_time
            FROM events 
            WHERE Date = ?
            LIMIT 1
        `, [queryDate]);

        if (todayEvent && todayEvent.length > 0) {
            const event = todayEvent[0];
            // If today's event exists, check if it's completed
            if (event.event_link) {
                const completed = await this.isEventCompleted(event.event_link);
                if (!completed) {
                    console.log(`Found current event: ${event.Event}`);
                    return event;
                }
            }
        }

        // If no current event or it's completed, get the next upcoming event
        const nextEvent = await this.query(`
            SELECT DISTINCT 
                event_id, Date, Event, City, State, 
                Country, event_link, event_time
            FROM events
            WHERE Date > ?
            ORDER BY Date ASC
            LIMIT 1
        `, [queryDate]);

        if (nextEvent?.length > 0) {
            console.log(`Found next event: ${nextEvent[0].Event}`);
            return nextEvent[0];
        }

        console.log('No current or upcoming events found');
        return null;
    } catch (error) {
        console.error('Error getting current event:', error);
        throw error;
    }
}

  static async handlePredictionRequest(interaction, cardType, model) {
    try {
      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferUpdate();
      }

      const event = await this.getUpcomingEvent();
      if (!event) {
        await interaction.editReply({
          content: "No upcoming events found.",
          ephemeral: true,
        });
        return;
      }

      // Enhanced loading message
      const loadingEmbed = new EmbedBuilder()
        .setColor("#ffff00")
        .setTitle("🤖 Fight Genie Analysis in Progress")
        .setDescription(
          [
            `Analyzing ${
              cardType === "main" ? "Main Card" : "Preliminary Card"
            } fights for ${event.Event}`,
            "**Processing:**",
            "• Gathering fighter statistics and historical data",
            "• Analyzing style matchups and recent performance",
            "• Calculating win probabilities and confidence levels",
            "• Generating parlay and prop recommendations",
            "",
            `Using ${
              model.toUpperCase() === "GPT" ? "GPT-4" : "Claude"
            } for enhanced fight analysis...`,
          ].join("\n")
        )
        .setFooter({
          text: "Please wait while Fight Genie processes the data...",
        });

      await interaction.editReply({ embeds: [loadingEmbed] });

      // Generate or retrieve predictions
      const storedPredictions = await this.getStoredPrediction(
        event.event_id,
        cardType,
        model
      );
      if (storedPredictions) {
        await this.displayPredictions(
          interaction,
          storedPredictions,
          event,
          model,
          cardType
        );
        return;
      }

      await this.generateNewPredictions(interaction, event, cardType, model);
    } catch (error) {
      console.error("Error handling prediction request:", error);
      await interaction.editReply({
        content: "Error generating predictions. Please try again.",
        ephemeral: true,
      });
    }
  }

  static async displayPredictions(
    interaction,
    predictions,
    event,
    model,
    cardType = "main"
  ) {
    try {
      const embed = this.createSplitPredictionEmbeds(
        predictions,
        event,
        model,
        cardType
      )[0];

      const optionsRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`get_analysis_${event.event_id}`)
          .setLabel("Get Full Analysis")
          .setEmoji("📝")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`betting_analysis_${event.event_id}`)
          .setLabel("Betting Analysis")
          .setEmoji("💰")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`show_event_${event.event_id}`)
          .setLabel("Back to Event")
          .setEmoji("↩️")
          .setStyle(ButtonStyle.Success)
      );

      await interaction.editReply({
        embeds: [embed],
        components: [optionsRow],
      });
    } catch (error) {
      console.error("Error displaying predictions:", error);
      await interaction.editReply({
        content: "Error displaying predictions. Please try again.",
        ephemeral: true,
      });
    }
  }

  static createSplitPredictionEmbeds(
    predictions,
    event,
    model,
    cardType = "main"
  ) {
    const modelName = model.toLowerCase() === "gpt" ? "GPT-4" : "Claude";
    const modelEmoji = model === "gpt" ? "🧠" : "🤖";

    // Get high confidence picks
    const locks = predictions.fights.filter((pred) => pred.confidence >= 70);

    const embed = new EmbedBuilder()
      .setColor("#00ff00")
      .setTitle(`${modelEmoji} ${event.Event}`)
      .setDescription(
        [
          `📍 ${event.City}, ${event.Country}`,
          `📅 ${new Date(event.Date).toLocaleDateString()}`,
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
        pred.confidence >= 70 ? "🔒" : pred.confidence >= 60 ? "✅" : "⚖️";

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

    // Add parlay recommendations if available
    if (predictions.betting_analysis?.parlays && locks.length >= 2) {
      const parlayContent = [];

      // Two-fight parlays
      if (locks.length >= 2) {
        parlayContent.push(
          `▸ ${locks[0].predictedWinner} + ${
            locks[1].predictedWinner
          }\n*Combined confidence: ${(
            (locks[0].confidence + locks[1].confidence) /
            2
          ).toFixed(1)}%*\n`
        );

        if (locks.length >= 3) {
          parlayContent.push(
            `▸ ${locks[1].predictedWinner} + ${
              locks[2].predictedWinner
            }\n*Combined confidence: ${(
              (locks[1].confidence + locks[2].confidence) /
              2
            ).toFixed(1)}%*\n`
          );
        }
      }

      // Three-fight parlay
      if (locks.length >= 3) {
        parlayContent.push(
          `▸ Triple Lock Parlay:\n${locks[0].predictedWinner} + ${
            locks[1].predictedWinner
          } + ${locks[2].predictedWinner}\n*Combined confidence: ${(
            (locks[0].confidence + locks[1].confidence + locks[2].confidence) /
            3
          ).toFixed(1)}%*`
        );
      }

      embed.addFields({
        name: "━━━━━━━━━━━━━━━━━━━━━━\n💰 **RECOMMENDED PARLAYS**\n",
        value: parlayContent.join("\n") + "\n",
        inline: false,
      });
    }

    embed.setFooter({
      text: `${modelName} Analysis • Fight Genie 1.0 • Stats from UFCStats.com`,
      iconURL:
        "https://upload.wikimedia.org/wikipedia/commons/thumb/9/92/UFC_Logo.svg/2560px-UFC_Logo.svg.png",
    });

    return [embed];
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
        if (!predictions?.fights) {
            await interaction.editReply({
                content: "No prediction data available. Please generate predictions first.",
                ephemeral: true
            });
            return;
        }

        const modelName = model === "gpt" ? "GPT-4" : "Claude";
        const modelEmoji = model === "gpt" ? "🧠" : "🤖";

        // Get predictions from database
        const mainCardPredictions = await this.getStoredPrediction(event.event_id, "main", model);
        const prelimPredictions = await this.getStoredPrediction(event.event_id, "prelims", model);

        // Create embeds for main card fights
        const mainCardEmbeds = [];
        let currentEmbed = new EmbedBuilder()
            .setColor("#0099ff")
            .setTitle(`${event.Event} - Detailed Analysis`)
            .setDescription([
                `*${modelEmoji} Detailed Analysis by ${modelName}*`,
                `📅 ${new Date(event.Date).toLocaleString()}`,
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
                    `📅 ${new Date(event.Date).toLocaleString()}`,
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
                    `📅 ${new Date(event.Date).toLocaleString()}`,
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

        // Send all embeds to user's DMs
        try {
            // Send main card embeds
            for (const embed of mainCardEmbeds) {
                await interaction.user.send({ embeds: [embed] });
            }
            
            // Send prelim embeds if they exist
            if (prelimEmbeds.length > 0) {
                for (const embed of prelimEmbeds) {
                    await interaction.user.send({ embeds: [embed] });
                }
            }

            // Send betting analysis as before
            const bettingAnalysis = this.createBettingAnalysisEmbed(predictions, event, modelName, modelEmoji);
            await interaction.user.send({ embeds: [bettingAnalysis] });
            
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

const currentModel = ModelCommand.getCurrentModel();
const predictions = await this.getStoredPrediction(
  eventId || interaction.message.id,
  "main",
  currentModel
);

if (!predictions || !predictions.fights) {
  await interaction.editReply({
    content: "No predictions found. Please generate predictions first.",
    ephemeral: true,
  });
  return;
}

const bettingEmbed = new EmbedBuilder()
  .setColor("#ffd700")
  .setTitle("💰 Betting Analysis 🧠")
  .setDescription("Fight Analysis and Betting Opportunities");

const locks = predictions.fights.filter((pred) => pred.confidence >= 70);

// Parlay Recommendations
const parlaySection = this.generateEnhancedParlayRecommendations(
  predictions.fights
);
if (parlaySection) {
  bettingEmbed.addFields({
    name: "🎲 Parlay Recommendations",
    value: parlaySection,
    inline: false,
  });
}

// Method Props
const propSection = this.generateEnhancedPropRecommendations(
  predictions.fights
);
if (propSection) {
  bettingEmbed.addFields({
    name: "👊 Method & Round Props",
    value: propSection,
    inline: false,
  });
}

// Value Plays
const valuePlays = this.generateValuePlays(predictions.fights);
if (valuePlays) {
  bettingEmbed.addFields({
    name: "💎 Value Opportunities",
    value: valuePlays,
    inline: false,
  });
}

const navigationRow = new ActionRowBuilder().addComponents(
  new ButtonBuilder()
    .setCustomId(`predict_main_${currentModel}_${eventId}`)
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
}static generateEnhancedParlayRecommendations(fights) {
  const locks = fights.filter((pred) => pred.confidence >= 70);
  const highValuePicks = fights.filter((pred) => pred.confidence >= 65);

  let parlayText = [];

  // 2-Fight Parlays
  if (locks.length >= 2) {
    parlayText.push("2-Fight Parlays:");
    // Generate all possible 2-fight combinations from locks
    for (let i = 0; i < locks.length - 1; i++) {
      parlayText.push(
        `• ${locks[i].predictedWinner} + ${
          locks[i + 1].predictedWinner
        }\n└ Method parlay: ${locks[i].method} + ${locks[i + 1].method}`
      );
    }
    parlayText.push("");
  }

  // 3-Fight Parlays
  if (highValuePicks.length >= 3) {
    parlayText.push("3-Fight Parlays:");
    const topThree = highValuePicks.slice(0, 3);
    parlayText.push(
      `• ${topThree
        .map((p) => p.predictedWinner)
        .join(" + ")}\n└ Combined confidence: ${(
        topThree.reduce((acc, p) => acc + p.confidence, 0) / 3
      ).toFixed(1)}%`
    );
    parlayText.push("");
  }

  // High-Value Combinations
  const koFighters = fights.filter(
    (f) => f.probabilityBreakdown?.ko_tko >= 55 && f.confidence >= 65
  );
  const subFighters = fights.filter(
    (f) => f.probabilityBreakdown?.submission >= 40 && f.confidence >= 65
  );

  if (koFighters.length >= 2 || subFighters.length >= 2) {
    parlayText.push("High-Value Combinations:");
    if (koFighters.length >= 2) {
      parlayText.push(
        `• ${koFighters[0].predictedWinner} + ${koFighters[1].predictedWinner} by KO/TKO\n└ High finish probability parlay`
      );
    }
    if (subFighters.length >= 2) {
      parlayText.push(
        `• ${subFighters[0].predictedWinner} + ${subFighters[1].predictedWinner} by Submission\n└ Grappling-focused parlay`
      );
    }
  }

  return parlayText.join("\n");
}

static generateEnhancedPropRecommendations(fights) {
  const props = [];

  fights.forEach((fight) => {
    const { probabilityBreakdown, predictedWinner, fighter1, fighter2 } = fight;
    if (!probabilityBreakdown) return;

    // Fight doesn't go to decision
    if (probabilityBreakdown.ko_tko + probabilityBreakdown.submission > 65) {
      props.push(
        `• ${fighter1} vs ${fighter2} doesn't reach decision (${probabilityBreakdown.ko_tko + probabilityBreakdown.submission}%)`
      );
    }

    // Method specific props for high confidence
    if (fight.confidence >= 65) {
      if (probabilityBreakdown.ko_tko >= 50) {
        props.push(
          `• ${predictedWinner} to win by KO/TKO (${probabilityBreakdown.ko_tko}%)`
        );
      }
      if (probabilityBreakdown.submission >= 40) {
        props.push(
          `• ${predictedWinner} to win by Submission (${probabilityBreakdown.submission}%)`
        );
      }
    }
  });

  return props.length > 0 ? props.join("\n") : null;
}

static generateValuePlays(fights) {
  const valuePlays = [];

  fights.forEach((fight) => {
    const { confidence, predictedWinner, probabilityBreakdown } = fight;

    if (confidence >= 65 && probabilityBreakdown) {
      const dominantMethod = this.getDominantMethod(probabilityBreakdown);
      if (dominantMethod) {
        valuePlays.push(
          `• ${predictedWinner} ${dominantMethod.description} (${dominantMethod.probability}%)`
        );
      }
    }
  });

  return valuePlays.length > 0
    ? valuePlays.join("\n") +
        "\n\n*Consider these for straight bets or parlay pieces*"
    : null;
}

static getDominantMethod(probabilityBreakdown) {
  const { ko_tko, submission, decision } = probabilityBreakdown;

  if (ko_tko > Math.max(submission, decision) && ko_tko >= 50) {
    return { description: "by KO/TKO", probability: ko_tko };
  }
  if (submission > Math.max(ko_tko, decision) && submission >= 40) {
    return { description: "by Submission", probability: submission };
  }
  if (decision > Math.max(ko_tko, submission) && decision >= 60) {
    return { description: "by Decision", probability: decision };
  }
  return null;
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
          .setDescription(
              [
                  `Analyzing ${cardType === "main" ? "Main Card" : "Preliminary Card"} fights for ${event.Event}`,
                  "**Processing:**",
                  "• Gathering fighter statistics and historical data",
                  "• Analyzing style matchups and recent performance",
                  "• Calculating win probabilities and confidence levels",
                  "• Generating parlay and prop recommendations",
                  "",
                  `Using ${model.toUpperCase() === "GPT" ? "GPT-4" : "Claude"} for enhanced fight analysis...`
              ].join("\n")
          );

      await interaction.editReply({ embeds: [loadingEmbed] });

      // Get fights based on card type
      const fights = cardType === "main"
          ? await this.getMainCardFights(event.Event)
          : await this.getPrelimFights(event.Event);

      if (!fights || fights.length === 0) {
          throw new Error(`No fights found for ${cardType} card`);
      }

      console.log(`Processing ${fights.length} fights for ${cardType} card:`, 
          fights.map(f => `${f.fighter1} vs ${f.fighter2}`));

      // Process fights in batches
      const maxBatchSize = 3;
      const predictions = [];
      let bettingAnalysis = null;

      for (let i = 0; i < fights.length; i += maxBatchSize) {
          const batch = fights.slice(i, i + maxBatchSize);
          console.log(`Processing batch ${Math.floor(i / maxBatchSize) + 1} of ${Math.ceil(fights.length / maxBatchSize)}`);

          try {
              const batchPredictions = await generateEnhancedPredictionsWithAI(batch, event, model);

              if (batchPredictions && Array.isArray(batchPredictions.fights)) {
                  predictions.push(...batchPredictions.fights);
                  
                  // Keep betting analysis from final batch
                  if (i + maxBatchSize >= fights.length) {
                      bettingAnalysis = batchPredictions.betting_analysis;
                  }
              } else {
                  console.error("Invalid batch predictions format:", batchPredictions);
              }
          } catch (batchError) {
              console.error(`Error processing batch ${Math.floor(i / maxBatchSize) + 1}:`, batchError);
          }

          // Add delay between batches
          if (i + maxBatchSize < fights.length) {
              await new Promise(resolve => setTimeout(resolve, 1000));
          }
      }

      // Validate we have predictions for all fights
      if (predictions.length === 0) {
          throw new Error("No valid predictions generated");
      }

      // Create prediction data structure
      const predictionData = {
          fights: predictions,
          betting_analysis: bettingAnalysis || {
              upsets: "Unable to generate detailed analysis at this time.",
              parlays: "Unable to generate parlay suggestions at this time.",
              method_props: "Unable to generate method props at this time.",
              round_props: "Unable to generate round props at this time.",
              special_props: "Unable to generate special props at this time."
          }
      };

      // Store predictions in database
      await this.storePredictions(event.event_id, cardType, model, predictionData);

      // Display predictions
      await this.displayPredictions(interaction, predictionData, event, model, cardType);

  } catch (error) {
      console.error("Error generating new predictions:", error);
      
      // Send error message to user
      const errorEmbed = new EmbedBuilder()
          .setColor("#ff0000")
          .setTitle("❌ Error Generating Predictions")
          .setDescription([
              "An error occurred while generating predictions.",
              "",
              "This can happen if:",
              "• Fighter data is missing or incomplete",
              "• The AI model is temporarily unavailable",
              "• There are connection issues",
              "",
              "Please try again in a few moments."
          ].join("\n"));

      await interaction.editReply({
          embeds: [errorEmbed],
          components: []
      });

      throw new Error("Failed to generate valid predictions");
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

// Helper method for storing predictions
static async storePredictions(eventId, cardType, model, predictions) {
  try {
      await database.query(
          `INSERT INTO stored_predictions (
              event_id, card_type, model_used, prediction_data, created_at
          ) VALUES (?, ?, ?, ?, datetime('now'))`,
          [eventId, cardType, model, JSON.stringify(predictions)]
      );
      console.log(`Stored predictions for event ${eventId}, card type ${cardType}`);
  } catch (error) {
      console.error("Error storing predictions:", error);
      throw error;
  }
}

// Helper method for main card fights
static async getMainCardFights(eventName) {
  const fights = await database.query(`
      SELECT 
          event_id,
          Event,
          Winner as fighter1,
          Loser as fighter2,
          WeightClass,
          is_main_card,
          Method
      FROM events 
      WHERE Event = ? 
      AND is_main_card = 1 
      ORDER BY event_id ASC
  `, [eventName]);

  return fights.map(fight => ({
      ...fight,
      fighter1: fight.fighter1?.trim() || fight.Winner?.trim(),
      fighter2: fight.fighter2?.trim() || fight.Loser?.trim(),
      WeightClass: fight.WeightClass || "Unknown",
      is_main_card: 1
  }));
}

// Helper method for prelim fights
static async getPrelimFights(eventName) {
  const fights = await database.query(`
      SELECT 
          event_id,
          Event,
          Winner as fighter1,
          Loser as fighter2,
          WeightClass,
          is_main_card,
          Method
      FROM events 
      WHERE Event = ? 
      AND is_main_card = 0 
      ORDER BY event_id ASC
  `, [eventName]);

  return fights.map(fight => ({
      ...fight,
      fighter1: fight.fighter1?.trim() || fight.Winner?.trim(),
      fighter2: fight.fighter2?.trim() || fight.Loser?.trim(),
      WeightClass: fight.WeightClass || "Unknown",
      is_main_card: 0
  }));
}

static async getMainCardFights(eventName) {
  try {
    const fights = await database.query(
      `
      SELECT 
          event_id,
          Event,
          Winner as fighter1,
          Loser as fighter2,
          WeightClass,
          is_main_card,
          Method
      FROM events 
      WHERE Event = ? 
      AND is_main_card = 1 
      ORDER BY event_id ASC`,
      [eventName]
    );

    return fights.map((fight) => ({
      ...fight,
      fighter1: fight.fighter1?.trim() || fight.Winner?.trim(),
      fighter2: fight.fighter2?.trim() || fight.Loser?.trim(),
      WeightClass: fight.WeightClass || "Unknown",
      is_main_card: 1,
    }));
  } catch (error) {
    console.error("Error getting main card fights:", error);
    return [];
  }
}

static async getPrelimFights(eventName) {
  try {
    const fights = await database.query(
      `
      SELECT 
          event_id,
          Event,
          Winner as fighter1,
          Loser as fighter2,
          WeightClass,
          is_main_card,
          Method
      FROM events 
      WHERE Event = ? 
      AND is_main_card = 0 
      ORDER BY event_id ASC`,
      [eventName]
    );

    return fights.map((fight) => ({
      ...fight,
      fighter1: fight.fighter1?.trim() || fight.Winner?.trim(),
      fighter2: fight.fighter2?.trim() || fight.Loser?.trim(),
      WeightClass: fight.WeightClass || "Unknown",
      is_main_card: 0,
    }));
  } catch (error) {
    console.error("Error getting prelim fights:", error);
    return [];
  }
}
}

module.exports = PredictionHandler;