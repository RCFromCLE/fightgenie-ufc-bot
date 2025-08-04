# Fight Genie
## Advanced UFC Fight Prediction & Analysis System
![Version](https://img.shields.io/badge/version-1.0.0-blue)
![Discord](https://img.shields.io/badge/discord-bot-7289da)
![Platform](https://img.shields.io/badge/platform-Discord-7289da)

https://fightgenie.ai/

https://rudycorradetti.com/2024/12/04/fight-genie-ai-nodejs-discord-bot-ufc-predictions/

Fight Genie is an advanced UFC fight prediction system utilizing dual AI models (GPT and Claude Sonnet), real-time odds integration, and comprehensive statistical analysis to provide accurate fight predictions and betting insights.

## Table of Contents
- [Overview](#overview)
- [System Architecture](#system-architecture)
- [Core Features](#core-features)
- [Technical Implementation](#technical-implementation)
- [Data Processing](#data-processing)
- [Prediction System](#prediction-system)
- [Security & Privacy](#security--privacy)
- [Deployment](#deployment)

## Overview

### Key Features
- Real-time fight predictions using dual AI models
- Live betting odds integration
- Comprehensive fighter statistics
- Privacy-focused data handling
- Automated event management
- Detailed statistical analysis

### Access Model

Fight Genie is now **100% FREE** to use! All features are available to everyone.

If you find the bot valuable, please consider supporting its development and server costs using the `$donate` command.

## System Architecture

### Database Structure (SQLite)
Currently implemented as local SQLite with planned Azure migration path:

```sql
-- Core Tables
events
  - event_id, Event, Date, City, Country
  - event_link, is_completed, event_time
  - prelims_time, main_card_time

fighters
  - Name, Height, Weight, Reach, Stance
  - SLPM, SApM, StrAcc, StrDef
  - TDAvg, TDAcc, TDDef, SubAvg
  - last_updated

stored_predictions
  - prediction_id, event_id, card_type
  - model_used, prediction_data, created_at

-- server_subscriptions (REMOVED - No longer used)
-- payment_logs (REMOVED - No longer used)
-- solana_payments (REMOVED - No longer used)
```

### Data Pipeline

#### Event Management System
```javascript
Event Detection Flow:
1. Check current date against event database
2. Scrape UFCStats.com for verification
3. Update event status and fight card
4. Trigger predictions if needed
```

#### Fighter Statistics Pipeline
```javascript
Data Collection Process:
1. UFCStats.com scraping
2. Data normalization
3. Statistical validation
4. Database storage
5. Cache management
```

## Technical Implementation

### Web Scraping System
UFCStats.com data collection using Axios and Cheerio:

```javascript
Scraping Scenarios:
1. Event Detection
   - Upcoming events page
   - Event details and timing
   - Fight card composition

2. Fighter Statistics
   - Individual fighter pages
   - Career statistics
   - Fight history
   - Performance metrics

3. Fight Results
   - Completed event verification
   - Result confirmation
   - Record updates
```

### Prediction System

#### Confidence Calculation (100 points)
```javascript
Score Components:
1. Base Score (30 points)
   - UFC win rate (15)
   - Opposition quality (15)

2. Style Score (25 points)
   - Technical advantages (15)
   - Physical advantages (10)

3. Form Score (25 points)
   - Recent performance (15)
   - Activity/preparation (10)

4. Historical Score (20 points)
   - Career consistency (10)
   - Championship experience (10)
```

#### Edge Calculation
```javascript
Edge Formula:
1. Convert odds to probability
   - Positive odds: 100/(odds + 100)
   - Negative odds: |odds|/(|odds| + 100)

2. Calculate edge
   - Edge = model_confidence - market_probability

3. Determine value rating
   ⭐⭐⭐⭐⭐: 20%+ edge, 70%+ confidence
   ⭐⭐⭐⭐: 15%+ edge, 65%+ confidence
   ⭐⭐⭐: 10%+ edge, 60%+ confidence
```

### Payment Integration (REMOVED)

Payment processing (PayPal, Solana, Stripe) has been removed as the bot is now free.

## Security & Privacy

### Data Protection
```javascript
Stored Data (Minimal):
- Discord Server ID
- Discord Admin ID (for specific admin commands)

Not Stored:
- Personal Information
- Payment Details
- User Messages
- IP Addresses
```

### Prediction Accuracy
```javascript
Tracking Metrics:
1. Winner prediction accuracy
2. Method prediction accuracy
3. Round prediction accuracy
4. Confidence correlation
5. Edge validation
```

## Documentation Notes

### Command Reference
```javascript
User Commands:
$upcoming - Show current event
$predict - Generate predictions
$checkstats - Fighter statistics
$sub - Check bot status
$donate - Support Fight Genie's development

Admin Commands:
(Admin commands related to payments/promos removed)
- $advance - Advance to the next event (Admin only)
- $forceupdate - Force update current event data (Admin only)
- $syncpredictions - Sync predictions (Admin only)
```

### Manual Tweet Triggering
You can manually trigger specific tweet types using the `TweetAutomation.js` script directly from the command line. This is useful if a scheduled tweet fails or needs to be posted outside the schedule.

**Usage:**
```bash
node src/utils/TweetAutomation.js <tweet_type>
```

Replace `<tweet_type>` with one of the following:

-   **Fight Analysis Thread:**
    ```bash
    node src/utils/TweetAutomation.js fight_analysis
    ```
-   **Value Pick Tweet:**
    ```bash
    node src/utils/TweetAutomation.js value_pick
    ```
-   **Model Competition Thread:**
    ```bash
    node src/utils/TweetAutomation.js model_competition
    ```
-   **Weekly State Thread:**
    ```bash
    node src/utils/TweetAutomation.js weekly_state
    ```
-   **UFC History/Promo Tweet:**
    ```bash
    node src/utils/TweetAutomation.js ufc_history_promo
    ```

**Note:** This script respects the `TWEET_TEST_MODE` environment variable set in your `.env` file. If set to `true`, tweets will be logged to the console and `tweet-logs.txt` instead of being posted to Twitter.

### Support
For technical support or inquiries:
- Email: rudycorradetti4@gmail.com
---

## Technical Specifications

### System Requirements
- Node.js 16+
- SQLite3
- Discord.js v14+
- Minimum 2GB RAM
- 10GB Storage
