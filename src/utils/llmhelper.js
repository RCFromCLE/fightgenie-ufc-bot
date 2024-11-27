require("dotenv").config({
  path: require("path").resolve(__dirname, "../../.env"),
});
const Anthropic = require("@anthropic-ai/sdk");
const OpenAI = require("openai");
const database = require("../database");
const PredictionModel = require("../models/prediction");

// Initialize clients with API keys
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || "",
  dangerouslyAllowBrowser: true,
});

async function generateEnhancedPredictionsWithAI(fightData, eventInfo, model = "claude") {
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

4. Fight-Specific Factors:
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

  const f1Opponents = fighter1Fights.map(f => f.opponent_name);
  const f2Opponents = fighter2Fights.map(f => f.opponent_name);

  return {
    fighter1TopOpponents: f1Opponents.length,
    fighter2TopOpponents: f2Opponents.length,
    levelDifferential: calculateLevelDifferential(fighter1Fights, fighter2Fights)
  };
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

async function generatePredictionsWithGPT(prompt) {
  try {
      // Extract fights data from prompt
      const formattedData = prompt.match(/Fight Analysis Data:\s*([\s\S]*?)(?=For each fight)/);
      if (!formattedData) {
          throw new Error("No fights data found in prompt");
      }

      const data = JSON.parse(formattedData[1].trim());
      const enrichedFights = data.enrichedFights || [];
      
      // Split fights into smaller batches
      const maxFightsPerRequest = 3;
      const allPredictions = {
          fights: [],
          betting_analysis: {}
      };
      
      // Process fights in batches
      for (let i = 0; i < enrichedFights.length; i += maxFightsPerRequest) {
          const fightsBatch = enrichedFights.slice(i, i + maxFightsPerRequest);
          
          // Create a modified prompt for this batch
          const batchData = {
              ...data,
              enrichedFights: fightsBatch
          };
          
          const batchPrompt = prompt.replace(
              /Fight Analysis Data:[\s\S]*?(?=For each fight)/,
              `Fight Analysis Data:\n${JSON.stringify(batchData, null, 2)}\n\n`
          );

          console.log(`Processing batch ${i / maxFightsPerRequest + 1} of ${Math.ceil(enrichedFights.length / maxFightsPerRequest)}`);

          const gptResponse = await openai.chat.completions.create({
              model: "gpt-4-turbo-preview",
              messages: [
                  {
                      role: "system",
                      content: "You are an elite UFC fight analyst focused on statistical analysis and technical matchups. Provide pure JSON responses with detailed, evidence-based predictions."
                  },
                  {
                      role: "user",
                      content: batchPrompt + "\n\nRespond with only the JSON object, no markdown formatting."
                  }
              ],
              temperature: 0.7,
              max_tokens: 4096,
              top_p: 0.9,
              frequency_penalty: 0.1,
              presence_penalty: 0.1
          });

          if (!gptResponse.choices[0]?.message?.content) {
              throw new Error("No prediction content received from GPT");
          }

          const content = gptResponse.choices[0].message.content;
          console.log(`GPT Raw Response for batch ${i / maxFightsPerRequest + 1}:`, content);

          // Clean the JSON response
          const cleanedContent = content
              .replace(/```json\n?/g, "")
              .replace(/```\n?/g, "")
              .replace(/[\u201C\u201D]/g, '"')
              .replace(/[\u2018\u2019]/g, "'")
              .replace(/\n+/g, " ")
              .replace(/\s+/g, " ")
              .replace(/,\s*([}\]])/g, "$1")
              .trim();

          try {
              const batchPredictions = JSON.parse(cleanedContent);
              
              // Validate and merge predictions
              if (batchPredictions.fights && Array.isArray(batchPredictions.fights)) {
                  allPredictions.fights.push(...batchPredictions.fights);
                  
                  // Keep betting analysis from final batch
                  if (i + maxFightsPerRequest >= enrichedFights.length) {
                      allPredictions.betting_analysis = batchPredictions.betting_analysis || {};
                  }
              }
          } catch (parseError) {
              console.error("Parse error for batch:", parseError);
              console.error("Cleaned content:", cleanedContent);
              continue;
          }
          
          // Add delay between batches
          await new Promise(resolve => setTimeout(resolve, 1000));
      }

      // Validate final predictions
      if (!allPredictions.fights || allPredictions.fights.length === 0) {
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
      const claudeResponse = await anthropic.messages.create({
          model: "claude-3-opus-20240229",
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

      if (!claudeResponse.content || !Array.isArray(claudeResponse.content) || claudeResponse.content.length === 0) {
          console.error("Invalid response structure from Claude:", claudeResponse);
          throw new Error("Invalid response structure from Claude");
      }

      const textContent = claudeResponse.content.find(item => item.type === "text");
      if (!textContent || !textContent.text) {
          console.error("No text content found in Claude response:", claudeResponse);
          throw new Error("No text content found in Claude response");
      }

      // Extract JSON from response
      const jsonMatch = textContent.text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
          console.error("No JSON found in Claude response:", textContent.text);
          throw new Error("No JSON found in Claude response");
      }

      // Clean and parse the JSON
      const cleanJson = cleanJsonString(jsonMatch[0]);
      console.log("Attempting to parse cleaned JSON:", cleanJson);

      try {
          const parsedJson = JSON.parse(cleanJson);

          // Validate required structure
          if (!parsedJson.fights || !Array.isArray(parsedJson.fights)) {
              console.error("Invalid prediction format - parsed JSON:", parsedJson);
              throw new Error("Invalid prediction format: missing fights array");
          }

          // Validate each fight has required fields
          for (const fight of parsedJson.fights) {
              if (!fight.fighter1 || !fight.fighter2 || !fight.predictedWinner) {
                  console.error("Invalid fight format:", fight);
                  throw new Error("Invalid fight format: missing required fields");
              }
          }

          return parsedJson;
      } catch (parseError) {
          console.error("JSON Parse Error - Content:", cleanJson);
          console.error("Parse error details:", parseError);
          throw new Error("Failed to parse prediction JSON: " + parseError.message);
      }

  } catch (error) {
      console.error("Error with Claude prediction:", error);

      // Handle rate limits or token limits with fallback
      if (error.message.includes("token limit") || 
          error.message.includes("rate limit") || 
          error.status === 429) {
          console.log("Rate/token limit hit, generating simplified prediction...");
          return generateSimplifiedPrediction();
      }

      // Handle potential API errors with fallback
      if (error.status >= 500) {
          console.log("API error, generating simplified prediction...");
          return generateSimplifiedPrediction();
      }

      // If it's a parsing error, try to recover with simplified prediction
      if (error.message.includes("JSON")) {
          console.log("JSON parsing error, generating simplified prediction...");
          return generateSimplifiedPrediction();
      }

      throw new Error("Failed to generate Claude prediction: " + error.message);
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
  return text
      .replace(/[\u201C\u201D]/g, '"') // Replace smart quotes with straight quotes
      .replace(/[\u2018\u2019]/g, "'") // Replace smart single quotes
      .replace(/[\n\r]+/g, " ")        // Replace newlines with spaces
      .replace(/\s+/g, " ")            // Normalize spaces
      .replace(/,\s*([}\]])/g, "$1")   // Remove trailing commas
      .trim();
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
  comparePhysicalAttributes
};