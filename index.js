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
const PaymentCommand = require("./src/commands/PaymentCommand");
const PaymentHandler = require("./src/utils/PaymentHandler");
const OddsAnalysis = require("./src/utils/OddsAnalysis");
const StatsDisplayHandler = require("./src/utils/StatsDisplayHandler");
const AdminLogger = require("./src/utils/AdminLogger");
const AdminEventCommand = require("./src/commands/AdminEventCommand");
const PromoCommand = require('./src/commands/PromoCommand');
const COMMAND_PREFIX = "$";

// const ALLOWED_CHANNEL_ID = "1300201044730445864";

const MAX_RETRIES = 3;

const RETRY_DELAY = 1000;

let isClientReady = false;

require("dotenv").config();

function checkEnvironmentVariables() {
  const requiredVars = [
    // Discord Configuration
    "DISCORD_TOKEN",
    "DISCORD_CLIENT_ID",
    
    // API Keys
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "ODDS_API_KEY",
    
    // Database Configuration
    "DB_PATH",
    
    // Server Configuration
    "PORT",
    
    // Environment
    "NODE_ENV",
    
    // Bot Configuration
    "LOG_LEVEL",
    "COMMAND_PREFIX",
    
    // PayPal Configuration
    "PAYPAL_CLIENT_ID",
    "PAYPAL_CLIENT_SECRET",
    
    // Solana Configuration
    "SOLANA_RPC_URL",
    "SOLANA_MERCHANT_WALLET"

  ];

  const missing = requiredVars.filter((varName) => !process.env[varName]);
  
  // Optional variables can be checked separately
  const optionalVars = ["ALLOWED_CHANNEL_ID"];
  const missingOptional = optionalVars.filter((varName) => !process.env[varName]);
  
  if (missing.length > 0) {
    console.error(`Missing required environment variables: ${missing.join(", ")}`);
    process.exit(1);
  }
  
  if (missingOptional.length > 0) {
    console.warn(`Missing optional environment variables: ${missingOptional.join(", ")}`);
  }
  
  // Additional validation for specific environments
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

async function checkAccess(guildId, eventId = null) {
  if (!client.isReady()) {
    console.error("Error: Discord client is not ready.");

    return false;
  }

  try {
    return await database.verifyAccess(guildId, eventId);
  } catch (error) {
    console.error("Error checking access:", error);

    return false;
  }
}

client.once("ready", async () => {
  isClientReady = true;

  console.log(`Bot is ready as ${client.user.tag}`);

  // console.log("Connected to allowed channel:", ALLOWED_CHANNEL_ID);

  // Log initial stats

  await AdminLogger.logServerStats(client);

  // Log stats every 6 hours

  setInterval(async () => {
    await AdminLogger.logServerStats(client);
  }, 6 * 60 * 60 * 1000);
});

client.on("messageCreate", async (message) => {
  if (!client.isReady()) {
    console.error("Message received but client is not ready.");
    return;
  }
  // if (message.author.bot || message.channelId !== ALLOWED_CHANNEL_ID) return;
  if (!message.content.startsWith(COMMAND_PREFIX)) return;

  console.log("Received command:", message.content);
  const args = message.content.slice(COMMAND_PREFIX.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  const freeCommands = ["help", "buy"];

  try {
    switch (command) {
      case "promo":
        await PromoCommand.handlePromoCommand(message, args);
        break;

      case "checkpromos":
        await PromoCommand.handleCheckPromos(message);
        break;

      case "createnewcodes":
        await PromoCommand.handleCreateNextEventCodes(message);
        break;

      case "buy":
        await PaymentCommand.handleBuyCommand(message);
        break;

      default:
        if (!freeCommands.includes(command)) {
          const event = await database.getCurrentEvent();
          const hasAccess = await checkAccess(message.guild.id, event?.event_id);
          if (!hasAccess) {
            const embed = new EmbedBuilder()
              .setColor("#ff0000")
              .setTitle("Server Access Required")
              .setDescription(
                "This server needs to purchase access to use Fight Genie predictions."
              )
              .setAuthor({
                name: "Fight Genie",
                iconURL: "attachment://FightGenie_Logo_1.PNG",
              })
              .addFields({
                name: "How to Purchase",
                value:
                  "Use the `$buy` command to see our special lifetime access offer! Or swoop in for event access at $6.99 per event.",
              });
            await message.reply({
              embeds: [embed],
              files: [
                {
                  attachment: "./src/images/FightGenie_Logo_1.PNG",
                  name: "FightGenie_Logo_1.PNG",
                },
              ],
            });
            return;
          }
        }

        switch (command) {
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

                // Check access to determine if we should show the buy prompt
                const hasAccess = await database.verifyAccess(
                  message.guild.id,
                  event.event_id
                );

                if (!hasAccess) {
                  // Add a field to the embed prompting to buy
                  response.embeds[0].addFields({
                    name: "🔒 Access Required",
                    value: [
                      "Purchase Fight Genie access to see:",
                      "• AI-powered fight predictions",
                      "• Detailed fighter analysis",
                      "• Betting insights and recommendations",
                      "• Live odds integration",
                      "",
                      "Use `$buy` to see pricing options!",
                    ].join("\n"),
                    inline: false,
                  });

                  // Replace prediction buttons with buy button
                  response.components = [
                    new ActionRowBuilder().addComponents(
                      new ButtonBuilder()
                        .setCustomId("buy_server_access")
                        .setLabel("Get Fight Genie Access")
                        .setEmoji("🌟")
                        .setStyle(ButtonStyle.Success)
                    ),
                  ];
                }

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
              console.log(
                `Unauthorized advance attempt from guild ${message.guild?.id}`
              );
              return;
            }
            if (!message.member?.permissions.has("Administrator")) {
              await message.reply(
                "❌ This command requires administrator permissions."
              );
              return;
            }
            await AdminEventCommand.handleAdvanceEvent(message);
            break;

          case "forceupdate":
            if (message.guild?.id !== "496121279712329756") {
              console.log(
                `Unauthorized forceupdate attempt from guild ${message.guild?.id}`
              );
              return;
            }
            if (!message.member?.permissions.has("Administrator")) {
              await message.reply(
                "❌ This command requires administrator permissions."
              );
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
            await message.reply(
              `Unknown command. Use ${COMMAND_PREFIX}help to see available commands.`
            );
        }
    }
  } catch (error) {
    console.error("Command error:", error);
    await message.reply(
      "An error occurred while processing your request. Please try again later."
    );
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

      const [action, ...args] = interaction.customId.split("_");

      // Check access for prediction-related buttons
      if (
        action === "predict" ||
        action === "betting"
      ) {
        const eventId = args[args.length - 1];
        const hasAccess = await database.verifyAccess(
          interaction.guild.id,
          eventId
        );

        if (!hasAccess) {
          const embed = new EmbedBuilder()
            .setColor("#ff0000")
            .setTitle("Server Access Required")
            .setDescription(
              "This server needs to purchase access to use Fight Genie predictions."
            )
            .setAuthor({
              name: "Fight Genie",
              iconURL: "attachment://FightGenie_Logo_1.PNG",
            })
            .addFields({
              name: "How to Purchase",
              value:
                "Use the `$buy` command to see our special lifetime access offer! Or swoop in for event access at $6.99 per event.",
            });

          await interaction.editReply({
            embeds: [embed],
            files: [
              {
                attachment: "./src/images/FightGenie_Logo_1.PNG",
                name: "FightGenie_Logo_1.PNG",
              },
            ],
          });
          return;
        }
      }
      console.log("Button interaction:", {
        action,
        customId: interaction.customId
      });
      switch (action) {
        case "buy":
          await PaymentHandler.handlePayment(interaction);
          break;

        case "verify":
          if (args[0] === "payment") {
            const [orderId, serverId] = args.slice(1);
            await PaymentHandler.handlePaymentVerification(
              interaction,
              orderId,
              serverId
            );
          }
          break;

        case "update":
          if (args[0] === "stats") {
            const fighterName = args.slice(1).join(" ");
            await CheckStatsCommand.handleStatsButton(interaction, fighterName);
          }
          break;

        case "scrape":
          if (args[0] === "stats") {
            const fighterName = args.slice(1).join(" ");
            await CheckStatsCommand.handleScrapeButton(
              interaction,
              fighterName
            );
          }
          break;

        case "predict":
          const [cardType, model, eventId] = args;
          await PredictionHandler.handlePredictionRequest(
            interaction,
            cardType,
            model,
            eventId
          );
          break;

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
            // Handle direct betting_analysis button
            const event = await EventHandlers.getUpcomingEvent();
            await EventHandlers.displayBettingAnalysis(interaction, event.event_id);
          }          break;

          case "showcalculations":
            await EventHandlers.handleCalculationButton(interaction);
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
              console.log("Getting predictions for analysis:", {
                eventId: event.event_id,
                model: currentModel,
              });

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
              const eventId = args[1]; // Get eventId from button customId
              const event = await EventHandlers.getUpcomingEvent();
              if (!event) {
                await interaction.editReply({
                  content: "No upcoming events found.",
                  ephemeral: true,
                });
                return;
              }

              const currentModel = ModelCommand.getCurrentModel();
              console.log("Getting predictions for analysis:", {
                eventId: event.event_id,
                model: currentModel,
              });

              // Get stored predictions
              const predictions = await PredictionHandler.getStoredPrediction(
                event.event_id,
                "main", // Always use main card for detailed analysis
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
                // Try to send DM
                await interaction.user.send({
                  content: "Preparing detailed analysis...",
                });

                // If DM succeeds, send the analysis
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

function createHelpEmbed() {
  return new EmbedBuilder()

    .setColor("#0099ff")

    .setTitle("Fight Genie Commands")

    .setDescription("Welcome to Fight Genie! Here are the available commands:")

    .addFields(
      {
        name: "🌟 $buy",

        value:
          "```SPECIAL OFFER: Get lifetime access for $50!\nLimited launch price only!```",
      },

      {
        name: "📅 $upcoming",

        value:
          "```Show the next upcoming UFC event.\n\n• Subscribers can view predictions & analysis\n• Check data status via card dropdown menu```",
      },

      {
        name: "🤖 $model [claude/gpt]",

        value:
          "```Switch between Claude and GPT-4 for predictions\nDefault: GPT-4```",
      },

      {
        name: "📊 $stats",

        value:
          "```Compare prediction accuracy between Claude and GPT-4 models\nUpdated the following day after each event```",
      },

      {
        name: "👤 $checkstats [fighter name]",

        value:
          "```• View all fighter stats used for prediction analysis\n• Force update stats from ufcstats.com\n• Use when stats are outdated/missing via:\n  - Fight card\n  - Data status menu```",
      }
    )

    .setFooter({
      text: "Data from UFCStats.com | Powered by Claude & GPT-4 | Fight Genie 1.0",

      iconURL:
        "https://upload.wikimedia.org/wikipedia/commons/thumb/9/92/UFC_Logo.svg/2560px-UFC_Logo.svg.png",
    });
}

client.once("ready", () => {
  isClientReady = true;
  console.log(`Bot is ready as ${client.user.tag}`);

  client.user.setActivity(
    `AI UFC Predictions | $help | ${
      11 + Math.max(0, client.guilds.cache.size - 1)
    } servers`,
    { type: ActivityType.Competing }
  );
});

async function startup() {
  try {
    console.log("Initializing database...");

    await database.initializeDatabase();

    await database.createPaymentTables();

    console.log("Database initialized");

    console.log("Starting bot...");

    await client.login(process.env.DISCORD_TOKEN);

    // Wait for the 'ready' event

    await new Promise((resolve) => client.once("ready", resolve));

    console.log("Bot startup complete");
  } catch (error) {
    console.error("Startup error:", error);

    process.exit(1);
  }
}

startup();

module.exports = { client };
