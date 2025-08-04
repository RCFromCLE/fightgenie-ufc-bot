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
const MarketAnalysis = require('../utils/MarketAnalysis');
const EventImageHandler = require('./EventImageHandler');

class EventHandlers {

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
            AND is_completed = 0
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
      // Get current date in local timezone
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      const currentDate = `${year}-${month}-${day}`;
      
      console.log('Current date and time:', {
          localTime: now.toLocaleString(),
          searchDate: currentDate
      });

      // First try: exact date match with is_completed = 0
      let query = `
          SELECT 
              event_id,
              Date,
              Event,
              City,
              State, 
              Country,
              event_link,
              event_time
          FROM events 
          WHERE Date = ?
          AND Event LIKE 'UFC%'
          AND is_completed = 0
          GROUP BY Event, Date, City, State, Country, event_link, event_time
          LIMIT 1
      `;

      let result = await database.query(query, [currentDate]);
      
      // If no exact match, check nearby dates with is_completed = 0
      if (!result || result.length === 0) {
          console.log('No exact date match, checking nearby dates...');
          
          query = `
              SELECT 
                  event_id,
                  Date,
                  Event,
                  City,
                  State, 
                  Country,
                  event_link,
                  event_time
              FROM events 
              WHERE Date BETWEEN date(?, '-3 days') AND date(?, '+3 days')
              AND Event LIKE 'UFC%'
              AND is_completed = 0
              GROUP BY Event, Date, City, State, Country, event_link, event_time
              ORDER BY ABS(julianday(Date) - julianday(?))
              LIMIT 1
          `;
          
          result = await database.query(query, [currentDate, currentDate, currentDate]);
          
          if (result && result.length > 0) {
              console.log('Found event in nearby dates:', result[0]);
          } else {
              // If still no result, try future events with is_completed = 0
              query = `
                  SELECT 
                      event_id,
                      Date,
                      Event,
                      City,
                      State, 
                      Country,
                      event_link,
                      event_time
                  FROM events 
                  WHERE Date > ?
                  AND Event LIKE 'UFC%'
                  AND is_completed = 0
                  GROUP BY Event, Date, City, State, Country, event_link, event_time
                  ORDER BY Date ASC
                  LIMIT 1
              `;
              
              result = await database.query(query, [currentDate]);
          }
      }

      if (!result || result.length === 0) {
          console.log('No events found in any date range');
          return null;
      }

      const event = result[0];
      console.log('Selected event:', event);

      // Get fights for this event
      const fights = await database.query(`
          SELECT DISTINCT
              event_id,
              fighter1,
              fighter2,
              WeightClass,
              is_main_card
          FROM events 
          WHERE Event = ? 
          AND Date = ?
          AND fighter1 IS NOT NULL 
          AND fighter2 IS NOT NULL
          ORDER BY is_main_card DESC, event_id ASC
      `, [event.Event, event.Date]);

      if (fights && fights.length > 0) {
          console.log(`Found ${fights.length} fights for event ${event.Event}`);
          event.fights = fights;
      } else {
          console.log(`No fights found for event ${event.Event}`);
          // Try without the date constraint if no fights found
          const fallbackFights = await database.query(`
              SELECT DISTINCT
                  event_id,
                  fighter1,
                  fighter2,
                  WeightClass,
                  is_main_card
              FROM events 
              WHERE Event = ? 
              AND fighter1 IS NOT NULL 
              AND fighter2 IS NOT NULL
              ORDER BY is_main_card DESC, event_id ASC
          `, [event.Event]);
          
          if (fallbackFights && fallbackFights.length > 0) {
              console.log(`Found ${fallbackFights.length} fights using fallback query`);
              event.fights = fallbackFights;
          }
      }

      if (!event.fights || event.fights.length === 0) {
          throw new Error("No fights found for event");
      }

      return event;

  } catch (error) {
      console.error("Error in getUpcomingEvent:", error);
      console.error('Stack trace:', error.stack);
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

    return [...mainCard, ...prelims];
  }


  static async getRecord(fighterName) {
    try {
      const [wins, losses, draws] = await Promise.all([
        database.query(
          "SELECT COUNT(*) as count FROM events WHERE Winner = ?",
          [fighterName]
        ),
        database.query("SELECT COUNT(*) as count FROM events WHERE Loser = ?", [
          fighterName,
        ]),
        database.query(
          'SELECT COUNT(*) as count FROM events WHERE (Winner = ? OR Loser = ?) AND Method LIKE "%Draw%"',
          [fighterName, fighterName]
        ),
      ]);

      return `${wins[0]?.count || 0}-${losses[0]?.count || 0}-${draws[0]?.count || 0
        }`;
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
      const hasResults =
        $('.b-fight-details__table-col:contains("W/L")').length > 0;
      const allFightsCompleted = $(".b-fight-details__table-row")
        .toArray()
        .every((row) => {
          const method = $(row)
            .find(".b-fight-details__table-col:nth-child(8)")
            .text()
            .trim();
          return method !== "";
        });

      console.log(
        `Event completion check - Has results: ${hasResults}, All fights completed: ${allFightsCompleted}`
      );
      return hasResults && allFightsCompleted;
    } catch (error) {
      console.error("Error checking event completion:", error);
      return false;
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
        database.query("SELECT COUNT(*) as count FROM events WHERE Loser = ?", [
          fighterName,
        ]),
        database.query(
          'SELECT COUNT(*) as count FROM events WHERE (Winner = ? OR Loser = ?) AND Method LIKE "%Draw%"',
          [fighterName, fighterName]
        ),
      ]);

      return `${wins[0]?.count || 0}-${losses[0]?.count || 0}-${draws[0]?.count || 0
        }`;
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

      const { embed: dataQualityEmbed } =
        await DataValidator.createStatsReportEmbed(event, fights);

      await interaction.editReply({
        embeds: [dataQualityEmbed],
      });
    } catch (error) {
      console.error("Error fetching fighter data quality status:", error);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: "An error occurred while fetching data.",
          ephemeral: true,
        });
      } else {
        await interaction.followUp({
          content: "An error occurred while fetching data.",
          ephemeral: true,
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
      const modelName =
        currentModel.toLowerCase() === "gpt" ? "GPT" : "Claude"; // Updated display name

      const mainCard = fights.filter((f) => f.is_main_card === 1);
      const prelims = fights.filter((f) => f.is_main_card === 0);

      const eventDetails = await database.query(
        `
            SELECT Date, event_time 
            FROM events 
            WHERE Event = ? 
            LIMIT 1`,
        [event.Event]
      );

      const eventTime = eventDetails[0]?.event_time || "3 PM PST";
      const eventDate = new Date(new Date(eventDetails[0]?.Date).getTime() + (24 * 60 * 60 * 1000));

      const { embed: tempEmbed, files } = await EventImageHandler.modifyEventEmbed(
        new EmbedBuilder(),
        event
      );

      const imageAttachment = files.find(file => file.name !== 'FightGenie_Logo_1.PNG');
      const imageAttachmentName = imageAttachment ? imageAttachment.name : 'FightGenie_Logo_1.PNG';

      // --- Fetch Predictions for Double Locks ---
      let doubleLocks = [];
      try {
        const [gptPredictions, claudePredictions] = await Promise.all([
          PredictionHandler.getStoredPrediction(event.event_id, "main", "gpt"),
          PredictionHandler.getStoredPrediction(event.event_id, "main", "claude"),
          // Add prelims if needed for double locks across all fights
          // PredictionHandler.getStoredPrediction(event.event_id, "prelims", "gpt"),
          // PredictionHandler.getStoredPrediction(event.event_id, "prelims", "claude")
        ]);

        const gptFights = gptPredictions?.fights || [];
        const claudeFights = claudePredictions?.fights || [];

        if (gptFights.length > 0 && claudeFights.length > 0) {
          gptFights.forEach(gptFight => {
            const claudeFight = claudeFights.find(cFight =>
              (cFight.fighter1 === gptFight.fighter1 && cFight.fighter2 === gptFight.fighter2) ||
              (cFight.fighter1 === gptFight.fighter2 && cFight.fighter2 === gptFight.fighter1)
            );

            if (claudeFight &&
                gptFight.predictedWinner === claudeFight.predictedWinner &&
                gptFight.confidence >= 75 &&
                claudeFight.confidence >= 75) {
              doubleLocks.push({
                fighter: gptFight.predictedWinner,
                gptConfidence: gptFight.confidence,
                claudeConfidence: claudeFight.confidence,
                opponent: gptFight.predictedWinner === gptFight.fighter1 ? gptFight.fighter2 : gptFight.fighter1
              });
            }
          });
        }
        console.log(`Found ${doubleLocks.length} double locks.`);
      } catch (error) {
        console.error("Error fetching predictions for double locks:", error);
        // Continue without double locks if fetching fails
      }
      // --- End Fetch Predictions for Double Locks ---


      const embed = new EmbedBuilder()
        .setColor("#0099ff")
        .setTitle(
          `🥊 ${event.Event}`
        )
        .addFields(
          {
            name: "\u200b",
            description: tempEmbed.setImage(`attachment://${imageAttachmentName}`).data.description,
            value: [
              `📅 ${eventDate.toLocaleString("en-US", {
                month: "long",
                day: "numeric",
                year: "numeric",
              })} at ${eventTime}`,
              `📍 ${event.City}, ${event.Country}`,
              "",
              "💡 Records shown are UFC fights only",
              "📊 Data from: ufcstats.com",
              "",
              "━━━━━━━━━━━━━━━━━━━━━━",
              "",
              "🎯 **MAIN CARD**",
            ].join("\n"),
            inline: false
          }
        );

        // --- Add Double Lock Section ---
        if (doubleLocks.length > 0) {
          embed.addFields({
            name: "🔒 Double Locks (GPT & Claude >75%)",
            value: doubleLocks.map(lock =>
              `**${lock.fighter}** vs ${lock.opponent}\n└ GPT: ${lock.gptConfidence}% | Claude: ${lock.claudeConfidence}%`
            ).join('\n\n'),
            inline: false
          });
           embed.addFields({ name: "\u200B", value: "━━━━━━━━━━━━━━━━━━━━━━" }); // Separator after locks
        }
        // --- End Double Lock Section ---

        embed.setThumbnail("attachment://FightGenie_Logo_1.PNG")
        .setFooter({
          text: `Fight Genie 1.1 | Free Bot - Use $donate to support! | Current Model: ${modelName}`, // Footer already updated, ensuring it's correct
          iconURL: "attachment://FightGenie_Logo_1.PNG",
        });

      for (const fight of mainCard) {
        const [fighter1Stats, fighter2Stats, fighter1Record, fighter2Record] =
          await Promise.all([
            FighterStats.getFighterStats(fight.fighter1),
            FighterStats.getFighterStats(fight.fighter2),
            this.getRecord(fight.fighter1),
            this.getRecord(fight.fighter2),
          ]);

        embed.addFields({
          name: `\n${fight.WeightClass || "Weight Class TBD"}`,
          value: [
            `👊 **${fight.fighter1}** (${fighter1Record})`,
            `${fighter1Stats?.Stance || "Orthodox"} | ${fighter1Stats?.Reach || "??"
            }" reach | ${this.calculateAge(fighter1Stats?.DOB) || "??"} yrs`,
            "⚔️",
            `**${fight.fighter2}** (${fighter2Record})`,
            `${fighter2Stats?.Stance || "Orthodox"} | ${fighter2Stats?.Reach || "??"
            }" reach | ${this.calculateAge(fighter2Stats?.DOB) || "??"} yrs\n`,
          ].join("\n"),
          inline: false,
        });
      }

      if (showPrelims && prelims.length > 0) {
        embed.addFields({
          name: "\n━━━━━━━━━━━━━━━━━━━━━━\n🥊 **PRELIMINARY CARD**\n",
          value: "\u200b",
          inline: false,
        });

        for (const fight of prelims) {
          const [fighter1Stats, fighter2Stats, fighter1Record, fighter2Record] =
            await Promise.all([
              FighterStats.getFighterStats(fight.fighter1),
              FighterStats.getFighterStats(fight.fighter2),
              this.getRecord(fight.fighter1),
              this.getRecord(fight.fighter2),
            ]);

          embed.addFields({
            name: fight.WeightClass || "Weight Class TBD",
            value: [
              `👊 **${fight.fighter1}** (${fighter1Record})`,
              `${fighter1Stats?.Stance || "Orthodox"} | ${fighter1Stats?.Reach || "??"
              }" reach | ${this.calculateAge(fighter1Stats?.DOB) || "??"} yrs`,
              "⚔️",
              `**${fight.fighter2}** (${fighter2Record})`,
              `${fighter2Stats?.Stance || "Orthodox"} | ${fighter2Stats?.Reach || "??"
              }" reach | ${this.calculateAge(fighter2Stats?.DOB) || "??"
              } yrs\n`,
            ].join("\n"),
            inline: false,
          });
        }
      }

      const components = await this.createNavigationButtons(
        event,
        showPrelims,
        fights
      );

      return {
        embeds: [embed],
        files,
        components,
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
      const prelimsShown = currentEmbed.fields.some(
        (field) => field.name && field.name.includes("PRELIMINARY CARD")
      );

      // Toggle state - if prelims are shown, hide them
      const response = await this.createEventEmbed(event, !prelimsShown);

      console.log(
        `Toggling prelims - Current state: ${prelimsShown ? "shown" : "hidden"
        }, New state: ${!prelimsShown ? "shown" : "hidden"}`
      );

      await interaction.message.edit(response);
    } catch (error) {
      console.error("Error toggling prelims:", error);
      await interaction.followUp({
        content: "Error toggling preliminary card display.",
        ephemeral: true,
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
        .setStyle(ButtonStyle.Success),
      // Prediction button is always added now
      new ButtonBuilder()
        .setCustomId(
          `predict_main_${currentModel}_${event.event_id || "latest"}`
        )
        .setLabel(`${modelName} Main Card Predictions`)
        .setEmoji("🎯")
        .setStyle(ButtonStyle.Primary),
      // Full Analysis button is always added now
      new ButtonBuilder()
        .setCustomId(`get_analysis_${event.event_id || "latest"}`)
        .setLabel(`DM ${modelName} Full Analysis`)
        .setEmoji("📈")
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
          .setLabel("AI Prelim Predictions")
          .setEmoji("🥊")
          .setStyle(ButtonStyle.Primary)
      );
      components.push(predictRow);
    }

    return components;
  }

  static async createBaseEmbed(event) {
    const eventDetails = await database.query(
      `
        SELECT prelims_time, main_card_time 
        FROM events 
        WHERE Event = ? 
        LIMIT 1`,
      [event.Event]
    );

    const mainCardTime = eventDetails[0]?.main_card_time
      ? new Date(eventDetails[0].main_card_time)
      : new Date(event.Date);

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
        `📅 ${estTime}\n📍 ${event.City}${event.State ? `, ${event.State}` : ""
        }, ${event.Country
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
        displayValue += `\n\n📈 FanDuel Odds:\n${fight.fighter1
          }: ${OddsAnalysis.formatAmericanOdds(fightOdds.fighter1.price)}\n${fight.fighter2
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

      const modelName = currentModel === "gpt" ? "GPT" : "Claude"; // Updated display name
      const modelEmoji = currentModel === "gpt" ? "🧠" : "🤖";

      const bettingEmbed = new EmbedBuilder()
        .setColor("#ffd700")
        .setTitle(`💰 AI Betting Analysis ${modelEmoji}`)
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
          ephemeral: true,
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
              content:
                "No predictions found. Please generate predictions first.",
              ephemeral: true,
            });
            return;
          }

          // Get current page from embed description
          let currentPage = 0;
          if (interaction.message?.embeds[0]?.description) {
            const match =
              interaction.message.embeds[0].description.match(/Page (\d+)/);
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
              content:
                "No predictions found. Please generate predictions first.",
              ephemeral: true,
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
                content:
                  "No predictions found. Please generate predictions first.",
                ephemeral: true,
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
            const prelimsShown = currentEmbed.fields.some(
              (field) => field.name && field.name.includes("PRELIMINARY CARD")
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
            ephemeral: true,
          });
      }
    } catch (error) {
      console.error("Error handling button interaction:", error);
      await interaction.followUp({
        content: "Error processing button interaction. Please try again.",
        ephemeral: true,
      });
    }
  }

  static async createNavigationButtons(event, showPrelims, fights) {
    const currentModel = ModelCommand.getCurrentModel() || "gpt";
    const modelName = currentModel.toLowerCase() === "gpt" ? "GPT" : "Claude"; // Updated display name
    const components = [];

    // Force boolean value for showPrelims and log the state
    showPrelims = Boolean(showPrelims);
    console.log("Creating navigation buttons - Prelims shown:", showPrelims);

    // First row with main action buttons
    const buttonRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`toggle_prelims_${event.event_id || "latest"}`)
        .setLabel(showPrelims ? "Hide Prelims" : "Show Prelims")
        .setEmoji("👁️")
        .setStyle(ButtonStyle.Success)
    );

    // Prediction button is always added now (access check removed)
    buttonRow.addComponents(
      new ButtonBuilder()
        .setCustomId(
          `predict_main_${currentModel}_${event.event_id || "latest"}`
        )
        .setLabel(`${modelName} Main Card Predictions`)
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
          .setLabel("AI Prelim Predictions")
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

  static async displayBettingAnalysis(interaction, eventId) {
    try {
      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferUpdate();
      }

      const event = await this.getUpcomingEvent();
      if (!event) {
        await interaction.editReply({ content: "No upcoming events found.", ephemeral: true });
        return;
      }

      const currentModel = ModelCommand.getCurrentModel();
      const modelName = currentModel === "gpt" ? "GPT" : "Claude";
      const modelEmoji = currentModel === "gpt" ? "🧠" : "🤖";

      // Generate the comprehensive market analysis report
      let analysisReport;
      try {
        analysisReport = await MarketAnalysis.generateMarketAnalysis(event, currentModel);
        if (!analysisReport) {
          throw new Error("Market analysis returned null or undefined.");
        }
      } catch (analysisError) {
        console.error("Error generating market analysis:", analysisError);
        await interaction.editReply({
          content: `Error generating market analysis using ${modelName}. Please try again later or check logs.`,
          ephemeral: true
        });
        return;
      }

      // --- Create Embeds using the new analysisReport structure ---

      // 1. Main Summary Embed (similar to the user's image)
      const summaryEmbed = new EmbedBuilder()
        .setColor("#0099ff")
        .setTitle(`📊 UFC Market Intelligence Report ${modelEmoji}`)
        .setDescription(`**${event.Event}**\n*Advanced Analysis by ${modelName} Fight Analytics*`)
        .setThumbnail("attachment://FightGenie_Logo_1.PNG")
        .addFields(
          { name: "📅 Date", value: analysisReport.eventDetails?.date || event.Date, inline: true },
          { name: "📍 Location", value: analysisReport.eventDetails?.location || `${event.City}, ${event.Country}`, inline: true },
          { name: "⚙️ Model Used", value: analysisReport.eventDetails?.modelUsed || modelName, inline: true },
          { name: "\u200B", value: "━━━━━━━━━━━━━━━━━━━━━━" } // Separator
        );

      // Add Market Overview
      if (analysisReport.marketOverview) {
        summaryEmbed.addFields({
          name: "📈 Market Overview",
          value: [
            `Efficiency: ${analysisReport.marketOverview.marketEfficiency || 'N/A'}`,
            `Sharpness: ${analysisReport.marketOverview.sharpness || 'N/A'}`,
            `Avg. Edge: ${analysisReport.marketOverview.averageEdge || 'N/A'}`,
            `Value Plays: ${analysisReport.marketOverview.valueOpportunitiesCount || 0}`,
          ].join('\n'),
          inline: false,
        });
      }

      // Add Top Value Plays
      if (analysisReport.valuePicks && analysisReport.valuePicks.length > 0) {
        const topPicks = analysisReport.valuePicks.slice(0, 3); // Show top 3
        summaryEmbed.addFields({
          name: "💎 Top Value Plays",
          value: topPicks.map(pick =>
            `**${pick.valueRatingDisplay} ${pick.fighter}** (vs ${pick.opponent})` +
            `\n└ Edge: ${pick.edge} | Confidence: ${pick.confidence} | Odds: ${pick.odds > 0 ? '+' : ''}${pick.odds}` +
            `\n└ Method: ${pick.method} | Rec. Size: ${pick.recommendedBetSize}` +
            `\n└ *${pick.analysis}*`
          ).join('\n\n') || "No value plays meet the criteria.", // Updated text
          inline: false
        });
      } else {
        summaryEmbed.addFields({ name: "💎 Top Value Plays", value: "No value plays meet the criteria.", inline: false }); // Updated text
      }

      // summaryEmbed.addFields({ name: "\u200B", value: "More details in following messages..." }); // Removed this line as requested implicitly by showing all embeds


      // 2. Parlay Recommendations Embed
      const parlayEmbed = new EmbedBuilder()
        .setColor("#DAA520") // Gold color for parlays
        .setTitle(`🎲 Parlay Recommendations ${modelEmoji}`)
        .setThumbnail("attachment://FightGenie_Logo_1.PNG");

      if (analysisReport.parlayRecommendations) {
        const { twoPicks, threePicks, valueParlays } = analysisReport.parlayRecommendations;
        if (twoPicks && twoPicks.length > 0) {
          parlayEmbed.addFields({
            name: "✌️ Two-Pick Parlays",
            value: twoPicks.map(p =>
              `**${p.ratingDisplay} ${p.fighters.join(' + ')}**` +
              `\n└ Edge: ${p.edge} | Confidence: ${p.avgConfidence} | Return: ${p.potentialReturn}`
            ).join('\n\n'),
            inline: false
          });
        }
        if (threePicks && threePicks.length > 0) {
          parlayEmbed.addFields({
            name: "🤟 Three-Pick Parlays",
            value: threePicks.map(p =>
              `**${p.ratingDisplay} ${p.fighters.join(' + ')}**` +
              `\n└ Edge: ${p.edge} | Confidence: ${p.avgConfidence} | Return: ${p.potentialReturn}`
            ).join('\n\n'),
            inline: false
          });
        }
        if (valueParlays && valueParlays.length > 0) {
          parlayEmbed.addFields({
            name: "💰 Value Parlays (Fav + Underdog)",
            value: valueParlays.map(p =>
              `**${p.ratingDisplay} ${p.fighters.join(' + ')}**` +
              `\n└ Edge: ${p.edge} | Confidence: ${p.avgConfidence} | Return: ${p.potentialReturn}`
            ).join('\n\n'),
            inline: false
          });
        }
         if (!parlayEmbed.data.fields || parlayEmbed.data.fields.length === 0) {
           parlayEmbed.setDescription("No parlay recommendations meet the criteria."); // Updated text
        }
      } else {
        parlayEmbed.setDescription("No parlay recommendations available."); // Keep this if report itself is missing
      }


      // 3. Prop Bets Embed
      const propEmbed = new EmbedBuilder()
        .setColor("#A020F0") // Purple for props
        .setTitle(`🎯 Method & Prop Bets ${modelEmoji}`)
        .setThumbnail("attachment://FightGenie_Logo_1.PNG");

      if (analysisReport.methodAndPropBets) {
        const { highConfidenceFinishes, roundProps } = analysisReport.methodAndPropBets;
        if (highConfidenceFinishes && highConfidenceFinishes.length > 0) {
          propEmbed.addFields({
            name: "💥 High Confidence Finishes",
            value: highConfidenceFinishes.map(f =>
              `**${f.fighter} by ${f.method}**` +
              `\n└ Probability: ${f.probability} | Confidence: ${f.confidence}` +
              `\n└ *${f.analysis}*`
            ).join('\n\n'),
            inline: false
          });
        }
         if (roundProps && roundProps.length > 0) {
          propEmbed.addFields({
            name: "⏱️ Round Props",
            value: roundProps.map(r =>
              `**${r.fight} - ${r.prediction}**` +
              `\n└ Confidence: ${r.confidence}` +
              `\n└ *${r.analysis}*`
            ).join('\n\n'),
            inline: false
          });
        }
         if (!propEmbed.data.fields || propEmbed.data.fields.length === 0) {
           propEmbed.setDescription("No prop bet recommendations meet the criteria."); // Updated text
        }
      } else {
         propEmbed.setDescription("No prop bet recommendations available."); // Keep this if report itself is missing
      }


      // 4. Risk & Bankroll Embed
      const strategyEmbed = new EmbedBuilder()
        .setColor("#FF4500") // OrangeRed for strategy/risk
        .setTitle(`🏦 Risk Assessment & Bankroll Strategy ${modelEmoji}`)
        .setThumbnail("attachment://FightGenie_Logo_1.PNG");

      if (analysisReport.riskAssessment && analysisReport.bankrollStrategy) {
         strategyEmbed.addFields(
           {
             name: "⚖️ Market Risk Assessment",
             value: `Level: **${analysisReport.riskAssessment.marketRiskLevel || 'N/A'}**\nVolatility: ${analysisReport.riskAssessment.volatility || 'N/A'}\nFactors: ${analysisReport.riskAssessment.marketRiskFactors?.join(', ') || 'None'}`,
             inline: false
           },
           {
             name: "📊 Recommended Bankroll Allocation",
             value: `Straight Bets: ${analysisReport.bankrollStrategy.straightBetAllocation || 'N/A'}\nParlays: ${analysisReport.bankrollStrategy.parlayAllocation || 'N/A'}\nReserve: ${analysisReport.bankrollStrategy.reserveAllocation || 'N/A'}`,
             inline: true
           },
           {
             name: "💰 Recommended Max Bet Sizes (% of Bankroll)",
             value: `Single Straight: ${analysisReport.bankrollStrategy.maxStraightBetSize || 'N/A'}\nSingle Parlay: ${analysisReport.bankrollStrategy.maxParlayBetSize || 'N/A'}\nTotal Exposure: ${analysisReport.riskAssessment.exposureLimits?.totalExposure || 'N/A'}`,
             inline: true
           }
         );
         if (analysisReport.riskAssessment.recommendedAdjustments && analysisReport.riskAssessment.recommendedAdjustments.length > 0) {
            strategyEmbed.addFields({
                name: "⚠️ Recommended Adjustments",
                value: analysisReport.riskAssessment.recommendedAdjustments.join('\n'),
                inline: false
            });
         }
      } else {
         strategyEmbed.setDescription("Risk and bankroll strategy information not available."); // Keep this if report itself is missing
      }

      // Legend Embed (reuse existing)
      const legendEmbed = this.createBettingLegendEmbed();

      // Navigation Buttons (reuse existing)
      const navigationRow = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(`show_event_${event.event_id}`)
            .setLabel('Back to Event')
            .setEmoji('↩️')
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId('showcalculations') // Ensure this customId matches handler
            .setLabel('How We Calculate')
            .setEmoji('🧮')
            .setStyle(ButtonStyle.Primary)
        );

      // Send embeds
      const embedsToSend = [summaryEmbed, parlayEmbed, propEmbed, strategyEmbed, legendEmbed].filter(e => e.data.fields || e.data.description); // Only send embeds with content

      if (embedsToSend.length === 0) {
         await interaction.editReply({
           content: `No analysis data could be generated or displayed for ${event.Event}.`,
           ephemeral: true
         });
         return;
      }

      await interaction.editReply({
        embeds: embedsToSend,
        components: [navigationRow],
        files: [{
          attachment: './src/images/FightGenie_Logo_1.PNG',
          name: 'FightGenie_Logo_1.PNG'
        }]
      });

    } catch (error) {
      console.error('Error displaying betting analysis:', error);
      await interaction.editReply({
        content: 'Error generating betting analysis. Please try again.',
        ephemeral: true
      });
    }
  }

  static async addMainCardParlays(embed, mainCardData, oddsData) {
    const highConfPicks = mainCardData
      .filter(fight => fight.confidence >= 70)
      .sort((a, b) => b.confidence - a.confidence);

    if (highConfPicks.length >= 2) {
      const twoFightStats = this.calculateParlayStats(highConfPicks.slice(0, 2), oddsData);
      const threeFightStats = this.calculateParlayStats(highConfPicks.slice(0, 3), oddsData);
      const fourFightStats = this.calculateParlayStats(highConfPicks.slice(0, 4), oddsData);

      embed.addFields({
        name: "🎯 MAIN CARD PARLAYS",
        value: [
          "TWO-FIGHT MAIN CARD:",
          ...highConfPicks.slice(0, 2).map(pick => {
            const confEmoji = pick.confidence >= 75 ? "🔒" : "✅";
            return `└ ${confEmoji} ${pick.predictedWinner} (${pick.confidence}%)`;
          }),
          `└ Combined Probability: ${(twoFightStats.confidenceProduct * 100).toFixed(1)}%`,
          `└ Implied Probability: ${twoFightStats.impliedProbability}%`,
          `└ Potential Return: ${twoFightStats.potentialReturn}`,
          `└ Edge: ${twoFightStats.edge}%`,
          `└ Rating: ${twoFightStats.rating}`,
          "",
          "THREE-FIGHT MAIN CARD:",
          ...highConfPicks.slice(0, 3).map(pick => {
            const confEmoji = pick.confidence >= 75 ? "🔒" : "✅";
            return `└ ${confEmoji} ${pick.predictedWinner} (${pick.confidence}%)`;
          }),
          `└ Combined Probability: ${(threeFightStats.confidenceProduct * 100).toFixed(1)}%`,
          `└ Implied Probability: ${threeFightStats.impliedProbability}%`,
          `└ Potential Return: ${threeFightStats.potentialReturn}`,
          `└ Edge: ${threeFightStats.edge}%`,
          `└ Rating: ${threeFightStats.rating}`,
          "",
          "FOUR-FIGHT MAIN CARD:",
          ...highConfPicks.slice(0, 4).map(pick => {
            const confEmoji = pick.confidence >= 75 ? "🔒" : "✅";
            return `└ ${confEmoji} ${pick.predictedWinner} (${pick.confidence}%)`;
          }),
          `└ Combined Probability: ${(fourFightStats.confidenceProduct * 100).toFixed(1)}%`,
          `└ Implied Probability: ${fourFightStats.impliedProbability}%`,
          `└ Potential Return: ${fourFightStats.potentialReturn}`,
          `└ Edge: ${fourFightStats.edge}%`,
          `└ Rating: ${fourFightStats.rating}`
        ].join('\n'),
        inline: false
      });
    }
  }

  static async addPrelimParlays(embed, prelimData, oddsData) {
    const highConfPicks = prelimData
      .filter(fight => fight.confidence >= 70)
      .sort((a, b) => b.confidence - a.confidence);

    if (highConfPicks.length >= 2) {
      const twoFightStats = this.calculateParlayStats(highConfPicks.slice(0, 2), oddsData);
      const threeFightStats = this.calculateParlayStats(highConfPicks.slice(0, 3), oddsData);
      const fourFightStats = this.calculateParlayStats(highConfPicks.slice(0, 4), oddsData);

      embed.addFields({
        name: "🥊 PRELIMINARY CARD PARLAYS",
        value: [
          "TWO-FIGHT PRELIMS:",
          ...highConfPicks.slice(0, 2).map(pick => {
            const confEmoji = pick.confidence >= 75 ? "🔒" : "✅";
            return `└ ${confEmoji} ${pick.predictedWinner} (${pick.confidence}%)`;
          }),
          `└ Combined Probability: ${(twoFightStats.confidenceProduct * 100).toFixed(1)}%`,
          `└ Implied Probability: ${twoFightStats.impliedProbability}%`,
          `└ Potential Return: ${twoFightStats.potentialReturn}`,
          `└ Edge: ${twoFightStats.edge}%`,
          `└ Rating: ${twoFightStats.rating}`,
          "",
          "THREE-FIGHT PRELIMS:",
          ...highConfPicks.slice(0, 3).map(pick => {
            const confEmoji = pick.confidence >= 75 ? "🔒" : "✅";
            return `└ ${confEmoji} ${pick.predictedWinner} (${pick.confidence}%)`;
          }),
          `└ Combined Probability: ${(threeFightStats.confidenceProduct * 100).toFixed(1)}%`,
          `└ Implied Probability: ${threeFightStats.impliedProbability}%`,
          `└ Potential Return: ${threeFightStats.potentialReturn}`,
          `└ Edge: ${threeFightStats.edge}%`,
          `└ Rating: ${threeFightStats.rating}`,
          "",
          "FOUR-FIGHT PRELIMS:",
          ...highConfPicks.slice(0, 4).map(pick => {
            const confEmoji = pick.confidence >= 75 ? "🔒" : "✅";
            return `└ ${confEmoji} ${pick.predictedWinner} (${pick.confidence}%)`;
          }),
          `└ Combined Probability: ${(fourFightStats.confidenceProduct * 100).toFixed(1)}%`,
          `└ Implied Probability: ${fourFightStats.impliedProbability}%`,
          `└ Potential Return: ${fourFightStats.potentialReturn}`,
          `└ Edge: ${fourFightStats.edge}%`,
          `└ Rating: ${fourFightStats.rating}`
        ].join('\n'),
        inline: false
      });
    }
  }

  static async addCrossCardParlays(embed, mainCardData, prelimData, oddsData) {
    try {
      const parlayConfigurations = [
        {
          name: "THREE-FIGHT CROSS-CARD",
          risk: "MEDIUM RISK",
          mainCount: 2,
          prelimCount: 1,
          minConfidence: 75
        },
        {
          name: "FIVE-FIGHT CROSS-CARD",
          risk: "HIGH RISK",
          mainCount: 3,
          prelimCount: 2,
          minConfidence: 70
        },
        {
          name: "SEVEN-FIGHT CROSS-CARD",
          risk: "EXTREME RISK",
          mainCount: 4,
          prelimCount: 3,
          minConfidence: 65
        }
      ];

      embed.addFields({
        name: "🔄 CROSS-CARD PARLAYS",
        value: "AI-generated cross-card parlays with our picks and analysis.\n━━━━━━━━━━━━━━━━━━━━━━", // Rephrased "Premium"
        inline: false
      });

      for (const config of parlayConfigurations) {
        const mainPicks = mainCardData
          .filter(f => f.confidence >= config.minConfidence)
          .slice(0, config.mainCount);

        const prelimPicks = prelimData
          .filter(f => f.confidence >= config.minConfidence)
          .slice(0, config.prelimCount);

        if (mainPicks.length + prelimPicks.length >= (config.mainCount + config.prelimCount)) {
          const parlay = [...mainPicks, ...prelimPicks];
          const stats = this.calculateParlayStats(parlay, oddsData);

          if (parseFloat(stats.edge) > 0 && parseFloat(stats.impliedProbability) < 100) {
            embed.addFields({
              name: `🎲 ${config.name} (${config.risk})`,
              value: [
                ...parlay.map(pick => {
                  const cardEmoji = mainPicks.includes(pick) ? "🎯" : "🥊";
                  const confEmoji = pick.confidence >= 75 ? "🔒" : "✅";
                  return `└ ${cardEmoji} ${confEmoji} ${pick.predictedWinner} (${pick.confidence}%)`;
                }),
                "",
                `└ True Parlay Probability: ${(stats.confidenceProduct * 100).toFixed(1)}%`,
                `└ Market Implied Probability: ${stats.impliedProbability}%`,
                `└ Potential Return: ${stats.potentialReturn}`,
                `└ Value Edge: ${stats.edge}%`,
                `└ Rating: ${this.getParlayRating(parseFloat(stats.edge), stats.confidenceProduct * 100)}`
              ].join('\n'),
              inline: false
            });
          }
        }
      }

      await this.addMethodProps(embed, [...mainCardData, ...prelimData], oddsData);

    } catch (error) {
      console.error('Error generating cross-card parlays:', error);
    }
  }

  static getParlayRating(edge, confidence) {
    if (edge >= 20 && confidence >= 75) return "⭐⭐⭐⭐⭐";
    if (edge >= 15 && confidence >= 70) return "⭐⭐⭐⭐";
    if (edge >= 10 && confidence >= 65) return "⭐⭐⭐";
    if (edge >= 5 && confidence >= 60) return "⭐⭐";
    return "⭐";
  }

  // Add new method for prop bets
  static async addMethodProps(embed, fights, oddsData) {
    try {
      const highConfidenceProps = fights
        .filter(fight => {
          const method = fight.probabilityBreakdown;
          return (
            (method.ko_tko >= 60 && fight.confidence >= 70) ||
            (method.submission >= 50 && fight.confidence >= 70) ||
            (method.decision >= 75 && fight.confidence >= 75)
          );
        })
        .map(fight => {
          const method = fight.probabilityBreakdown;
          const bestMethod = this.determineBestMethod(method);
          return {
            fighter: fight.predictedWinner,
            method: bestMethod.method,
            probability: bestMethod.probability,
            confidence: fight.confidence
          };
        })
        .sort((a, b) => b.probability - a.probability)
        .slice(0, 3);  // Take top 3 props

      if (highConfidenceProps.length > 0) {
        embed.addFields({
          name: "🎯 HIGH CONFIDENCE PROPS",
          value: highConfidenceProps.map(prop => {
            const methodEmoji =
              prop.method === 'KO/TKO' ? '👊' :
                prop.method === 'Submission' ? '🔄' : '📋';
            return [
              `${methodEmoji} ${prop.fighter} to win by ${prop.method}`,
              `└ Confidence: ${prop.confidence}%`,
              `└ Method Probability: ${prop.probability.toFixed(1)}%`,
              ''
            ].join('\n');
          }).join('\n'),
          inline: false
        });
      }
    } catch (error) {
      console.error('Error generating method props:', error);
    }
  }

  static determineBestMethod(methodBreakdown) {
    const methods = [
      { method: 'KO/TKO', probability: methodBreakdown.ko_tko, threshold: 60 },
      { method: 'Submission', probability: methodBreakdown.submission, threshold: 50 },
      { method: 'Decision', probability: methodBreakdown.decision, threshold: 75 }
    ];

    return methods
      .filter(m => m.probability >= m.threshold)
      .sort((a, b) => b.probability - a.probability)[0] ||
      { method: 'Unknown', probability: 0 };
  }

  static calculateParlayStats(picks, oddsData) {
    console.log("Calculating parlay stats for picks:", picks.map(p => p.predictedWinner));
    try {
      if (!picks?.length || !oddsData) {
        return {
          confidenceProduct: 0,
          impliedProbability: "0.0",
          potentialReturn: "+0.00%",
          edge: "0.0",
          rating: "⭐"
        };
      }

      const confidenceProduct = picks.reduce((product, pick) => {
        return product * (pick.confidence / 100);
      }, 1);

      let impliedProbability = 1;
      let potentialReturn = 1;

      for (const pick of picks) {
        try {
          const fightOdds = OddsAnalysis.getFightOdds(
            { fighter1: pick.fighter1, fighter2: pick.fighter2 },
            oddsData,
            "fanduel"
          );

          if (!fightOdds) {
            impliedProbability *= 0.5;
            potentialReturn *= 2;
            continue;
          }

          const selectedOdds = pick.predictedWinner === pick.fighter1
            ? fightOdds.fighter1.price
            : fightOdds.fighter2.price;

          const legProbability = OddsAnalysis.calculateImpliedProbability(selectedOdds) / 100;
          impliedProbability *= legProbability;

          if (selectedOdds > 0) {
            potentialReturn *= (1 + selectedOdds / 100);
          } else {
            potentialReturn *= (1 + 100 / Math.abs(selectedOdds));
          }
        } catch (error) {
          console.log(`Error processing odds for ${pick.predictedWinner}`);
          impliedProbability *= 0.5;
          potentialReturn *= 2;
        }
      }

      const finalImpliedProbability = (impliedProbability * 100).toFixed(1);
      const finalPotentialReturn = `+${((potentialReturn - 1) * 100).toFixed(2)}%`;
      const edge = (confidenceProduct * 100 - parseFloat(finalImpliedProbability)).toFixed(1);
      const rating = "⭐".repeat(this.calculateRating(parseFloat(edge), confidenceProduct * 100));

      return {
        confidenceProduct,
        impliedProbability: finalImpliedProbability,
        potentialReturn: finalPotentialReturn,
        edge,
        rating
      };
    } catch (error) {
      console.error("Error calculating parlay stats:", error);
      return {
        confidenceProduct: 0,
        impliedProbability: "0.0",
        potentialReturn: "+0.00%",
        edge: "0.0",
        rating: "⭐"
      };
    }
  }

  static calculateRating(edge, confidence) {
    // Enhanced rating system
    if (edge >= 20 && confidence >= 75) return 5;
    if (edge >= 15 && confidence >= 70) return 4;
    if (edge >= 10 && confidence >= 65) return 3;
    if (edge >= 5 && confidence >= 60) return 2;
    return 1;
  }

  static getFightOdds(fight, oddsData) {
    const fightOdds = OddsAnalysis.getFightOdds(
      { fighter1: fight.fighter1, fighter2: fight.fighter2 },
      oddsData,
      "fanduel"
    );

    if (!fightOdds) return null;

    return fight.predictedWinner === fight.fighter1
      ? fightOdds.fighter1.price
      : fightOdds.fighter2.price;
  }

  static calculateEdge(confidence, odds) {
    const impliedProb = OddsAnalysis.calculateImpliedProbability(odds);
    return (confidence - impliedProb).toFixed(1);
  }

  static async analyzeEventValue(mainCardData, prelimData, oddsData) {
    try {
      const allFights = [...mainCardData, ...prelimData];
      const valueAnalysis = {
        highValueFights: [],
        mediumValueFights: [],
        lowValueFights: [],
        totalEdge: 0,
        averageEdge: 0
      };

      // Analyze each fight for betting value
      for (const fight of allFights) {
        const odds = this.getFightOdds(fight, oddsData, 'fanduel');
        if (!odds) continue;

        const selectedOdds = fight.predictedWinner === fight.fighter1
          ? odds.fighter1.price
          : odds.fighter2.price;

        const impliedProbability = this.calculateImpliedProbability(selectedOdds);
        const edge = fight.confidence - impliedProbability;
        const methodConfidence = Math.max(
          fight.probabilityBreakdown.ko_tko,
          fight.probabilityBreakdown.submission,
          fight.probabilityBreakdown.decision
        );

        const fightValue = {
          fighter: fight.predictedWinner,
          confidence: fight.confidence,
          edge: edge,
          odds: selectedOdds,
          methodConfidence,
          isMainCard: mainCardData.includes(fight),
          rating: this.calculateValueRating(edge, fight.confidence, methodConfidence)
        };

        if (fightValue.rating >= 4) {
          valueAnalysis.highValueFights.push(fightValue);
        } else if (fightValue.rating >= 3) {
          valueAnalysis.mediumValueFights.push(fightValue);
        } else {
          valueAnalysis.lowValueFights.push(fightValue);
        }

        valueAnalysis.totalEdge += edge;
      }

      valueAnalysis.averageEdge = valueAnalysis.totalEdge / allFights.length;
      return valueAnalysis;
    } catch (error) {
      console.error('Error analyzing event value:', error);
      return null;
    }
  }

  static calculateValueRating(edge, confidence, methodConfidence) {
    let rating = 0;

    // Edge rating
    if (edge >= 20) rating += 2;
    else if (edge >= 10) rating += 1;

    // Confidence rating
    if (confidence >= 75) rating += 2;
    else if (confidence >= 65) rating += 1;

    // Method confidence rating
    if (methodConfidence >= 60) rating += 1;

    return rating;
  }

  static async addValueAnalysisToEmbed(embed, mainCardData, prelimData, oddsData) {
    const analysis = await this.analyzeEventValue(mainCardData, prelimData, oddsData);
    if (!analysis) return;

    const { highValueFights, mediumValueFights, averageEdge } = analysis;

    // Sort fights by rating for optimal parlay combinations
    const sortedHighValue = highValueFights.sort((a, b) => b.rating - a.rating);
    const sortedMediumValue = mediumValueFights.sort((a, b) => b.rating - a.rating);

    // Generate betting strategy recommendation
    let recommendation;
    if (sortedHighValue.length >= 3) {
      recommendation = [
        "🔥 STRONG BETTING OPPORTUNITY",
        "Multiple high-value plays identified. Consider:",
        "• Individual bets on top-rated fights",
        "• Small parlay combinations with highest-rated picks",
        "• Method props for high-confidence finishes"
      ].join("\n");
    } else if (sortedHighValue.length > 0) {
      recommendation = [
        "✅ MODERATE BETTING OPPORTUNITY",
        "Limited high-value plays available. Consider:",
        "• Selective individual bets on highest-rated fights",
        "• Conservative parlay approach"
      ].join("\n");
    } else {
      recommendation = [
        "⚠️ LIMITED BETTING VALUE",
        "Few high-value opportunities identified.",
        "Recommend reduced exposure and highly selective betting"
      ].join("\n");
    }

    // Add value analysis section
    embed.addFields({
      name: "💎 BETTING VALUE ANALYSIS",
      value: [
        `High-Value Fights Found: ${sortedHighValue.length}`,
        `Medium-Value Fights Found: ${sortedMediumValue.length}`,
        `Average Edge: ${averageEdge.toFixed(1)}%`,
        "",
        "TOP RATED OPPORTUNITIES:",
        ...sortedHighValue.slice(0, 3).map(fight =>
          `${fight.isMainCard ? "🎯" : "🥊"} ${fight.fighter} (${fight.rating}⭐) - Edge: ${fight.edge.toFixed(1)}%`
        ),
        "",
        recommendation
      ].join("\n"),
      inline: false
    });

    // Add optimal parlay combinations if high-value fights are available
    if (sortedHighValue.length >= 2) {
      const optimalParlays = this.generateOptimalParlays(sortedHighValue, sortedMediumValue);

      embed.addFields({
        name: "🌟 OPTIMIZED PARLAY COMBINATIONS", // Rephrased "PREMIUM"
        value: optimalParlays.map(parlay =>
          [
            `${parlay.rating}⭐ PARLAY:`,
            ...parlay.picks.map(pick =>
              `└ ${pick.isMainCard ? "🎯" : "🥊"} ${pick.fighter} (Edge: ${pick.edge.toFixed(1)}%)`
            ),
            `Combined Edge: ${parlay.combinedEdge.toFixed(1)}%`,
            ""
          ].join("\n")
        ).join("\n"),
        inline: false
      });
    }
  }

  static generateOptimalParlays(highValueFights, mediumValueFights) {
    const parlays = [];

    // Generate 2-3 fight combinations from high-value fights
    if (highValueFights.length >= 2) {
      const twoFightParlay = {
        picks: highValueFights.slice(0, 2),
        rating: 5,
        combinedEdge: highValueFights.slice(0, 2).reduce((sum, fight) => sum + fight.edge, 0) / 2
      };
      parlays.push(twoFightParlay);
    }

    // Add medium value fights for larger parlays if needed
    const allQualifiedFights = [...highValueFights, ...mediumValueFights.filter(f => f.edge > 10)];
    if (allQualifiedFights.length >= 3) {
      const threeFightParlay = {
        picks: allQualifiedFights.slice(0, 3),
        rating: 4,
        combinedEdge: allQualifiedFights.slice(0, 3).reduce((sum, fight) => sum + fight.edge, 0) / 3
      };
      parlays.push(threeFightParlay);
    }

    return parlays;
  }

  static createBettingLegendEmbed() {
    return new EmbedBuilder()
      .setColor("#0099ff")
      .setTitle("📖 Betting Analysis Legend")
      .setDescription(
        [
          "**Icons & Card Types**",
          "🎯 Main Card Fight",
          "🥊 Preliminary Card Fight",
          "💎 High Value Play",
          "⭐ Confidence Rating (1-5 stars)",
          "",
          "**Terms Explained**",
          "`Combined Confidence`: Averaged model confidence across picks",
          "`Implied Probability`: Market-derived win probability from odds",
          "`Edge`: Difference between confidence and implied probability",
          "`Potential Return`: Expected payout on $100 stake",
          "`Rating`: Overall play quality (⭐-⭐⭐⭐⭐⭐)",
          "",
          "**Rating System**",
          "⭐⭐⭐⭐⭐: Premium Play (20%+ edge, 70%+ confidence)",
          "⭐⭐⭐⭐: Strong Play (15%+ edge, 65%+ confidence)",
          "⭐⭐⭐: Solid Play (10%+ edge, 60%+ confidence)",
          "⭐⭐: Moderate Play (5%+ edge, 55%+ confidence)",
          "⭐: Low Confidence Play",
        ].join("\n")
      );
  }

  static async addValuePlays(embed, allFights, oddsData) {
    const underdogPicks = allFights
      .filter((fight) => {
        const odds = this.getFightOdds(fight, oddsData);
        return odds > 100 && fight.confidence >= 60;
      })
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 5);

    if (underdogPicks.length > 0) {
      embed.addFields({
        name: "🐶 UNDERDOG PICKS",
        value:
          underdogPicks
            .map((pick) => {
              const odds = this.getFightOdds(pick, oddsData);
              const edge = this.calculateEdge(pick.confidence, odds);
              const rating = this.calculateRating(edge, pick.confidence);
              return [
                `${pick.isMainCard ? "🎯" : "🥊"} ${pick.predictedWinner} (+${odds})`,
                `└ Confidence: ${pick.confidence}%`,
                `└ Implied Probability: ${OddsAnalysis.calculateImpliedProbability(odds).toFixed(1)}%`,
                `└ Edge: ${edge}%`,
                `└ Rating: ${"⭐".repeat(rating)}`,
                "",
              ].join("\n");
            })
            .join("\n") + "━━━━━━━━━━━━━━━━━━━━━━",
        inline: false,
      });
    }
  }

  static getRiskLevel(avgConfidence) {
    if (avgConfidence >= 75) return "Lower";
    if (avgConfidence >= 70) return "Medium";
    return "Higher";
  }

  static getRatingDisplay(rating) {
    return "⭐".repeat(Math.min(5, Math.max(1, rating)));
  }

  static formatOdds(odds) {
    return odds > 0 ? `+${odds}` : odds.toString();
  }

  static async handleCalculationButton(interaction) {
    try {
      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferUpdate();
      }

      // First Embed: Core Concepts
      const basicConceptsEmbed = new EmbedBuilder()
        .setColor('#0099ff')
        .setTitle('🎯 Fight Genie Analysis System - Core Concepts')
        .addFields(
          {
            name: 'Understanding The Basics',
            value: [
              '```',
              'Fight Genie analyzes three key areas:',
              '',
              '1. Fighter Analysis',
              '   • Fighting style & techniques',
              '   • Recent performance (last 12 months)',
              '   • Physical advantages',
              '',
              '2. Statistical Edge',
              '   • True win probability',
              '   • Betting market odds',
              '   • Value opportunities',
              '',
              '3. Betting Value',
              '   • Profitable opportunities',
              '   • Risk assessment',
              '   • Parlay combinations',
              '```'
            ].join('\n'),
            inline: false
          }
        );

      // Second Embed: Edge Calculation Breakdown
      const edgeCalculationEmbed = new EmbedBuilder()
        .setColor('#0099ff')
        .setTitle('🧮 Understanding Betting Edge')
        .addFields(
          {
            name: 'Converting Odds to Probability',
            value: [
              '```',
              'American Odds → Win Probability',
              '',
              'For Positive Odds (+150):',
              'Probability = 100 ÷ (Odds + 100)',
              'Example: +150 → 100/(150+100) = 40%',
              '',
              'For Negative Odds (-150):',
              'Probability = |Odds| ÷ (|Odds| + 100)',
              'Example: -150 → 150/(150+100) = 60%',
              '```'
            ].join('\n'),
            inline: false
          },
          {
            name: 'Edge Calculation Example',
            value: [
              '```',
              'Example: Fighter A vs Fighter B',
              '',
              '1. Betting Odds: Fighter A +150 (40% implied)',
              '2. Our Model: Fighter A 50% to win',
              '3. Edge = Our % - Market %',
              '   Edge = 50% - 40% = +10% Edge',
              '',
              'This means we think Fighter A wins more',
              'often than the betting market suggests',
              '```'
            ].join('\n'),
            inline: false
          }
        );

      // Third Embed: Advanced Concepts
      const advancedConceptsEmbed = new EmbedBuilder()
        .setColor('#0099ff')
        .setTitle('📊 Advanced Analysis System')
        .addFields(
          {
            name: 'Confidence Score Breakdown',
            value: [
              '```',
              'Model Confidence Formula:',
              '',
              'Base Score (30 points):',
              '• Win rate vs quality (15 pts)',
              '• UFC performance (15 pts)',
              '',
              'Style Points (25 points):',
              '• Technical matchup (15 pts)',
              '• Physical advantages (10 pts)',
              '',
              'Form Score (25 points):',
              '• Recent fights (15 pts)',
              '• Training camp (10 pts)',
              '',
              'Historical (20 points):',
              '• Career consistency (10 pts)',
              '• Big fight experience (10 pts)',
              '',
              'Total = Sum of all categories',
              'Example: 75/100 = 75% confidence',
              '```'
            ].join('\n'),
            inline: false
          },
          {
            name: 'Value Rating System',
            value: [
              '```',
              'Star Rating = Edge + Confidence',
              '',
              '⭐⭐⭐⭐⭐',
              '• 20%+ edge AND 70%+ confidence',
              '• Example: We say 75%, market says 50%',
              '',
              '⭐⭐⭐⭐',
              '• 15%+ edge AND 65%+ confidence',
              '• Example: We say 70%, market says 52%',
              '',
              '⭐⭐⭐',
              '• 10%+ edge AND 60%+ confidence',
              '• Example: We say 65%, market says 53%',
              '```'
            ].join('\n'),
            inline: false
          }
        );

      // Fourth Embed: Parlay Math
      const parlayEmbed = new EmbedBuilder()
        .setColor('#0099ff')
        .setTitle('🎲 Parlay Calculation System')
        .addFields(
          {
            name: 'Understanding Parlay Math',
            value: [
              '```',
              'Parlay Probability Formula:',
              '',
              'Total Probability = Fight1 × Fight2',
              '',
              'Example Two-Fight Parlay:',
              'Fight 1: 70% chance = 0.70',
              'Fight 2: 65% chance = 0.65',
              'Combined: 0.70 × 0.65 = 0.455',
              'Final Probability = 45.5%',
              '',
              'This is why parlays are risky!',
              'Two good chances = lower overall odds',
              '```'
            ].join('\n'),
            inline: false
          },
          {
            name: 'Smart Parlay Strategy',
            value: [
              '```',
              'Fight Genie Parlay Rules:',
              '',
              '1. High Confidence Picks Only',
              '   • Main picks: 70%+ confidence',
              '   • Value picks: 15%+ edge',
              '',
              '2. Maximum Three Fights',
              '   • Two fights = safer',
              '   • Three fights = higher risk/reward',
              '',
              '3. Style Consideration',
              '   • Don\'t parlay similar fighting styles',
              '   • Mix finishers with decision winners',
              '   • Avoid all underdogs in same parlay',
              '```'
            ].join('\n'),
            inline: false
          }
        );

      const navigationRow = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId('betting_analysis')
            .setLabel('View Current Betting Analysis')
            .setEmoji('💰')
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId('show_event')
            .setLabel('Back to Event')
            .setEmoji('↩️')
            .setStyle(ButtonStyle.Secondary)
        );

      await interaction.editReply({
        embeds: [basicConceptsEmbed, edgeCalculationEmbed, advancedConceptsEmbed, parlayEmbed],
        components: [navigationRow]
      });

    } catch (error) {
      console.error('Error displaying calculation system:', error);
      await interaction.editReply({
        content: 'Error displaying prediction system information. Please try again.',
        ephemeral: true
      });
    }
  }
}

module.exports = EventHandlers;
