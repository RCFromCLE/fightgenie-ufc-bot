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

static async getCurrentEvent() {
    try {
        const event = await database.getCurrentEvent();
        return event;
    } catch (error) {
        console.error("Error getting current event:", error);
        throw error;
    }
}

static async cleanupFightCard(fights) {
    const fighterCounts = new Map();
    fights.forEach((fight) => {
        fighterCounts.set(fight.fighter1, (fighterCounts.get(fight.fighter1) || 0) + 1);
        fighterCounts.set(fight.fighter2, (fighterCounts.get(fight.fighter2) || 0) + 1);
    });

    // Remove duplicates while preserving order
    const seenFighters = new Set();
    const cleanedFights = fights.filter((fight) => {
        if (seenFighters.has(fight.fighter1) || seenFighters.has(fight.fighter2)) {
            return false;
        }
        seenFighters.add(fight.fighter1);
        seenFighters.add(fight.fighter2);
        return true;
    });

    // Split into main card and prelims
    const mainCard = cleanedFights.slice(0, 5).map((fight) => ({ ...fight, is_main_card: 1 }));
    const prelims = cleanedFights.slice(5).map((fight) => ({ ...fight, is_main_card: 0 }));

    return [...mainCard, ...prelims];
}

static async createEventEmbed(event, showPrelims = false) {
    try {
        let fights = await database.getEventFights(event.Event);
        if (!fights || !Array.isArray(fights)) {
            throw new Error("No fights data available");
        }

        fights = await this.cleanupFightCard(fights);

        const currentModel = ModelCommand.getCurrentModel() || "gpt";
        const modelName = currentModel.toLowerCase() === "gpt" ? "GPT-4" : "Claude";
        
        // Split fights into main card and prelims
        const mainCard = fights.filter(f => f.is_main_card === 1);
        const prelims = fights.filter(f => f.is_main_card === 0);

        // Get event time from database
        const eventDetails = await database.query(`
            SELECT Date, event_time 
            FROM events 
            WHERE Event = ? 
            LIMIT 1`,
            [event.Event]
        );

        const eventTime = eventDetails[0]?.event_time || "TBD";
        const eventDate = new Date(eventDetails[0]?.Date);

        const embed = new EmbedBuilder()
            .setColor("#0099ff")
            .setTitle(`🥊 ${event.Event}`)
            .setDescription([
                `📅 ${eventDate.toLocaleDateString('en-US', { 
                    month: 'long',
                    day: 'numeric',
                    year: 'numeric'
                })} at ${eventTime}`,
                `📍 ${event.City}, ${event.Country}`,
                '',
                '💡 Records shown are UFC fights only',
                '📊 Data from: ufcstats.com',
                '',
                '━━━━━━━━━━━━━━━━━━━━━━',
                '',
                '🎯 **MAIN CARD**'
            ].join('\n'))
            .setThumbnail("attachment://FightGenie_Logo_1.PNG")
            .setFooter({
                text: `Fight Genie 1.0  |  Current Model: ${modelName}`,
                iconURL: 'attachment://FightGenie_Logo_1.PNG'
            });

        // Add main card fights
        for (const fight of mainCard) {
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
                    `${fighter1Stats?.Stance || 'Orthodox'} | ${fighter1Stats?.Reach || '??'}" reach`,
                    '⚔️',
                    `**${fight.fighter2}** (${fighter2Record})`,
                    `${fighter2Stats?.Stance || 'Orthodox'} | ${fighter2Stats?.Reach || '??'}" reach`
                ].join('\n'),
                inline: false
            });
        }

        // Add prelims if showPrelims is true
        if (showPrelims && prelims.length > 0) {
            embed.addFields({
                name: '\n━━━━━━━━━━━━━━━━━━━━━━\n🥊 **PRELIMINARY CARD**',
                value: '\u200b',
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
                        `${fighter1Stats?.Stance || 'Orthodox'} | ${fighter1Stats?.Reach || '??'}" reach`,
                        '⚔️',
                        `**${fight.fighter2}** (${fighter2Record})`,
                        `${fighter2Stats?.Stance || 'Orthodox'} | ${fighter2Stats?.Reach || '??'}" reach`
                    ].join('\n'),
                    inline: false
                });
            }
        }

        // Create navigation components
        const components = await this.createNavigationButtons(event, showPrelims, fights);

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

        const currentModel = ModelCommand.getCurrentModel() || "gpt";
        const modelName = currentModel.toLowerCase() === "gpt" ? "GPT-4" : "Claude Sonnet";
        
        // Split fights into main card and prelims
        const mainCard = fights.filter(f => f.is_main_card === 1);
        const prelims = fights.filter(f => f.is_main_card === 0);

        // Get event time from database
        const eventDetails = await database.query(`
            SELECT Date, event_time 
            FROM events 
            WHERE Event = ? 
            LIMIT 1`,
            [event.Event]
        );

        const eventTime = eventDetails[0]?.event_time || "3 AM ET";
        const eventDate = new Date(eventDetails[0]?.Date);

        // Create base embed
        const embed = new EmbedBuilder()
            .setColor("#0099ff")
            .setTitle(`🥊 UFC Fight Night: ${mainCard[0]?.fighter1 || ''} vs. ${mainCard[0]?.fighter2 || ''}`)
            .setDescription([
                `📅 ${eventDate.toLocaleString('en-US', { 
                    month: 'long',
                    day: 'numeric',
                    year: 'numeric'
                })} at ${eventTime}`,
                `📍 ${event.City}, ${event.Country}`,
                '',
                '💡 Records shown are UFC fights only',
                '📊 Data from: ufcstats.com',
                '',
                '━━━━━━━━━━━━━━━━━━━━━━',
                '',
                '🎯 **MAIN CARD**'
            ].join('\n'))
            .setThumbnail("attachment://FightGenie_Logo_1.PNG")
            .setFooter({
                text: `Fight Genie 1.0  |  💳 PayPal • ⚡ Solana  |  Current Model: ${modelName}`,
                iconURL: 'attachment://FightGenie_Logo_1.PNG'
            });

        // Add main card fights without odds
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

        // Add prelims if showPrelims is true
        if (showPrelims && prelims.length > 0) {
            embed.addFields({
                name: '\n━━━━━━━━━━━━━━━━━━━━━━\n🥊 **PRELIMINARY CARD**\n',
                value: '\u200b',
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

        // Create navigation components
        const components = await this.createNavigationButtons(event, showPrelims, fights);

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

static async handlePrelimToggle(interaction) {
  try {
      if (!interaction.deferred && !interaction.replied) {
          await interaction.deferUpdate();
      }

      const event = await this.getUpcomingEvent();
      if (!event) {
          await interaction.followUp({
              content: "No upcoming events found.",
              ephemeral: true,
          });
          return;
      }

      // Check if prelims are currently shown by looking for the PRELIMINARY CARD section
      const currentEmbed = interaction.message.embeds[0];
      const prelimsShown = currentEmbed.fields.some(field => 
          field.name && field.name.includes("PRELIMINARY CARD")
      );

      // Toggle state - if prelims are shown, hide them
      const response = await this.createEventEmbed(event, !prelimsShown);
      
      console.log(`Toggling prelims - Current state: ${prelimsShown ? 'shown' : 'hidden'}, New state: ${!prelimsShown ? 'shown' : 'hidden'}`);
      
      await interaction.message.edit(response);
  } catch (error) {
      console.error("Error toggling prelims:", error);
      await interaction.followUp({
          content: "Error toggling preliminary card display.",
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
          .setCustomId(`predict_main_${currentModel}_${event.event_id || "latest"}`)
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
              .setCustomId(`predict_prelims_${currentModel}_${event.event_id || "latest"}`)
              .setLabel("Prelim Predictions")
              .setEmoji("🥊")
              .setStyle(ButtonStyle.Primary)
      );
      components.push(predictRow);
  }

  return components;
}

static async createBaseEmbed(event) {
    const eventDetails = await database.query(`
        SELECT prelims_time, main_card_time 
        FROM events 
        WHERE Event = ? 
        LIMIT 1`,
        [event.Event]
    );

    const mainCardTime = eventDetails[0]?.main_card_time ? 
        new Date(eventDetails[0].main_card_time) : 
        new Date(event.Date);

    const estTime = mainCardTime.toLocaleString("en-US", {
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

  static async handleBettingAnalysis(interaction, eventId) {
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
            await this.displayBettingAnalysis(interaction, event.event_id);
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
              // Direct handling here instead of redirecting
              const currentEmbed = interaction.message.embeds[0];
              const prelimsShown = currentEmbed.fields.some(field => 
                  field.name && field.name.includes("PRELIMINARY CARD")
              );

              console.log("Toggle prelims - Current state:", prelimsShown);
              const response = await this.createEventEmbed(event, !prelimsShown);
              await interaction.message.edit(response);
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

    // Force boolean value for showPrelims and log the state
    showPrelims = Boolean(showPrelims);
    console.log('Creating navigation buttons - Prelims shown:', showPrelims);

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

  static formatBettingContent(content) {
    if (!content) return 'None available';
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
        return content.map(item => {
            if (typeof item === 'string') return `• ${item}`;
            if (typeof item === 'object') {
                if (item.prediction && item.reasoning) {
                    return `• ${item.prediction}\n  └ ${item.reasoning}`;
                }
                if (item.combination) {
                    return `• ${item.combination.join(" + ")}\n  └ ${item.reasoning}`;
                }
                if (item.opportunity) {
                    return `• ${item.opportunity}\n  └ ${item.reasoning}`;
                }
                return Object.entries(item)
                    .map(([key, val]) => `• ${key}: ${val}`)
                    .join('\n');
            }
            return `• ${JSON.stringify(item)}`;
        }).join('\n');
    }
    if (typeof content === 'object') {
        return Object.entries(content)
            .map(([key, val]) => `• ${key}: ${val}`)
            .join('\n');
    }
    return String(content);
}

static async displayBettingAnalysis(interaction, eventId) {
    try {
        if (!interaction.deferred && !interaction.replied) {
            await interaction.deferUpdate();
        }

        const event = await database.getCurrentEvent() || await database.getUpcomingEvent();
        if (!event) {
            await interaction.editReply({
                content: "No upcoming events found.",
                ephemeral: true,
            });
            return;
        }

        const currentModel = ModelCommand.getCurrentModel();
        const predictions = await database.query(
            `SELECT prediction_data
             FROM stored_predictions
             WHERE event_id = ?
             AND card_type = 'main'
             AND model_used = ?
             ORDER BY created_at DESC
             LIMIT 1`,
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
                content: "No betting analysis available. Please generate new predictions.",
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
        )
        .setThumbnail("attachment://FightGenie_Logo_1.PNG")
        .setFooter({
            text: `${modelName} Analysis • Fight Genie 1.0 • Stats from UFCStats.com`,
            iconURL: "attachment://FightGenie_Logo_1.PNG"
        });

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
            if (content) {
                const formattedContent = this.formatBettingContent(content);
                if (formattedContent && formattedContent !== 'None available') {
                    bettingEmbed.addFields({ 
                        name, 
                        value: formattedContent, 
                        inline: false 
                    });
                }
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
    files: [{
        attachment: './src/images/FightGenie_Logo_1.PNG',
        name: 'FightGenie_Logo_1.PNG'
    }]
});

} catch (error) {
        console.error("Error displaying betting analysis:", error);
        await interaction.editReply({
            content: "Error displaying betting analysis. Please try again.",
            ephemeral: true,
        });
    }
}
}

module.exports = EventHandlers;