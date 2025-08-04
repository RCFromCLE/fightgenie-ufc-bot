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
const DonateCommand = require("./src/commands/DonateCommand"); // Added DonateCommand
const SubscriptionCommand = require("./src/commands/SubscriptionCommand"); // Ensure SubscriptionCommand is imported if not already
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
const UpdateFighterStatsCommand = require('./src/commands/UpdateFighterStatsCommand');
// Removed PaymentCommand and related service imports as they are no longer needed
// const PaymentCommand = require("./src/commands/PaymentCommand");
// const PaymentHandler = require("./src/utils/PaymentHandler");
// const PayPalService = require("./src/utils/PayPalService");
// const StripePaymentService = require("./src/utils/StripePaymentService");
// const SolanaPaymentService = require("./src/utils/SolanaPaymentService");
// const SolanaPriceService = require("./src/utils/SolanaPriceService");

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
        
      case "updatefighterstats":
        if (message.guild?.id !== "496121279712329756") {
          console.log(`Unauthorized updatefighterstats attempt from guild ${message.guild?.id}`);
          return;
        }
        if (!message.member?.permissions.has("Administrator")) {
          await message.reply("❌ This command requires administrator permissions.");
          return;
        }
        await UpdateFighterStatsCommand.handleUpdateAllFighterStats(message);
        break;
        
      case "runallpredictions":
        if (message.guild?.id !== "496121279712329756") {
          console.log(`Unauthorized runallpredictions attempt from guild ${message.guild?.id}`);
          return;
        }
        if (!message.member?.permissions.has("Administrator")) {
          await message.reply("❌ This command requires administrator permissions.");
          return;
        }
        
        try {
          const loadingEmbed = new EmbedBuilder()
            .setColor('#ffff00')
            .setTitle('🔄 Running All Predictions')
            .setDescription([
              'Generating predictions for:',
              '• Main Card - GPT',
              '• Main Card - Claude',
              '• Preliminary Card - GPT',
              '• Preliminary Card - Claude',
              '',
              'This may take a few minutes. Please wait...'
            ].join('\n'));
          
          const loadingMsg = await message.reply({ embeds: [loadingEmbed] });
          
          // Get the event
          const event = await EventHandlers.getUpcomingEvent();
          if (!event) {
            await loadingMsg.edit({
              content: "No upcoming events found.",
              embeds: []
            });
            return;
          }
          
          // Create a mock interaction object for the PredictionHandler
          const mockInteraction = {
            editReply: async (content) => {
              await loadingMsg.edit(content);
            },
            deferUpdate: async () => {},
            deferred: true,
            replied: true,
            message: loadingMsg
          };
          
          // Run all predictions sequentially
          const results = [];
          
          // Main Card - GPT
          try {
            await PredictionHandler.generateNewPredictions(mockInteraction, event, "main", "gpt");
            results.push("✅ Main Card - GPT");
          } catch (error) {
            console.error("Error generating Main Card GPT predictions:", error);
            results.push("❌ Main Card - GPT");
          }
          
          // Main Card - Claude
          try {
            await PredictionHandler.generateNewPredictions(mockInteraction, event, "main", "claude");
            results.push("✅ Main Card - Claude");
          } catch (error) {
            console.error("Error generating Main Card Claude predictions:", error);
            results.push("❌ Main Card - Claude");
          }
          
          // Prelims - GPT
          try {
            await PredictionHandler.generateNewPredictions(mockInteraction, event, "prelims", "gpt");
            results.push("✅ Preliminary Card - GPT");
          } catch (error) {
            console.error("Error generating Prelim GPT predictions:", error);
            results.push("❌ Preliminary Card - GPT");
          }
          
          // Prelims - Claude
          try {
            await PredictionHandler.generateNewPredictions(mockInteraction, event, "prelims", "claude");
            results.push("✅ Preliminary Card - Claude");
          } catch (error) {
            console.error("Error generating Prelim Claude predictions:", error);
            results.push("❌ Preliminary Card - Claude");
          }
          
          // Create completion embed
          const completionEmbed = new EmbedBuilder()
            .setColor('#00ff00')
            .setTitle('✅ Predictions Generated')
            .setDescription([
              `Generated predictions for ${event.Event}:`,
              '',
              ...results,
              '',
              'Use `$upcoming` to view the event and access predictions.'
            ].join('\n'));
          
          const viewEventButton = new ActionRowBuilder()
            .addComponents(
              new ButtonBuilder()
                .setCustomId(`view_event_${event.event_id}`)
                .setLabel('View Event')
                .setEmoji('👁️')
                .setStyle(ButtonStyle.Primary)
            );
          
          await loadingMsg.edit({
            embeds: [completionEmbed],
            components: [viewEventButton]
          });
          
        } catch (error) {
          console.error("Error running all predictions:", error);
          await message.reply("Error generating predictions. Please try again.");
        }
        break;

      case "checkstats":
        await CheckStatsCommand.handleCheckStats(message, args);
        break;

      case "stats":
        await ModelStatsCommand.handleModelStatsCommand(message);
        break;

      // Added donate command
      case "donate":
        await DonateCommand.handleDonateCommand(message);
        break;

      // Keep sub command (now repurposed)
      case "sub":
        await SubscriptionCommand.handleSubscriptionStatus(message);
        break;

      case "help":
        const helpEmbed = createHelpEmbed();
        await message.reply({ embeds: [helpEmbed] });
        break;

      // Removed buy command case
      // case "buy":
      //   await PaymentCommand.handleBuyCommand(message);
      //   break;

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

  // Check interaction age immediately - Discord interactions expire after 3 seconds for initial response
  const interactionAge = Date.now() - interaction.createdTimestamp;
  if (interactionAge > 2800) { // 2.8 seconds - slightly less conservative to allow more interactions through
    console.log(`Interaction too old (${interactionAge}ms), ignoring to prevent errors`);
    return;
  }

  try {
    // Handle Slash Commands
    if (interaction.isChatInputCommand()) {
      const { commandName } = interaction;

      // Immediately defer all slash commands to prevent timeout
      try {
        await interaction.deferReply();
      } catch (error) {
        console.error("Failed to defer slash command interaction:", error);
        return;
      }

      switch (commandName) {
        case 'upcoming':
          await retryCommand(async () => {
            
            try {
              const event = await EventHandlers.getUpcomingEvent();
              if (!event) {
                await interaction.editReply({
                  content: "No upcoming events found.",
                });
                return;
              }

              const response = await EventHandlers.createEventEmbed(event, false);
              await interaction.editReply(response);
            } catch (error) {
              console.error("Error creating upcoming event embed:", error);
              await interaction.editReply({
                content: "Error loading upcoming event data. Please try again.",
              });
            }
          });
          break;

        case 'predict':
          const fighter1 = interaction.options.getString('fighter1');
          const fighter2 = interaction.options.getString('fighter2');
          const card = interaction.options.getString('card');
          const model = interaction.options.getString('model');
          
          if (fighter1 && fighter2) {
            // Handle specific fighter prediction
            await interaction.editReply({
              content: `Prediction for ${fighter1} vs ${fighter2} is not yet implemented via slash commands. Please use the /upcoming command and use the buttons to generate predictions.`
            });
          } else {
            // Show upcoming event with prediction options
            await retryCommand(async () => {
              
              try {
                const event = await EventHandlers.getUpcomingEvent();
                if (!event) {
                  await interaction.editReply({
                    content: "No upcoming events found.",
                  });
                  return;
                }

                const response = await EventHandlers.createEventEmbed(event, false);
                await interaction.editReply(response);
              } catch (error) {
                console.error("Error creating upcoming event embed:", error);
                await interaction.editReply({
                  content: "Error loading upcoming event data. Please try again.",
                });
              }
            });
          }
          break;

        case 'model':
          const modelType = interaction.options.getString('type');
          if (modelType) {
            await ModelCommand.handleModelCommand(interaction, [modelType]);
          } else {
            await ModelCommand.handleModelCommand(interaction, []);
          }
          break;

        case 'stats':
          const fighterName = interaction.options.getString('fighter');
          if (fighterName) {
            await CheckStatsCommand.handleCheckStats(interaction, [fighterName]);
          } else {
            await ModelStatsCommand.handleModelStatsCommand(interaction);
          }
          break;

        case 'checkstats':
          const fighter = interaction.options.getString('fighter');
          await CheckStatsCommand.handleCheckStats(interaction, [fighter]);
          break;

        case 'donate':
          await DonateCommand.handleDonateCommand(interaction);
          break;

        case 'sub':
          await SubscriptionCommand.handleSubscriptionStatus(interaction);
          break;

        case 'help':
          const helpEmbed = createSlashHelpEmbed();
          await interaction.editReply({ embeds: [helpEmbed] });
          break;

        case 'admin':
          const subcommand = interaction.options.getSubcommand();
          
          // Check permissions
          if (interaction.guild?.id !== "496121279712329756") {
            console.log(`Unauthorized admin attempt from guild ${interaction.guild?.id}`);
            await interaction.editReply({ content: "❌ Admin commands are not available in this server.", ephemeral: true });
            return;
          }
          if (!interaction.member?.permissions.has("Administrator")) {
            await interaction.editReply({ content: "❌ This command requires administrator permissions.", ephemeral: true });
            return;
          }

          switch (subcommand) {
            case 'advance':
              await AdminEventCommand.handleAdvanceEvent(interaction);
              break;
            case 'forceupdate':
              await AdminEventCommand.forceUpdateCurrentEvent(interaction);
              break;
            case 'updatefighterstats':
              await UpdateFighterStatsCommand.handleUpdateAllFighterStats(interaction);
              break;
            case 'runallpredictions':
              try {
                const loadingEmbed = new EmbedBuilder()
                  .setColor('#ffff00')
                  .setTitle('🔄 Running All Predictions')
                  .setDescription([
                    'Generating predictions for:',
                    '• Main Card - GPT',
                    '• Main Card - Claude',
                    '• Preliminary Card - GPT',
                    '• Preliminary Card - Claude',
                    '',
                    'This may take a few minutes. Please wait...'
                  ].join('\n'));
                
                await interaction.editReply({ embeds: [loadingEmbed] });
                
                // Get the event
                const event = await EventHandlers.getUpcomingEvent();
                if (!event) {
                  await interaction.editReply({
                    content: "No upcoming events found.",
                  });
                  return;
                }
                
                // Run all predictions sequentially
                const results = [];
                
                // Main Card - GPT
                try {
                  await PredictionHandler.generateNewPredictions(interaction, event, "main", "gpt");
                  results.push("✅ Main Card - GPT");
                } catch (error) {
                  console.error("Error generating Main Card GPT predictions:", error);
                  results.push("❌ Main Card - GPT");
                }
                
                // Main Card - Claude
                try {
                  await PredictionHandler.generateNewPredictions(interaction, event, "main", "claude");
                  results.push("✅ Main Card - Claude");
                } catch (error) {
                  console.error("Error generating Main Card Claude predictions:", error);
                  results.push("❌ Main Card - Claude");
                }
                
                // Prelims - GPT
                try {
                  await PredictionHandler.generateNewPredictions(interaction, event, "prelims", "gpt");
                  results.push("✅ Preliminary Card - GPT");
                } catch (error) {
                  console.error("Error generating Prelim GPT predictions:", error);
                  results.push("❌ Preliminary Card - GPT");
                }
                
                // Prelims - Claude
                try {
                  await PredictionHandler.generateNewPredictions(interaction, event, "prelims", "claude");
                  results.push("✅ Preliminary Card - Claude");
                } catch (error) {
                  console.error("Error generating Prelim Claude predictions:", error);
                  results.push("❌ Preliminary Card - Claude");
                }
                
                // Create completion embed
                const completionEmbed = new EmbedBuilder()
                  .setColor('#00ff00')
                  .setTitle('✅ Predictions Generated')
                  .setDescription([
                    `Generated predictions for ${event.Event}:`,
                    '',
                    ...results,
                    '',
                    'Use `/upcoming` to view the event and access predictions.'
                  ].join('\n'));
                
                const viewEventButton = new ActionRowBuilder()
                  .addComponents(
                    new ButtonBuilder()
                      .setCustomId(`view_event_${event.event_id}`)
                      .setLabel('View Event')
                      .setEmoji('👁️')
                      .setStyle(ButtonStyle.Primary)
                  );
                
                await interaction.editReply({
                  embeds: [completionEmbed],
                  components: [viewEventButton]
                });
                
              } catch (error) {
                console.error("Error running all predictions:", error);
                await interaction.editReply("Error generating predictions. Please try again.");
              }
              break;
            case 'syncpredictions':
              await AdminPredictionCommand.handleSyncPredictions(interaction);
              break;
          }
          break;

        default:
          await interaction.editReply({ content: `Unknown command: ${commandName}`, ephemeral: true });
      }
      return;
    }

    // Handle Select Menus
    if (interaction.isStringSelectMenu()) {
      // Defer select menu interactions immediately
      try {
        await interaction.deferUpdate();
      } catch (error) {
        console.error("Failed to defer select menu interaction:", error);
        return;
      }

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
      // Defer button interactions immediately
      try {
        await interaction.deferUpdate();
      } catch (error) {
        // If deferUpdate fails, it might already be deferred or replied to
        if (error.code === 40060) {
          console.log("Button interaction already acknowledged, continuing...");
        } else {
          console.error("Failed to defer button interaction:", error);
          return;
        }
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
        case "run_all_predictions":
          const eventId = args[0];
          try {
            
            const loadingEmbed = new EmbedBuilder()
              .setColor('#ffff00')
              .setTitle('🔄 Running All Predictions')
              .setDescription([
                'Generating predictions for:',
                '• Main Card - GPT',
                '• Main Card - Claude',
                '• Preliminary Card - GPT',
                '• Preliminary Card - Claude',
                '',
                'This may take a few minutes. Please wait...'
              ].join('\n'));
            
            await interaction.editReply({ 
              embeds: [loadingEmbed],
              components: [] 
            });
            
            // Get the event
            const event = await EventHandlers.getUpcomingEvent();
            if (!event) {
              await interaction.editReply({
                content: "No upcoming events found.",
                embeds: []
              });
              return;
            }
            
            // Run all predictions sequentially
            const results = [];
            
            // Main Card - GPT
            try {
              await PredictionHandler.generateNewPredictions(interaction, event, "main", "gpt");
              results.push("✅ Main Card - GPT");
            } catch (error) {
              console.error("Error generating Main Card GPT predictions:", error);
              results.push("❌ Main Card - GPT");
            }
            
            // Main Card - Claude
            try {
              await PredictionHandler.generateNewPredictions(interaction, event, "main", "claude");
              results.push("✅ Main Card - Claude");
            } catch (error) {
              console.error("Error generating Main Card Claude predictions:", error);
              results.push("❌ Main Card - Claude");
            }
            
            // Prelims - GPT
            try {
              await PredictionHandler.generateNewPredictions(interaction, event, "prelims", "gpt");
              results.push("✅ Preliminary Card - GPT");
            } catch (error) {
              console.error("Error generating Prelim GPT predictions:", error);
              results.push("❌ Preliminary Card - GPT");
            }
            
            // Prelims - Claude
            try {
              await PredictionHandler.generateNewPredictions(interaction, event, "prelims", "claude");
              results.push("✅ Preliminary Card - Claude");
            } catch (error) {
              console.error("Error generating Prelim Claude predictions:", error);
              results.push("❌ Preliminary Card - Claude");
            }
            
            // Create completion embed
            const completionEmbed = new EmbedBuilder()
              .setColor('#00ff00')
              .setTitle('✅ Predictions Generated')
              .setDescription([
                `Generated predictions for ${event.Event}:`,
                '',
                ...results,
                '',
                'Use `$upcoming` to view the event and access predictions.'
              ].join('\n'));
            
            const viewEventButton = new ActionRowBuilder()
              .addComponents(
                new ButtonBuilder()
                  .setCustomId(`view_event_${event.event_id}`)
                  .setLabel('View Event')
                  .setEmoji('👁️')
                  .setStyle(ButtonStyle.Primary)
              );
            
            await interaction.editReply({
              embeds: [completionEmbed],
              components: [viewEventButton]
            });
            
          } catch (error) {
            console.error("Error running all predictions:", error);
            await interaction.editReply({
              content: "Error generating predictions. Please try again.",
              embeds: []
            });
          }
          break;
          
        case "update_fighter_stats":
          try {
            
            const loadingEmbed = new EmbedBuilder()
              .setColor('#ffff00')
              .setTitle('🔄 Updating Fighter Stats')
              .setDescription('Fetching current event fighters and updating their stats...');
            
            await interaction.editReply({ 
              embeds: [loadingEmbed],
              components: [] 
            });
            
            // Get the event
            const statsEvent = await EventHandlers.getUpcomingEvent();
            if (!statsEvent) {
              await interaction.editReply({
                content: "No upcoming events found.",
                embeds: []
              });
              return;
            }
            
            // Get all fights for the event
            const fights = await database.getEventFights(statsEvent.Event);
            if (!fights || fights.length === 0) {
              await interaction.editReply({
                content: "No fights found for the current event.",
                embeds: []
              });
              return;
            }
            
            // Extract all fighter names
            const fighters = new Set();
            fights.forEach(fight => {
              fighters.add(fight.fighter1);
              fighters.add(fight.fighter2);
            });
            
            const fighterArray = Array.from(fighters);
            const totalFighters = fighterArray.length;
            
            // Update progress embed
            const progressEmbed = new EmbedBuilder()
              .setColor('#ffff00')
              .setTitle('🔄 Updating Fighter Stats')
              .setDescription([
                `Event: ${statsEvent.Event}`,
                `Total fighters to update: ${totalFighters}`,
                '',
                'This process may take a few minutes. Please wait...',
                '',
                '⏳ Starting updates...'
              ].join('\n'));
            
            await interaction.editReply({ embeds: [progressEmbed] });
            
            // Update stats for each fighter
            const results = [];
            let successCount = 0;
            let failCount = 0;
            
            for (let i = 0; i < fighterArray.length; i++) {
              const fighter = fighterArray[i];
              try {
                // Update progress every 3 fighters
                if (i % 3 === 0) {
                  const updatedProgressEmbed = new EmbedBuilder()
                    .setColor('#ffff00')
                    .setTitle('🔄 Updating Fighter Stats')
                    .setDescription([
                      `Event: ${statsEvent.Event}`,
                      `Progress: ${i}/${totalFighters} fighters`,
                      '',
                      'This process may take a few minutes. Please wait...',
                      '',
                      `⏳ Currently updating: ${fighter}`
                    ].join('\n'));
                  
                  await interaction.editReply({ embeds: [updatedProgressEmbed] });
                }
                
                // Update fighter stats
                const updatedStats = await FighterStats.updateFighterStats(fighter);
                
                if (updatedStats) {
                  results.push(`✅ ${fighter}`);
                  successCount++;
                } else {
                  results.push(`❌ ${fighter} (not found)`);
                  failCount++;
                }
              } catch (error) {
                console.error(`Error updating stats for ${fighter}:`, error);
                results.push(`❌ ${fighter} (error)`);
                failCount++;
              }
              
              // Add a small delay to avoid rate limiting
              await new Promise(resolve => setTimeout(resolve, 1000));
            }
            
            // Create completion embed
            const completionEmbed = new EmbedBuilder()
              .setColor('#00ff00')
              .setTitle('✅ Fighter Stats Update Complete')
              .setDescription([
                `Event: ${statsEvent.Event}`,
                `Successfully updated: ${successCount}/${totalFighters} fighters`,
                `Failed: ${failCount}/${totalFighters} fighters`,
                '',
                '**Results:**',
                results.join('\n')
              ].join('\n'));
            
            const runPredictionsButton = new ActionRowBuilder()
              .addComponents(
                new ButtonBuilder()
                  .setCustomId(`run_all_predictions_${statsEvent.event_id}`)
                  .setLabel('Run All Predictions')
                  .setEmoji('🔄')
                  .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                  .setCustomId(`view_event_${statsEvent.event_id}`)
                  .setLabel('View Event')
                  .setEmoji('👁️')
                  .setStyle(ButtonStyle.Secondary)
              );
            
            await interaction.editReply({
              embeds: [completionEmbed],
              components: [runPredictionsButton]
            });
            
          } catch (error) {
            console.error("Error updating fighter stats:", error);
            await interaction.editReply({
              content: "Error updating fighter stats. Please try again.",
              embeds: []
            });
          }
          break;
          
        case "view_event":
          const viewEventId = args[0];
          try {
            
            const event = await EventHandlers.getUpcomingEvent();
            if (!event) {
              await interaction.editReply({
                content: "No upcoming events found.",
                embeds: []
              });
              return;
            }
            
            const response = await EventHandlers.createEventEmbed(event, false);
            await interaction.editReply(response);
            
          } catch (error) {
            console.error("Error viewing event:", error);
            await interaction.editReply({
              content: "Error loading event. Please try again.",
              embeds: []
            });
          }
          break;
          
        case "predict":
          const [cardType, model, predictEventId] = args;
          await PredictionHandler.handlePredictionRequest(
            interaction,
            cardType,
            model,
            predictEventId
          );
          break;

        case 'market_analysis': {
          const eventId = args[0];
          try {

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
            const modelName = currentModel === "gpt" ? "GPT" : "Claude";

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
        name: "🤖 $model [claude/gpt]",
        value: "```Switch between Claude and GPT for predictions\nDefault: GPT```",
      },
      {
        name: "📊 $stats",
        value: "```Compare prediction accuracy between Claude and GPT models\nUpdated the following day after each event```",
      },
      {
        name: "👤 $checkstats [fighter name]",
        value: "```• View all fighter stats used for prediction analysis\n• Force update stats from ufcstats.com\n• Use when stats are outdated/missing```",
      },
      {
        name: "ℹ️ $sub", // Updated description for $sub
        value: "```Check bot status and learn about supporting Fight Genie```",
      },
      {
        name: "💖 $donate", // Added $donate command
        value: "```Support Fight Genie's development and server costs```",
      }
      // Removed $buy command from help
    )
    .setFooter({
      text: "Data from UFCStats.com | Powered by Claude & GPT | Fight Genie 1.1",
      iconURL: "https://upload.wikimedia.org/wikipedia/commons/thumb/9/92/UFC_Logo.svg/2560px-UFC_Logo.svg.png",
    });
}

function createSlashHelpEmbed() {
  return new EmbedBuilder()
    .setColor("#0099ff")
    .setTitle("Fight Genie Slash Commands")
    .setDescription("Welcome to Fight Genie! Here are the available slash commands:")
    .addFields(
      {
        name: "📅 /upcoming",
        value: "```Show the next upcoming UFC event with predictions & analysis```",
      },
      {
        name: "🔮 /predict",
        value: "```Generate or view fight predictions\nOptions: fighter1, fighter2, card, model```",
      },
      {
        name: "🤖 /model [type]",
        value: "```Switch between Claude and GPT for predictions\nDefault: GPT```",
      },
      {
        name: "📊 /stats [fighter]",
        value: "```Compare prediction accuracy between models\nOptional: Check specific fighter stats```",
      },
      {
        name: "👤 /checkstats <fighter>",
        value: "```View fighter stats used for prediction analysis\nForce update stats from ufcstats.com```",
      },
      {
        name: "ℹ️ /sub",
        value: "```Check bot status and learn about supporting Fight Genie```",
      },
      {
        name: "💖 /donate",
        value: "```Support Fight Genie's development and server costs```",
      },
      {
        name: "🔧 /admin",
        value: "```Admin commands (restricted access)\nSubcommands: advance, forceupdate, updatefighterstats, runallpredictions, syncpredictions```",
      }
    )
    .setFooter({
      text: "Data from UFCStats.com | Powered by Claude & GPT | Fight Genie 2.0",
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
    // Database is initialized when required via its constructor
    console.log("Initializing database...");
    // await database.initializeDatabase(); // Removed redundant call
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
