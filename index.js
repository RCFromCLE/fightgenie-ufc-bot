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
const AdminMode = require('./src/utils/AdminMode');
const PredictionState = require('./src/utils/PredictionState');
// Removed PaymentCommand and related service imports as they are no longer needed
// const PaymentCommand = require("./src/commands/PaymentCommand");
// const PaymentHandler = require("./src/utils/PaymentHandler");
// const PayPalService = require("./src/utils/PayPalService");
// const StripePaymentService = require("./src/utils/StripePaymentService");
// const SolanaPaymentService = require("./src/utils/SolanaPaymentService");
// const SolanaPriceService = require("./src/utils/SolanaPriceService");

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
    "SOLANA_RPC_URL",
    "TWITTER_API_KEY",
    "TWITTER_API_SECRET",
    "TWITTER_ACCESS_TOKEN",
    "TWITTER_ACCESS_SECRET",
    "ADMIN_PASSWORD"
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

// Removed $ command support - only slash commands are supported now

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

  // Check admin mode restriction (except for admin commands)
  if (interaction.isChatInputCommand() && interaction.commandName !== 'admin') {
    if (!AdminMode.shouldAllowCommand(interaction)) {
      try {
        await interaction.reply({
          content: AdminMode.getRejectionMessage(),
          ephemeral: true
        });
      } catch (error) {
        console.error("Failed to send admin mode rejection:", error);
      }
      return;
    }
  }

  // Check admin mode for button/menu interactions
  if ((interaction.isButton() || interaction.isStringSelectMenu()) && !AdminMode.shouldAllowCommand(interaction)) {
    try {
      await interaction.reply({
        content: AdminMode.getRejectionMessage(),
        ephemeral: true
      });
    } catch (error) {
      console.error("Failed to send admin mode rejection:", error);
    }
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

              const response = await EventHandlers.createEventEmbed(event, false, interaction);
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

                const response = await EventHandlers.createEventEmbed(event, false, interaction);
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
          // Always show model statistics - no fighter parameter needed
          await ModelStatsCommand.handleModelStatsCommand(interaction);
          break;

        case 'checkstats':
          const fighter = interaction.options.getString('fighter');
          await CheckStatsCommand.handleCheckStats(interaction, [fighter]);
          break;

        case 'donate':
          await DonateCommand.handleDonateCommand(interaction);
          break;

        case 'status':
        case 'sub': // Keep backward compatibility temporarily
          await SubscriptionCommand.handleSubscriptionStatus(interaction);
          break;

        case 'help':
          const helpEmbed = createSlashHelpEmbed();
          await interaction.editReply({ embeds: [helpEmbed] });
          break;

        case 'admin':
          const subcommand = interaction.options.getSubcommand();
          const password = interaction.options.getString('password');
          
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
          
          // Verify password
          const adminPassword = process.env.ADMIN_PASSWORD;
          if (!adminPassword || password !== adminPassword) {
            await interaction.editReply({ content: "❌ Invalid admin password.", ephemeral: true });
            console.log(`Failed admin password attempt for ${subcommand} by ${interaction.user.tag}`);
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
            case 'rollback':
              await AdminEventCommand.handleRollback(interaction);
              break;
            case 'enableadminmode':
              AdminMode.enableAdminMode();
              await interaction.editReply({
                content: "🔒 **Admin Mode ENABLED**\n\nBot will now only respond to commands from the admin server. All other servers will see a maintenance message.",
                ephemeral: true
              });
              break;
            case 'disableadminmode':
              AdminMode.disableAdminMode();
              await interaction.editReply({
                content: "🔓 **Admin Mode DISABLED**\n\nBot will now respond to commands from all servers normally.",
                ephemeral: true
              });
              break;
            case 'adminstatus':
              await interaction.editReply({
                content: AdminMode.getStatusMessage(),
                ephemeral: true
              });
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
            
            const response = await EventHandlers.createEventEmbed(event, false, interaction);
            await interaction.editReply(response);
            
          } catch (error) {
            console.error("Error viewing event:", error);
            await interaction.editReply({
              content: "Error loading event. Please try again.",
              embeds: []
            });
          }
          break;
          
        case "rollback":
          const rollbackType = args[0]; // 'event'
          const rollbackEventId = args[1];
          
          // Check permissions
          if (interaction.guild?.id !== "496121279712329756") {
            await interaction.editReply({ 
              content: "❌ This action is not available in this server.", 
              ephemeral: true 
            });
            return;
          }
          if (!interaction.member?.permissions.has("Administrator")) {
            await interaction.editReply({ 
              content: "❌ This action requires administrator permissions.", 
              ephemeral: true 
            });
            return;
          }
          
          // Show rollback interface
          await AdminEventCommand.handleRollback(interaction);
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

            const currentModel = ModelCommand.getCurrentModel(interaction.guild?.id);

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
              console.log('Generating new market analysis for event:', event.event_id, 'model:', currentModel);
              
              // Get predictions - generate if they don't exist
              let mainCardPredictions = await PredictionHandler.getStoredPrediction(event.event_id, "main", currentModel);
              let prelimPredictions = await PredictionHandler.getStoredPrediction(event.event_id, "prelims", currentModel);
              
              // If no predictions exist, generate them first
              if (!mainCardPredictions && !prelimPredictions) {
                console.log('No predictions found, generating new predictions...');
                
                // Update UI to show generating predictions
                await interaction.editReply({
                  embeds: [
                    new EmbedBuilder()
                      .setColor('#ffff00')
                      .setTitle('⚡ Generating Predictions')
                      .setDescription('No predictions found. Generating fresh predictions for market analysis...')
                  ]
                });
                
                // Generate predictions for both cards
                try {
                  await PredictionHandler.generateNewPredictions(interaction, event, "main", currentModel);
                  mainCardPredictions = await PredictionHandler.getStoredPrediction(event.event_id, "main", currentModel);
                } catch (err) {
                  console.error('Error generating main card predictions:', err);
                }
                
                try {
                  await PredictionHandler.generateNewPredictions(interaction, event, "prelims", currentModel);
                  prelimPredictions = await PredictionHandler.getStoredPrediction(event.event_id, "prelims", currentModel);
                } catch (err) {
                  console.error('Error generating prelim predictions:', err);
                }
              }
              
              // Fetch odds data
              const freshOddsData = await OddsAnalysis.fetchUFCOdds();

              console.log('Main card predictions:', mainCardPredictions ? 'Found' : 'Not found');
              console.log('Prelim predictions:', prelimPredictions ? 'Found' : 'Not found');
              console.log('Odds data:', freshOddsData ? 'Found' : 'Not found');

              // Process fights and find best value plays
              const allFights = [...(mainCardPredictions?.fights || []), ...(prelimPredictions?.fights || [])];
              console.log('Total fights to analyze:', allFights.length);
              
              // If still no fights, show error
              if (allFights.length === 0) {
                await interaction.editReply({
                  embeds: [
                    new EmbedBuilder()
                      .setColor('#ff0000')
                      .setTitle('❌ No Predictions Available')
                      .setDescription([
                        'Unable to generate market analysis.',
                        '',
                        'Please try:',
                        '1. Generate predictions using `/upcoming`',
                        '2. Click on prediction buttons for Main Card or Prelims',
                        '3. Try the market analysis again after predictions are generated'
                      ].join('\n'))
                  ]
                });
                return;
              }
              
              oddsData = freshOddsData;

              // Calculate edges and sort by value
              const processedFights = allFights.map(fight => {
                const odds = OddsAnalysis.getFightOdds(fight, oddsData, 'fanduel');
                
                // Debug odds for first fight
                if (allFights.indexOf(fight) === 0) {
                  console.log('Sample fight analysis:', {
                    fighter1: fight.fighter1,
                    fighter2: fight.fighter2,
                    predictedWinner: fight.predictedWinner,
                    confidence: fight.confidence,
                    oddsFound: !!odds,
                    odds: odds
                  });
                }
                
                const impliedProb = odds ? OddsAnalysis.calculateImpliedProbability(
                  fight.predictedWinner === fight.fighter1 ? odds.fighter1?.price : odds.fighter2?.price
                ) : 0;
                
                const edge = fight.confidence - impliedProb;
                
                return {
                  ...fight,
                  impliedProbability: impliedProb,
                  edge: edge,
                  valueRating: MarketAnalysis.calculateValueRating(edge),
                  hasOdds: !!odds
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

            // Check if we have any fights with odds
            const fightsWithOdds = marketAnalysis.processedFights ? marketAnalysis.processedFights.filter(f => f.hasOdds) : [];
            console.log(`Fights with odds: ${fightsWithOdds.length}/${marketAnalysis.processedFights ? marketAnalysis.processedFights.length : 0}`);
            
            // If no odds available, use confidence-based picks
            let topValuePlays, mainCardPicks, prelimPicks;
            
            if (fightsWithOdds.length > 0) {
              // Get top value plays (edge > 10% and confidence > 65%)
              topValuePlays = fightsWithOdds
                .filter(fight => fight.edge > 10 && fight.confidence > 65)
                .sort((a, b) => b.edge - a.edge)
                .slice(0, 3);

              // Best main card and prelim picks with odds
              mainCardPicks = fightsWithOdds
                .filter(fight => fight.is_main_card === 1 && fight.edge > 7.5)
                .sort((a, b) => b.confidence - a.confidence)
                .slice(0, 2);

              prelimPicks = fightsWithOdds
                .filter(fight => fight.is_main_card === 0 && fight.edge > 7.5)
                .sort((a, b) => b.confidence - a.confidence)
                .slice(0, 2);
            } else {
              // Fallback to confidence-based picks when no odds available
              console.log('No odds available, using confidence-based analysis');
              
              topValuePlays = (marketAnalysis.processedFights || [])
                .filter(fight => fight.confidence > 70)
                .sort((a, b) => b.confidence - a.confidence)
                .slice(0, 3);

              mainCardPicks = (marketAnalysis.processedFights || [])
                .filter(fight => fight.is_main_card === 1 && fight.confidence > 65)
                .sort((a, b) => b.confidence - a.confidence)
                .slice(0, 2);

              prelimPicks = (marketAnalysis.processedFights || [])
                .filter(fight => fight.is_main_card === 0 && fight.confidence > 65)
                .sort((a, b) => b.confidence - a.confidence)
                .slice(0, 2);
            }

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
            await PredictionHandler.handleBettingAnalysis(interaction, eventId);
          } else if (!args.length) {
            const event = await EventHandlers.getUpcomingEvent();
            await PredictionHandler.handleBettingAnalysis(interaction, event.event_id);
          }
          break;

        case "AI":
          if (args[0] === "Betting" && args[1] === "Analysis") {
            const event = await EventHandlers.getUpcomingEvent();
            await PredictionHandler.handleBettingAnalysis(interaction, event.event_id);
          }
          break;

        case "showcalculations":
          await EventHandlers.handleCalculationButton(interaction);
          break;

        case "show":
          if (args[0] === "event") {
            // Handle show event with proper model context
            try {
              const event = await EventHandlers.getUpcomingEvent();
              if (!event) {
                await interaction.editReply({
                  content: "No upcoming events found.",
                  embeds: []
                });
                return;
              }
              
              const response = await EventHandlers.createEventEmbed(event, false, interaction);
              await interaction.editReply(response);
            } catch (error) {
              console.error("Error showing event:", error);
              await interaction.editReply({
                content: "Error loading event. Please try again.",
                embeds: []
              });
            }
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

        case "back":
          if (args[0] === "to" && args[1] === "model" && args[2] === "stats") {
            // Handle back to model stats button
            await ModelStatsCommand.handleModelStatsCommand(interaction);
          }
          break;

        case "events":
          if (args[0] === "page") {
            const direction = args[1]; // 'prev' or 'next'
            const currentPage = parseInt(args[2]);
            await ModelStatsCommand.handleEventsPagination(interaction, direction, currentPage);
          }
          break;

        case "get":
          if (args[0] === "analysis") {
            try {
              const eventId = args[1]; // Get event ID from button
              const event = await EventHandlers.getUpcomingEvent();
              if (!event) {
                await interaction.editReply({
                  content: "No upcoming events found.",
                  ephemeral: true,
                });
                return;
              }

              const currentModel = ModelCommand.getCurrentModel(interaction.guild?.id);
              
              // Get both main card and prelim predictions for comprehensive analysis
              const mainCardPredictions = await PredictionHandler.getStoredPrediction(
                event.event_id,
                "main",
                currentModel
              );
              const prelimPredictions = await PredictionHandler.getStoredPrediction(
                event.event_id,
                "prelims",
                currentModel
              );

              // Check if we have any predictions
              if (!mainCardPredictions && !prelimPredictions) {
                await interaction.editReply({
                  content:
                    "No predictions found for this event. Please generate predictions first using the Main Card or Prelims buttons.",
                  ephemeral: true,
                });
                return;
              }

              // Use the predictions we have (prioritize main card if both exist)
              const predictions = mainCardPredictions || prelimPredictions;

              try {
                // Set a timeout for the operation
                const timeoutPromise = new Promise((_, reject) => 
                  setTimeout(() => reject(new Error('Analysis timeout')), 30000)
                );
                
                const analysisPromise = (async () => {
                  // Test if DMs are open first
                  await interaction.user.send({
                    content: "📊 Preparing detailed analysis...",
                  });

                  await PredictionHandler.sendDetailedAnalysis(
                    interaction,
                    predictions,
                    event,
                    currentModel
                  );
                })();
                
                // Race between analysis and timeout
                await Promise.race([analysisPromise, timeoutPromise]);
                
              } catch (dmError) {
                console.error("DM Error:", dmError);
                if (dmError.message === 'Analysis timeout') {
                  await interaction.editReply({
                    content: "❌ Analysis generation timed out. Please try again or generate predictions first.",
                    ephemeral: true,
                  });
                } else if (dmError.code === 50007) {
                  await interaction.editReply({
                    content: "❌ Unable to send detailed analysis. Please make sure your DMs are open.",
                    ephemeral: true,
                  });
                } else {
                  await interaction.editReply({
                    content: "❌ An error occurred while generating the analysis. Please try again.",
                    ephemeral: true,
                  });
                }
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
        name: "📅 /upcoming",
        value: "```Show the next upcoming UFC event with predictions & analysis```",
      },
      {
        name: "🤖 /model [claude/gpt]",
        value: "```Switch between Claude and GPT for predictions\nDefault: GPT```",
      },
      {
        name: "📊 /stats",
        value: "```Compare prediction accuracy between Claude and GPT models\nUpdated the following day after each event```",
      },
      {
        name: "👤 /checkstats [fighter name]",
        value: "```• View all fighter stats used for prediction analysis\n• Force update stats from ufcstats.com\n• Use when stats are outdated/missing```",
      },
      {
        name: "ℹ️ /status",
        value: "```View bot status, statistics, and helpful information```",
      },
      {
        name: "💖 /donate", // Added /donate command
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
  client.user.setActivity(`AI UFC Predictions | /help | ${11 + Math.max(0, client.guilds.cache.size - 1)} servers`, { type: ActivityType.Competing });
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

// Set up periodic cleanup for PredictionState
setInterval(() => {
  PredictionState.cleanup();
}, 5 * 60 * 1000); // Clean up every 5 minutes

module.exports = { client };
