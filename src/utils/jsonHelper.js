function parseAndValidateGPTResponse(content) {
    try {
        // Remove code block markers first
        let cleanedContent = content.replace(/```json\n?|```/g, '');

        // Extract the JSON object
        const jsonMatch = cleanedContent.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            console.error("No JSON object found in response");
            return generateEmptyPrediction();
        }

        let jsonString = jsonMatch[0];

        // Clean control characters and problematic whitespace
        jsonString = jsonString
            .replace(/[\x00-\x1F\x7F-\x9F]/g, '')
            .replace(/\s+/g, ' ')
            .replace(/:\s*"+([^"]+)"+/g, ':"$1"')
            .replace(/(\w)'(\w)/g, "$1'$2")
            .replace(/\[\s*"/g, '["')
            .replace(/",\s*"/g, '","')
            .replace(/"\s*\]/g, '"]')
            .replace(/,(\s*[}\]])/g, '$1')
            .replace(/:\s*(\d+)\.(\d+)/g, ':$1.$2')
            .replace(/:(\s*)(true|false)\b/gi, (_, space, bool) => 
                `:${space}${bool.toLowerCase()}`
            );

        // Try parsing with recovery options
        let parsed;
        try {
            parsed = JSON.parse(jsonString);
        } catch (initialError) {
            console.log("Initial parse failed, attempting recovery");
            
            // Try to recover both fights and betting analysis
            const fightsMatch = jsonString.match(/"fights"\s*:\s*\[([\s\S]*?)\](?=\s*,|\s*})/);
            const marketMatch = jsonString.match(/"betting_analysis"\s*:\s*(\{[\s\S]*?\})(?=\s*[,}])/);
            
            if (fightsMatch) {
                let fightsArray = fightsMatch[1]
                    .replace(/[\x00-\x1F\x7F-\x9F]/g, '')
                    .replace(/\n/g, ' ')
                    .replace(/\s+/g, ' ');

                let marketAnalysis = marketMatch ? marketMatch[1] : '{"marketAnalysis":{}}';

                const partialJson = `{
                    "fights":[${fightsArray}],
                    "betting_analysis":${marketAnalysis}
                }`;
                
                console.log("Attempting to parse cleaned data:", partialJson);
                parsed = JSON.parse(partialJson);
            } else {
                throw new Error("Could not extract fights array");
            }
        }

        // Handle market analysis structure
        if (!parsed.betting_analysis) {
            parsed.betting_analysis = {
                marketAnalysis: generateEmptyMarketAnalysis()
            };
        }

        // If betting_analysis doesn't have marketAnalysis, create it
        if (!parsed.betting_analysis.marketAnalysis) {
            parsed.betting_analysis.marketAnalysis = generateEmptyMarketAnalysis();
        }

        // Validate the structure
        if (validatePredictionStructure(parsed)) {
            return parsed;
        }

        console.error("Validation failed for parsed JSON");
        return generateEmptyPrediction();

    } catch (error) {
        console.error("Error in JSON processing:", error);
        return generateEmptyPrediction();
    }
}

function cleanFightObject(fight) {
    try {
        // First validate that we have fighter names
        if (!fight.fighter1 || !fight.fighter2) {
            console.error("Missing fighter names in fight object:", fight);
            return null;
        }

        const cleaned = {};
        Object.entries(fight).forEach(([key, value]) => {
            if (typeof value === 'string') {
                // Preserve fighter names exactly as they are
                if (key === 'fighter1' || key === 'fighter2' || key === 'predictedWinner') {
                    cleaned[key] = value.replace(/^["']+|["']+$/g, '').trim();
                } else {
                    // Clean other strings
                    cleaned[key] = value
                        .replace(/[\x00-\x1F\x7F-\x9F]/g, '')
                        .replace(/^"+|"+$/g, '')
                        .replace(/(\w)'(\w)/g, "$1'$2")
                        .trim();
                }
            } else if (Array.isArray(value)) {
                cleaned[key] = value.map(item => 
                    typeof item === 'string' 
                        ? item.replace(/[\x00-\x1F\x7F-\x9F]/g, '').trim()
                        : item
                );
            } else {
                cleaned[key] = value;
            }
        });

        // Validate the cleaned object
        if (!cleaned.fighter1 || !cleaned.fighter2) {
            console.error("Fighter names were lost during cleaning:", cleaned);
            return null;
        }

        return cleaned;
    } catch (error) {
        console.error("Error cleaning fight object:", error, "Original fight:", fight);
        return null;
    }
}

function validatePredictionStructure(predictions) {
    if (!predictions?.fights?.length) {
        console.log("Missing or empty fights array");
        return false;
    }

    // Filter out any null fights from cleaning
    predictions.fights = predictions.fights
        .map(fight => cleanFightObject(fight))
        .filter(fight => fight !== null);

    if (predictions.fights.length === 0) {
        console.log("No valid fights after cleaning");
        return false;
    }

    // Ensure market analysis has proper structure
    if (!predictions.betting_analysis?.marketAnalysis) {
        predictions.betting_analysis = {
            marketAnalysis: generateEmptyMarketAnalysis()
        };
    }

    return predictions.fights.every(fight => {
        try {
            const requiredFields = [
                'fighter1',
                'fighter2',
                'predictedWinner',
                'confidence',
                'method',
                'probabilityBreakdown'
            ];

            const hasAllFields = requiredFields.every(field => {
                const hasField = fight.hasOwnProperty(field) && fight[field] !== null && fight[field] !== '';
                if (!hasField) {
                    console.log(`Missing or empty required field: ${field} in fight:`, fight);
                }
                return hasField;
            });

            if (!hasAllFields) return false;

            if (![fight.fighter1, fight.fighter2, fight.predictedWinner].every(name => 
                typeof name === 'string' && name.trim().length > 0
            )) {
                console.log("Invalid fighter name detected:", fight);
                return false;
            }

            const validConfidence = typeof fight.confidence === 'number' &&
                                  fight.confidence >= 55 &&
                                  fight.confidence <= 85;
            
            if (!validConfidence) {
                console.log(`Invalid confidence value: ${fight.confidence}`);
                return false;
            }

            const validProbabilities = fight.probabilityBreakdown &&
                                     typeof fight.probabilityBreakdown.ko_tko === 'number' &&
                                     typeof fight.probabilityBreakdown.submission === 'number' &&
                                     typeof fight.probabilityBreakdown.decision === 'number';
            
            if (!validProbabilities) {
                console.log("Invalid probability breakdown:", fight.probabilityBreakdown);
                return false;
            }

            return true;

        } catch (error) {
            console.error("Fight validation error:", error, "Fight:", fight);
            return false;
        }
    });
}

// Add this helper function to verify fighter names
function verifyFighterNames(fights) {
    return fights.map(fight => {
        // Log the fighter names for debugging
        console.log("Processing fighter names:", {
            fighter1: fight.fighter1,
            fighter2: fight.fighter2,
            predictedWinner: fight.predictedWinner
        });

        // Ensure names are strings and properly trimmed
        fight.fighter1 = String(fight.fighter1).trim();
        fight.fighter2 = String(fight.fighter2).trim();
        fight.predictedWinner = String(fight.predictedWinner).trim();

        return fight;
    });
}

function generateEmptyMarketAnalysis() {
    return {
        overview: "Basic analysis based on available data",
        efficiency: 70,
        mainCardPicks: [],
        prelimPicks: [],
        parlayRecommendations: "Analysis unavailable",
        propBets: "Analysis unavailable",
        overallStrategy: "Insufficient data for detailed analysis"
    };
}

function generateEmptyPrediction() {
    return {
        fights: [],
        betting_analysis: {
            marketAnalysis: generateEmptyMarketAnalysis()
        }
    };
}

module.exports = {
    parseAndValidateGPTResponse,
    validatePredictionStructure,
    generateEmptyPrediction,
    cleanFightObject,
    verifyFighterNames
};