const {
  EmbedBuilder,
  ButtonBuilder,
  ActionRowBuilder,
  ButtonStyle,
} = require("discord.js");
const axios = require("axios");
const database = require("../database");
const ModelCommand = require("../commands/ModelCommand");

class OddsAnalysis {
  static API_ENDPOINTS = {
    ODDS: "/v4/sports/mma_mixed_martial_arts/odds",
  };

// In OddsAnalysis.js, update the handleOddsCommand method:

static async handleOddsCommand(interaction, model, eventId, bookmaker = 'fanduel', cardType = 'main') {
    try {
        // Don't defer if already deferred
        if (!interaction.deferred && !interaction.replied) {
            await interaction.deferUpdate();
        }
        
        const event = await database.getUpcomingEvent();
        if (!event) {
            await interaction.editReply({
                content: "No upcoming events found.",
                ephemeral: true
            });
            return;
        }

        const currentEventId = eventId || event.event_id;
        const currentModel = ModelCommand.getCurrentModel();
        
        console.log(`Handling odds for event ID: ${currentEventId}, card type: ${cardType}`);

        // Get fights and odds data
        const [fights, oddsData] = await Promise.all([
            database.getEventFights(event.Event),
            this.fetchUFCOdds()
        ]);

        if (!oddsData) {
            const errorEmbed = new EmbedBuilder()
                .setColor('#ff0000')
                .setTitle('❌ Odds Currently Unavailable')
                .setDescription('Unable to fetch current odds. Please try again later.');
            
            await interaction.editReply({ embeds: [errorEmbed] });
            return;
        }

        if (!fights || fights.length === 0) {
            await interaction.editReply({
                content: "No fights found for this event.",
                ephemeral: true
            });
            return;
        }

        // Get fights based on card type
        const selectedFights = fights.filter(f => 
            cardType === 'main' ? f.is_main_card === 1 : f.is_main_card === 0
        );

        const bookmakerName = bookmaker === 'fanduel' ? 'FanDuel' : 'DraftKings';
        const embed = new EmbedBuilder()
            .setColor('#0099ff')
            .setTitle(`💰 ${event.Event} - ${bookmakerName} Odds`)
            .setDescription(`${cardType === 'main' ? '🎯 Main Card' : '🥊 Preliminary Card'} betting lines powered by ${bookmakerName}`);

        let displayedFights = 0;
        const totalFights = selectedFights.length;

        // Add fights for the selected card type
        for (const fight of selectedFights) {
            const fightOdds = this.getFightOdds(fight, oddsData, bookmaker);
            if (fightOdds) {
                embed.addFields({
                    name: `${fight.fighter1 || fight.Winner} vs ${fight.fighter2 || fight.Loser}`,
                    value: this.formatFightOddsDisplay(fight, fightOdds),
                    inline: false
                });
                displayedFights++;
            }
        }

        // Add note about missing odds if applicable
        if (displayedFights < totalFights) {
            embed.addFields({
                name: '⚠️ Notice',
                value: `Odds for ${totalFights - displayedFights} fight(s) are not yet available from ${bookmakerName}.`,
                inline: false
            });
        }

        embed.setFooter({
            text: `Current Model: ${currentModel.toUpperCase()} | Odds from ${bookmakerName} | For entertainment purposes only`,
            iconURL: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/92/UFC_Logo.svg/2560px-UFC_Logo.svg.png'
        });

        // Create navigation rows
        const navigationRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`odds_fanduel_${cardType}_${currentEventId}`)
                    .setLabel('FanDuel')
                    .setEmoji('🎲')
                    .setStyle(bookmaker === 'fanduel' ? ButtonStyle.Success : ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId(`odds_draftkings_${cardType}_${currentEventId}`)
                    .setLabel('DraftKings')
                    .setEmoji('🎲')
                    .setStyle(bookmaker === 'draftkings' ? ButtonStyle.Success : ButtonStyle.Secondary)
            );

        // Add card type selection row
        const cardSelectionRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`odds_main_${bookmaker}_${currentEventId}`)
                    .setLabel('Main Card Odds')
                    .setEmoji('🎯')
                    .setStyle(cardType === 'main' ? ButtonStyle.Success : ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId(`odds_prelims_${bookmaker}_${currentEventId}`)
                    .setLabel('Prelims Odds')
                    .setEmoji('🥊')
                    .setStyle(cardType === 'prelims' ? ButtonStyle.Success : ButtonStyle.Secondary),
            );

        const optionsRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`show_event_${currentEventId}`)
                    .setLabel('Back to Event')
                    .setEmoji('↩️')
                    .setStyle(ButtonStyle.Success)
            );

        await interaction.editReply({
            embeds: [embed],
            components: [navigationRow, cardSelectionRow, optionsRow]
        });

    } catch (error) {
        console.error('Error handling odds command:', error);
        if (!interaction.replied) {
            await interaction.followUp({
                content: 'Error fetching odds data. Please try again later.',
                ephemeral: true
            });
        }
    }
  }

  static calculateImpliedProbability(americanOdds) {
    if (!americanOdds) return null;
    
    if (americanOdds > 0) {
        return (100 / (americanOdds + 100)) * 100;
    } else {
        return (Math.abs(americanOdds) / (Math.abs(americanOdds) + 100)) * 100;
    }
}

  static getFightOdds(fight, oddsData, bookmaker) {
    if (!oddsData || !bookmaker) return null;

    const fighter1 = fight.fighter1 || fight.Winner;
    const fighter2 = fight.fighter2 || fight.Loser;

    if (!fighter1 || !fighter2) return null;

    const market = oddsData.find(
      (m) =>
        (m.home_team === fighter1 && m.away_team === fighter2) ||
        (m.home_team === fighter2 && m.away_team === fighter1)
    );

    if (!market?.bookmakers) return null;

    const bookmakerOdds = market.bookmakers.find((b) => b.key === bookmaker);
    if (!bookmakerOdds?.markets?.[0]?.outcomes) return null;

    const outcomes = bookmakerOdds.markets[0].outcomes;
    return {
      fighter1: outcomes.find((o) => o.name === fighter1),
      fighter2: outcomes.find((o) => o.name === fighter2),
      lastUpdate: bookmakerOdds.last_update,
    };
  }

  static formatFightOddsDisplay(fight, odds) {
    if (!odds?.fighter1 || !odds?.fighter2) return "Odds currently unavailable";

    const lastUpdate = new Date(odds.lastUpdate).toLocaleString();
    const fighter1 = fight.fighter1 || fight.Winner;
    const fighter2 = fight.fighter2 || fight.Loser;

    return [
      `${fighter1}: ${this.formatAmericanOdds(odds.fighter1.price)}`,
      `${fighter2}: ${this.formatAmericanOdds(odds.fighter2.price)}`,
      `Last Updated: ${lastUpdate}`,
    ]
      .filter(Boolean)
      .join("\n");
  }

  static formatAmericanOdds(odds) {
    return odds > 0 ? `+${odds}` : odds.toString();
  }

  static async fetchUFCOdds() {
    try {
      // Check cache first
      const cached = await database.getOddsCache("mma_odds");
      if (cached) {
        console.log("Using cached odds data");
        return cached.data;
      }

      const response = await axios.get(
        `https://api.the-odds-api.com${this.API_ENDPOINTS.ODDS}`,
        {
          params: {
            apiKey: process.env.ODDS_API_KEY,
            regions: "us",
            markets: "h2h",
            oddsFormat: "american",
            dateFormat: "iso",
          },
        }
      );

      console.log(
        `Remaining requests: ${response.headers["x-requests-remaining"]}`
      );

      // Store in cache for 30 minutes
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
      await database.storeOddsCache(
        "mma_odds",
        response.data,
        expiresAt,
        response.headers["x-requests-remaining"]
      );

      return response.data;
    } catch (error) {
      if (error.response?.status === 429) {
        console.error("API rate limit exceeded");
        return null;
      }
      console.error("Error fetching odds:", error);
      return null;
    }
  }
}

module.exports = OddsAnalysis;
