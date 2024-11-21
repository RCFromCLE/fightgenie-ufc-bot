const {
  EmbedBuilder,
  ButtonBuilder,
  ActionRowBuilder,
  ButtonStyle,
  PermissionFlagsBits,
} = require("discord.js");
const PaymentModel = require("../models/PaymentModel");
const SolanaPriceService = require("../utils/SolanaPriceService");

class PaymentCommand {
  static async handleBuyCommand(message) {
    try {
      // Command handling for $buy message
      if (!message.guild) {
        await message.reply("⚠️ This command must be used in a server channel first.");
        return;
      }

      if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
        await message.reply({
          content: "⚠️ Only server administrators can purchase Fight Genie access.",
          ephemeral: true,
        });
        return;
      }

      const hasAccess = await PaymentModel.checkServerAccess(message.guild.id);
      if (hasAccess) {
        await message.reply("✅ This server already has access to Fight Genie!");
        return;
      }

      // Calculate Solana prices with 10% discount
      const lifetimeUsdAmount = 50.00;
      const eventUsdAmount = 6.99;
      
      const [lifetimeSolAmount, eventSolAmount] = await Promise.all([
        SolanaPriceService.getPriceWithDiscount(lifetimeUsdAmount),
        SolanaPriceService.getPriceWithDiscount(eventUsdAmount)
      ]);

      const embed = new EmbedBuilder()
        .setColor("#0099ff")
        .setAuthor({ 
          name: 'Fight Genie',
          iconURL: 'attachment://FightGenie_Logo_1.PNG'
        })
        .setTitle(`🌟 Fight Genie Server Access - ${message.guild.name}`)
        .setDescription(
          "Choose your payment method and access type below. All members will be able to use Fight Genie predictions!"
        )
        .addFields(
          {
            name: "🌟 Server Lifetime Access - Special Launch Offer!",
            value: [
              "```",
              "• One-time payment for permanent access",
              "• Server-wide access to all future predictions",
              "• All members can use predictions",
              "• Never pay again!",
              "",
              `PayPal: $${lifetimeUsdAmount.toFixed(2)}`,
              `Solana: ${lifetimeSolAmount} SOL (10% discount!)`,
              "```"
            ].join('\n'),
            inline: false,
          },
          {
            name: "🎟️ Server Event Access",
            value: [
              "```",
              "• Pay-per-event access",
              "• Server-wide access for one event",
              "• All members can use predictions",
              "• Perfect for watching parties",
              "",
              `PayPal: $${eventUsdAmount.toFixed(2)}`,
              `Solana: ${eventSolAmount} SOL (10% discount!)`,
              "```"
            ].join('\n'),
            inline: false,
          }
        )
        .addFields({
          name: "💫 Choose Your Payment Method",
          value: [
            "🌐 **PayPal**: Traditional secure payment",
            "⚡ **Solana**: Fast crypto payment with 10% discount",
            "",
            "*Real-time SOL pricing powered by Jupiter Exchange*"
          ].join('\n'),
          inline: false
        });

      // First row - Lifetime access buttons
      const lifetimeRow = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId("buy_lifetime_paypal")
            .setLabel("Lifetime Access - PayPal")
            .setEmoji("🌐")
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId("buy_lifetime_solana")
            .setLabel("Lifetime Access - Solana (10% Off)")
            .setEmoji("⚡")
            .setStyle(ButtonStyle.Success)
        );

      // Second row - Event access buttons
      const eventRow = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId("buy_event_paypal")
            .setLabel("Event Access - PayPal")
            .setEmoji("🌐")
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId("buy_event_solana")
            .setLabel("Event Access - Solana (10% Off)")
            .setEmoji("⚡")
            .setStyle(ButtonStyle.Secondary)
        );

      await message.reply({
        embeds: [embed],
        components: [lifetimeRow, eventRow],
        files: [{
          attachment: './src/images/FightGenie_Logo_1.PNG',
          name: 'FightGenie_Logo_1.PNG'
        }]
      });
    } catch (error) {
      console.error("Error handling buy command:", error);
      await message.reply("Error processing server purchase request. Please try again.");
    }
  }
}

module.exports = PaymentCommand;