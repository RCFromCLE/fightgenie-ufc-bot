// src/models/prediction.js

const database = require("../database");
const FighterStatsUtil = require("../utils/fighterStats");

class PredictionModel {
  static async analyzeFightMatchup(fighter1, fighter2) {
    const [fighter1Stats, fighter2Stats] = await Promise.all([
      FighterStatsUtil.getFighterStats(fighter1),

      FighterStatsUtil.getFighterStats(fighter2),
    ]);

    return {
      striking: this.analyzeStrikingMatchup(fighter1Stats, fighter2Stats),
      grappling: this.analyzeGrapplingMatchup(fighter1Stats, fighter2Stats),
      physical: this.analyzePhysicalAdvantages(fighter1Stats, fighter2Stats),
      experience: await this.analyzeExperience(fighter1, fighter2),
    };
  }

  static analyzeStrikingMatchup(fighter1Stats, fighter2Stats) {
    if (!fighter1Stats || !fighter2Stats) return null;

    const f1_slpm = parseFloat(fighter1Stats.SLPM || 0);
    const f2_slpm = parseFloat(fighter2Stats.SLPM || 0);
    const f1_strdef = parseFloat(fighter1Stats.StrDef?.replace("%", "") || 0);
    const f2_strdef = parseFloat(fighter2Stats.StrDef?.replace("%", "") || 0);

    return {
      volumeDifferential: f1_slpm - f2_slpm,

      defenseComparison: f1_strdef - f2_strdef,

      advantage: this.calculateAdvantage(
        f1_slpm,
        f2_slpm,
        f1_strdef,
        f2_strdef
      ),
    };
  }

  static analyzeGrapplingMatchup(fighter1Stats, fighter2Stats) {
    if (!fighter1Stats || !fighter2Stats) return null;

    const f1_tdavg = parseFloat(fighter1Stats.TDAvg || 0);
    const f2_tdavg = parseFloat(fighter2Stats.TDAvg || 0);
    const f1_tddef = parseFloat(fighter1Stats.TDDef?.replace("%", "") || 0);
    const f2_tddef = parseFloat(fighter2Stats.TDDef?.replace("%", "") || 0);
    const f1_subavg = parseFloat(fighter1Stats.SubAvg || 0);
    const f2_subavg = parseFloat(fighter2Stats.SubAvg || 0);

    return {
      takedownDifferential: f1_tdavg - f2_tdavg,
      takedownDefense: f1_tddef - f2_tddef,
      submissionThreat: f1_subavg - f2_subavg,
      advantage: this.calculateGrapplingAdvantage(
        f1_tdavg,
        f2_tdavg,
        f1_tddef,
        f2_tddef,
        f1_subavg,
        f2_subavg
      ),
    };
  }

  static analyzePhysicalAdvantages(fighter1Stats, fighter2Stats) {
    if (!fighter1Stats || !fighter2Stats) return null;

    const heightDiff =
      this.parseHeight(fighter1Stats.Height) -
      this.parseHeight(fighter2Stats.Height);

    const reachDiff =
      this.parseReach(fighter1Stats.Reach) -
      this.parseReach(fighter2Stats.Reach);

    return {
      heightDifferential: heightDiff,

      reachDifferential: reachDiff,

      stanceMatchup: this.analyzeStanceMatchup(
        fighter1Stats.Stance,
        fighter2Stats.Stance
      ),
    };
  }

  static async analyzeExperience(fighter1, fighter2) {
    const [f1History, f2History] = await Promise.all([
      database.query(
        "SELECT * FROM fight_history WHERE fighter_name = ? ORDER BY fight_date DESC",
        [fighter1]
      ),

      database.query(
        "SELECT * FROM fight_history WHERE fighter_name = ? ORDER BY fight_date DESC",
        [fighter2]
      ),
    ]);

    return {
      fighter1TotalFights: f1History.length,

      fighter2TotalFights: f2History.length,

      fighter1RecentForm: this.analyzeRecentForm(f1History.slice(0, 3)),

      fighter2RecentForm: this.analyzeRecentForm(f2History.slice(0, 3)),

      commonOpponents: await this.findCommonOpponents(fighter1, fighter2),
    };
  }

  static calculateAdvantage(f1_metric1, f2_metric1, f1_metric2, f2_metric2) {
    const score = [
      f1_metric1 > f2_metric1 ? 1 : f1_metric1 < f2_metric1 ? -1 : 0,

      f1_metric2 > f2_metric2 ? 1 : f1_metric2 < f2_metric2 ? -1 : 0,
    ].reduce((a, b) => a + b, 0);

    if (score >= 1.5) return "Significant Advantage";

    if (score > 0) return "Slight Advantage";

    if (score === 0) return "Even";

    if (score > -1.5) return "Slight Disadvantage";

    return "Significant Disadvantage";
  }

  static calculateGrapplingAdvantage(
    f1_td,
    f2_td,
    f1_def,
    f2_def,
    f1_sub,
    f2_sub
  ) {
    const score = [
      f1_td > f2_td ? 1 : f1_td < f2_td ? -1 : 0,

      f1_def > f2_def ? 1 : f1_def < f2_def ? -1 : 0,

      f1_sub > f2_sub ? 1 : f1_sub < f2_sub ? -1 : 0,
    ].reduce((a, b) => a + b, 0);

    if (score >= 2) return "Significant Advantage";

    if (score > 0) return "Slight Advantage";

    if (score === 0) return "Even";

    if (score > -2) return "Slight Disadvantage";

    return "Significant Disadvantage";
  }

  static analyzeStanceMatchup(stance1, stance2) {
    const matchups = {
      "Orthodox vs Southpaw": "Complex matchup",

      "Southpaw vs Orthodox": "Complex matchup",

      "Orthodox vs Orthodox": "Neutral",

      "Southpaw vs Southpaw": "Neutral",

      "Switch vs Orthodox": "Advantage",

      "Switch vs Southpaw": "Advantage",
    };

    return matchups[`${stance1} vs ${stance2}`] || "Unknown";
  }

  static analyzeRecentForm(fights) {
    if (!fights.length) return { trend: "Unknown", winStreak: 0 };

    const winStreak = fights.findIndex((f) => f.result !== "Win");

    const trend = (() => {
      const wins = fights.filter((f) => f.result === "Win").length;

      if (wins === 3) return "Strong";

      if (wins === 2) return "Good";

      if (wins === 1) return "Mixed";

      return "Poor";
    })();

    return {
      trend,

      winStreak: winStreak === -1 ? fights.length : winStreak,

      recentResults: fights.map((f) => f.result),
    };
  }

  static async findCommonOpponents(fighter1, fighter2) {
    try {
      const commonOpponents = await database.getCommonOpponents(
        fighter1,
        fighter2
      );

      return {
        count: commonOpponents.length,

        commonFights: commonOpponents,

        analysis: this.analyzeCommonOpponentResults(
          commonOpponents,
          fighter1,
          fighter2
        ),
      };
    } catch (error) {
      console.error("Error finding common opponents:", error);

      return {
        count: 0,

        commonFights: [],

        analysis: "No common opponents found",
      };
    }
  }

  static analyzeCommonOpponentResults(commonOpponents, fighter1, fighter2) {
    if (!commonOpponents || commonOpponents.length === 0) {
      return "No common opponents to analyze";
    }

    let fighter1Wins = 0;

    let fighter2Wins = 0;

    commonOpponents.forEach((fight) => {
      if (fight.fighter1_fight.result === "Win") fighter1Wins++;

      if (fight.fighter2_fight.result === "Win") fighter2Wins++;
    });

    let analysis = `Found ${commonOpponents.length} common opponent(s). `;

    analysis += `${fighter1} won ${fighter1Wins} of these matchups, while ${fighter2} won ${fighter2Wins}. `;

    if (fighter1Wins > fighter2Wins) {
      analysis += `${fighter1} has performed better against common opposition.`;
    } else if (fighter2Wins > fighter1Wins) {
      analysis += `${fighter2} has performed better against common opposition.`;
    } else {
      analysis += `Both fighters have performed similarly against common opposition.`;
    }

    return analysis;
  }

  static parseHeight(height) {
    if (!height) return 0;

    const inches = height.match(/(\d+)'(\d+)"/);

    return inches ? parseInt(inches[1]) * 12 + parseInt(inches[2]) : 0;
  }

  static parseReach(reach) {
    if (!reach) return 0;

    return parseInt(reach.replace('"', "")) || 0;
  }
}

module.exports = PredictionModel;
