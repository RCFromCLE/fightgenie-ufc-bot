const { EmbedBuilder } = require('discord.js');
// No longer need database access for this command
// const database = require('../database'); 

class SubscriptionCommand {
    static async handleSubscriptionStatus(message) {
        try {
            const guildName = message.guild ? message.guild.name : "this server";

            const infoEmbed = new EmbedBuilder()
                .setColor('#00ff00') // Green color for positive news
                .setTitle('✅ Fight Genie is Free!')
                .setDescription([
                    `Good news! Fight Genie is now **completely free** to use in **${guildName}** and all other servers.`,
                    "",
                    "All features, including AI predictions and analysis, are available to everyone without any subscription.",
                    "",
                    "If you enjoy using Fight Genie and want to support its continued development and server costs, please consider making a donation.",
                    "",
                    "Use the `$donate` command to see how you can contribute.",
                    "",
                    "Thank you for being part of the Fight Genie community!"
                ].join('\n'))
                .setThumbnail('attachment://FightGenie_Logo_1.PNG') // Keep the logo
                .setFooter({
                    text: 'Fight Genie - Free for All!',
                    iconURL: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/92/UFC_Logo.svg/2560px-UFC_Logo.svg.png' // Keep UFC logo or use yours
                });

            await message.reply({ 
                embeds: [infoEmbed],
                files: [{ // Keep the logo if you want
                    attachment: './src/images/FightGenie_Logo_1.PNG',
                    name: 'FightGenie_Logo_1.PNG'
                }]
            });

        } catch (error) {
            console.error('Error handling subscription status command:', error);
            try {
                await message.reply({
                    content: 'An error occurred while processing this command. Please try again later.',
                    ephemeral: true 
                });
            } catch (replyError) {
                 console.error("Failed to send error reply for sub command:", replyError);
            }
        }
    }
}

module.exports = SubscriptionCommand;
