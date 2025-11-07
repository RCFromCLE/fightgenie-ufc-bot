class PredictionState {
    constructor() {
        this.activePredictions = new Map(); // eventId -> { status, startTime, userId, guildId }
        this.predictionQueue = new Map(); // eventId -> array of waiting requests
    }

    // Check if predictions are currently running for an event
    isPredictionRunning(eventId) {
        return this.activePredictions.has(eventId);
    }

    // Start a prediction session
    startPrediction(eventId, userId, guildId) {
        if (this.isPredictionRunning(eventId)) {
            return false; // Already running
        }

        this.activePredictions.set(eventId, {
            status: 'running',
            startTime: Date.now(),
            userId,
            guildId
        });

        return true;
    }

    // End a prediction session
    endPrediction(eventId) {
        this.activePredictions.delete(eventId);
        
        // Process any queued requests
        if (this.predictionQueue.has(eventId)) {
            const queue = this.predictionQueue.get(eventId);
            this.predictionQueue.delete(eventId);
            
            // Return the first queued request to be processed
            return queue.shift();
        }
        
        return null;
    }

    // Add a request to the queue
    queuePredictionRequest(eventId, interaction) {
        if (!this.predictionQueue.has(eventId)) {
            this.predictionQueue.set(eventId, []);
        }
        
        this.predictionQueue.get(eventId).push(interaction);
    }

    // Get prediction status for an event
    getPredictionStatus(eventId) {
        return this.activePredictions.get(eventId) || null;
    }

    // Clean up old prediction sessions (older than 10 minutes)
    cleanup() {
        const now = Date.now();
        const maxAge = 10 * 60 * 1000; // 10 minutes

        for (const [eventId, session] of this.activePredictions.entries()) {
            if (now - session.startTime > maxAge) {
                console.log(`Cleaning up stale prediction session for event ${eventId}`);
                this.endPrediction(eventId);
            }
        }
    }

    // Get all active predictions (for debugging)
    getActivePredictions() {
        return Array.from(this.activePredictions.entries()).map(([eventId, session]) => ({
            eventId,
            ...session,
            duration: Date.now() - session.startTime
        }));
    }
}

// Export singleton instance
module.exports = new PredictionState();
