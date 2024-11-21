const FighterStats = require("./fighterStats.js");
const database = require("../database");

class StatsManager {
    static async formatFightDisplay(fight, fighter1Stats, fighter2Stats) {
        try {
            if (!fighter1Stats || !fighter2Stats) return null;

            // Get records from database
            const [fighter1Record, fighter2Record] = await Promise.all([
                this.getRecord(fight.fighter1),
                this.getRecord(fight.fighter2)
            ]);

            const formatFighterStats = (stats) => {
                if (!stats) return "No stats available";

                const reach = stats.Reach ? `${stats.Reach}"` : "?";
                const slpm = stats.SLPM?.toFixed(1) || "0.0";
                const tdAvg = stats.TDAvg?.toFixed(1) || "0.0";
                const tdDef = stats.TDDef?.replace("%", "") || "0";
                const subAvg = stats.SubAvg?.toFixed(1) || "0.0";
                const age = stats.DOB ? new Date().getFullYear() - new Date(stats.DOB).getFullYear() : "?";

                return `${stats.Stance || "?"} | ${reach} reach | ${age} yrs | ${slpm} str/min | ${tdAvg} td/15m | ${tdDef}% td def | ${subAvg} sub/15m`;
            };

            // Format records
            const record1 = `${fighter1Record.wins}-${fighter1Record.losses}-${fighter1Record.draws}`;
            const record2 = `${fighter2Record.wins}-${fighter2Record.losses}-${fighter2Record.draws}`;

            return [
                `${fight.fighter1} (${record1})`,
                formatFighterStats(fighter1Stats),
                "⚔️",
                `${fight.fighter2} (${record2})`,
                formatFighterStats(fighter2Stats)
            ].join("\n");
        } catch (error) {
            console.error("Error formatting fight display:", error);
            return null;
        }
    }

    static async getRecord(fighterName) {
        try {
            const [wins, losses, draws] = await Promise.all([
                database.query(
                    "SELECT COUNT(*) as count FROM events WHERE Winner = ?",
                    [fighterName]
                ),
                database.query(
                    "SELECT COUNT(*) as count FROM events WHERE Loser = ?",
                    [fighterName]
                ),
                database.query(
                    'SELECT COUNT(*) as count FROM events WHERE (Winner = ? OR Loser = ?) AND Method LIKE "%Draw%"',
                    [fighterName, fighterName]
                )
            ]);

            return {
                wins: wins[0]?.count || 0,
                losses: losses[0]?.count || 0,
                draws: draws[0]?.count || 0
            };
        } catch (error) {
            console.error("Error getting record for", fighterName, ":", error);
            return { wins: 0, losses: 0, draws: 0 };
        }
    }static formatDetailedFighterStats(fighter1Name, fighter1Stats, fighter2Name, fighter2Stats) {
      const formatFighterBlock = (name, stats) => {
          if (!stats) return `${name}: No stats available`;

          const age = stats.DOB
              ? new Date().getFullYear() - new Date(stats.DOB).getFullYear()
              : "N/A";

          const totalFights =
              (stats.record?.wins || 0) +
              (stats.record?.losses || 0) +
              (stats.record?.draws || 0);

          return [
              `**${name}**`,
              `📊 Physical: ${stats.Height || "N/A"} | ${stats.Weight || "N/A"} | Reach: ${stats.Reach || "N/A"}`,
              `👊 Style: ${stats.Stance || "N/A"} | Age: ${age}`,
              `🎯 Striking: ${stats.SLPM?.toFixed(1) || "0.0"} Landed/min | ${stats.SApM?.toFixed(1) || "0.0"} Absorbed/min`,
              `🛡️ Defense: Str: ${stats.StrDef || "0%"} | TD: ${stats.TDDef || "0%"}`,
              `🤼 Grappling: ${stats.TDAvg?.toFixed(1) || "0.0"} TD/15min | ${stats.SubAvg?.toFixed(1) || "0.0"} Sub/15min`,
              `📈 Total Fights: ${totalFights}`
          ].join("\n");
      };

      return [
          formatFighterBlock(fighter1Name, fighter1Stats),
          "\n⚔️ VS ⚔️\n",
          formatFighterBlock(fighter2Name, fighter2Stats)
      ].join("\n");
  }

  static async parseHeight(heightStr) {
      if (!heightStr) return 0;
      const match = heightStr.match(/(\d+)'(\d+)"/);
      return match ? parseInt(match[1]) * 12 + parseInt(match[2]) : 0;
  }

  static async parseWeight(weightStr) {
      if (!weightStr) return 0;
      return parseInt(weightStr.replace(/\D/g, "")) || 0;
  }

  static async isWomensDivision(fighter1, fighter2) {
      const fights = await database.query(
          `SELECT DISTINCT WeightClass 
           FROM events 
           WHERE (Winner IN (?, ?) OR Loser IN (?, ?))
           AND WeightClass LIKE "Women%"
           LIMIT 1`,
          [fighter1, fighter2, fighter1, fighter2]
      );
      return fights.length > 0;
  }

  static determineWeightClassFromWeight(weight, isWomens) {
      if (isWomens) {
          if (weight <= 115) return "Women's Strawweight";
          if (weight <= 125) return "Women's Flyweight";
          if (weight <= 135) return "Women's Bantamweight";
          if (weight <= 145) return "Women's Featherweight";
      }
      if (weight <= 125) return "Flyweight";
      if (weight <= 135) return "Bantamweight";
      if (weight <= 145) return "Featherweight";
      if (weight <= 155) return "Lightweight";
      if (weight <= 170) return "Welterweight";
      if (weight <= 185) return "Middleweight";
      if (weight <= 205) return "Light Heavyweight";
      return "Heavyweight";
  }

  static formatMatchupAnalysis(matchup) {
      if (!matchup) return "Matchup analysis not available";

      const formatAdvantage = (advantage) => {
          const arrows = {
              "Significant Advantage": "⬆️⬆️",
              "Slight Advantage": "⬆️",
              "Even": "↔️",
              "Slight Disadvantage": "⬇️",
              "Significant Disadvantage": "⬇️⬇️"
          };
          return arrows[advantage] || "↔️";
      };

      return [
          `**Weight Class**: ${matchup.weightClass}`,
          "",
          "**Style Matchup**:",
          `Striking: ${formatAdvantage(matchup.stylistic?.striking?.advantage)} ${matchup.stylistic?.striking?.advantage || 'Unknown'}`,
          `Grappling: ${formatAdvantage(matchup.stylistic?.grappling?.advantage)} ${matchup.stylistic?.grappling?.advantage || 'Unknown'}`,
          "",
          "**Physical Comparison**:",
          `Height Difference: ${Math.abs(matchup.tale_of_tape?.height?.difference || 0)}" ${(matchup.tale_of_tape?.height?.difference || 0) > 0 ? "(Fighter 1 taller)" : "(Fighter 2 taller)"}`,
          `Reach Difference: ${Math.abs(matchup.tale_of_tape?.reach?.difference || 0)}" ${(matchup.tale_of_tape?.reach?.difference || 0) > 0 ? "(Fighter 1 longer)" : "(Fighter 2 longer)"}`,
          `Stance Matchup: ${matchup.tale_of_tape?.stance?.fighter1 || 'Unknown'} vs ${matchup.tale_of_tape?.stance?.fighter2 || 'Unknown'}`,
          "",
          matchup.commonOpponents?.length > 0 
              ? `**Common Opponents**: ${matchup.commonOpponents.length} found`
              : "**Common Opponents**: None found"
      ].join("\n");
  }

  static formatStats(fighter1Name, fighter1Stats, fighter2Name, fighter2Stats) {
      const formatFighterLine = (name, stats) => {
          if (!stats) return `**${name}**: No stats available`;

          return [
              `**${name}**`,
              `${stats.Stance || "N/A"} stance | ${stats.Reach || "N/A"}" reach`,
              `Strikes: ${(stats.SLPM || 0).toFixed(1)}/min | ${stats.StrAcc || "0%"} acc | ${stats.StrDef || "0%"} def`,
              `Grappling: ${(stats.TDAvg || 0).toFixed(1)} TD/15m | ${stats.TDDef || "0%"} TD def | ${(stats.SubAvg || 0).toFixed(1)} sub/15m`
          ].join("\n");
      };

      return [
          formatFighterLine(fighter1Name, fighter1Stats),
          "\n⚔️ VS ⚔️\n",
          formatFighterLine(fighter2Name, fighter2Stats)
      ].join("\n");
  }
}

module.exports = StatsManager;