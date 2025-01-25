// src/utils/fightDataProcessor.js

const processFightData = async (fights) => {
    return fights
        .map(fight => {
            if (!fight.fighter1 || !fight.fighter2) {
                console.warn('Invalid fight data:', fight);
                return null;
            }

            return {
                fighter1: fight.fighter1.trim(),
                fighter2: fight.fighter2.trim(),
                WeightClass: fight.WeightClass || 'Unknown',
                is_main_card: Boolean(fight.is_main_card),
                event_id: fight.event_id
            };
        })
        .filter(fight => fight !== null);
};

const segregateFightCard = (fights) => {
    const mainCard = fights.filter(fight => fight.is_main_card);
    const prelims = fights.filter(fight => !fight.is_main_card);
    
    console.log(`Main card fights: ${mainCard.length}`);
    mainCard.forEach(fight => {
        console.log(`${fight.fighter1} vs ${fight.fighter2} (${fight.WeightClass})`);
    });
    
    return {
        mainCard,
        prelims
    };
};

const prepareFightsForPrediction = (fights) => {
    return fights.map(fight => ({
        fighter1: fight.fighter1,
        fighter2: fight.fighter2,
        weightClass: fight.WeightClass,
        isMainCard: fight.is_main_card,
        matchup: `${fight.fighter1} vs ${fight.fighter2}`,
        eventId: fight.event_id
    }));
};

const processEventFights = async (eventFights) => {
    try {
        console.log('Processing event fights:', eventFights);
        
        const validatedFights = await processFightData(eventFights);
        const { mainCard, prelims } = segregateFightCard(validatedFights);
        
        const preparedMainCard = prepareFightsForPrediction(mainCard);
        const preparedPrelims = prepareFightsForPrediction(prelims);
        
        return {
            mainCard: preparedMainCard,
            prelims: preparedPrelims,
            allFights: [...preparedMainCard, ...preparedPrelims]
        };
    } catch (error) {
        console.error('Error processing event fights:', error);
        throw error;
    }
};

module.exports = {
    processFightData,
    segregateFightCard,
    prepareFightsForPrediction,
    processEventFights
};