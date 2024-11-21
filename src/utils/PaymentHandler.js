const { EmbedBuilder, ButtonBuilder, ActionRowBuilder, ButtonStyle } = require("discord.js");
const PayPalService = require("./PayPalService");
const PaymentModel = require("../models/PaymentModel");
const database = require("../database");
const SolanaPriceService = require("./SolanaPriceService");

class PaymentHandler {
    static async handlePayment(interaction) {
        try {
            if (!interaction.deferred && !interaction.replied) {
                await interaction.deferUpdate();
            }

            // Parse button customId: buy_[type]_[method]
            const [action, type, method] = interaction.customId.split('_');
            
            if (action !== 'buy') return;

            const isLifetime = type === 'lifetime';
            const isSolana = method === 'solana';
            const amount = isLifetime ? 50.00 : 6.99;

            console.log('Processing payment:', {
                type,
                method,
                amount,
                isLifetime,
                isSolana
            });

            // Check existing access
            const hasAccess = await PaymentModel.checkServerAccess(interaction.guild.id);
            if (hasAccess) {
                await interaction.editReply({
                    content: '✅ This server already has Fight Genie access!',
                    ephemeral: true
                });
                return;
            }

            if (isSolana) {
                await this.handleSolanaPayment(interaction, {
                    amount,
                    isLifetime
                });
            } else {
                await this.handlePayPalPayment(interaction, {
                    amount,
                    isLifetime
                });
            }
        } catch (error) {
            console.error('Payment handling error:', error);
            await interaction.editReply({
                content: 'Error processing payment request. Please try again.',
                ephemeral: true
            });
        }
    }

    static async handlePayPalPayment(interaction, { amount, isLifetime }) {
        try {
            const paymentType = isLifetime ? 'SERVER_LIFETIME' : 'SERVER_EVENT';

            // Create PayPal order
            const order = await PayPalService.createPaymentOrder(
                interaction.user.id,
                interaction.guild.id,
                amount,
                paymentType
            );

            const embed = new EmbedBuilder()
                .setColor('#0099ff')
                .setTitle('🌐 Complete Your PayPal Purchase')
                .setAuthor({ 
                    name: 'Fight Genie',
                    iconURL: 'attachment://FightGenie_Logo_1.PNG'
                })
                .setDescription([
                    `Complete your payment of $${amount.toFixed(2)} through PayPal to activate ${isLifetime ? 'lifetime' : 'event'} access.`,
                    '',
                    'Click the PayPal button below to complete your purchase securely.'
                ].join('\n'))
                .addFields(
                    {
                        name: isLifetime ? '🌟 Lifetime Access' : '🎟️ Event Access',
                        value: isLifetime 
                            ? '• One-time payment for permanent access\n• Server-wide access to all predictions\n• Never pay again!'
                            : '• Access until event completion\n• Server-wide access for one event\n• Perfect for watch parties',
                        inline: false
                    },
                    {
                        name: 'Next Steps',
                        value: [
                            '1. Click the PayPal button below',
                            '2. Complete payment on PayPal',
                            '3. Return here and click "Verify Payment"',
                            '4. Start using Fight Genie predictions!'
                        ].join('\n')
                    }
                );

            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setLabel('Pay with PayPal')
                        .setURL(order.approveLink)
                        .setStyle(ButtonStyle.Link),
                    new ButtonBuilder()
                        .setCustomId(`verify_payment_${order.orderId}_${interaction.guild.id}`)
                        .setLabel('Verify Payment')
                        .setEmoji('✅')
                        .setStyle(ButtonStyle.Success)
                );

            await interaction.editReply({
                embeds: [embed],
                components: [row],
                files: [{
                    attachment: './src/images/FightGenie_Logo_1.PNG',
                    name: 'FightGenie_Logo_1.PNG'
                }],
                ephemeral: true
            });
        } catch (error) {
            console.error('PayPal payment error:', error);
            throw error;
        }
    }

    static async handleSolanaPayment(interaction, { amount, isLifetime }) {
        try {
            // Calculate Solana amount with 10% discount
            const solAmount = await SolanaPriceService.getPriceWithDiscount(amount);
            
            // Generate payment address
            const paymentAddress = await PaymentModel.generateSolanaPaymentAddress();
            
            const embed = new EmbedBuilder()
                .setColor('#0099ff')
                .setTitle('⚡ Complete Your Solana Payment')
                .setAuthor({ 
                    name: 'Fight Genie',
                    iconURL: 'attachment://FightGenie_Logo_1.PNG'
                })
                .setDescription([
                    `Complete your payment of ${solAmount} SOL to activate ${isLifetime ? 'lifetime' : 'event'} access.`,
                    '',
                    '**Payment Address:**',
                    `\`${paymentAddress}\``,
                    '',
                    '**Amount Due:**',
                    `${solAmount} SOL`,
                    '',
                    '*10% discount applied for Solana payments!*',
                    '*Real-time pricing powered by Jupiter Exchange API V2*'
                ].join('\n'))
                .addFields(
                    {
                        name: isLifetime ? '🌟 Lifetime Access' : '🎟️ Event Access',
                        value: isLifetime 
                            ? '• One-time payment for permanent access\n• Server-wide access to all predictions\n• Never pay again!'
                            : '• Access until event completion\n• Server-wide access for one event\n• Perfect for watch parties',
                        inline: false
                    },
                    {
                        name: 'Next Steps',
                        value: [
                            '1. Send the exact SOL amount to the address above',
                            '2. Wait for transaction confirmation (~30 seconds)',
                            '3. Click "Verify Payment" below',
                            '4. Start using Fight Genie predictions!'
                        ].join('\n')
                    }
                );

            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`verify_solana_${paymentAddress}_${interaction.guild.id}_${solAmount}`)
                        .setLabel('Verify Payment')
                        .setEmoji('⚡')
                        .setStyle(ButtonStyle.Success)
                );

            await interaction.editReply({
                embeds: [embed],
                components: [row],
                files: [{
                    attachment: './src/images/FightGenie_Logo_1.PNG',
                    name: 'FightGenie_Logo_1.PNG'
                }],
                ephemeral: true
            });
        } catch (error) {
            console.error('Solana payment error:', error);
            throw error;
        }
    }
}

module.exports = PaymentHandler;