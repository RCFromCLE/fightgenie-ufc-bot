const { generateEnhancedPredictionsWithAI } = require('./llmhelper');
const OddsAnalysis = require('./OddsAnalysis');
const database = require('../database');
const PredictionHandler = require('./PredictionHandler');

class MarketAnalysis {
    static async generateMarketAnalysis(event, model) {
        try {
            // First check if we have a recent analysis stored
            const storedAnalysis = await database.query(`
                SELECT analysis_data 
                FROM market_analysis 
                WHERE event_id = ? 
                AND model_used = ?
                AND created_at > datetime('now', '-1 hour')
                ORDER BY created_at DESC LIMIT 1
            `, [event.event_id, model]);
    
            if (storedAnalysis?.[0]?.analysis_data) {
                console.log('Using cached market analysis');
                return JSON.parse(storedAnalysis[0].analysis_data);
            }
    
            console.log('Generating new market analysis using internal calculations...');
    
            // Get fights data and odds
            const { mainCardData, prelimData } = await this.getAllFights(event.event_id, model);
            const rawOddsData = await OddsAnalysis.fetchUFCOdds(); // Assuming this returns an array of odds objects
            
            // Combine predictions and odds
            const allFights = [
                ...(mainCardData?.fights || []), 
                ...(prelimData?.fights || [])
            ];

            const enrichedFights = allFights.map(fight => {
                const fightOdds = rawOddsData?.find(o => 
                    (o.fighter1.toLowerCase() === fight.fighter1.toLowerCase() && o.fighter2.toLowerCase() === fight.fighter2.toLowerCase()) ||
                    (o.fighter1.toLowerCase() === fight.fighter2.toLowerCase() && o.fighter2.toLowerCase() === fight.fighter1.toLowerCase())
                );

                let odds = null;
                let impliedProbability = null;
                let edge = null;

                if (fightOdds) {
                    const winnerOdds = fight.predictedWinner.toLowerCase() === fightOdds.fighter1.toLowerCase() 
                        ? fightOdds.fighter1_odds 
                        : fightOdds.fighter2_odds;
                    
                    if (winnerOdds) {
                        odds = winnerOdds;
                        impliedProbability = winnerOdds > 0 
                            ? (100 / (winnerOdds + 100)) * 100 
                            : (Math.abs(winnerOdds) / (Math.abs(winnerOdds) + 100)) * 100;
                        edge = fight.confidence - impliedProbability;
                    }
                }

                return {
                    ...fight,
                    odds: odds,
                    impliedProbability: impliedProbability,
                    edge: edge
                };
            });

            // --- Perform Analysis using Helper Functions ---
            const marketMetrics = this.calculateMarketMetrics(enrichedFights);
            const valueOpportunities = this.identifyValueOpportunities(enrichedFights);
            const parlayAnalysis = await this.analyzeParlayOpportunities(enrichedFights, marketMetrics);
            const methodProps = await this.analyzeMethodProps(enrichedFights);
            const riskAssessment = this.generateRiskAssessment(marketMetrics, valueOpportunities);
            const bankrollStrategy = this.calculateBankrollStrategy(valueOpportunities, parlayAnalysis);

            // --- Construct the Detailed Report ---
            const analysisReport = {
                eventDetails: {
                    name: event.Event,
                    date: event.Date, // Assuming event object has Date
                    location: event.Location, // Assuming event object has Location
                    modelUsed: model
                },
                marketOverview: {
                    totalFightsAnalyzed: marketMetrics.totalFights,
                    fightsWithOdds: marketMetrics.fightsWithOdds,
                    averageEdge: this.formatDisplayValue(marketMetrics.averageEdge),
                    marketBalance: this.formatDisplayValue(marketMetrics.marketBalance),
                    marketEfficiency: this.formatDisplayValue(marketMetrics.marketEfficiency),
                    sharpness: marketMetrics.sharpness,
                    valueOpportunitiesCount: marketMetrics.valueOpportunities
                },
                valuePicks: valueOpportunities.map(v => ({
                    ...v,
                    edge: this.formatDisplayValue(v.edge),
                    confidence: this.formatDisplayValue(v.confidence),
                    impliedProbability: this.formatDisplayValue(v.impliedProbability),
                    recommendedBetSize: this.formatDisplayValue(v.recommendedBetSize),
                    valueRatingDisplay: this.getRatingDisplay(v.valueRating)
                })),
                parlayRecommendations: {
                    twoPicks: parlayAnalysis.twoPicks.map(p => ({
                        fighters: p.picks.map(pick => pick.predictedWinner),
                        avgConfidence: this.formatDisplayValue(p.confidence),
                        impliedProbability: this.formatDisplayValue(p.impliedProbability),
                        potentialReturn: p.potentialReturn,
                        edge: this.formatDisplayValue(p.edge),
                        ratingDisplay: this.getRatingDisplay(p.rating)
                    })),
                    threePicks: parlayAnalysis.threePicks.map(p => ({
                        fighters: p.picks.map(pick => pick.predictedWinner),
                        avgConfidence: this.formatDisplayValue(p.confidence),
                        impliedProbability: this.formatDisplayValue(p.impliedProbability),
                        potentialReturn: p.potentialReturn,
                        edge: this.formatDisplayValue(p.edge),
                        ratingDisplay: this.getRatingDisplay(p.rating)
                    })),
                    valueParlays: parlayAnalysis.valueParlays.map(p => ({
                        fighters: p.picks.map(pick => pick.predictedWinner),
                        avgConfidence: this.formatDisplayValue(p.confidence),
                        impliedProbability: this.formatDisplayValue(p.impliedProbability),
                        potentialReturn: p.potentialReturn,
                        edge: this.formatDisplayValue(p.edge),
                        ratingDisplay: this.getRatingDisplay(p.rating)
                    })),
                    overallRiskRating: parlayAnalysis.riskRating // Assuming this is a simple value/string
                },
                methodAndPropBets: {
                    highConfidenceFinishes: methodProps.highConfFinishes.map(f => ({
                        ...f,
                        probability: this.formatDisplayValue(f.probability),
                        confidence: this.formatDisplayValue(f.confidence)
                    })),
                    roundProps: methodProps.roundProps.map(r => ({
                        ...r,
                        confidence: this.formatDisplayValue(r.confidence)
                    }))
                    // specialProps could be added here if implemented
                },
                riskAssessment: {
                    marketRiskLevel: riskAssessment.marketRisk.level,
                    marketRiskFactors: riskAssessment.marketRisk.factors,
                    volatility: riskAssessment.volatilityAssessment.marketEfficiency, // Simplified for now
                    recommendedAdjustments: riskAssessment.volatilityAssessment.recommendedAdjustments,
                    exposureLimits: {
                        maxSingleBet: this.formatDisplayValue(riskAssessment.exposureLimits.maxSingleBet),
                        maxParlay: this.formatDisplayValue(riskAssessment.exposureLimits.maxParlay),
                        totalExposure: this.formatDisplayValue(riskAssessment.exposureLimits.totalExposure)
                    }
                    // individualRisks could be added for more detail
                },
                bankrollStrategy: {
                    straightBetAllocation: this.formatDisplayValue(bankrollStrategy.straightBets.percentage),
                    parlayAllocation: this.formatDisplayValue(bankrollStrategy.parlays.percentage),
                    reserveAllocation: this.formatDisplayValue(bankrollStrategy.reserve),
                    maxStraightBetSize: this.formatDisplayValue(bankrollStrategy.straightBets.maxBetSize),
                    maxParlayBetSize: this.formatDisplayValue(bankrollStrategy.parlays.maxBetSize)
                }
            };
    
            // Store the new structured analysis in the database
            await database.query(`
                INSERT INTO market_analysis (
                    event_id,
                    model_used,
                    analysis_data
                ) VALUES (?, ?, ?)
            `, [
                event.event_id,
                model,
                JSON.stringify(analysisReport) // Store the new object
            ]);
    
            return analysisReport; // Return the new object
    
        } catch (error) {
            console.error('Error generating market analysis:', error);
            throw error;
        }
    }    
    static async getAllFights(eventId, model) {
        try {
            const [mainCard, prelims] = await Promise.all([
                database.query(
                    `SELECT prediction_data 
                    FROM stored_predictions 
                    WHERE event_id = ? AND card_type = ? AND model_used = ? 
                    ORDER BY created_at DESC LIMIT 1`,
                    [eventId, 'main', model]
                ),
                database.query(
                    `SELECT prediction_data 
                    FROM stored_predictions 
                    WHERE event_id = ? AND card_type = ? AND model_used = ? 
                    ORDER BY created_at DESC LIMIT 1`,
                    [eventId, 'prelims', model]
                )
            ]);

            const mainCardData = mainCard?.[0]?.prediction_data ? 
                JSON.parse(mainCard[0].prediction_data) : null;
            const prelimData = prelims?.[0]?.prediction_data ? 
                JSON.parse(prelims[0].prediction_data) : null;

            return {
                mainCardData,
                prelimData
            };
        } catch (error) {
            console.error("Error getting fights:", error);
            return { mainCardData: null, prelimData: null };
        }
    }

    static calculateMarketMetrics(fightOdds) {
        const metrics = {
            totalFights: fightOdds.length,
            fightsWithOdds: fightOdds.filter(f => f.odds).length,
            averageEdge: 0,
            marketBalance: 0,
            valueOpportunities: 0,
            marketEfficiency: 0,
            sharpness: 0
        };

        let totalEdge = 0;
        let totalImpliedProbability = 0;

        fightOdds.forEach(fight => {
            if (fight.edge) {
                totalEdge += fight.edge;
                if (fight.edge > 5) metrics.valueOpportunities++;
            }
            if (fight.impliedProbability) {
                totalImpliedProbability += fight.impliedProbability;
            }
        });

        metrics.averageEdge = metrics.fightsWithOdds ? totalEdge / metrics.fightsWithOdds : 0;
        metrics.marketBalance = Math.abs(100 - (totalImpliedProbability / metrics.fightsWithOdds));
        metrics.marketEfficiency = 100 - (Math.abs(metrics.averageEdge) * 10);
        metrics.sharpness = metrics.marketBalance < 5 ? "High" : metrics.marketBalance < 10 ? "Medium" : "Low";

        return metrics;
    }

    static identifyValueOpportunities(fightOdds) {
        return fightOdds
            .filter(fight => fight.edge && fight.edge > 5)
            .map(fight => ({
                fighter: fight.predictedWinner,
                opponent: fight.predictedWinner === fight.fighter1 ? fight.fighter2 : fight.fighter1,
                odds: fight.odds,
                confidence: fight.confidence,
                edge: fight.edge,
                impliedProbability: fight.impliedProbability,
                method: fight.method,
                methodBreakdown: fight.probabilityBreakdown,
                recommendedBetSize: this.calculateOptimalBetSize(fight.edge, fight.confidence),
                valueRating: this.calculateValueRating(fight.edge, fight.confidence),
                analysis: this.generateValueAnalysis(fight)
            }))
            .sort((a, b) => b.edge - a.edge);
    }

    static calculateOptimalBetSize(edge, confidence) {
        const probability = confidence / 100;
        const kellyFraction = 0.25;
        let betSize = 0;

        if (edge > 0) {
            betSize = (probability - ((1 - probability) / (edge / 100))) * kellyFraction;
        }

        return Math.min(Math.max(betSize * 100, 0), 5).toFixed(1);
    }

    static calculateValueRating(edge, confidence) {
        if (edge >= 20 && confidence >= 75) return 5;
        if (edge >= 15 && confidence >= 75) return 4;
        if (edge >= 10 && confidence >= 65) return 3;
        if (edge >= 5 && confidence >= 60) return 2;
        return 1;
    }

    static generateValueAnalysis(fight) {
        const analysis = [];

        if (fight.edge > 15) {
            analysis.push("Strong Value Play: Significant edge against market odds");
        } else if (fight.edge > 10) {
            analysis.push("Good Value: Clear edge against market odds");
        } else {
            analysis.push("Moderate Value: Small but notable edge");
        }

        const { ko_tko, submission, decision } = fight.probabilityBreakdown;
        const highestProb = Math.max(ko_tko, submission, decision);
        
        if (highestProb > 60) {
            const method = highestProb === ko_tko ? "KO/TKO" : 
                          highestProb === submission ? "Submission" : "Decision";
            analysis.push(`Strong ${method} probability (${highestProb}%)`);
        }

        if (fight.confidence >= 75) {
            analysis.push("High model confidence supports value");
        }

        return analysis.join(". ");
    }
    
    static async analyzeParlayOpportunities(fightOdds, marketMetrics) {
        const highConfidencePicks = fightOdds.filter(f => 
            f.confidence >= 75 && f.edge && f.edge > 5
        ).sort((a, b) => b.confidence - a.confidence);

        const valueUnderdogs = fightOdds.filter(f => 
            f.odds && f.odds > 100 && f.confidence > 60 && f.edge > 7.5
        );

        const parlayAnalysis = {
            twoPicks: await this.generateTwoFightParlays(highConfidencePicks),
            threePicks: await this.generateThreeFightParlays(highConfidencePicks),
            valueParlays: await this.generateValueParlays(highConfidencePicks, valueUnderdogs),
            riskRating: this.calculateParlayRiskRating(marketMetrics)
        };

        return parlayAnalysis;
    }

    static async generateTwoFightParlays(picks) {
        const parlays = [];
        for (let i = 0; i < picks.length - 1; i++) {
            for (let j = i + 1; j < picks.length; j++) {
                const parlay = {
                    picks: [picks[i], picks[j]],
                    confidence: (picks[i].confidence + picks[j].confidence) / 2,
                    impliedProbability: this.calculateParlayImpliedProbability([picks[i], picks[j]]),
                    potentialReturn: this.calculateParlayReturn([picks[i], picks[j]]),
                    edge: null,
                    rating: null
                };

                parlay.edge = parlay.confidence - parlay.impliedProbability;
                parlay.rating = this.calculateParlayRating(parlay.edge, parlay.confidence);

                if (parlay.edge > 0) {
                    parlays.push(parlay);
                }
            }
        }
        return parlays.sort((a, b) => b.edge - a.edge).slice(0, 3);
    }

    static calculateParlayImpliedProbability(picks) {
        return picks.reduce((prob, pick) => prob * (pick.impliedProbability / 100), 1) * 100;
    }

    static calculateParlayReturn(picks) {
        let totalOdds = 1;
        picks.forEach(pick => {
            const odds = pick.odds;
            if (odds > 0) {
                totalOdds *= (1 + odds / 100);
            } else {
                totalOdds *= (1 + 100 / Math.abs(odds));
            }
        });
        return `+${((totalOdds - 1) * 100).toFixed(0)}`;
    }

    static calculateParlayRating(edge, confidence) {
        if (edge >= 15 && confidence >= 75) return 5;
        if (edge >= 10 && confidence >= 65) return 4;
        if (edge >= 7.5 && confidence >= 60) return 3;
        if (edge >= 5 && confidence >= 55) return 2;
        return 1;
    }

    static async generateThreeFightParlays(picks) {
        const parlays = [];
        for (let i = 0; i < picks.length - 2; i++) {
            for (let j = i + 1; j < picks.length - 1; j++) {
                for (let k = j + 1; k < picks.length; k++) {
                    const parlay = {
                        picks: [picks[i], picks[j], picks[k]],
                        confidence: (picks[i].confidence + picks[j].confidence + picks[k].confidence) / 3,
                        impliedProbability: this.calculateParlayImpliedProbability([picks[i], picks[j], picks[k]]),
                        potentialReturn: this.calculateParlayReturn([picks[i], picks[j], picks[k]]),
                        edge: null,
                        rating: null
                    };

                    parlay.edge = parlay.confidence - parlay.impliedProbability;
                    parlay.rating = this.calculateParlayRating(parlay.edge, parlay.confidence);

                    if (parlay.edge > 0) {
                        parlays.push(parlay);
                    }
                }
            }
        }
        return parlays.sort((a, b) => b.edge - a.edge).slice(0, 2);
    }

    static async generateValueParlays(favorites, underdogs) {
        const parlays = [];
        
        for (const favorite of favorites.slice(0, 2)) {
            for (const underdog of underdogs.slice(0, 2)) {
                const parlay = {
                    picks: [favorite, underdog],
                    confidence: (favorite.confidence + underdog.confidence) / 2,
                    impliedProbability: this.calculateParlayImpliedProbability([favorite, underdog]),
                    potentialReturn: this.calculateParlayReturn([favorite, underdog]),
                    isValueParlay: true
                };

                parlay.edge = parlay.confidence - parlay.impliedProbability;
                parlay.rating = this.calculateParlayRating(parlay.edge, parlay.confidence);

                if (parlay.edge > 7.5) {
                    parlays.push(parlay);
                }
            }
        }

        return parlays.sort((a, b) => b.potentialReturn - a.potentialReturn).slice(0, 2);
    }

    static async analyzeMethodProps(fightOdds) {
        const methodProps = {
            highConfFinishes: [],
            roundProps: [],
            specialProps: []
        };

        fightOdds.forEach(fight => {
            const { ko_tko, submission, decision } = fight.probabilityBreakdown;
            
            if (ko_tko > 65 || submission > 60) {
                methodProps.highConfFinishes.push({
                    fighter: fight.predictedWinner,
                    method: ko_tko > submission ? 'KO/TKO' : 'Submission',
                    probability: Math.max(ko_tko, submission),
                    confidence: fight.confidence,
                    analysis: this.generateMethodAnalysis(fight)
                });
            }

            if (fight.probabilityBreakdown.ko_tko > 50 || fight.probabilityBreakdown.submission > 40) {
                methodProps.roundProps.push({
                    fight: `${fight.fighter1} vs ${fight.fighter2}`,
                    prediction: fight.probabilityBreakdown.ko_tko + fight.probabilityBreakdown.submission > 70 ? 
                        "Under 2.5" : "Over 1.5",
                    confidence: Math.min(85, Math.max(60, 
                        fight.probabilityBreakdown.ko_tko + fight.probabilityBreakdown.submission)),
                    analysis: this.generateRoundPropAnalysis(fight)
                });
            }
        });

        return methodProps;
    }

    static generateMethodAnalysis(fight) {
        const breakdowns = [];
        const { ko_tko, submission, decision } = fight.probabilityBreakdown;

        if (ko_tko > submission && ko_tko > decision) {
            breakdowns.push(`Strong KO/TKO potential (${ko_tko}% probability)`);
        } else if (submission > ko_tko && submission > decision) {
            breakdowns.push(`High submission threat (${submission}% probability)`);
        }

        if (fight.confidence > 70) {
            breakdowns.push("High confidence in winner prediction reinforces method likelihood");
        }

        return breakdowns.join(". ");
    }

    static generateRoundPropAnalysis(fight) {
        const { ko_tko, submission } = fight.probabilityBreakdown;
        const totalFinishProb = ko_tko + submission;

        if (totalFinishProb > 70) {
            return `High finish probability (${totalFinishProb.toFixed(1)}%) suggests early ending`;
        } else if (totalFinishProb > 50) {
            return `Moderate finish potential (${totalFinishProb.toFixed(1)}%) with timing uncertainty`;
        }
        return "Fight likely to extend, suggesting over consideration";
    }

    static generateRiskAssessment(marketMetrics, valueOpportunities) {
        return {
            marketRisk: this.calculateMarketRisk(marketMetrics),
            individualRisks: this.calculateIndividualRisks(valueOpportunities),
            exposureLimits: this.calculateExposureLimits(marketMetrics),
            volatilityAssessment: this.assessVolatility(marketMetrics, valueOpportunities)
        };
    }

    static calculateMarketRisk(metrics) {
        const risk = {
            level: null,
            score: 0,
            factors: []
        };

        if (metrics.marketEfficiency < 70) {
            risk.score += 3;
            risk.factors.push("Low market efficiency indicates higher variance");
        }

        if (metrics.marketBalance > 15) {
            risk.score += 2;
            risk.factors.push("Significant market imbalance detected");
        }

        risk.level = risk.score >= 4 ? "High" : 
                    risk.score >= 2 ? "Moderate" : "Low";

        return risk;
    }

    static calculateIndividualRisks(opportunities) {
        return opportunities.map(opp => ({
            fighter: opp.fighter,
            riskLevel: this.calculateIndividualRiskLevel(opp),
            factors: this.identifyRiskFactors(opp)
        }));
    }

    static calculateIndividualRiskLevel(opportunity) {
        let riskScore = 0;
        
        if (opportunity.edge > 15) riskScore += 2;
        if (opportunity.confidence < 65) riskScore += 2;
        if (opportunity.odds > 150) riskScore += 1;
        
        return riskScore >= 4 ? "High" :
               riskScore >= 2 ? "Medium" : "Low";
    }

    static identifyRiskFactors(opportunity) {
        const factors = [];
        
        if (opportunity.edge > 15) factors.push("Large edge suggests potential market inefficiency");
        if (opportunity.confidence < 65) factors.push("Lower confidence indicates prediction uncertainty");
        if (opportunity.odds > 150) factors.push("Underdog position increases variance");
        
        return factors;
    }

    static calculateExposureLimits(metrics) {
        const baseLimit = 5; // Maximum 5% per play base
        const efficiencyFactor = metrics.marketEfficiency / 100;
        
        return {
            maxSingleBet: Math.min(5, baseLimit * efficiencyFactor),
            maxParlay: Math.min(2, baseLimit * efficiencyFactor * 0.4),
            totalExposure: Math.min(20, baseLimit * 4 * efficiencyFactor)
        };
    }

    static assessVolatility(metrics, opportunities) {
        const volatilityFactors = {
            marketEfficiency: metrics.marketEfficiency < 75 ? "High" : "Normal",
            edgeDistribution: this.calculateEdgeDistribution(opportunities),
            recommendedAdjustments: []
        };

        if (metrics.marketEfficiency < 75) {
            volatilityFactors.recommendedAdjustments.push("Reduce position sizes by 25%");
        }

        if (volatilityFactors.edgeDistribution === "Wide") {
            volatilityFactors.recommendedAdjustments.push("Focus on highest confidence plays");
        }

        return volatilityFactors;
    }

    static calculateEdgeDistribution(opportunities) {
        const edges = opportunities.map(o => o.edge);
        const spread = Math.max(...edges) - Math.min(...edges);
        return spread > 15 ? "Wide" : "Normal";
    }

    static calculateBankrollStrategy(valueOpportunities, parlayAnalysis) {
        const strategy = {
            straightBets: {
                percentage: 0,
                maxBetSize: 0,
                allocation: []
            },
            parlays: {
                percentage: 0,
                maxBetSize: 0,
                allocation: []
            },
            reserve: 0
        };

        const totalOpportunities = valueOpportunities.length;
        const qualityOpportunities = valueOpportunities.filter(v => v.edge > 10).length;

        strategy.straightBets.percentage = Math.min(60, 35 + (qualityOpportunities * 5));
        strategy.parlays.percentage = Math.min(25, 10 + (parlayAnalysis.twoPicks?.length * 3 || 0));
        strategy.reserve = 100 - (strategy.straightBets.percentage + strategy.parlays.percentage);

        strategy.straightBets.maxBetSize = Math.min(5, 2 + (Math.max(...valueOpportunities.map(v => v.edge)) / 10));
        strategy.parlays.maxBetSize = Math.min(2, 0.5 + (this.calculateParlayRiskRating(parlayAnalysis) / 2));

        return strategy;
    }

    static calculateParlayRiskRating(parlayAnalysis) {
        if (!parlayAnalysis?.twoPicks?.length) return 0;
        
        const avgEdge = parlayAnalysis.twoPicks.reduce((sum, p) => sum + p.edge, 0) / 
                       parlayAnalysis.twoPicks.length;
        
        return avgEdge > 10 ? 3 : 
               avgEdge > 7.5 ? 2 : 1;
    }

    static formatDisplayValue(value) {
        if (typeof value === 'number') {
            return value.toFixed(1) + '%';
        }
        return value.toString();
    }

    static getRatingDisplay(rating) {
        return "⭐".repeat(Math.min(5, Math.max(1, rating)));
    }
}

module.exports = MarketAnalysis;
