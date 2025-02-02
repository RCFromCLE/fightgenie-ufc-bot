// index.js

const {
  Client,
  GatewayIntentBits,
  ActivityType,
  EmbedBuilder,
  ButtonBuilder,
  ActionRowBuilder,
  ButtonStyle,
} = require("discord.js");

const EventHandlers = require("./src/utils/eventHandlers");
const PredictCommand = require("./src/commands/predict");
const ModelCommand = require("./src/commands/ModelCommand");
const ModelStatsCommand = require("./src/commands/ModelStatsCommand");
const CheckStatsCommand = require("./src/commands/CheckStatsCommand");
const database = require("./src/database");
const FighterStats = require("./src/utils/fighterStats");
const DataValidator = require("./src/utils/DataValidator");
const PredictionHandler = require("./src/utils/PredictionHandler");
const OddsAnalysis = require("./src/utils/OddsAnalysis");
const StatsDisplayHandler = require("./src/utils/StatsDisplayHandler");
const AdminLogger = require("./src/utils/AdminLogger");
const AdminEventCommand = require("./src/commands/AdminEventCommand");
const MarketAnalysis = require("./src/utils/MarketAnalysis");
const TweetAutomation = require("./src/utils/TweetAutomation");
const AdminPredictionCommand = require('./src/commands/AdminPredictionCommand');

const COMMAND_PREFIX = "$";
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000;

let isClientReady = false;

require("dotenv").config();

function checkEnvironmentVariables() {
  const requiredVars = [
    "DISCORD_TOKEN",
    "DISCORD_CLIENT_ID",
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "ODDS_API_KEY",
    "DB_PATH",
    "PORT",
    "NODE_ENV",
    "LOG_LEVEL",
    "COMMAND_PREFIX",
    "SOLANA_RPC_URL",
    "TWITTER_API_KEY",
    "TWITTER_API_SECRET",
    "TWITTER_ACCESS_TOKEN",
    "TWITTER_ACCESS_SECRET"
  ];

  const missing = requiredVars.filter((varName) => !process.env[varName]);

  if (missing.length > 0) {
    console.error(`Missing required environment variables: ${missing.join(", ")}`);
    process.exit(1);
  }

  if (process.env.NODE_ENV !== 'development' && process.env.NODE_ENV !== 'production') {
    console.error('NODE_ENV must be either "development" or "production"');
    process.exit(1);
  }

  console.log('Environment variables validation completed successfully');
}

checkEnvironmentVariables();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
  ],
});

global.discordClient = client;

async function retryCommand(fn, maxRetries = MAX_RETRIES) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      console.error(`Attempt ${i + 1} failed:`, error);
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY));
    }
  }
}

client.once("ready", async () => {
  isClientReady = true;
  console.log(`Bot is ready as ${client.user.tag}`);
  await AdminLogger.logServerStats(client);
  setInterval(async () => {
    await AdminLogger.logServerStats(client);
  }, 6 * 60 * 60 * 1000);
});

client.on("messageCreate", async (message) => {
  if (!client.isReady()) {
    console.error("Message received but client is not ready.");
    return;
  }
  if (!message.content.startsWith(COMMAND_PREFIX)) return;

  console.log("Received command:", message.content);
  const args = message.content.slice(COMMAND_PREFIX.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  try {
    switch (command) {
      case "syncpredictions":
        if (message.guild?.id !== "496121279712329756") {
          console.log(`Unauthorized syncpredictions attempt from guild ${message.guild?.id}`);
          return;
        }
        if (!message.member?.permissions.has("Administrator")) {
          await message.reply("❌ This command requires administrator permissions.");
          return;
        }
        await AdminPredictionCommand.handleSyncPredictions(message);
        break;

      case "upcoming":
        await retryCommand(async () => {
          const loadingEmbed = new EmbedBuilder()
            .setColor("#ffff00")
            .setTitle("Loading Upcoming Event Data")
            .setDescription("Fetching upcoming event information...");
          const loadingMsg = await message.reply({ embeds: [loadingEmbed] });

          try {
            const event = await EventHandlers.getUpcomingEvent();
            if (!event) {
              await loadingMsg.edit({
                content: "No upcoming events found.",
                embeds: [],
              });
              return;
            }

            const response = await EventHandlers.createEventEmbed(event, false);
            await loadingMsg.edit(response);
          } catch (error) {
            console.error("Error creating upcoming event embed:", error);
            await loadingMsg.edit({
              content: "Error loading upcoming event data. Please try again.",
              embeds: [],
            });
          }
        });
        break;

      case "model":
        await ModelCommand.handleModelCommand(message, args);
        break;

      case "advance":
        if (message.guild?.id !== "496121279712329756") {
          console.log(`Unauthorized advance attempt from guild ${message.guild?.id}`);
          return;
        }
        if (!message.member?.permissions.has("Administrator")) {
          await message.reply("❌ This command requires administrator permissions.");
          return;
        }
        await AdminEventCommand.handleAdvanceEvent(message);
        break;

      case "forceupdate":
        if (message.guild?.id !== "496121279712329756") {
          console.log(`Unauthorized forceupdate attempt from guild ${message.guild?.id}`);
          return;
        }
        if (!message.member?.permissions.has("Administrator")) {
          await message.reply("❌ This command requires administrator permissions.");
          return;
        }
        await AdminEventCommand.forceUpdateCurrentEvent(message);
        break;

      case "checkstats":
        await CheckStatsCommand.handleCheckStats(message, args);
        break;

      case "stats":
        await ModelStatsCommand.handleModelStatsCommand(message);
        break;

      case "help":
        const helpEmbed = createHelpEmbed();
        await message.reply({ embeds: [helpEmbed] });
        break;

      default:
        await message.reply(`Unknown command. Use ${COMMAND_PREFIX}help to see available commands.`);
    }
  } catch (error) {
    console.error("Command error:", error);
    await message.reply("An error occurred while processing your request. Please try again later.");
  }
});
client.on("interactionCreate", async (interaction) => {
  if (!client.isReady()) {
    console.error("Interaction received but client is not ready.");
    return;
  }

  try {
    // Handle Select Menus
    if (interaction.isStringSelectMenu()) {
      // Handle view_historical_predictions select menu
      if (interaction.customId === "view_historical_predictions") {
        const [type, eventId, timestamp] = interaction.values[0].split("_");
        if (type === "event") {
          await ModelStatsCommand.handleHistoricalView(interaction);
        }
        return;
      }

      if (interaction.customId.startsWith("fighter_stats_")) {
        const selectedValue = interaction.values[0];
        if (selectedValue === "all_data_status") {
          await EventHandlers.handleShowFighterDataStatus(interaction);
        } else {
          const fighterName = selectedValue.split(":")[1];
          if (fighterName) {
            await StatsDisplayHandler.handleShowFighterStats(interaction);
          }
        }
      }
      return;
    }

    if (interaction.isButton()) {
      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferUpdate().catch(console.error);
      }

      // Special handling for market analysis
      let action, args;
      if (interaction.customId.startsWith('market_analysis')) {
        action = 'market_analysis';
        args = interaction.customId.split('_').slice(2); // Skip 'market' and 'analysis'
      } else {
        [action, ...args] = interaction.customId.split("_");
      }

      switch (action) {
        case "predict":
          const [cardType, model, eventId] = args;
          await PredictionHandler.handlePredictionRequest(
            interaction,
            cardType,
            model,
            eventId
          );
          break;

        case 'market_analysis': {
          const eventId = args[0];
          try {
            if (!interaction.deferred && !interaction.replied) {
              await interaction.deferUpdate();
            }

            const event = await EventHandlers.getUpcomingEvent();
            if (!event) {
              await interaction.editReply({
                content: "No upcoming events found.",
                ephemeral: true
              });
              return;
            }

            const currentModel = ModelCommand.getCurrentModel();

            // First check if we have recent analysis stored
            const storedAnalysis = await database.query(`
                SELECT analysis_data, created_at
                FROM market_analysis
                WHERE event_id = ? 
                AND model_used = ?
                AND created_at > datetime('now', '-1 hour')
                ORDER BY created_at DESC LIMIT 1
            `, [event.event_id, currentModel]);

            let marketAnalysis;
            let oddsData;

            if (storedAnalysis?.length > 0) {
              console.log('Using stored market analysis');
              marketAnalysis = JSON.parse(storedAnalysis[0].analysis_data);
              oddsData = marketAnalysis.oddsData;
            } else {
              console.log('Generating new market analysis');
              // Get predictions and odds
              const [mainCardPredictions, prelimPredictions, freshOddsData] = await Promise.all([
                PredictionHandler.getStoredPrediction(event.event_id, "main", currentModel),
                PredictionHandler.getStoredPrediction(event.event_id, "prelims", currentModel),
                OddsAnalysis.fetchUFCOdds()
              ]);

              // Process fights and find best value plays
              const allFights = [...(mainCardPredictions?.fights || []), ...(prelimPredictions?.fights || [])];
              oddsData = freshOddsData;

              // Calculate edges and sort by value
              const processedFights = allFights.map(fight => {
                const odds = OddsAnalysis.getFightOdds(fight, oddsData, 'fanduel');
                const impliedProb = odds ? OddsAnalysis.calculateImpliedProbability(
                  fight.predictedWinner === fight.fighter1 ? odds.fighter1?.price : odds.fighter2?.price
                ) : 0;
                return {
                  ...fight,
                  impliedProbability: impliedProb,
                  edge: fight.confidence - impliedProb,
                  valueRating: MarketAnalysis.calculateValueRating(fight.confidence - impliedProb)
                };
              });

              // Store the analysis
              await database.query(`
                INSERT INTO market_analysis (
                    event_id,
                    model_used,
                    analysis_data,
                    created_at
                ) VALUES (?, ?, ?, datetime('now'))
              `, [
                event.event_id,
                currentModel,
                JSON.stringify({
                  processedFights,
                  oddsData,
                  timestamp: new Date().toISOString()
                })
              ]);

              marketAnalysis = { processedFights, oddsData };
            }

            // Get top value plays (edge > 10% and confidence > 65%)
            const topValuePlays = marketAnalysis.processedFights
              .filter(fight => fight.edge > 10 && fight.confidence > 65)
              .sort((a, b) => b.edge - a.edge)
              .slice(0, 3);

            // Best main card and prelim picks
            const mainCardPicks = marketAnalysis.processedFights
              .filter(fight => fight.is_main_card === 1 && fight.edge > 7.5)
              .sort((a, b) => b.confidence - a.confidence)
              .slice(0, 2);

            const prelimPicks = marketAnalysis.processedFights
              .filter(fight => fight.is_main_card === 0 && fight.edge > 7.5)
              .sort((a, b) => b.confidence - a.confidence)
              .slice(0, 2);

            const modelEmoji = currentModel === "gpt" ? "🧠" : "🤖";
            const modelName = currentModel === "gpt" ? "GPT-4o" : "Claude-3.5";

            // Create main analysis embed
            const marketAnalysisEmbed = new EmbedBuilder()
              .setColor("#00ff00")
              .setTitle(`🎯 UFC Market Intelligence Report ${modelEmoji}`)
              .setDescription([
                `*Advanced Analysis by ${modelName} Fight Analytics*`,
                `Event: ${event.Event}`,
                `Date: ${new Date(event.Date).toLocaleDateString()}`,
                "",
                "Last Updated: " + new Date().toLocaleString(),
                "\n━━━━━━━━━━━━━━━━━━━━━━\n"
              ].join('\n'))
              .addFields(
                {
                  name: "💎 Top Value Plays",
                  value: topValuePlays.map(fight =>
                    `${getValueStars(fight.edge)} ${fight.predictedWinner} (${fight.confidence}% vs ${fight.impliedProbability.toFixed(1)}% implied)\n` +
                    `└ Edge: ${fight.edge.toFixed(1)}% | Method: ${fight.method}`
                  ).join('\n\n') || "No significant value plays found",
                  inline: false
                },
                {
                  name: "🎯 Best Main Card Picks",
                  value: mainCardPicks.map(fight =>
                    `${getValueStars(fight.edge)} ${fight.predictedWinner}\n` +
                    `└ ${fight.method} (${fight.confidence}% conf) | Edge: ${fight.edge.toFixed(1)}%`
                  ).join('\n\n') || "No strong main card picks",
                  inline: false
                },
                {
                  name: "🥊 Best Prelim Picks",
                  value: prelimPicks.map(fight =>
                    `${getValueStars(fight.edge)} ${fight.predictedWinner}\n` +
                    `└ ${fight.method} (${fight.confidence}% conf) | Edge: ${fight.edge.toFixed(1)}%`
                  ).join('\n\n') || "No strong prelim picks",
                  inline: false
                }
              );

            // Create explanation embed
            const explanationEmbed = new EmbedBuilder()
              .setColor("#0099ff")
              .setTitle("🎓 Understanding Value Ratings")
              .addFields(
                {
                  name: "⭐ Star Rating System",
                  value: [
                    "⭐⭐⭐⭐⭐ = Elite Value (20%+ edge)",
                    "⭐⭐⭐⭐ = Strong Value (15%+ edge)",
                    "⭐⭐⭐ = Good Value (10%+ edge)",
                    "⭐⭐ = Decent Value (7.5%+ edge)",
                    "⭐ = Slight Value (5%+ edge)",
                    "",
                    "**How We Calculate Edge:**",
                    "Edge = Our Confidence - Implied Probability",
                    "Example: 70% confidence vs 55% implied = 15% edge"
                  ].join('\n'),
                  inline: false
                }
              );

            const navigationRow = new ActionRowBuilder()
              .addComponents(
                new ButtonBuilder()
                  .setCustomId(`predict_main_${currentModel}_${event.event_id}`)
                  .setLabel("Back to AI Predictions")
                  .setEmoji("📊")
                  .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                  .setCustomId(`betting_analysis_${event.event_id}`)
                  .setLabel("AI Betting Analysis")
                  .setEmoji("💰")
                  .setStyle(ButtonStyle.Success)
              );

            await interaction.editReply({
              embeds: [marketAnalysisEmbed, explanationEmbed],
              components: [navigationRow],
              files: [{
                attachment: "./src/images/FightGenie_Logo_1.PNG",
                name: "FightGenie_Logo_1.PNG"
              }]
            });

          } catch (error) {
            console.error("Error displaying market analysis:", error);
            await interaction.editReply({
              content: "Error generating market analysis. Please try again.",
              ephemeral: true
            });
          }
          break;
        }

        case "prev":
        case "next":
        case "analysis":
          await EventHandlers.handleButtonInteraction(interaction);
          break;

        case "betting":
          if (args[0] === "analysis") {
            const eventId = args[1];
            await EventHandlers.displayBettingAnalysis(interaction, eventId);
          } else if (!args.length) {
            const event = await EventHandlers.getUpcomingEvent();
            await EventHandlers.displayBettingAnalysis(interaction, event.event_id);
          }
          break;

        case "showcalculations":
          await EventHandlers.handleCalculationButton(interaction);
          break;

        case "show":
          if (args[0] === "event") {
            await PredictCommand.handleShowEvent(interaction);
          } else if (args[0] === "odds") {
            const [bookmaker, eventId] = args.slice(1);
            await OddsAnalysis.handleOddsCommand(
              interaction,
              null,
              eventId,
              bookmaker,
              "main"
            );
          }
          break;

        case "odds":
          if (args[0] === "fanduel" || args[0] === "draftkings") {
            const [bookmaker, cardType, eventId] = args;
            await OddsAnalysis.handleOddsCommand(
              interaction,
              null,
              eventId,
              bookmaker,
              cardType
            );
          } else if (args[0] === "main" || args[0] === "prelims") {
            const [cardType, bookmaker, eventId] = args;
            await OddsAnalysis.handleOddsCommand(
              interaction,
              null,
              eventId,
              bookmaker,
              cardType
            );
          }
          break;

        case "toggle":
          if (args[0] === "prelims") {
            await PredictCommand.handlePrelimToggle(interaction);
          }
          break;

        case "get":
          if (args[0] === "analysis") {
            try {
              const event = await EventHandlers.getUpcomingEvent();
              if (!event) {
                await interaction.editReply({
                  content: "No upcoming events found.",
                  ephemeral: true,
                });
                return;
              }

              const currentModel = ModelCommand.getCurrentModel();
              const predictions = await PredictionHandler.getStoredPrediction(
                event.event_id,
                "main",
                currentModel
              );

              if (!predictions) {
                await interaction.editReply({
                  content:
                    "No predictions found for this event. Please generate predictions first.",
                  ephemeral: true,
                });
                return;
              }

              try {
                await interaction.user.send({
                  content: "Preparing detailed analysis...",
                });

                await PredictionHandler.sendDetailedAnalysis(
                  interaction,
                  predictions,
                  event,
                  currentModel
                );
              } catch (dmError) {
                console.error("DM Error:", dmError);
                await interaction.editReply({
                  content:
                    "❌ Unable to send detailed analysis. Please make sure your DMs are open.",
                  ephemeral: true,
                });
              }
            } catch (error) {
              console.error("Error handling analysis request:", error);
              await interaction.editReply({
                content: "Error generating analysis. Please try again.",
                ephemeral: true,
              });
            }
          }
          break;

        default:
          console.log(`Unknown interaction: ${interaction.customId}`);
      }
    }

  } catch (error) {
    console.error("Interaction error:", error);
    try {
      const errorMessage = "Error processing request. Please try again.";
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: errorMessage, ephemeral: true });
      } else {
        await interaction.followUp({ content: errorMessage, ephemeral: true });
      }
    } catch (replyError) {
      console.error("Error sending error message:", replyError);
    }
  }
});

function getValueStars(edge) {
  if (edge >= 20) return "⭐⭐⭐⭐⭐";
  if (edge >= 15) return "⭐⭐⭐⭐";
  if (edge >= 10) return "⭐⭐⭐";
  if (edge >= 7.5) return "⭐⭐";
  if (edge >= 5) return "⭐";
  return "";
}

function createHelpEmbed() {
  return new EmbedBuilder()
    .setColor("#0099ff")
    .setTitle("Fight Genie Commands")
    .setDescription("Welcome to Fight Genie! Here are the available commands:")
    .addFields(
      {
        name: "📅 $upcoming",
        value: "```Show the next upcoming UFC event with predictions & analysis```",
      },
      {
        name: "🤖 $model [Claude-3.5/gpt]",
        value: "```Switch between Claude-3.5 and GPT-4o for predictions\nDefault: GPT-4o```",
      },
      {
        name: "📊 $stats",
        value: "```Compare prediction accuracy between Claude-3.5 and GPT-4o models\nUpdated the following day after each event```",
      },
      {
        name: "👤 $checkstats [fighter name]",
        value: "```• View all fighter stats used for prediction analysis\n• Force update stats from ufcstats.com\n• Use when stats are outdated/missing```",
      }
    )
    .setFooter({
      text: "Data from UFCStats.com | Powered by Claude-3.5 & GPT-4o | Fight Genie 1.0",
      iconURL: "https://upload.wikimedia.org/wikipedia/commons/thumb/9/92/UFC_Logo.svg/2560px-UFC_Logo.svg.png",
    });
}

client.once("ready", () => {
  isClientReady = true;
  console.log(`Bot is ready as ${client.user.tag}`);
  client.user.setActivity(`AI UFC Predictions | $help | ${11 + Math.max(0, client.guilds.cache.size - 1)} servers`, { type: ActivityType.Competing });
});

async function startup() {
  try {
    console.log("Initializing database...");
    await database.initializeDatabase();
    console.log("Database initialized");

    const events = await database.query(`
      SELECT Event, Date, event_id 
      FROM events 
      WHERE Date >= date('now')
      ORDER BY Date ASC
      LIMIT 5
    `);
    console.log("\n=== DEBUG: Upcoming Events ===");
    console.log(events);

    console.log("Starting bot...");
    await client.login(process.env.DISCORD_TOKEN);
    
    // Wait for the 'ready' event
    await new Promise((resolve) => client.once("ready", resolve));
    console.log("Bot startup complete");

    // Initialize and schedule tweet automation
    console.log("Initializing tweet automation...");
    const tweetBot = new TweetAutomation();
    await tweetBot.scheduleTweets();
    console.log("Tweet automation initialized");

  } catch (error) {
    console.error("Startup error:", error);
    process.exit(1);
  }
}

startup();

module.exports = { client };