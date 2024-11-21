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
            const currentDate = new Date().toISOString().slice(0, 10);
            const currentEvent = await database.query(
                `SELECT DISTINCT event_id, Date, Event, City, State, Country, event_link
                FROM events WHERE Date = ? LIMIT 1`,
                [currentDate]
            );

            if (currentEvent?.length > 0) {
                console.log("Found current event:", currentEvent[0].Event);
                return currentEvent[0];
            }

            const nextEvent = await database.query(
                `SELECT DISTINCT event_id, Date, Event, City, State, Country, event_link
                FROM events WHERE Date > ? ORDER BY Date ASC LIMIT 1`,
                [currentDate]
            );

            if (nextEvent?.length > 0) {
                console.log("Found upcoming event:", nextEvent[0].Event);
                return nextEvent[0];
            }

            return null;
        } catch (error) {
            console.error("Error getting upcoming event:", error);
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
                await interaction.editReply({ content: "No upcoming events found.", ephemeral: true });
                return;
            }
    
            // Enhanced loading message
            const loadingEmbed = new EmbedBuilder()
                .setColor("#ffff00")
                .setTitle("🤖 Fight Genie Analysis in Progress")
                .setDescription([
                    `Analyzing ${cardType === 'main' ? 'Main Card' : 'Preliminary Card'} fights for ${event.Event}`,
                    '**Processing:**',
                    '• Gathering fighter statistics and historical data',
                    '• Analyzing style matchups and recent performance',
                    '• Calculating win probabilities and confidence levels',
                    '• Generating parlay and prop recommendations',
                    '',
                    `Using ${model.toUpperCase() === 'GPT' ? 'GPT-4' : 'Claude'} for enhanced fight analysis...`
                ].join('\n'))
                .setFooter({ text: 'Please wait while Fight Genie processes the data...' });
    
            await interaction.editReply({ embeds: [loadingEmbed] });
    
            // Generate or retrieve predictions
            const storedPredictions = await this.getStoredPrediction(event.event_id, cardType, model);
            if (storedPredictions) {
                await this.displayPredictions(interaction, storedPredictions, event, model, cardType);
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

static async displayPredictions(interaction, predictions, event, model, cardType = 'main') {
    try {
        const embed = this.createSplitPredictionEmbeds(predictions, event, model, cardType)[0];
        
        const optionsRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`get_analysis_${event.event_id}`)
                    .setLabel('Get Full Analysis')
                    .setEmoji('📝')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId(`betting_analysis_${event.event_id}`)
                    .setLabel('Betting Analysis')
                    .setEmoji('💰')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId(`show_event_${event.event_id}`)
                    .setLabel('Back to Event')
                    .setEmoji('↩️')
                    .setStyle(ButtonStyle.Success)
            );

        await interaction.editReply({ 
            embeds: [embed],
            components: [optionsRow]
        });
    } catch (error) {
        console.error("Error displaying predictions:", error);
        await interaction.editReply({
            content: "Error displaying predictions. Please try again.",
            ephemeral: true
        });
    }
}


    static createSplitPredictionEmbeds(predictions, event, model, cardType = 'main') {
        const modelName = model.toLowerCase() === "gpt" ? "GPT-4" : "Claude";
        const modelEmoji = model === "gpt" ? "🧠" : "🤖";
        
        // Get high confidence picks
        const locks = predictions.fights.filter(pred => pred.confidence >= 70);
        
        const embed = new EmbedBuilder()
            .setColor("#00ff00")
            .setTitle(`${modelEmoji} ${event.Event}`)
            .setDescription([
                `📍 ${event.City}, ${event.Country}`,
                `📅 ${new Date(event.Date).toLocaleDateString()}`,
                '\n━━━━━━━━━━━━━━━━━━━━━━',
                cardType === 'main' 
                    ? '📊 **MAIN CARD PREDICTIONS**\n'
                    : '📊 **PRELIMINARY CARD PREDICTIONS**\n'
            ].join('\n'))
            .setThumbnail("https://upload.wikimedia.org/wikipedia/commons/thumb/9/92/UFC_Logo.svg/2560px-UFC_Logo.svg.png");
    
        // Add concise fight predictions
        predictions.fights.forEach(pred => {
            const confidenceEmoji = pred.confidence >= 70 ? "🔒" : 
                                   pred.confidence >= 60 ? "✅" : "⚖️";
            
            const methodEmoji = pred.method.includes('KO') ? "👊" :
                               pred.method.includes('Sub') ? "🔄" :
                               pred.method.includes('Dec') ? "⚖️" : "⚔️";
    
            embed.addFields({
                name: `${pred.fighter1} vs ${pred.fighter2}`,
                value: [
                    `${confidenceEmoji} **${pred.predictedWinner}** (${pred.confidence}%)`,
                    `${methodEmoji} ${pred.method}`,
                    `▸ KO ${pred.probabilityBreakdown.ko_tko}% • Sub ${pred.probabilityBreakdown.submission}% • Dec ${pred.probabilityBreakdown.decision}%`
                ].join('\n'),
                inline: false
            });
        });
    
        // Add high confidence picks section after predictions
        if (locks.length > 0) {
            embed.addFields({
                name: '━━━━━━━━━━━━━━━━━━━━━━\n🔒 **HIGH CONFIDENCE PICKS**',
                value: locks.map(l => 
                    `▸ ${l.predictedWinner} (${l.confidence}%) by ${l.method}`
                ).join('\n'),
                inline: false
            });
        }
    
        // Add parlay recommendations if available
        if (predictions.betting_analysis?.parlays && locks.length >= 2) {
            const parlayContent = [];
            
            // Two-fight parlays
            if (locks.length >= 2) {
                parlayContent.push(`▸ ${locks[0].predictedWinner} + ${locks[1].predictedWinner}\n*Combined confidence: ${((locks[0].confidence + locks[1].confidence) / 2).toFixed(1)}%*\n`);
                
                if (locks.length >= 3) {
                    parlayContent.push(`▸ ${locks[1].predictedWinner} + ${locks[2].predictedWinner}\n*Combined confidence: ${((locks[1].confidence + locks[2].confidence) / 2).toFixed(1)}%*\n`);
                }
            }
            
            // Three-fight parlay
            if (locks.length >= 3) {
                parlayContent.push(`▸ Triple Lock Parlay:\n${locks[0].predictedWinner} + ${locks[1].predictedWinner} + ${locks[2].predictedWinner}\n*Combined confidence: ${((locks[0].confidence + locks[1].confidence + locks[2].confidence) / 3).toFixed(1)}%*`);
            }
    
            embed.addFields({
                name: '━━━━━━━━━━━━━━━━━━━━━━\n💰 **RECOMMENDED PARLAYS**\n',
                value: parlayContent.join('\n') + '\n',
                inline: false
            });
        }
    
        embed.setFooter({
            text: `${modelName} Analysis • Fight Genie 1.0 • Stats from UFCStats.com`,
            iconURL: "https://upload.wikimedia.org/wikipedia/commons/thumb/9/92/UFC_Logo.svg/2560px-UFC_Logo.svg.png"
        });
    
        return [embed];
    }

    // Enhanced prop recommendations
    static generateEnhancedPropRecommendations(fights) {
        const props = [];
    
        // Fight duration props
        fights.forEach(fight => {
            const { probabilityBreakdown, predictedWinner, fighter1, fighter2, confidence } = fight;
            if (!probabilityBreakdown) return;
    
            const finishProb = (probabilityBreakdown.ko_tko + probabilityBreakdown.submission);
            
            // Fight doesn't go the distance
            if (finishProb > 65) {
                props.push(`• ${fighter1} vs ${fighter2} doesn't reach decision (${finishProb.toFixed(0)}%)\n└ High finishing potential from both fighters`);
            }
    
            // Method specific props for high confidence
            if (confidence >= 65) {
                if (probabilityBreakdown.ko_tko >= 50) {
                    props.push(`• ${predictedWinner} by KO/TKO (${probabilityBreakdown.ko_tko}%)\n└ Strong striking advantage indicated`);
                }
                if (probabilityBreakdown.submission >= 40) {
                    props.push(`• ${predictedWinner} by Submission (${probabilityBreakdown.submission}%)\n└ Clear grappling edge demonstrated`);
                }
            }
    
            // Round props for likely early finishes
            if (finishProb >= 70) {
                props.push(`• Fight to end inside the distance\n└ High finishing rate historical matchup`);
            }
        });
    
        return props.length > 0 ? props.join('\n\n') : null;
    }
    
    // Update sendDetailedAnalysis to include both main card and prelims
    static async sendDetailedAnalysis(interaction, eventId) {
        try {
            if (!interaction.deferred && !interaction.replied) {
                await interaction.deferUpdate();
            }
    
            const event = await this.getUpcomingEvent();
            if (!event) {
                await interaction.editReply({
                    content: "No upcoming events found.",
                    ephemeral: true
                });
                return;
            }
    
            const currentModel = ModelCommand.getCurrentModel();
            const [mainCardPreds, prelimsPreds] = await Promise.all([
                this.getStoredPrediction(eventId || event.event_id, "main", currentModel),
                this.getStoredPrediction(eventId || event.event_id, "prelims", currentModel)
            ]);
    
            if (!mainCardPreds && !prelimsPreds) {
                await interaction.editReply({
                    content: "No predictions found. Please generate predictions first.",
                    ephemeral: true
                });
                return;
            }
    
            const modelName = currentModel === "gpt" ? "GPT-4" : "Claude";
            const modelEmoji = currentModel === "gpt" ? "🧠" : "🤖";
    
            const embeds = [];
    
            // Main Card Analysis Embed (if available)
            if (mainCardPreds?.fights) {
                const mainCardEmbed = new EmbedBuilder()
                    .setColor("#0099ff")
                    .setTitle(`${event.Event} - Main Card Analysis`)
                    .setDescription([
                        `*${modelEmoji} Detailed Analysis by ${modelName}*`,
                        `📅 ${event.Date}`,
                        '',
                        '**MAIN CARD BREAKDOWN**',
                        '═══════════════════════',
                        this.formatDetailedAnalysis(mainCardPreds)
                    ].join('\n'));
                embeds.push(mainCardEmbed);
            }
    
            // Prelims Analysis Embed (if available)
            if (prelimsPreds?.fights) {
                const prelimsEmbed = new EmbedBuilder()
                    .setColor("#0099ff")
                    .setTitle(`${event.Event} - Preliminary Card Analysis`)
                    .setDescription([
                        `*${modelEmoji} Detailed Analysis by ${modelName}*`,
                        `📅 ${event.Date}`,
                        '',
                        '**PRELIMINARY CARD BREAKDOWN**',
                        '═══════════════════════',
                        this.formatDetailedAnalysis(prelimsPreds)
                    ].join('\n'));
                embeds.push(prelimsEmbed);
            }
    
            try {
                await interaction.user.send({ embeds });
                await interaction.editReply({
                    content: `✅ Detailed analysis for ${embeds.length === 2 ? 'both cards' : 'the card'} has been sent to your DMs!`,
                    ephemeral: true
                });
            } catch (dmError) {
                console.error("Error sending DM:", dmError);
                await interaction.editReply({
                    content: "❌ Unable to send detailed analysis via DM. Please make sure your DMs are open.",
                    ephemeral: true
                });
            }
    
        } catch (error) {
            console.error("Error sending detailed analysis:", error);
            await interaction.editReply({
                content: "Error generating detailed analysis. Please try again.",
                ephemeral: true
            });
        }
    }
    
    static formatDetailedAnalysis(predictions) {
        if (!predictions?.fights) return "No predictions available.";
    
        const sections = [];
        const locks = predictions.fights.filter(pred => pred.confidence >= 70);
    
        if (locks.length > 0) {
            sections.push(
                '🔒 **HIGH CONFIDENCE PICKS**',
                ...locks.map(l => [
                    `**${l.predictedWinner}** (${l.confidence}%) by ${l.method}`,
                    `└ *Statistical Edge:* ${l.keyFactors[0]}`,
                    `└ *Analysis:* ${l.reasoning}`,
                    ''
                ].join('\n')),
                '═══════════════════════\n'
            );
        }
    
        // Add detailed fight analysis
        predictions.fights.forEach(pred => {
            sections.push(
                `**${pred.fighter1} vs ${pred.fighter2}**`,
                `🎯 **Prediction:** ${pred.predictedWinner} (${pred.confidence}% confidence)`,
                `⚔️ **Method:** ${pred.method}`,
                '',
                '📊 **Win Probability Breakdown:**',
                `• KO/TKO: ${pred.probabilityBreakdown?.ko_tko || 0}%`,
                `• Submission: ${pred.probabilityBreakdown?.submission || 0}%`,
                `• Decision: ${pred.probabilityBreakdown?.decision || 0}%`,
                '',
                '💡 **Key Factors:**',
                ...pred.keyFactors.map(factor => `• ${factor}`),
                '',
                '📝 **Detailed Analysis:**',
                pred.reasoning,
                '═══════════════════════\n'
            );
        });
    
        return sections.join('\n');
    }
        
    static getMethodEmoji(method) {
        if (!method) return "⚔️";
        const methodUpper = method.toUpperCase();
        if (methodUpper.includes("KO") || methodUpper.includes("TKO")) return "👊";
        if (methodUpper.includes("SUB")) return "🔄";
        if (methodUpper.includes("DEC")) return "📋";
        return "⚔️";
    }
    static async sendDetailedAnalysis(interaction, eventId) {
        try {
            if (!interaction.deferred && !interaction.replied) {
                await interaction.deferUpdate();
            }

            const event = await this.getUpcomingEvent();
            if (!event) {
                await interaction.editReply({
                    content: "No upcoming events found.",
                    ephemeral: true
                });
                return;
            }

            const currentModel = ModelCommand.getCurrentModel();
            const predictions = await this.getStoredPrediction(eventId || event.event_id, "main", currentModel);

            if (!predictions || !predictions.fights) {
                await interaction.editReply({
                    content: "No predictions found. Please generate predictions first.",
                    ephemeral: true
                });
                return;
            }

            const modelName = currentModel === "gpt" ? "GPT-4" : "Claude";
            const modelEmoji = currentModel === "gpt" ? "🧠" : "🤖";

            const locks = predictions.fights.filter(pred => pred.confidence >= 70);

            const analysisEmbed = new EmbedBuilder()
                .setColor("#0099ff")
                .setTitle(`${event.Event} - Detailed Analysis`)
                .setDescription([
                    `*${modelEmoji} Detailed Analysis by ${modelName}*`,
                    `📅 ${event.Date}`,
                    '',
                    locks.length > 0 ? [
                        '🔒 **HIGH CONFIDENCE PICKS:**',
                        ...locks.map(l => `• ${l.predictedWinner} (${l.confidence}%) by ${l.method}`),
                        '',
                        'Consider these picks for parlays.'
                    ].join('\n') : '',
                    '═══════════════════════'
                ].join('\n'));

            for (const pred of predictions.fights) {
                const confidenceEmoji = pred.confidence >= 70 ? "🔒" : pred.confidence >= 60 ? "✅" : "⚠️";
                const methodEmoji = this.getMethodEmoji(pred.method);

                analysisEmbed.addFields({
                    name: `${pred.fighter1} vs ${pred.fighter2}`,
                    value: [
                        `${confidenceEmoji} **Pick:** ${pred.predictedWinner} (${pred.confidence}% confidence)`,
                        `${methodEmoji} **Method:** ${pred.method}`,
                        '',
                        '**Win Probability:**',
                        `KO/TKO: ${pred.probabilityBreakdown?.ko_tko || 0}%`,
                        `Submission: ${pred.probabilityBreakdown?.submission || 0}%`,
                        `Decision: ${pred.probabilityBreakdown?.decision || 0}%`,
                        '',
                        '**Key Factors:**',
                        pred.keyFactors.map(factor => `• ${factor}`).join('\n'),
                        '',
                        '**Full Analysis:**',
                        pred.reasoning,
                        '───────────────'
                    ].join('\n'),
                    inline: false
                });
            }

            if (predictions.betting_analysis) {
                const parlays = this.generateEnhancedParlayRecommendations(predictions.fights);
                const props = this.generateEnhancedPropRecommendations(predictions.fights);
                
                analysisEmbed.addFields({
                    name: '💰 Enhanced Betting Analysis',
                    value: [
                        '**Recommended Parlays:**',
                        parlays,
                        '',
                        '**High Value Props:**',
                        props,
                        '',
                        '**Strategy Notes:**',
                        '• Combine high confidence picks for better value',
                        '• Consider round/method props for additional value',
                        '• Monitor line movement and weigh-in results'
                    ].join('\n'),
                    inline: false
                });
            }

            analysisEmbed.setFooter({
                text: `Fight Genie Analysis • ${modelName} • Stats from UFCStats.com`,
                iconURL: "https://upload.wikimedia.org/wikipedia/commons/thumb/9/92/UFC_Logo.svg/2560px-UFC_Logo.svg.png"
            });

            try {
                await interaction.user.send({
                    embeds: [analysisEmbed]
                });

                await interaction.editReply({
                    content: "✅ Detailed analysis has been sent to your DMs!",
                    ephemeral: true
                });
            } catch (dmError) {
                console.error("Error sending DM:", dmError);
                await interaction.editReply({
                    content: "❌ Unable to send detailed analysis via DM. Please make sure your DMs are open.",
                    ephemeral: true
                });
            }

        } catch (error) {
            console.error("Error sending detailed analysis:", error);
            try {
                await interaction.editReply({
                    content: "Error generating detailed analysis. Please try again.",
                    ephemeral: true
                });
            } catch (replyError) {
                console.error("Error sending error message:", replyError);
            }
        }
    }

    static async handleBettingAnalysis(interaction, eventId) {
        try {
            if (!interaction.deferred && !interaction.replied) {
                await interaction.deferUpdate();
            }

            const currentModel = ModelCommand.getCurrentModel();
            const predictions = await this.getStoredPrediction(eventId || interaction.message.id, "main", currentModel);

            if (!predictions || !predictions.fights) {
                await interaction.editReply({
                    content: "No predictions found. Please generate predictions first.",
                    ephemeral: true
                });
                return;
            }

            const bettingEmbed = new EmbedBuilder()
                .setColor("#ffd700")
                .setTitle("💰 Betting Analysis 🧠")
                .setDescription("Fight Analysis and Betting Opportunities");

            const locks = predictions.fights.filter(pred => pred.confidence >= 70);

            // Parlay Recommendations
            const parlaySection = this.generateEnhancedParlayRecommendations(predictions.fights);
            if (parlaySection) {
                bettingEmbed.addFields({
                    name: "🎲 Parlay Recommendations",
                    value: parlaySection,
                    inline: false
                });
            }

            // Method Props
            const propSection = this.generateEnhancedPropRecommendations(predictions.fights);
            if (propSection) {
                bettingEmbed.addFields({
                    name: "👊 Method & Round Props",
                    value: propSection,
                    inline: false
                });
            }

            // Value Plays
            const valuePlays = this.generateValuePlays(predictions.fights);
            if (valuePlays) {
                bettingEmbed.addFields({
                    name: "💎 Value Opportunities",
                    value: valuePlays,
                    inline: false
                });
            }

            const navigationRow = new ActionRowBuilder()
                .addComponents(
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
                components: [navigationRow]
            });

        } catch (error) {
            console.error("Error handling betting analysis:", error);
            await interaction.editReply({
                content: "Error generating betting analysis. Please try again.",
                ephemeral: true
            });
        }
    }

    static generateEnhancedParlayRecommendations(fights) {
        const locks = fights.filter(pred => pred.confidence >= 70);
        const highValuePicks = fights.filter(pred => pred.confidence >= 65);
        
        let parlayText = [];
    
        // 2-Fight Parlays
        if (locks.length >= 2) {
            parlayText.push('2-Fight Parlays:');
            // Generate all possible 2-fight combinations from locks
            for (let i = 0; i < locks.length - 1; i++) {
                parlayText.push(`• ${locks[i].predictedWinner} + ${locks[i + 1].predictedWinner}\n└ Method parlay: ${locks[i].method} + ${locks[i + 1].method}`);
            }
            parlayText.push('');
        }
    
        // 3-Fight Parlays
        if (highValuePicks.length >= 3) {
            parlayText.push('3-Fight Parlays:');
            const topThree = highValuePicks.slice(0, 3);
            parlayText.push(`• ${topThree.map(p => p.predictedWinner).join(' + ')}\n└ Combined confidence: ${(topThree.reduce((acc, p) => acc + p.confidence, 0) / 3).toFixed(1)}%`);
            parlayText.push('');
        }
    
        // High-Value Combinations
        const koFighters = fights.filter(f => 
            f.probabilityBreakdown?.ko_tko >= 55 && f.confidence >= 65
        );
        const subFighters = fights.filter(f => 
            f.probabilityBreakdown?.submission >= 40 && f.confidence >= 65
        );
    
        if (koFighters.length >= 2 || subFighters.length >= 2) {
            parlayText.push('High-Value Combinations:');
            if (koFighters.length >= 2) {
                parlayText.push(`• ${koFighters[0].predictedWinner} + ${koFighters[1].predictedWinner} by KO/TKO\n└ High finish probability parlay`);
            }
            if (subFighters.length >= 2) {
                parlayText.push(`• ${subFighters[0].predictedWinner} + ${subFighters[1].predictedWinner} by Submission\n└ Grappling-focused parlay`);
            }
        }
    
        return parlayText.join('\n');
    }
    
    static generateEnhancedPropRecommendations(fights) {
        const props = [];

        fights.forEach(fight => {
            const { probabilityBreakdown, predictedWinner, fighter1, fighter2 } = fight;
            if (!probabilityBreakdown) return;

            // Fight doesn't go to decision
            if ((probabilityBreakdown.ko_tko + probabilityBreakdown.submission) > 65) {
                props.push(`• ${fighter1} vs ${fighter2} doesn't reach decision (${probabilityBreakdown.ko_tko + probabilityBreakdown.submission}%)`);
            }

            // Method specific props for high confidence
            if (fight.confidence >= 65) {
                if (probabilityBreakdown.ko_tko >= 50) {
                    props.push(`• ${predictedWinner} to win by KO/TKO (${probabilityBreakdown.ko_tko}%)`);
                }
                if (probabilityBreakdown.submission >= 40) {
                    props.push(`• ${predictedWinner} to win by Submission (${probabilityBreakdown.submission}%)`);
                }
            }
        });

        return props.length > 0 ? props.join('\n') : null;
    }

    static generateValuePlays(fights) {
        const valuePlays = [];
        
        fights.forEach(fight => {
            // Identify potential value based on confidence vs probability breakdown
            const { confidence, predictedWinner, probabilityBreakdown } = fight;
            
            if (confidence >= 65 && probabilityBreakdown) {
                const dominantMethod = this.getDominantMethod(probabilityBreakdown);
                if (dominantMethod) {
                    valuePlays.push(`• ${predictedWinner} ${dominantMethod.description} (${dominantMethod.probability}%)`);
                }
            }
        });

        return valuePlays.length > 0 ? 
            valuePlays.join('\n') + '\n\n*Consider these for straight bets or parlay pieces*' 
            : null;
    }

    static getDominantMethod(probabilityBreakdown) {
        const { ko_tko, submission, decision } = probabilityBreakdown;
        
        if (ko_tko > Math.max(submission, decision) && ko_tko >= 50) {
            return { description: 'by KO/TKO', probability: ko_tko };
        }
        if (submission > Math.max(ko_tko, decision) && submission >= 40) {
            return { description: 'by Submission', probability: submission };
        }
        if (decision > Math.max(ko_tko, submission) && decision >= 60) {
            return { description: 'by Decision', probability: decision };
        }
        return null;
    }static async cleanupOldPredictions(daysToKeep = 30) {
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
            console.log(`Stored predictions for event ${eventId}, card type ${cardType}`);
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

            return results?.length > 0 ? JSON.parse(results[0].prediction_data) : null;
        } catch (error) {
            console.error("Error getting stored prediction:", error);
            return null;
        }
    }

    static async validateFighterData(fighterName) {
        try {
            const stats = await database.query(
                `SELECT *, datetime(last_updated) as updated_at
                FROM fighters WHERE Name = ?`,
                [fighterName]
            );

            if (!stats?.length) {
                return { status: "missing", details: "No data found", hasData: false };
            }

            return this.analyzeFighterStats(stats[0]);
        } catch (error) {
            console.error(`Error validating stats for ${fighterName}:`, error);
            return { status: "error", details: error.message, hasData: false };
        }
    }

    static analyzeFighterStats(stats) {
        const statFields = ["SLPM", "SApM", "StrAcc", "StrDef", "TDAvg", "TDAcc", "TDDef", "SubAvg"];
        let zeroOrMissingCount = 0;
        
        statFields.forEach(field => {
            const value = stats[field];
            if (!value || value === 0 || value === "0" || value === "0%" || value === "NULL") {
                zeroOrMissingCount++;
            }
        });

        const lastUpdate = new Date(stats.updated_at);
        const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

        return {
            status: zeroOrMissingCount >= 4 ? "limited" : "complete",
            details: zeroOrMissingCount >= 4
                ? `${zeroOrMissingCount} missing statistical fields`
                : `Last updated: ${lastUpdate.toLocaleDateString()}`,
            hasData: zeroOrMissingCount < 4,
            needsUpdate: lastUpdate < twoWeeksAgo,
        };
    }

    static async generateNewPredictions(interaction, event, cardType, model) {
        try {
            const loadingEmbed = new EmbedBuilder()
                .setColor("#ffff00")
                .setTitle("🔄 Generating Predictions")
                .setDescription("Please wait while Fight Genie analyzes the matchups...");
    
            await interaction.editReply({
                embeds: [loadingEmbed],
                components: []
            });
    
            // Get fights without validation
            const fights = cardType === "main" 
                ? await this.getMainCardFights(event.Event)
                : await this.getPrelimFights(event.Event);
    
            if (!fights || fights.length === 0) {
                throw new Error(`No fights found for ${cardType} card`);
            }
    
            console.log(`Processing ${fights.length} fights for ${cardType} card`);
    
            // Process fights in batches
            const batchSize = 3;
            const batches = [];
            for (let i = 0; i < fights.length; i += batchSize) {
                batches.push(fights.slice(i, i + batchSize));
            }
    
            // Process each batch
            const allPredictions = {
                fights: [],
                betting_analysis: {}
            };
    
            for (let i = 0; i < batches.length; i++) {
                console.log(`Processing batch ${i + 1} of ${batches.length}`);
                const batchFights = batches[i];
                
                const batchPredictions = await generateEnhancedPredictionsWithAI(
                    batchFights,
                    event,
                    model
                );
    
                if (batchPredictions?.fights) {
                    allPredictions.fights.push(...batchPredictions.fights);
                    if (i === batches.length - 1) {
                        allPredictions.betting_analysis = batchPredictions.betting_analysis;
                    }
                }
    
                // Add small delay between batches
                if (i < batches.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }
    
            if (!allPredictions.fights || allPredictions.fights.length === 0) {
                throw new Error("Failed to generate valid predictions");
            }
    
            await this.storePredictions(event.event_id, cardType, model, allPredictions);
            await this.displayPredictions(interaction, allPredictions, event, model, cardType);
    
        } catch (error) {
            console.error("Error generating new predictions:", error);
            const errorEmbed = new EmbedBuilder()
                .setColor("#ff0000")
                .setTitle("❌ Error Generating Predictions")
                .setDescription("An error occurred while generating predictions. Please try again in a few moments.");
    
            await interaction.editReply({
                embeds: [errorEmbed],
                components: []
            });
        }
    }
        
    static async getMainCardFights(eventName) {
        try {
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
                ORDER BY event_id ASC`,
                [eventName]
            );
    
            return fights.map(fight => ({
                ...fight,
                fighter1: fight.fighter1?.trim() || fight.Winner?.trim(),
                fighter2: fight.fighter2?.trim() || fight.Loser?.trim(),
                WeightClass: fight.WeightClass || 'Unknown',
                is_main_card: 1
            }));
        } catch (error) {
            console.error('Error getting main card fights:', error);
            return [];
        }
    }
    
    static async getPrelimFights(eventName) {
        try {
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
                ORDER BY event_id ASC`,
                [eventName]
            );
    
            return fights.map(fight => ({
                ...fight,
                fighter1: fight.fighter1?.trim() || fight.Winner?.trim(),
                fighter2: fight.fighter2?.trim() || fight.Loser?.trim(),
                WeightClass: fight.WeightClass || 'Unknown',
                is_main_card: 0
            }));
        } catch (error) {
            console.error('Error getting prelim fights:', error);
            return [];
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
}
module.exports = PredictionHandler;