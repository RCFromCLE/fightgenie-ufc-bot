const {
    EmbedBuilder,
    ButtonBuilder,
    ActionRowBuilder,
    ButtonStyle,
} = require("discord.js");

// Your PayPal donation link
const DONATION_LINK = "https://www.paypal.com/donate/?hosted_button_id=2JF3LZ77YEBEE";

class DonateCommand {
    static async handleDonateCommand(message) {
        try {
            const guildName = message.guild ? message.guild.name : "this server";

            const donateEmbed = new EmbedBuilder()
                .setColor('#0099ff') // You can choose a different color
                .setTitle('💖 Support Fight Genie!')
                .setDescription([
                    `Thank you for using Fight Genie in **${guildName}**!`,
                    "",
                    "Fight Genie provides AI-powered UFC predictions and insights completely **free** for thousands of users like you.",
                    "",
                    "Maintaining and improving the bot takes significant time and resources. If you find Fight Genie valuable, please consider supporting its development with a small donation.",
                    "",
                    "Your contribution helps cover server costs, data feeds, and allows me to dedicate more time to adding new features!",
                    "",
                    "**Click the button below or use the link to donate:**",
                    DONATION_LINK
                ].join('\n'))
                .setThumbnail('attachment://FightGenie_Logo_1.PNG'); // Optional: Keep the logo

            const donateButton = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setLabel("Donate via PayPal")
                        .setStyle(ButtonStyle.Link)
                        .setURL(DONATION_LINK)
                        .setEmoji("💰") // Optional emoji
                );

            // Send as a public reply in the channel where the command was used
            await message.reply({
                embeds: [donateEmbed],
                components: [donateButton],
                files: [{ // Keep the logo if you want
                    attachment: './src/images/FightGenie_Logo_1.PNG',
                    name: 'FightGenie_Logo_1.PNG'
                }]
                // Make it non-ephemeral so everyone sees the donation appeal
                // ephemeral: false (default)
            });

        } catch (error) {
            console.error("Error handling donate command:", error);
            // Send a generic error message
            try {
                await message.reply({
                    content: "An error occurred while processing the donate command. Please try again later.",
                    ephemeral: true
                });
            } catch (replyError) {
                console.error("Failed to send error reply for donate command:", replyError);
            }
        }
    }
}

module.exports = DonateCommand;
