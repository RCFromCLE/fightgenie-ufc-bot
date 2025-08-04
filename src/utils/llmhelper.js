require("dotenv").config({
  path: require("path").resolve(__dirname, "../../.env"),
});
const Anthropic = require("@anthropic-ai/sdk");
const OpenAI = require("openai");
const database = require("../database");
const PredictionModel = require("../models/prediction");
const CommonOpponentAnalyzer = require("./CommonOpponentAnalyzer");

// Initialize clients with API keys
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || "",
  dangerouslyAllowBrowser: true,
});

async function generateEnhancedPredictionsWithAI(fightData, eventInfo, model = "Claude") {
  try {
      console.log("Starting prediction generation with model:", model);
      console.log("Number of fights to analyze:", fightData.length);
      console.log("Event info:", JSON.stringify(eventInfo, null, 2));

      // Collect comprehensive data for each fight
      const enrichedFights = await Promise.all(
          fightData.map(async (fight) => {
              try {
                  const fighter1Data = await getFighterCompleteData(fight.fighter1);
                  const fighter2Data = await getFighterCompleteData(fight.fighter2);
                  const matchupAnalysis = await PredictionModel.analyzeFightMatchup(
                      fight.fighter1,
                      fight.fighter2
                  );

                  // Get common opponent analysis
                  const commonOpponentData = await CommonOpponentAnalyzer.analyzeCommonOpponents(
                      fight.fighter1,
                      fight.fighter2
                  );

                  const [
                      fighter1Effectiveness,
                      fighter2Effectiveness,
                      fighter1RecentForm,
                      fighter2RecentForm,
                      fighter1WeightHistory,
                      fighter2WeightHistory,
                      historicalMatchup,
                      styleMatchup,
                      physicalComparison,
                  ] = await Promise.all([
                      calculateFighterEffectiveness(fighter1Data.basics, fight.fighter1),
                      calculateFighterEffectiveness(fighter2Data.basics, fight.fighter2),
                      getDetailedRecentForm(fight.fighter1),
                      getDetailedRecentForm(fight.fighter2),
                      getWeightCutHistory(fight.fighter1),
                      getWeightCutHistory(fight.fighter2),
                      getDetailedStyleMatchup(fight.fighter1, fight.fighter2),
                      comparePhysicalAttributes(fighter1Data.basics, fighter2Data.basics)
                  ]);

                  return {
                      ...fight,
                      fighter1Stats: {
                          basics: fighter1Data.basics,
                          history: fighter1Data.history,
                          effectiveness: fighter1Effectiveness,
                          recentForm: fighter1RecentForm,
                          stylistics: matchupAnalysis,
                          weightCutHistory: fighter1WeightHistory,
                      },
                      fighter2Stats: {
                          basics: fighter2Data.basics,
                          history: fighter2Data.history,
                          effectiveness: fighter2Effectiveness,
                          recentForm: fighter2RecentForm,
                          stylistics: {
                              ...matchupAnalysis,
                              striking: invertAdvantage(matchupAnalysis.striking),
                              grappling: invertAdvantage(matchupAnalysis.grappling),
                          },
                          weightCutHistory: fighter2WeightHistory,
                      },
                      matchupAnalysis: {
                          historical: historicalMatchup,
                          stylistic: styleMatchup,
                          physical: physicalComparison,
                          commonOpponents: commonOpponentData
                      },
                  };
              } catch (error) {
                  console.error(
                      `Error enriching fight data for ${fight.fighter1} vs ${fight.fighter2}:`,
                      error
                  );
                  return fight;
              }
          })
      );

      // Format the data for the AI prompt
      const formattedData = {
          event: eventInfo,
          enrichedFights: enrichedFights
      };

      const enhancedPrompt = `You are an elite UFC fight analyst with deep expertise in MMA statistics and technical analysis. Analyze the following fight data and provide detailed, fight-specific predictions. Avoid templated responses and generic analysis.

Event Details:
${JSON.stringify(eventInfo, null, 2)}

Fight Analysis Data:
${JSON.stringify(formattedData, null, 2)}

For each fight, analyze:

1. Style Matchup Dynamics:
- How each fighter's style matches up against their opponent
- Historical performance against similar fighting styles
- Key technical advantages/disadvantages
- Range management and distance control

2. Statistical Edge Analysis:
- Significant strike differentials and accuracy
- Defensive metrics and vulnerability patterns
- Grappling efficiency and control time
- Phase transition success rates

3. Form and Momentum:
- Recent performance trends
- Quality of competition faced
- Improvements or declines in key areas
- Recovery and durability factors

4. Common Opponent Analysis:
- Performance against shared opponents
- Comparative results against similar fighting styles
- Insights from historical matchups with common opponents
- Stylistic advantages revealed through common opponent performance

5. Fight-Specific Factors:
- Weight class dynamics and size advantages
- Cardio and pace considerations
- Tournament/rankings implications
- Location and venue impact

Provide predictions in this exact JSON format:

{
  "fights": [
      {
          "fighter1": "Name",
          "fighter2": "Name",
          "predictedWinner": "Name",
          "confidence": <55-85>,
          "method": "KO/TKO/Submission/Decision",
          "round": <1-5>,
          "reasoning": "Specific, detailed analysis for this particular matchup",
          "keyFactors": [
              "Specific advantage/factor with supporting stats",
              "Style matchup element unique to this fight",
              "Historical pattern relevant to this matchup",
              "Physical or technical edge with evidence"
          ],
          "probabilityBreakdown": {
              "ko_tko": <percentage>,
              "submission": <percentage>,
              "decision": <percentage>
          }
      }
  ],
  "betting_analysis": {
      "upsets": "Detailed breakdown of underdog opportunities",
      "parlays": "List of 2-3 specific parlay combinations with detailed reasoning",
      "value_parlays": "2-3 specific parlay opportunities combining underdog and favorite picks",
      "method_props": "Specific finish predictions based on style matchups",
      "round_props": "Round-specific predictions based on finish rates",
      "special_props": "Creative prop opportunities based on fighter traits"
  }
}`;

      if (model === "gpt") {
          return await generatePredictionsWithGPT(enhancedPrompt);
      } else {
          return await generatePredictionsWithClaude(enhancedPrompt);
      }
  } catch (error) {
      console.error("Error in generateEnhancedPredictionsWithAI:", error);
      throw error;
  }
}

// Helper functions for fighter data
async function getFighterCompleteData(fighterName) {
  try {
    const [basics, history, stats, recentFights] = await Promise.all([
      database.query("SELECT * FROM fighters WHERE Name = ?", [fighterName]),
      database.query(
        "SELECT * FROM fight_history WHERE fighter_name = ? ORDER BY fight_date DESC LIMIT 5",
        [fighterName]
      ),
      database.query("SELECT * FROM fighter_stats WHERE name = ?", [fighterName]),
      database.query(
        `SELECT * FROM events 
         WHERE (Winner = ? OR Loser = ?) 
         ORDER BY Date DESC LIMIT 3`,
        [fighterName, fighterName]
      ),
    ]);

    return {
      basics: basics[0],
      history,
      stats: stats[0],
      recentFights,
    };
  } catch (error) {
    console.error(`Error getting data for fighter ${fighterName}:`, error);
    return { basics: null, history: [], stats: null, recentFights: [] };
  }
}

async function calculateFighterEffectiveness(basics, fighterName) {
  if (!basics) {
    return {
      striking: { accuracy: 0, volume: 0, defense: "0%", differential: 0 },
      grappling: {
        takedownAccuracy: 0,
        takedownDefense: 0,
        takedownsPerFight: 0,
        submissionsPerFight: 0,
      },
      overall: { finishRate: 0 },
    };
  }

  const strAcc = parseFloat(basics.StrAcc?.replace("%", "") || 0);
  const slpm = parseFloat(basics.SLPM || 0);
  const sapm = parseFloat(basics.SApM || 0);

  const striking = {
    accuracy: strAcc,
    volume: slpm,
    defense: basics.StrDef || "0%",
    differential: slpm - sapm,
    significantStrikesLanded: parseFloat(basics.SignificantStrikesLanded || 0),
    strikesAbsorbed: parseFloat(basics.StrikesAbsorbed || 0),
    headStrikeAccuracy: parseFloat(basics.HeadStrAcc?.replace("%", "") || 0),
    bodyStrikeAccuracy: parseFloat(basics.BodyStrAcc?.replace("%", "") || 0),
    legStrikeAccuracy: parseFloat(basics.LegStrAcc?.replace("%", "") || 0),
  };

  const grappling = {
    takedownAccuracy: parseFloat(basics.TDAcc?.replace("%", "") || 0),
    takedownDefense: parseFloat(basics.TDDef?.replace("%", "") || 0),
    takedownsPerFight: parseFloat(basics.TDAvg || 0),
    submissionsPerFight: parseFloat(basics.SubAvg || 0),
    submissionAttempts: parseFloat(basics.SubmissionAttempts || 0),
    reversalsPerFight: parseFloat(basics.Reversals || 0),
    averagePositionTime: parseFloat(basics.ControlTime || 0),
  };

  try {
    const [finishRate, wins, losses] = await Promise.all([
      database.calculateFinishRate(fighterName),
      database.getFinishes(fighterName, 'Winner', ''),
      database.getFinishes(fighterName, 'Loser', '')
    ]);

    const totalFights = wins + losses;
    const winRate = totalFights > 0 ? (wins / totalFights) * 100 : 0;

    return {
      striking,
      grappling,
      overall: {
        finishRate,
        winRate,
        effectiveStrikeRate: (striking.accuracy * striking.volume) / 100,
        defensiveEfficiency: parseFloat(basics.StrDef?.replace("%", "") || 0),
        groundControl: parseFloat(basics.ControlTime || 0),
      },
    };
  } catch (error) {
    console.error(`Error calculating effectiveness for ${fighterName}:`, error);
    return {
      striking,
      grappling,
      overall: {
        finishRate: 0,
        winRate: 0,
        effectiveStrikeRate: (striking.accuracy * striking.volume) / 100,
        defensiveEfficiency: parseFloat(basics.StrDef?.replace("%", "") || 0),
        groundControl: parseFloat(basics.ControlTime || 0),
      },
    };
  }
}

async function getDetailedRecentForm(fighterName) {
  try {
    const recentFights = await database.query(`
        SELECT 
            Date,
            CASE 
                WHEN Winner = ? THEN 'Win'
                WHEN Loser = ? THEN 'Loss'
                ELSE 'Draw'
            END as result,
            Method,
            WeightClass
        FROM events
        WHERE Winner = ? OR Loser = ?
        ORDER BY Date DESC
        LIMIT 5
    `, [fighterName, fighterName, fighterName, fighterName]);

    return {
      fights: recentFights,
      trend: analyzeFightTrend(recentFights),
      consistency: analyzeFightConsistency(recentFights)
    };
  } catch (error) {
    console.error(`Error getting recent form for ${fighterName}:`, error);
    return null;
  }
}

function analyzeFightTrend(fights) {
  if (!fights || fights.length === 0) return 'Unknown';
  
  const recentResults = fights.slice(0, 3).map(f => f.result);
  const wins = recentResults.filter(r => r === 'Win').length;
  
  if (wins === 3) return 'Strong Upward';
  if (wins === 2) return 'Moderate Upward';
  if (wins === 1) return 'Mixed';
  return 'Downward';
}

function analyzeFightConsistency(fights) {
  if (!fights || fights.length < 2) return 'Unknown';
  
  const methodCounts = fights.reduce((acc, fight) => {
    acc[fight.Method] = (acc[fight.Method] || 0) + 1;
    return acc;
  }, {});
  
  const maxCount = Math.max(...Object.values(methodCounts));
  const totalFights = fights.length;
  
  if (maxCount / totalFights >= 0.6) return 'High';
  if (maxCount / totalFights >= 0.4) return 'Moderate';
  return 'Low';
}

async function getWeightCutHistory(fighterName) {
  try {
    const weightHistory = await database.query(
      `
      SELECT WeightClass, Date, 
             LAG(WeightClass) OVER (ORDER BY Date) as previous_class,
             CAST((julianday(Date) - julianday(LAG(Date) OVER (ORDER BY Date))) AS INTEGER) as days_between_fights
      FROM events
      WHERE Winner = ? OR Loser = ?
      ORDER BY Date DESC
      LIMIT 5
      `,
      [fighterName, fighterName]
    );

    return {
      recentWeightClasses: weightHistory.map(wh => ({
        weightClass: wh.WeightClass,
        date: wh.Date,
        previousClass: wh.previous_class,
        daysBetweenFights: wh.days_between_fights,
      })),
      weightClassChanges: weightHistory.filter(wh => wh.WeightClass !== wh.previous_class).length,
      averageDaysBetweenFights: weightHistory.reduce((acc, curr) => acc + (curr.days_between_fights || 0), 0) / weightHistory.length,
    };
  } catch (error) {
    console.error(`Error getting weight cut history for ${fighterName}:`, error);
    return {
      recentWeightClasses: [],
      weightClassChanges: 0,
      averageDaysBetweenFights: 0,
    };
  }
}

async function getDetailedStyleMatchup(fighter1, fighter2) {
  try {
    const [fighter1Style, fighter2Style] = await Promise.all([
      database.query(
        `
        SELECT 
          COUNT(CASE WHEN Method LIKE '%KO%' OR Method LIKE '%TKO%' THEN 1 END) as ko_wins,
          COUNT(CASE WHEN Method LIKE '%Submission%' THEN 1 END) as sub_wins,
          COUNT(CASE WHEN Method LIKE '%Decision%' THEN 1 END) as dec_wins,
          COUNT(*) as total_fights
        FROM events
        WHERE Winner = ?
        `,
        [fighter1]
      ),
      database.query(
        `
        SELECT 
          COUNT(CASE WHEN Method LIKE '%KO%' OR Method LIKE '%TKO%' THEN 1 END) as ko_wins,
          COUNT(CASE WHEN Method LIKE '%Submission%' THEN 1 END) as sub_wins,
          COUNT(CASE WHEN Method LIKE '%Decision%' THEN 1 END) as dec_wins,
          COUNT(*) as total_fights
        FROM events
        WHERE Winner = ?
        `,
        [fighter2]
      ),
    ]);

    // Get additional stats for style analysis
    const [f1Stats, f2Stats] = await Promise.all([
      database.query("SELECT SLPM, TDAvg FROM fighters WHERE Name = ?", [fighter1]),
      database.query("SELECT SLPM, TDAvg FROM fighters WHERE Name = ?", [fighter2])
    ]);

    const fighter1Stats = {
      ...fighter1Style[0],
      striking_preference: parseFloat(f1Stats[0]?.SLPM || 0),
      grappling_preference: parseFloat(f1Stats[0]?.TDAvg || 0),
    };

    const fighter2Stats = {
      ...fighter2Style[0],
      striking_preference: parseFloat(f2Stats[0]?.SLPM || 0),
      grappling_preference: parseFloat(f2Stats[0]?.TDAvg || 0),
    };

    return {
      stylistic_comparison: {
        fighter1_tendencies: {
          finishing_preference: determineFinishingPreference(fighter1Stats),
          position_preference: determinePositionPreferenceFromStats(fighter1Stats),
        },
        fighter2_tendencies: {
          finishing_preference: determineFinishingPreference(fighter2Stats),
          position_preference: determinePositionPreferenceFromStats(fighter2Stats),
        },
      },
      style_clash_rating: calculateStyleClashRating(fighter1Stats, fighter2Stats),
    };
  } catch (error) {
    console.error(`Error analyzing style matchup for ${fighter1} vs ${fighter2}:`, error);
    return {
      stylistic_comparison: null,
      style_clash_rating: 0,
    };
  }
}

function determineFinishingPreference(stats) {
  if (!stats || !stats.total_fights) return "Unknown";

  const totalWins = (stats.ko_wins || 0) + (stats.sub_wins || 0) + (stats.dec_wins || 0);
  if (totalWins === 0) return "Unknown";

  const koRate = (stats.ko_wins || 0) / totalWins;
  const subRate = (stats.sub_wins || 0) / totalWins;
  const decRate = (stats.dec_wins || 0) / totalWins;

  if (koRate > 0.5) return "Knockout";
  if (subRate > 0.5) return "Submission";
  if (decRate > 0.5) return "Decision";
  return "Mixed";
}

function determinePositionPreferenceFromStats(stats) {
  if (!stats || (!stats.striking_preference && !stats.grappling_preference)) return "Unknown";

  const strikingScore = stats.striking_preference * 2; // Weight striking more heavily
  const grapplingScore = stats.grappling_preference * 3; // Weight grappling more heavily

  if (strikingScore > grapplingScore * 1.5) return "Striker";
  if (grapplingScore > strikingScore * 1.2) return "Grappler";
  return "Balanced";
}

function calculateStyleClashRating(fighter1Stats, fighter2Stats) {
  if (!fighter1Stats || !fighter2Stats) return 0;

  // Calculate style differential based on strike/grappling preferences
  const strikeDiff = Math.abs(
    (fighter1Stats.striking_preference || 0) - (fighter2Stats.striking_preference || 0)
  );
  const grappleDiff = Math.abs(
    (fighter1Stats.grappling_preference || 0) - (fighter2Stats.grappling_preference || 0)
  );

  // Normalize the differences
  const maxStrike = Math.max(fighter1Stats.striking_preference || 0, fighter2Stats.striking_preference || 0);
  const maxGrapple = Math.max(fighter1Stats.grappling_preference || 0, fighter2Stats.grappling_preference || 0);

  const normalizedStrikeDiff = maxStrike ? strikeDiff / maxStrike : 0;
  const normalizedGrappleDiff = maxGrapple ? grappleDiff / maxGrapple : 0;

  // Return weighted average of the differences
  return (normalizedStrikeDiff * 0.6 + normalizedGrappleDiff * 0.4);
}

function analyzeRecentPerformance(fights) {
  if (!fights || fights.length === 0) return null;

  const performance = {
    wins: fights.filter(f => f.result === 'Win').length,
    finishes: fights.filter(f => f.result === 'Win' && !f.method.includes('Decision')).length,
    averageFightTime: calculateAverageFightTime(fights),
    dominance: calculateDominanceScore(fights)
  };

  return performance;
}

function compareCompetitionLevel(fighter1Fights, fighter2Fights) {
  if (!fighter1Fights || !fighter2Fights) return null;

  const f1Opponents = fighter1Fights.map(f => f.opponent_name || f.Opponent || f.opponent);
  const f2Opponents = fighter2Fights.map(f => f.opponent_name || f.Opponent || f.opponent);

  // Calculate common opponents
  const commonOpponents = f1Opponents.filter(opponent => f2Opponents.includes(opponent));

  // Calculate average opponent quality (if available)
  const f1OpponentQuality = calculateOpponentQuality(fighter1Fights);
  const f2OpponentQuality = calculateOpponentQuality(fighter2Fights);

  return {
    fighter1TotalOpponents: f1Opponents.length,
    fighter2TotalOpponents: f2Opponents.length,
    commonOpponents: commonOpponents,
    commonOpponentCount: commonOpponents.length,
    fighter1OpponentQuality: f1OpponentQuality,
    fighter2OpponentQuality: f2OpponentQuality,
    levelDifferential: calculateLevelDifferential(f1OpponentQuality, f2OpponentQuality),
    competitionAdvantage: determineCompetitionAdvantage(f1OpponentQuality, f2OpponentQuality, commonOpponents.length)
  };
}

function calculateOpponentQuality(fights) {
  if (!fights || fights.length === 0) return 0;

  // Calculate quality based on opponent win rates and rankings if available
  let totalQuality = 0;
  let validFights = 0;

  fights.forEach(fight => {
    // Basic quality score based on fight outcome and method
    let fightQuality = 50; // Base score

    // Adjust based on fight result
    if (fight.result === 'Win' || fight.Result === 'Win') {
      fightQuality += 20;
    } else if (fight.result === 'Loss' || fight.Result === 'Loss') {
      fightQuality -= 10;
    }

    // Adjust based on method (finishing opponents is higher quality)
    const method = fight.method || fight.Method || '';
    if (method.includes('KO') || method.includes('TKO') || method.includes('Submission')) {
      fightQuality += 15;
    }

    // Adjust based on opponent ranking if available
    if (fight.opponent_ranking || fight.OpponentRanking) {
      const ranking = parseInt(fight.opponent_ranking || fight.OpponentRanking);
      if (ranking <= 5) fightQuality += 30;
      else if (ranking <= 10) fightQuality += 20;
      else if (ranking <= 15) fightQuality += 10;
    }

    totalQuality += fightQuality;
    validFights++;
  });

  return validFights > 0 ? totalQuality / validFights : 0;
}

function calculateLevelDifferential(quality1, quality2) {
  if (typeof quality1 !== 'number' || typeof quality2 !== 'number') return 0;
  
  const differential = quality1 - quality2;
  
  // Normalize to a scale
  if (Math.abs(differential) < 5) return 0; // Negligible difference
  if (Math.abs(differential) < 15) return differential > 0 ? 1 : -1; // Slight advantage
  if (Math.abs(differential) < 25) return differential > 0 ? 2 : -2; // Moderate advantage
  return differential > 0 ? 3 : -3; // Significant advantage
}

function determineCompetitionAdvantage(quality1, quality2, commonOpponentCount) {
  const qualityDiff = quality1 - quality2;
  
  if (commonOpponentCount >= 2) {
    // Strong comparison possible with common opponents
    if (Math.abs(qualityDiff) < 5) return "Even with strong comparison data";
    return qualityDiff > 0 ? "Fighter 1 advantage (verified)" : "Fighter 2 advantage (verified)";
  } else if (commonOpponentCount === 1) {
    // Limited comparison data
    if (Math.abs(qualityDiff) < 10) return "Even with limited comparison data";
    return qualityDiff > 0 ? "Fighter 1 slight advantage" : "Fighter 2 slight advantage";
  } else {
    // No common opponents
    if (Math.abs(qualityDiff) < 15) return "Even competition level";
    return qualityDiff > 0 ? "Fighter 1 higher competition level" : "Fighter 2 higher competition level";
  }
}

function determineFinishingPreference(stats) {
  const total = (stats.ko_wins || 0) + (stats.sub_wins || 0) + (stats.dec_wins || 0);
  if (total === 0) return "Unknown";

  const koRate = (stats.ko_wins || 0) / total;
  const subRate = (stats.sub_wins || 0) / total;
  const decRate = (stats.dec_wins || 0) / total;

  if (koRate > 0.5) return "Knockout";
  if (subRate > 0.5) return "Submission";
  if (decRate > 0.5) return "Decision";
  return "Mixed";
}

function determinePositionPreference(stats) {
  if (!stats.striking_preference && !stats.grappling_preference) return "Unknown";
  return stats.striking_preference > stats.grappling_preference ? "Striker" : "Grappler";
}

function calculateStyleClashRating(fighter1Stats, fighter2Stats) {
  if (!fighter1Stats || !fighter2Stats) return 0;

  const strikeClash = Math.abs(
    (fighter1Stats.striking_preference || 0) - (fighter2Stats.striking_preference || 0)
  );
  const grappleClash = Math.abs(
    (fighter1Stats.grappling_preference || 0) - (fighter2Stats.grappling_preference || 0)
  );

  return (strikeClash + grappleClash) / 2;
}

function generateAnalysisPrompt(eventInfo, enrichedFights) {
  return `You are an elite UFC fight analyst with deep expertise in MMA statistics and technical analysis. Analyze the following fight data and provide detailed, fight-specific predictions. Avoid templated responses and generic analysis.

Event Details:
${JSON.stringify(eventInfo, null, 2)}

Fight Analysis Data:
${JSON.stringify(enrichedFights, null, 2)}

For each fight, analyze:
[Previous analysis guidelines remain the same...]

Provide predictions with a particular focus on betting opportunities in this exact JSON format:

{
  "fights": [
      {
          "fighter1": "Name",
          "fighter2": "Name",
          "predictedWinner": "Name",
          "confidence": <55-85>,
          "method": "KO/TKO/Submission/Decision",
          "round": <1-5>,
          "reasoning": "Specific, detailed analysis for this matchup",
          "probabilityBreakdown": {
              "ko_tko": <percentage>,
              "submission": <percentage>,
              "decision": <percentage>
          }
      }
  ],
  "betting_analysis": {
      "upsets": {
          "opportunities": [
              {
                  "fighter": "<Underdog Name>",
                  "confidence": <55-70>,
                  "odds": "<american odds>",
                  "reasoning": "Detailed statistical/stylistic advantages that create upset potential",
                  "optimal_bet": "Specific bet recommendation (straight/prop/method)",
                  "vulnerability_analysis": "Key weaknesses in favorite's game that underdog can exploit"
              }
          ]
      },
      "parlays": {
          "combinations": [
              {
                  "type": "High Confidence Parlay",
                  "picks": [
                      {
                          "fighter": "<Name>",
                          "method": "<Method>",
                          "confidence": <65-85>
                      },
                      {
                          "fighter": "<Different Fight Winner>",
                          "method": "<Method>",
                          "confidence": <65-85>
                      }
                  ],
                  "cumulative_confidence": <percentage>,
                  "reasoning": "Style matchup and statistical evidence for each pick",
                  "risk_assessment": "Analysis of key risks to parlay"
              }
          ],
          "value_combinations": [
              {
                  "picks": [
                      {
                          "fighter": "<Favorite>",
                          "confidence": <70-85>
                      },
                      {
                          "fighter": "<Value Underdog>",
                          "confidence": <55-65>
                      }
                  ],
                  "reasoning": "Mathematical edge and style analysis",
                  "implied_probability": <percentage>,
                  "estimated_true_probability": <percentage>
              }
          ]
      },
      "method_props": {
          "high_confidence_finishes": [
              {
                  "fighter": "<Name>",
                  "method": "<Specific Finish Type>",
                  "round_range": "<1-2 or 1-3 etc>",
                  "confidence": <60-85>,
                  "historical_evidence": "Past finishes & opponent vulnerability data",
                  "style_analysis": "Technical breakdown of finishing sequence"
              }
          ]
      },
      "round_props": {
          "predictions": [
              {
                  "fight": "<Fighter1 vs Fighter2>",
                  "prediction": "Over/Under X.5 rounds",
                  "confidence": <60-85>,
                  "reasoning": "Detailed pace and durability analysis",
                  "historical_data": "Relevant fight time statistics",
                  "key_factors": [
                      "Factor 1 with statistical support",
                      "Factor 2 with statistical support"
                  ]
              }
          ]
      }
  }
}

Key Requirements for Betting Analysis:
1. NEVER include both fighters from the same match in any parlay or combination
2. Focus on identifying true value based on confidence vs. implied probability from odds
3. Validate all finishes against historical fighter data
4. Consider fighter durability and cardio when projecting round props
5. Include specific technical analysis to support each betting recommendation
6. Diversify fighter selection across different recommendations
7. Include statistical evidence for all confidence ratings
8. Account for style matchups and historical performance against similar opponents
9. Always mention in the prediction if the lack of data or uncertainty affects the analysis. Dont mention it all if it doesn't.

Remember to maintain maximum confidence of 95% due to MMA's inherent unpredictability. Focus on fight-specific dynamics rather than general observations.`;
}

function validateBatchPredictions(predictions) {
  // Check basic structure
  if (!predictions || !predictions.fights || !Array.isArray(predictions.fights)) {
      console.error("Missing or invalid fights array");
      return false;
  }

  // Validate each fight prediction
  return predictions.fights.every(fight => {
      const isValid = (
          fight.fighter1 && 
          fight.fighter2 && 
          fight.predictedWinner &&
          typeof fight.confidence === 'number' &&
          fight.confidence >= 55 && 
          fight.confidence <= 85 &&
          fight.method &&
          fight.probabilityBreakdown &&
          typeof fight.probabilityBreakdown.ko_tko === 'number' &&
          typeof fight.probabilityBreakdown.submission === 'number' &&
          typeof fight.probabilityBreakdown.decision === 'number'
      );

      if (!isValid) {
          console.error("Invalid fight prediction:", fight);
      }

      return isValid;
  });
}


async function generatePredictionsWithGPT(prompt) {
  try {
      // Extract fights data from prompt
      const formattedData = prompt.match(/Fight Analysis Data:\s*([\s\S]*?)(?=For each fight)/);
      if (!formattedData) {
          console.error("No fights data found in prompt");
          throw new Error("Invalid prompt format: missing fights data");
      }

      const data = JSON.parse(formattedData[1].trim());
      const enrichedFights = data.enrichedFights || [];
      
      // Split fights into smaller batches - process one fight at a time
      const maxFightsPerRequest = 1;
      const allPredictions = {
          fights: [],
          betting_analysis: {}
      };
      
      // Process fights in batches
      for (let i = 0; i < enrichedFights.length; i += maxFightsPerRequest) {
          const fightsBatch = enrichedFights.slice(i, i + maxFightsPerRequest);
          
          // Create a simplified data structure with only essential information
          const simplifiedFight = fightsBatch.map(fight => ({
              fighter1: fight.fighter1,
              fighter2: fight.fighter2,
              WeightClass: fight.WeightClass,
              is_main_card: fight.is_main_card,
              fighter1Stats: {
                  basics: {
                      Name: fight.fighter1Stats?.basics?.Name,
                      SLPM: fight.fighter1Stats?.basics?.SLPM,
                      StrAcc: fight.fighter1Stats?.basics?.StrAcc,
                      SApM: fight.fighter1Stats?.basics?.SApM,
                      StrDef: fight.fighter1Stats?.basics?.StrDef,
                      TDAvg: fight.fighter1Stats?.basics?.TDAvg,
                      TDAcc: fight.fighter1Stats?.basics?.TDAcc,
                      TDDef: fight.fighter1Stats?.basics?.TDDef,
                      SubAvg: fight.fighter1Stats?.basics?.SubAvg
                  },
                  effectiveness: fight.fighter1Stats?.effectiveness
              },
              fighter2Stats: {
                  basics: {
                      Name: fight.fighter2Stats?.basics?.Name,
                      SLPM: fight.fighter2Stats?.basics?.SLPM,
                      StrAcc: fight.fighter2Stats?.basics?.StrAcc,
                      SApM: fight.fighter2Stats?.basics?.SApM,
                      StrDef: fight.fighter2Stats?.basics?.StrDef,
                      TDAvg: fight.fighter2Stats?.basics?.TDAvg,
                      TDAcc: fight.fighter2Stats?.basics?.TDAcc,
                      TDDef: fight.fighter2Stats?.basics?.TDDef,
                      SubAvg: fight.fighter2Stats?.basics?.SubAvg
                  },
                  effectiveness: fight.fighter2Stats?.effectiveness
              },
              matchupAnalysis: {
                  stylistic: fight.matchupAnalysis?.stylistic,
                  physical: fight.matchupAnalysis?.physical,
                  commonOpponents: fight.matchupAnalysis?.commonOpponents ? {
                      commonOpponentCount: fight.matchupAnalysis.commonOpponents.commonOpponentCount,
                      performanceInsights: fight.matchupAnalysis.commonOpponents.performanceInsights
                  } : null
              }
          }));
          
          // Create a simplified prompt for this batch
          const simplifiedPrompt = `
You are an elite UFC fight analyst. Analyze this fight and provide a prediction in JSON format.

Event: ${data.event.Event}
Fight: ${fightsBatch[0].fighter1} vs ${fightsBatch[0].fighter2}
Weight Class: ${fightsBatch[0].WeightClass}

Fight Data:
${JSON.stringify({ event: data.event, fights: simplifiedFight }, null, 2)}

Provide a prediction in this exact JSON format:
{
  "fights": [
    {
      "fighter1": "${fightsBatch[0].fighter1}",
      "fighter2": "${fightsBatch[0].fighter2}",
      "predictedWinner": "Name",
      "confidence": <55-85>,
      "method": "KO/TKO/Submission/Decision",
      "reasoning": "Brief analysis",
      "keyFactors": ["Factor 1", "Factor 2", "Factor 3"],
      "probabilityBreakdown": {
        "ko_tko": <percentage>,
        "submission": <percentage>,
        "decision": <percentage>
      }
    }
  ]
}

Respond with only the JSON object, no markdown formatting.`;

          console.log(`Processing batch ${Math.floor(i / maxFightsPerRequest) + 1} of ${Math.ceil(enrichedFights.length / maxFightsPerRequest)}`);

          try {
              let gptResponse;
              let retryCount = 0;
              const maxRetries = 3;
              
              while (retryCount < maxRetries) {
                  try {
                      gptResponse = await openai.chat.completions.create({
                          model: "gpt-4.1",  // Using gpt-4.1 as requested
                          messages: [
                              {
                                  role: "system",
                                  content: "You are an elite UFC fight analyst focused on statistical analysis and technical matchups. Provide pure JSON responses with detailed, evidence-based predictions."
                              },
                              {
                                  role: "user",
                                  content: simplifiedPrompt
                              }
                          ],
                          max_tokens: 1000,
                          temperature: 0.7
                      });
                      
                      if (gptResponse?.choices?.[0]?.message?.content) {
                          break; // Success, exit retry loop
                      }
                      
                      console.log(`GPT returned empty response, retry ${retryCount + 1}/${maxRetries}`);
                      retryCount++;
                      
                      if (retryCount < maxRetries) {
                          await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds before retry
                      }
                  } catch (apiError) {
                      console.error(`GPT API error (attempt ${retryCount + 1}):`, apiError.message);
                      retryCount++;
                      
                      if (retryCount >= maxRetries) {
                          throw apiError;
                      }
                      
                      await new Promise(resolve => setTimeout(resolve, 2000));
                  }
              }

              if (!gptResponse?.choices?.[0]?.message?.content) {
                  console.error("Empty response from GPT after all retries");
                  // Skip this batch and continue with others
                  continue;
              }

              const content = gptResponse.choices[0].message.content;
              console.log(`GPT Raw Response for batch ${Math.floor(i / maxFightsPerRequest) + 1} (first 200 chars):`, content.substring(0, 200) + "...");

              // Clean and parse the JSON response
              let batchPredictions;
              let parseSuccess = false;
              
              // Try multiple parsing strategies
              const parsingStrategies = [
                  // Strategy 1: Direct parse after cleaning
                  () => {
                      const cleaned = cleanJsonString(content);
                      return JSON.parse(cleaned);
                  },
                  // Strategy 2: Extract JSON with regex and parse
                  () => {
                      const jsonMatch = content.match(/\{(?:[^{}]|(?:\{[^{}]*\}))*\}/);
                      if (!jsonMatch) throw new Error("No JSON found");
                      return JSON.parse(cleanJsonString(jsonMatch[0]));
                  },
                  // Strategy 3: Find JSON between first { and last }
                  () => {
                      const firstBrace = content.indexOf('{');
                      const lastBrace = content.lastIndexOf('}');
                      if (firstBrace === -1 || lastBrace === -1) throw new Error("No JSON brackets found");
                      const extracted = content.substring(firstBrace, lastBrace + 1);
                      return JSON.parse(cleanJsonString(extracted));
                  },
                  // Strategy 4: Remove everything before first { and after last }
                  () => {
                      let trimmed = content.trim();
                      // Remove any text before the JSON
                      const jsonStart = trimmed.search(/\{/);
                      if (jsonStart > 0) {
                          trimmed = trimmed.substring(jsonStart);
                      }
                      // Remove any text after the JSON
                      const jsonEnd = trimmed.lastIndexOf('}');
                      if (jsonEnd > 0 && jsonEnd < trimmed.length - 1) {
                          trimmed = trimmed.substring(0, jsonEnd + 1);
                      }
                      return JSON.parse(cleanJsonString(trimmed));
                  }
              ];
              
              // Try each parsing strategy
              for (let strategyIndex = 0; strategyIndex < parsingStrategies.length; strategyIndex++) {
                  try {
                      console.log(`Trying parsing strategy ${strategyIndex + 1}...`);
                      batchPredictions = parsingStrategies[strategyIndex]();
                      parseSuccess = true;
                      console.log(`Successfully parsed with strategy ${strategyIndex + 1}`);
                      break;
                  } catch (strategyError) {
                      console.log(`Strategy ${strategyIndex + 1} failed:`, strategyError.message);
                      if (strategyIndex === parsingStrategies.length - 1) {
                          // All strategies failed
                          console.error("All parsing strategies failed");
                          console.error("Raw content:", content);
                          throw new Error("Invalid JSON response from GPT - all parsing strategies failed");
                      }
                  }
              }
              
              if (!parseSuccess) {
                  throw new Error("Failed to parse GPT response");
              }

              // Validate batch predictions
              if (!validateBatchPredictions(batchPredictions)) {
                  console.error("Invalid batch predictions format:", batchPredictions);
                  throw new Error("Invalid prediction format");
              }

              // Merge valid predictions
              allPredictions.fights.push(...batchPredictions.fights);
              
              // Keep betting analysis from final batch
              if (i + maxFightsPerRequest >= enrichedFights.length) {
                  allPredictions.betting_analysis = batchPredictions.betting_analysis || {};
              }

          } catch (batchError) {
              console.error(`Error processing batch ${Math.floor(i / maxFightsPerRequest) + 1}:`, batchError);
              // Continue with next batch instead of failing completely
          }

          // Add delay between batches
          if (i + maxFightsPerRequest < enrichedFights.length) {
              await new Promise(resolve => setTimeout(resolve, 2000));
          }
      }

      // Final validation of complete predictions
      if (!allPredictions.fights || allPredictions.fights.length === 0) {
          console.error("No valid predictions generated after processing all batches");
          throw new Error("No valid predictions generated");
      }

      console.log(`Generated predictions for ${allPredictions.fights.length} fights`);
      return allPredictions;

  } catch (error) {
      console.error("Error with GPT prediction:", error);
      if (error.message.includes("token limit") || error.message.includes("rate limit")) {
          console.log("Token/rate limit hit, generating simplified prediction...");
          return generateSimplifiedPrediction();
      }
      throw error;
  }
}

async function generatePredictionsWithClaude(prompt) {
  try {
      let ClaudeResponse;
      let retryCount = 0;
      const maxRetries = 3;
      
      while (retryCount < maxRetries) {
          try {
              ClaudeResponse = await anthropic.messages.create({
                  model: "claude-opus-4-20250514", // Updated model identifier
                  max_tokens: 4000,
                  temperature: 0.7,
                  top_p: 0.9,
                  messages: [
                      {
                          role: "user",
                          content: [
                              {
                                  type: "text",
                                  text: prompt + "\n\nProvide only valid JSON output with no additional text."
                              }
                          ]
                      }
                  ]
              });
              
              // If we get a response, break out of retry loop
              if (ClaudeResponse?.content) {
                  break;
              }
              
              console.log(`Claude returned empty response, retry ${retryCount + 1}/${maxRetries}`);
              retryCount++;
              
              if (retryCount < maxRetries) {
                  await new Promise(resolve => setTimeout(resolve, 3000)); // Wait 3 seconds before retry
              }
          } catch (apiError) {
              console.error(`Claude API error (attempt ${retryCount + 1}):`, apiError.message);
              
              // Check if it's a server error (5xx) or overloaded error
              if (apiError.status >= 500 || apiError.message.includes('Overloaded')) {
                  retryCount++;
                  
                  if (retryCount >= maxRetries) {
                      console.log("Claude API overloaded after all retries, generating simplified prediction...");
                      return generateSimplifiedPrediction();
                  }
                  
                  // Wait longer for server errors
                  const waitTime = retryCount * 3000; // Exponential backoff: 3s, 6s, 9s
                  console.log(`Waiting ${waitTime/1000} seconds before retry...`);
                  await new Promise(resolve => setTimeout(resolve, waitTime));
              } else {
                  // For non-server errors, throw immediately
                  throw apiError;
              }
          }
      }

      if (!ClaudeResponse?.content || !Array.isArray(ClaudeResponse.content) || ClaudeResponse.content.length === 0) {
          console.error("Invalid response structure from Claude after all retries");
          return generateSimplifiedPrediction();
      }

      const textContent = ClaudeResponse.content.find(item => item.type === "text");
      if (!textContent || !textContent.text) {
          console.error("No text content found in Claude response");
          return generateSimplifiedPrediction();
      }

      // Extract JSON from response
      const jsonMatch = textContent.text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
          console.error("No JSON found in Claude response");
          return generateSimplifiedPrediction();
      }

      // Clean and parse the JSON
      const cleanJson = cleanJsonString(jsonMatch[0]);
      console.log("Attempting to parse cleaned JSON (first 200 chars):", cleanJson.substring(0, 200) + "...");

      try {
          const parsedJson = JSON.parse(cleanJson);

          // Validate required structure
          if (!parsedJson.fights || !Array.isArray(parsedJson.fights)) {
              console.error("Invalid prediction format - missing fights array");
              return generateSimplifiedPrediction();
          }

          // Validate each fight has required fields
          for (const fight of parsedJson.fights) {
              if (!fight.fighter1 || !fight.fighter2 || !fight.predictedWinner) {
                  console.error("Invalid fight format - missing required fields");
                  return generateSimplifiedPrediction();
              }
          }

          return parsedJson;
      } catch (parseError) {
          console.error("JSON Parse Error:", parseError.message);
          return generateSimplifiedPrediction();
      }

  } catch (error) {
      console.error("Error with Claude prediction:", error.message);

      // Handle rate limits or token limits with fallback
      if (error.message.includes("token limit") || 
          error.message.includes("rate limit") || 
          error.status === 429) {
          console.log("Rate/token limit hit, generating simplified prediction...");
          return generateSimplifiedPrediction();
      }

      // If it's a parsing error, try to recover with simplified prediction
      if (error.message.includes("JSON")) {
          console.log("JSON parsing error, generating simplified prediction...");
          return generateSimplifiedPrediction();
      }

      throw error;
  }
}

function generateSimplifiedPrediction() {
  return {
      fights: [],
      betting_analysis: {
          upsets: "Unable to generate detailed analysis at this time.",
          parlays: "Unable to generate parlay suggestions at this time.",
          props: "Unable to generate prop bet suggestions at this time."
      }
  };
}

function cleanJsonString(text) {
  // First remove markdown code blocks
  let cleaned = text
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/[\u2018\u2019]/g, "'")
      .trim();

  // Try to extract JSON using a more robust approach
  // Look for the outermost JSON object
  let jsonStart = -1;
  let jsonEnd = -1;
  let braceCount = 0;
  let inString = false;
  let escapeNext = false;

  for (let i = 0; i < cleaned.length; i++) {
      const char = cleaned[i];
      
      if (escapeNext) {
          escapeNext = false;
          continue;
      }
      
      if (char === '\\') {
          escapeNext = true;
          continue;
      }
      
      if (char === '"' && !escapeNext) {
          inString = !inString;
          continue;
      }
      
      if (!inString) {
          if (char === '{') {
              if (jsonStart === -1) jsonStart = i;
              braceCount++;
          } else if (char === '}') {
              braceCount--;
              if (braceCount === 0 && jsonStart !== -1) {
                  jsonEnd = i + 1;
                  break;
              }
          }
      }
  }

  if (jsonStart !== -1 && jsonEnd !== -1) {
      cleaned = cleaned.substring(jsonStart, jsonEnd);
  } else {
      // Fallback to simple extraction
      const firstBrace = cleaned.indexOf('{');
      const lastBrace = cleaned.lastIndexOf('}');
      if (firstBrace >= 0 && lastBrace > firstBrace) {
          cleaned = cleaned.substring(firstBrace, lastBrace + 1);
      }
  }

  // Clean up common issues
  // Remove control characters
  cleaned = cleaned.replace(/[\x00-\x1F\x7F]/g, '');
  
  // Fix trailing commas
  cleaned = cleaned.replace(/,(\s*[}\]])/g, '$1');
  
  // Fix missing quotes around property names (carefully)
  // Only if we detect clear unquoted properties
  if (/[{,]\s*[a-zA-Z_][a-zA-Z0-9_]*\s*:/.test(cleaned)) {
      cleaned = cleaned.replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":');
  }
  
  return cleaned;
}

async function comparePhysicalAttributes(fighter1Basics, fighter2Basics) {
  if (!fighter1Basics || !fighter2Basics) return null;

  const heightDiff = parseFloat(fighter1Basics.Height || 0) - parseFloat(fighter2Basics.Height || 0);
  const reachDiff = parseFloat(fighter1Basics.Reach || 0) - parseFloat(fighter2Basics.Reach || 0);
  
  return {
    height_differential: heightDiff,
    reach_differential: reachDiff,
    stance_matchup: compareFighterStances(fighter1Basics.Stance, fighter2Basics.Stance),
    physical_advantage: determinePhysicalAdvantage(heightDiff, reachDiff)
  };
}

function compareFighterStances(stance1, stance2) {
  if (!stance1 || !stance2) return "Unknown";
  if (stance1 === stance2) return "Mirror";
  return `${stance1} vs ${stance2}`;
}

function determinePhysicalAdvantage(heightDiff, reachDiff) {
  if (Math.abs(heightDiff) < 1 && Math.abs(reachDiff) < 1) return "Neutral";
  if (heightDiff > 0 && reachDiff > 0) return "Fighter 1";
  if (heightDiff < 0 && reachDiff < 0) return "Fighter 2";
  return "Mixed";
}

function invertAdvantage(advantage) {
  if (!advantage) return null;
  const advantageMap = {
    "Significant Advantage": "Significant Disadvantage",
    "Slight Advantage": "Slight Disadvantage",
    "Even": "Even",
    "Slight Disadvantage": "Slight Advantage",
    "Significant Disadvantage": "Significant Advantage"
  };
  return advantageMap[advantage] || advantage;
}

async function validateBettingAnalysis(analysis, fights) {
  const usedFighters = new Set();
  const fightMatchups = new Map();
  
  // Create map of fighter matchups
  fights.forEach(fight => {
      fightMatchups.set(fight.fighter1, fight.fighter2);
      fightMatchups.set(fight.fighter2, fight.fighter1);
  });

  // Validate parlays
  const validateParlay = (parlay) => {
      const parleyFighters = new Set();
      let isValid = true;
      
      parlay.picks.forEach(pick => {
          // Check if fighter is already used
          if (parleyFighters.has(pick.fighter)) {
              isValid = false;
              return;
          }
          
          // Check if opponent is in parlay
          const opponent = fightMatchups.get(pick.fighter);
          if (parleyFighters.has(opponent)) {
              isValid = false;
              return;
          }
          
          parleyFighters.add(pick.fighter);
      });
      
      return isValid;
  };

  // Clean up parlays
  if (analysis.betting_analysis.parlays?.combinations) {
      analysis.betting_analysis.parlays.combinations = 
          analysis.betting_analysis.parlays.combinations.filter(validateParlay);
  }
  
  if (analysis.betting_analysis.parlays?.value_combinations) {
      analysis.betting_analysis.parlays.value_combinations = 
          analysis.betting_analysis.parlays.value_combinations.filter(validateParlay);
  }

  // Validate and clean method props
  if (analysis.betting_analysis.method_props?.high_confidence_finishes) {
      const validMethodProps = [];
      for (const prop of analysis.betting_analysis.method_props.high_confidence_finishes) {
          if (!usedFighters.has(prop.fighter)) {
              validMethodProps.push(prop);
              usedFighters.add(prop.fighter);
          }
      }
      analysis.betting_analysis.method_props.high_confidence_finishes = validMethodProps;
  }

  // Ensure diverse fighter selection
  const maxRecommendationsPerFighter = 2;
  const fighterCounts = new Map();
  
  const updateFighterCount = (fighter) => {
      const count = fighterCounts.get(fighter) || 0;
      fighterCounts.set(fighter, count + 1);
      return count < maxRecommendationsPerFighter;
  };

  // Clean up upsets
  if (analysis.betting_analysis.upsets?.opportunities) {
      analysis.betting_analysis.upsets.opportunities = 
          analysis.betting_analysis.upsets.opportunities
              .filter(upset => updateFighterCount(upset.fighter));
  }

  return analysis;
}

async function calculateFightSpecificMetrics(fighter1, fighter2) {
  try {
    const [f1Stats, f2Stats] = await Promise.all([
      database.query("SELECT * FROM fighters WHERE Name = ?", [fighter1]),
      database.query("SELECT * FROM fighters WHERE Name = ?", [fighter2])
    ]);

    return {
      paceMetrics: {
        expectedPace: calculateExpectedPace(f1Stats[0], f2Stats[0]),
        strikingVolume: compareStrikingVolume(f1Stats[0], f2Stats[0]),
        grappleFrequency: compareGrapplingFrequency(f1Stats[0], f2Stats[0])
      },
      matchupMetrics: {
        styleDominance: determineStyleDominance(f1Stats[0], f2Stats[0]),
        rangeControl: assessRangeControl(f1Stats[0], f2Stats[0]),
        defenseVulnerabilities: findDefenseVulnerabilities(f1Stats[0], f2Stats[0])
      }
    };
  } catch (error) {
    console.error(`Error calculating fight metrics for ${fighter1} vs ${fighter2}:`, error);
    return null;
  }
}
// Helper functions for calculateFightSpecificMetrics
function calculateExpectedPace(fighter1Stats, fighter2Stats) {
  const f1Pace = parseFloat(fighter1Stats?.SLPM || 0);
  const f2Pace = parseFloat(fighter2Stats?.SLPM || 0);
  return {
    combined: f1Pace + f2Pace,
    differential: Math.abs(f1Pace - f2Pace),
    expectedIntensity: (f1Pace + f2Pace) > 8 ? "High" : (f1Pace + f2Pace) > 5 ? "Medium" : "Low"
  };
}
// Helper functions for calculateFightSpecificMetrics
function calculateExpectedPace(fighter1Stats, fighter2Stats) {
  const f1Pace = parseFloat(fighter1Stats?.SLPM || 0);
  const f2Pace = parseFloat(fighter2Stats?.SLPM || 0);
  return {
    combined: f1Pace + f2Pace,
    differential: Math.abs(f1Pace - f2Pace),
    expectedIntensity: (f1Pace + f2Pace) > 8 ? "High" : (f1Pace + f2Pace) > 5 ? "Medium" : "Low"
  };
}

function compareStrikingVolume(fighter1Stats, fighter2Stats) {
  const f1Volume = parseFloat(fighter1Stats?.SLPM || 0);
  const f2Volume = parseFloat(fighter2Stats?.SLPM || 0);
  return {
    differential: f1Volume - f2Volume,
    advantage: f1Volume > f2Volume ? "Fighter 1" : f1Volume < f2Volume ? "Fighter 2" : "Even"
  };
}

function compareGrapplingFrequency(fighter1Stats, fighter2Stats) {
  const f1Freq = parseFloat(fighter1Stats?.TDAvg || 0);
  const f2Freq = parseFloat(fighter2Stats?.TDAvg || 0);
  return {
    differential: f1Freq - f2Freq,
    advantage: f1Freq > f2Freq ? "Fighter 1" : f1Freq < f2Freq ? "Fighter 2" : "Even"
  };
}

function determineStyleDominance(fighter1Stats, fighter2Stats) {
  const f1StrikeAcc = parseFloat(fighter1Stats?.StrAcc?.replace("%", "") || 0);
  const f2StrikeAcc = parseFloat(fighter2Stats?.StrAcc?.replace("%", "") || 0);
  const f1TDAcc = parseFloat(fighter1Stats?.TDAcc?.replace("%", "") || 0);
  const f2TDAcc = parseFloat(fighter2Stats?.TDAcc?.replace("%", "") || 0);
  
  return {
    striking: f1StrikeAcc - f2StrikeAcc,
    grappling: f1TDAcc - f2TDAcc,
    dominantArea: Math.abs(f1StrikeAcc - f2StrikeAcc) > Math.abs(f1TDAcc - f2TDAcc) ? "Striking" : "Grappling"
  };
}

function assessRangeControl(fighter1Stats, fighter2Stats) {
  const f1Reach = parseFloat(fighter1Stats?.Reach?.replace('"', "") || 0);
  const f2Reach = parseFloat(fighter2Stats?.Reach?.replace('"', "") || 0);
  const reachDiff = f1Reach - f2Reach;
  
  return {
    reachAdvantage: reachDiff > 0 ? "Fighter 1" : reachDiff < 0 ? "Fighter 2" : "Even",
    differential: Math.abs(reachDiff),
    significance: Math.abs(reachDiff) > 3 ? "Significant" : "Minimal"
  };
}

function findDefenseVulnerabilities(fighter1Stats, fighter2Stats) {
  const f1StrDef = parseFloat(fighter1Stats?.StrDef?.replace("%", "") || 0);
  const f2StrDef = parseFloat(fighter2Stats?.StrDef?.replace("%", "") || 0);
  const f1TDDef = parseFloat(fighter1Stats?.TDDef?.replace("%", "") || 0);
  const f2TDDef = parseFloat(fighter2Stats?.TDDef?.replace("%", "") || 0);
  
  return {
    fighter1: {
      strikingDefense: f1StrDef < 50 ? "Poor" : f1StrDef < 65 ? "Average" : "Good",
      grapplingDefense: f1TDDef < 50 ? "Poor" : f1TDDef < 65 ? "Average" : "Good"
    },
    fighter2: {
      strikingDefense: f2StrDef < 50 ? "Poor" : f2StrDef < 65 ? "Average" : "Good",
      grapplingDefense: f2TDDef < 50 ? "Poor" : f2TDDef < 65 ? "Average" : "Good"
    }
  };
}

module.exports = { 
  generateEnhancedPredictionsWithAI,
  generatePredictionsWithGPT,
  generatePredictionsWithClaude,
  comparePhysicalAttributes,
  validateBatchPredictions,
  cleanJsonString,
  compareCompetitionLevel,
  calculateOpponentQuality,
  calculateLevelDifferential,
  determineCompetitionAdvantage
};
