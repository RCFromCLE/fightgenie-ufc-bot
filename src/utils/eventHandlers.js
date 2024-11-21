// eventHandlers.js

const {
  EmbedBuilder,
  ButtonBuilder,
  ActionRowBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} = require("discord.js");
const FighterStatsUtil = require("./fighterStats");
const StatsManager = require("./StatsManager");
const ModelCommand = require("../commands/ModelCommand");
const database = require("../database");
const FighterStats = require("./fighterStats");
const DataValidator = require("./DataValidator");
const PredictionHandler = require("./PredictionHandler");
const OddsAnalysis = require("./OddsAnalysis");
const CheckStatsCommand = require("../commands/CheckStatsCommand");

class EventHandlers {
  static async getCurrentEvent() {
    try {
      const event = await database.getCurrentEvent();
      return event;
    } catch (error) {
      console.error("Error getting current event:", error);
      throw error;
    }
  }

  static async getUpcomingEvent() {
    try {
      let event = await database.getCurrentEvent();

      if (!event) {
        event = await database.getUpcomingEvent();
      }

      if (!event) {
        throw new Error("No current or upcoming events found.");
      }

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

  static async cleanupFightCard(fights) {
    const fighterCounts = new Map();
    fights.forEach((fight) => {
      fighterCounts.set(
        fight.fighter1,
        (fighterCounts.get(fight.fighter1) || 0) + 1
      );
      fighterCounts.set(
        fight.fighter2,
        (fighterCounts.get(fight.fighter2) || 0) + 1
      );
    });

    // Log duplicate fighters
    for (const [fighter, count] of fighterCounts) {
      if (count > 1) {
        console.log(
          `Warning: ${fighter} appears ${count} times in the fight card`
        );
      }
    }

    // Remove duplicates while preserving order
    const seenFighters = new Set();
    const cleanedFights = fights.filter((fight) => {
      if (
        seenFighters.has(fight.fighter1) ||
        seenFighters.has(fight.fighter2)
      ) {
        return false;
      }
      seenFighters.add(fight.fighter1);
      seenFighters.add(fight.fighter2);
      return true;
    });

    // Split into main card and prelims
    const mainCard = cleanedFights
      .slice(0, 5)
      .map((fight) => ({ ...fight, is_main_card: 1 }));
    const prelims = cleanedFights
      .slice(5)
      .map((fight) => ({ ...fight, is_main_card: 0 }));

    console.log(
      `Cleaned fight card: ${mainCard.length} main card fights, ${prelims.length} preliminary fights`
    );
    return [...mainCard, ...prelims];
  }

  static async getWeightClass(fighter1, fighter2) {
    try {
      const [fighter1Stats, fighter2Stats] = await Promise.all([
        FighterStatsUtil.getFighterStats(fighter1),
        FighterStatsUtil.getFighterStats(fighter2),
      ]);

      // Check recent fight weight class
      const recentFight = await database.query(
        `
                SELECT WeightClass
                FROM events
                WHERE ((Winner = ? AND Loser = ?) OR (Winner = ? AND Loser = ?))
                AND WeightClass IS NOT NULL
                AND WeightClass != 'Unknown'
                ORDER BY Date DESC LIMIT 1
                `,
        [fighter1, fighter2, fighter2, fighter1]
      );

      if (recentFight?.[0]?.WeightClass) {
        return recentFight[0].WeightClass;
      }

      // Check each fighter's most recent weight class
      const [fighter1Recent, fighter2Recent] = await Promise.all([
        database.query(
          `
                    SELECT WeightClass
                    FROM events
                    WHERE (Winner = ? OR Loser = ?)
                    AND WeightClass IS NOT NULL
                    AND WeightClass != 'Unknown'
                    ORDER BY Date DESC LIMIT 1
                    `,
          [fighter1, fighter1]
        ),
        database.query(
          `
                    SELECT WeightClass
                    FROM events
                    WHERE (Winner = ? OR Loser = ?)
                    AND WeightClass IS NOT NULL
                    AND WeightClass != 'Unknown'
                    ORDER BY Date DESC LIMIT 1
                    `,
          [fighter2, fighter2]
        ),
      ]);

      if (fighter1Recent?.[0]?.WeightClass)
        return fighter1Recent[0].WeightClass;
      if (fighter2Recent?.[0]?.WeightClass)
        return fighter2Recent[0].WeightClass;

      // Determine from fighter stats if no fight history
      const weight1 = StatsManager.parseWeight(fighter1Stats?.Weight);
      const weight2 = StatsManager.parseWeight(fighter2Stats?.Weight);
      const maxWeight = Math.max(weight1, weight2);
      const isWomens = await StatsManager.isWomensDivision(fighter1, fighter2);

      return StatsManager.determineWeightClassFromWeight(maxWeight, isWomens);
    } catch (error) {
      console.error("Error getting weight class:", error);
      return "Weight Class TBD";
    }
  }

  static async handleShowFighterDataStatus(interaction) {
    try {
        // Ensure interaction is acknowledged
        if (!interaction.deferred && !interaction.replied) {
            await interaction.deferReply({ ephemeral: true });
        }

        const event = await this.getUpcomingEvent();
        if (!event) {
            await interaction.editReply({ content: "No upcoming events found." });
            return;
        }

        const fights = await database.getEventFights(event.Event);
        if (!fights || fights.length === 0) {
            await interaction.editReply({
                content: "No fights found for the event.",
            });
            return;
        }

        // Use DataValidator instead of FighterStats
        const { embed: dataQualityEmbed } = await DataValidator.createStatsReportEmbed(event, fights);

        await interaction.editReply({ 
            embeds: [dataQualityEmbed] 
        });

    } catch (error) {
        console.error("Error fetching fighter data quality status:", error);
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({
                content: "An error occurred while fetching data.",
                ephemeral: true
            });
        } else {
            await interaction.followUp({
                content: "An error occurred while fetching data.",
                ephemeral: true
            });
        }
    }
}

static async createEventEmbed(event, showPrelims = false) {
    try {
        let fights = await database.getEventFights(event.Event);
        if (!fights || !Array.isArray(fights)) {
            throw new Error("No fights data available");
        }

        fights = await this.cleanupFightCard(fights);
        console.log(`Total fights after cleanup: ${fights.length}`);

        // Split fights into main card and prelims
        const mainCard = fights.filter(f => f.is_main_card === 1);
        const prelims = fights.filter(f => f.is_main_card === 0);

        // Create base embed
        const embed = new EmbedBuilder()
            .setColor("#0099ff")
            .setTitle(`🥊 UFC Fight Night: ${mainCard[0]?.fighter1 || ''} vs. ${mainCard[0]?.fighter2 || ''}`)
            .setAuthor({ 
                name: 'Fight Genie',
                iconURL: 'attachment://FightGenie_Logo_1.PNG'
            })
            .setDescription([
                `📅 ${new Date(event.Date).toLocaleString('en-US', { 
                    month: 'long',
                    day: 'numeric',
                    year: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                    timeZoneName: 'short',
                    timeZone: 'America/New_York'
                })}`,
                `📍 ${event.City}, ${event.Country}\n`,
                '💡 Records shown are UFC fights only.',
                '📊 Data from: ufcstats.com\n',
                '━━━━━━━━━━━━━━━━━━━━━━\n',
                '🎯 **MAIN CARD**\n'
            ].join('\n'))
            .setThumbnail("attachment://FightGenie_Logo_1.PNG");

        // Add main card fights
        for (const fight of mainCard) {
            const [fighter1Stats, fighter2Stats, fighter1Record, fighter2Record] = await Promise.all([
                FighterStats.getFighterStats(fight.fighter1),
                FighterStats.getFighterStats(fight.fighter2),
                this.getRecord(fight.fighter1),
                this.getRecord(fight.fighter2)
            ]);

            embed.addFields({
                name: `\n${fight.WeightClass || 'Weight Class TBD'}`,
                value: [
                    `👊 **${fight.fighter1}** (${fighter1Record})`,
                    `${fighter1Stats?.Stance || 'Orthodox'} | ${fighter1Stats?.Reach || '??'}" reach | ${this.calculateAge(fighter1Stats?.DOB) || '??'} yrs`,
                    '⚔️',
                    `**${fight.fighter2}** (${fighter2Record})`,
                    `${fighter2Stats?.Stance || 'Orthodox'} | ${fighter2Stats?.Reach || '??'}" reach | ${this.calculateAge(fighter2Stats?.DOB) || '??'} yrs\n`
                ].join('\n'),
                inline: false
            });
        }

        // Add prelims if requested
        if (showPrelims && prelims.length > 0) {
            embed.addFields({
                name: '\n━━━━━━━━━━━━━━━━━━━━━━\n🥊 **PRELIMINARY CARD**\n',
                value: '\u200b',  // Zero-width space for spacing
                inline: false
            });

            for (const fight of prelims) {
                const [fighter1Stats, fighter2Stats, fighter1Record, fighter2Record] = await Promise.all([
                    FighterStats.getFighterStats(fight.fighter1),
                    FighterStats.getFighterStats(fight.fighter2),
                    this.getRecord(fight.fighter1),
                    this.getRecord(fight.fighter2)
                ]);

                embed.addFields({
                    name: fight.WeightClass || 'Weight Class TBD',
                    value: [
                        `👊 **${fight.fighter1}** (${fighter1Record})`,
                        `${fighter1Stats?.Stance || 'Orthodox'} | ${fighter1Stats?.Reach || '??'}" reach | ${this.calculateAge(fighter1Stats?.DOB) || '??'} yrs`,
                        '⚔️',
                        `**${fight.fighter2}** (${fighter2Record})`,
                        `${fighter2Stats?.Stance || 'Orthodox'} | ${fighter2Stats?.Reach || '??'}" reach | ${this.calculateAge(fighter2Stats?.DOB) || '??'} yrs\n`
                    ].join('\n'),
                    inline: false
                });
            }
        }

        // Create navigation buttons
        const components = await this.createNavigationButtons(event, showPrelims, fights);

        // Return with file attachment for the logo
        return { 
            files: [{
                attachment: './src/images/FightGenie_Logo_1.PNG',
                name: 'FightGenie_Logo_1.PNG'
            }],
            embeds: [embed], 
            components 
        };
    } catch (error) {
        console.error("Error creating event embed:", error);
        throw error;
    }
}

// Keep the original record-fetching logic
static async getRecord(fighterName) {
    try {
        const [wins, losses, draws] = await Promise.all([
            database.query(
                "SELECT COUNT(*) as count FROM events WHERE Winner = ?",
                [fighterName]
            ),
            database.query(
                "SELECT COUNT(*) as count FROM events WHERE Loser = ?",
                [fighterName]
            ),
            database.query(
                'SELECT COUNT(*) as count FROM events WHERE (Winner = ? OR Loser = ?) AND Method LIKE "%Draw%"',
                [fighterName, fighterName]
            )
        ]);

        return `${wins[0]?.count || 0}-${losses[0]?.count || 0}-${draws[0]?.count || 0}`;
    } catch (error) {
        console.error(`Error getting record for ${fighterName}:`, error);
        return "0-0-0";
    }
}

static calculateAge(dob) {
    if (!dob) return null;
    const birthDate = new Date(dob);
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const m = today.getMonth() - birthDate.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
        age--;
    }
    return age;
}

static async getRecord(fighterName) {
    try {
        const [wins, losses, draws] = await Promise.all([
            database.query(
                "SELECT COUNT(*) as count FROM events WHERE Winner = ?",
                [fighterName]
            ),
            database.query(
                "SELECT COUNT(*) as count FROM events WHERE Loser = ?",
                [fighterName]
            ),
            database.query(
                'SELECT COUNT(*) as count FROM events WHERE (Winner = ? OR Loser = ?) AND Method LIKE "%Draw%"',
                [fighterName, fighterName]
            )
        ]);

        return `${wins[0]?.count || 0}-${losses[0]?.count || 0}-${draws[0]?.count || 0}`;
    } catch (error) {
        console.error(`Error getting record for ${fighterName}:`, error);
        return "0-0-0";
    }
}

static calculateAge(dob) {
    if (!dob) return null;
    const birthDate = new Date(dob);
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const m = today.getMonth() - birthDate.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
        age--;
    }
    return age;
}

  static async createFightEmbeds(event, mainCard, prelims, showPrelims) {
    const embeds = [];
    let currentEmbed = this.createBaseEmbed(event);

    try {
      if (mainCard.length > 0) {
        currentEmbed.addFields({
          name: "🎯 MAIN CARD",
          value: "───────────────",
          inline: false,
        });

        for (const fight of mainCard) {
          const [fighter1Stats, fighter2Stats] = await Promise.all([
            FighterStats.getFighterStats(fight.fighter1),
            FighterStats.getFighterStats(fight.fighter2),
          ]);

          const displayValue = await StatsManager.formatFightDisplay(
            fight,
            fighter1Stats,
            fighter2Stats
          );
          if (!displayValue) continue;

          currentEmbed.addFields({
            name: fight.WeightClass || "Weight Class TBD",
            value: `👊 **${fight.fighter1} vs ${fight.fighter2}**\n${displayValue}`,
            inline: false,
          });

          if (currentEmbed.data.fields.length === 25) {
            embeds.push(currentEmbed);
            currentEmbed = this.createBaseEmbed(event);
          }
        }
      }

      if (showPrelims && prelims.length > 0) {
        currentEmbed.addFields({
          name: "🥊 PRELIMINARY CARD",
          value: "───────────────",
          inline: false,
        });

        for (const fight of prelims) {
          const [fighter1Stats, fighter2Stats] = await Promise.all([
            FighterStats.getFighterStats(fight.fighter1),
            FighterStats.getFighterStats(fight.fighter2),
          ]);

          const displayValue = await StatsManager.formatFightDisplay(
            fight,
            fighter1Stats,
            fighter2Stats
          );
          if (!displayValue) continue;

          currentEmbed.addFields({
            name: fight.WeightClass || "Weight Class TBD",
            value: `👊 **${fight.fighter1} vs ${fight.fighter2}**\n${displayValue}`,
            inline: false,
          });

          if (currentEmbed.data.fields.length === 25) {
            embeds.push(currentEmbed);
            currentEmbed = this.createBaseEmbed(event);
          }
        }
      }

      if (currentEmbed.data.fields.length > 0) {
        embeds.push(currentEmbed);
      }

      return embeds;
    } catch (error) {
      console.error("Error creating fight embeds:", error);
      currentEmbed.setDescription(
        "Error loading fight details. Please try again."
      );
      embeds.push(currentEmbed);
      return embeds;
    }
  }

  static createBaseEmbed(event) {
    const eventDate = new Date(event.Date);
    const estTime = eventDate.toLocaleString("en-US", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "short",
    });

    return new EmbedBuilder()
      .setColor("#0099ff")
      .setTitle(`🥊 ${event.Event}`)
      .setDescription(
        `📅 ${estTime}\n📍 ${event.City}${
          event.State ? `, ${event.State}` : ""
        }, ${
          event.Country
        }\n\n💡 Records shown are UFC fights only.\nData from: ufcstats.com`
      )
      .setThumbnail(
        "https://upload.wikimedia.org/wikipedia/commons/thumb/9/92/UFC_Logo.svg/2560px-UFC_Logo.svg.png"
      );
  }

  static async createNavigationButtons(event, showPrelims, fights, guildId) {
    const currentModel = ModelCommand.getCurrentModel() || "gpt";
    const hasAccess = await database.verifyAccess(guildId); // Use guildId here
    const components = [];

    // First row with main action buttons
    const buttonRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`toggle_prelims_${event.event_id || "latest"}`)
        .setLabel(showPrelims ? "Hide Prelims" : "Show Prelims")
        .setEmoji("👁️")
        .setStyle(ButtonStyle.Success)
    );

    // Add buttons based on access
    if (hasAccess) {
      buttonRow.addComponents(
        new ButtonBuilder()
          .setCustomId(
            `predict_main_${currentModel}_${event.event_id || "latest"}`
          )
          .setLabel("Main Card Predictions")
          .setEmoji("🎯")
          .setStyle(ButtonStyle.Primary)
      );
    } else {
      buttonRow.addComponents(
        new ButtonBuilder()
          .setCustomId("buy_access")
          .setLabel("Get Fight Genie Access")
          .setEmoji("🌟")
          .setStyle(ButtonStyle.Primary)
      );
    }

    components.push(buttonRow);

    // Add fighter selection dropdowns only if access is granted
    if (hasAccess) {
      const mainCardFighters = fights
        .filter((f) => f.is_main_card === 1)
        .flatMap((f) => [f.fighter1, f.fighter2])
        .filter(Boolean);

      const prelimFighters = fights
        .filter((f) => f.is_main_card === 0)
        .flatMap((f) => [f.fighter1, f.fighter2])
        .filter(Boolean);

      const fighterOptions = [
        ...mainCardFighters.map((fighter) => ({
          label: fighter,
          value: `fighter:${fighter}`,
          emoji: "👤",
        })),
        ...prelimFighters.map((fighter) => ({
          label: fighter,
          value: `fighter:${fighter}`,
          emoji: "👤",
        })),
      ];

      const fighterSelect = new StringSelectMenuBuilder()
        .setCustomId(`fighter_stats_${event.event_id}`)
        .setPlaceholder("Select fighter to view stats")
        .setOptions(fighterOptions);

      components.push(new ActionRowBuilder().addComponents(fighterSelect));
    }

    return components;
  }

  static async formatFightDisplay(fight, oddsData) {
    try {
      const [fighter1Stats, fighter2Stats] = await Promise.all([
        FighterStats.getFighterStats(fight.fighter1),
        FighterStats.getFighterStats(fight.fighter2),
      ]);

      // Get FanDuel odds for this fight
      const fightOdds = OddsAnalysis.getFightOdds(fight, oddsData, "fanduel");

      // Start with basic fight info
      let displayValue = await StatsManager.formatFightDisplay(
        fight,
        fighter1Stats,
        fighter2Stats
      );

      // Add odds if available
      if (fightOdds?.fighter1 && fightOdds?.fighter2) {
        displayValue += `\n\n📈 FanDuel Odds:\n${
          fight.fighter1
        }: ${OddsAnalysis.formatAmericanOdds(fightOdds.fighter1.price)}\n${
          fight.fighter2
        }: ${OddsAnalysis.formatAmericanOdds(fightOdds.fighter2.price)}`;
      }

      return displayValue;
    } catch (error) {
      console.error("Error formatting fight display:", error);
      return null;
    }
  }

  static async handleButtonInteraction(interaction) {
    try {
        if (!interaction.deferred && !interaction.replied) {
            await interaction.deferUpdate();
        }

        const [action, ...args] = interaction.customId.split("_");
        const event = await this.getUpcomingEvent();
        
        if (!event) {
            await interaction.followUp({
                content: "No upcoming events found.",
                ephemeral: true
            });
            return;
        }

        const currentModel = ModelCommand.getCurrentModel();

        switch (action) {
            case "prev":
            case "next": {
                const predictions = await PredictionHandler.getStoredPrediction(
                    event.event_id,
                    "main",
                    currentModel
                );

                if (!predictions) {
                    await interaction.followUp({
                        content: "No predictions found. Please generate predictions first.",
                        ephemeral: true
                    });
                    return;
                }

                // Get current page from embed description
                let currentPage = 0;
                if (interaction.message?.embeds[0]?.description) {
                    const match = interaction.message.embeds[0].description.match(/Page (\d+)/);
                    if (match) {
                        currentPage = parseInt(match[1]) - 1;
                    }
                }

                // Update page based on action
                if (action === "next") currentPage++;
                if (action === "prev") currentPage--;

                await PredictionHandler.displayPredictions(
                    interaction,
                    predictions,
                    event,
                    currentModel,
                    currentPage
                );
                break;
            }

            case "analysis": {
                const predictions = await PredictionHandler.getStoredPrediction(
                    event.event_id,
                    "main",
                    currentModel
                );

                if (!predictions) {
                    await interaction.followUp({
                        content: "No predictions found. Please generate predictions first.",
                        ephemeral: true
                    });
                    return;
                }

                await PredictionHandler.sendDetailedAnalysis(
                    interaction,
                    predictions,
                    event,
                    currentModel
                );
                break;
            }

            case "get": {
                if (args[0] === "analysis") {
                    const predictions = await PredictionHandler.getStoredPrediction(
                        event.event_id,
                        "main",
                        currentModel
                    );

                    if (!predictions) {
                        await interaction.followUp({
                            content: "No predictions found. Please generate predictions first.",
                            ephemeral: true
                        });
                        return;
                    }

                    await PredictionHandler.sendDetailedAnalysis(
                        interaction,
                        event.event_id
                    );
                }
                break;
            }

            case "betting": {
                if (args[0] === "analysis") {
                    await PredictionHandler.displayBettingAnalysis(interaction, event.event_id);
                }
                break;
            }

            case "show": {
                if (args[0] === "event") {
                    await PredictCommand.handleShowEvent(interaction);
                }
                break;
            }

            case "predict": {
                const [cardType, model, eventId] = args;
                await PredictionHandler.handlePredictionRequest(
                    interaction,
                    cardType,
                    model,
                    eventId
                );
                break;
            }

            case "toggle": {
                if (args[0] === "prelims") {
                    await PredictCommand.handlePrelimToggle(interaction);
                }
                break;
            }

            default:
                await interaction.followUp({
                    content: "Unknown button action.",
                    ephemeral: true
                });
        }
    } catch (error) {
        console.error("Error handling button interaction:", error);
        await interaction.followUp({
            content: "Error processing button interaction. Please try again.",
            ephemeral: true
        });
    }
}

  static async createNavigationButtons(event, showPrelims, fights) {
    const currentModel = ModelCommand.getCurrentModel() || "gpt";
    const components = [];

    // First row with main action buttons
    const buttonRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`toggle_prelims_${event.event_id || "latest"}`)
        .setLabel(showPrelims ? "Hide Prelims" : "Show Prelims")
        .setEmoji("👁️")
        .setStyle(ButtonStyle.Success)
    );

    // Only add prediction button if server has access

    buttonRow.addComponents(
      new ButtonBuilder()
        .setCustomId(
          `predict_main_${currentModel}_${event.event_id || "latest"}`
        )
        .setLabel("Main Card Predictions")
        .setEmoji("🎯")
        .setStyle(ButtonStyle.Primary)
    );

    components.push(buttonRow);

    // Get main card fighters
    const mainCardFighters = fights
      .filter((f) => f.is_main_card === 1)
      .flatMap((f) => [f.fighter1, f.fighter2])
      .filter(Boolean);

    // Get prelim fighters
    const prelimFighters = fights
      .filter((f) => f.is_main_card === 0)
      .flatMap((f) => [f.fighter1, f.fighter2])
      .filter(Boolean);

    // Create main card dropdown options
    const mainCardOptions = [
      {
        label: "View All Fighter Data Status",
        value: "all_data_status",
        emoji: "📊",
      },
      ...mainCardFighters.map((fighter) => ({
        label: fighter,
        value: `fighter:${fighter}`,
        emoji: "👤",
      })),
    ];

    // Create prelims dropdown options
    const prelimOptions = [
      {
        label: "View All Fighter Data Status",
        value: "all_data_status",
        emoji: "📊",
      },
      ...prelimFighters.map((fighter) => ({
        label: fighter,
        value: `fighter:${fighter}`,
        emoji: "👤",
      })),
    ];

    // Create main card select menu
    const mainCardSelect = new StringSelectMenuBuilder()
      .setCustomId(`fighter_stats_main_${event.event_id}`)
      .setPlaceholder("Main Card Fighter Stats")
      .setMinValues(1)
      .setMaxValues(1)
      .setOptions(mainCardOptions);

    // Create prelims select menu
    const prelimSelect = new StringSelectMenuBuilder()
      .setCustomId(`fighter_stats_prelims_${event.event_id}`)
      .setPlaceholder("Preliminary Card Fighter Stats")
      .setMinValues(1)
      .setMaxValues(1)
      .setOptions(prelimOptions);

    // Add main card select menu row
    components.push(new ActionRowBuilder().addComponents(mainCardSelect));

    // Add prelims select menu row if showing prelims
    if (showPrelims) {
      components.push(new ActionRowBuilder().addComponents(prelimSelect));

      // Add prelim predictions button
      const predictRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(
            `predict_prelims_${currentModel}_${event.event_id || "latest"}`
          )
          .setLabel("Prelim Predictions")
          .setEmoji("🥊")
          .setStyle(ButtonStyle.Primary)
      );
      components.push(predictRow);
    }

    return components;
  }

  static async handleInteractionError(interaction, error) {
    try {
      console.error("Error handling interaction:", error);
      const errorMessage = "Error processing request. Please try again.";

      if (!interaction.deferred && !interaction.replied) {
        await interaction.reply({ content: errorMessage, ephemeral: true });
      } else {
        await interaction.followUp({ content: errorMessage, ephemeral: true });
      }
    } catch (replyError) {
      console.error("Error sending error message:", replyError);
    }
  }

  static async displayBettingAnalysis(interaction, eventId) {
    try {
      // Ensure interaction is deferred
      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferUpdate();
      }

      const event =
        (await database.getCurrentEvent()) ||
        (await database.getUpcomingEvent());
      if (!event) {
        await interaction.editReply({
          content: "No upcoming events found.",
          ephemeral: true,
        });
        return;
      }

      const currentModel = ModelCommand.getCurrentModel();
      console.log(
        `Getting predictions for event ${event.event_id}, model ${currentModel}`
      );

      // Get stored predictions with explicit card type
      const predictions = await database.query(
        `
                SELECT prediction_data
                FROM stored_predictions
                WHERE event_id = ?
                AND card_type = 'main'
                AND model_used = ?
                ORDER BY created_at DESC
                LIMIT 1
            `,
        [event.event_id, currentModel]
      );

      if (!predictions || !predictions.length) {
        await interaction.editReply({
          content: "No predictions found. Please generate predictions first.",
          ephemeral: true,
        });
        return;
      }

      const predictionData = JSON.parse(predictions[0].prediction_data);
      console.log("Retrieved prediction data:", predictionData);

      if (!predictionData?.betting_analysis) {
        await interaction.editReply({
          content:
            "No betting analysis available. Please generate new predictions.",
          ephemeral: true,
        });
        return;
      }

      const modelName = currentModel === "gpt" ? "GPT-4" : "Claude";
      const modelEmoji = currentModel === "gpt" ? "🧠" : "🤖";

      const bettingEmbed = new EmbedBuilder()
        .setColor("#ffd700")
        .setTitle(`💰 Betting Analysis ${modelEmoji}`)
        .setDescription(
          `Betting Opportunities for ${event.Event}\n\n*Analysis generated by ${modelName}*`
        );

      // Add each section if it exists
      const sections = {
        "🎲 Parlay Recommendations": predictionData.betting_analysis.parlays,
        "💰 Value Parlays": predictionData.betting_analysis.value_parlays,
        "👊 Method Props": predictionData.betting_analysis.method_props,
        "⏱️ Round Props": predictionData.betting_analysis.round_props,
        "🎯 Special Props": predictionData.betting_analysis.special_props,
        "⚠️ Potential Upsets": predictionData.betting_analysis.upsets,
      };

      Object.entries(sections).forEach(([name, content]) => {
        if (
          content &&
          content !== "undefined" &&
          content !== "null" &&
          content.trim() !== ""
        ) {
          bettingEmbed.addFields({ name, value: content, inline: false });
        }
      });

      const navigationRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`predict_main_${currentModel}_${event.event_id}`)
          .setLabel("Back to Predictions")
          .setEmoji("📊")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`show_event_${event.event_id}`)
          .setLabel("Back to Event")
          .setEmoji("↩️")
          .setStyle(ButtonStyle.Success)
      );

      await interaction.editReply({
        embeds: [bettingEmbed],
        components: [navigationRow],
      });
    } catch (error) {
      console.error("Error displaying betting analysis:", error);
      await interaction.editReply({
        content: "Error displaying betting analysis. Please try again.",
        ephemeral: true,
      });
    }
  }

  static async handleInteractionResponse(interaction, response) {
    try {
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply(response);
      } else if (interaction.deferred) {
        await interaction.editReply(response);
      } else {
        await interaction.followUp(response);
      }
    } catch (error) {
      console.error("Error handling interaction response:", error);
      await this.handleInteractionError(interaction, error);
    }
  }

  static async createFightEmbeds(event, mainCard, prelims, showPrelims) {
    const embeds = [];
    let currentEmbed = this.createBaseEmbed(event);

    try {
      if (mainCard.length > 0) {
        currentEmbed.addFields({
          name: "🎯 MAIN CARD",
          value: "───────────────",
          inline: false,
        });

        for (const fight of mainCard) {
          const [fighter1Stats, fighter2Stats] = await Promise.all([
            FighterStats.getFighterStats(fight.fighter1),
            FighterStats.getFighterStats(fight.fighter2),
          ]);

          const displayValue = await StatsManager.formatFightDisplay(
            fight,
            fighter1Stats,
            fighter2Stats
          );
          if (!displayValue) continue;

          currentEmbed.addFields({
            name: fight.WeightClass || "Weight Class TBD",
            value: `👊 **${fight.fighter1} vs ${fight.fighter2}**\n${displayValue}`,
            inline: false,
          });

          // Check if embed exceeds field limit
          if (currentEmbed.data.fields.length === 25) {
            embeds.push(currentEmbed);
            currentEmbed = this.createBaseEmbed(event); // Start a new embed
          }
        }
      }

      if (showPrelims && prelims.length > 0) {
        currentEmbed.addFields({
          name: "🥊 PRELIMINARY CARD",
          value: "───────────────",
          inline: false,
        });

        for (const fight of prelims) {
          const [fighter1Stats, fighter2Stats] = await Promise.all([
            FighterStats.getFighterStats(fight.fighter1),
            FighterStats.getFighterStats(fight.fighter2),
          ]);

          const displayValue = await StatsManager.formatFightDisplay(
            fight,
            fighter1Stats,
            fighter2Stats
          );
          if (!displayValue) continue;

          currentEmbed.addFields({
            name: fight.WeightClass || "Weight Class TBD",
            value: `👊 **${fight.fighter1} vs ${fight.fighter2}**\n${displayValue}`,
            inline: false,
          });

          // Check if embed exceeds field limit
          if (currentEmbed.data.fields.length === 25) {
            embeds.push(currentEmbed);
            currentEmbed = this.createBaseEmbed(event); // Start a new embed
          }
        }
      }

      if (currentEmbed.data.fields.length > 0) {
        embeds.push(currentEmbed); // Push the last embed
      }

      return embeds;
    } catch (error) {
      console.error("Error creating fight embeds:", error);

      // Return a basic error embed
      currentEmbed.setDescription(
        "Error loading fight details. Please try again."
      );
      embeds.push(currentEmbed);
      return embeds;
    }
  }

  static getDataQualityIcon(reason) {
    switch (reason) {
      case "no_data":
        return "❌";
      case "missing_stats":
        return "⚠️";
      case "insufficient_fights":
        return "📊";
      case "never_updated":
      case "outdated":
        return "⏰";
      default:
        return "❓";
    }
  }
}
module.exports = EventHandlers;
