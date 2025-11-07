# FightGenie UFC Bot - Project Documentation

## Overview
FightGenie is an advanced AI-powered Discord bot that provides UFC fight predictions, statistical analysis, and comprehensive fighter data. The bot leverages both OpenAI's GPT and Anthropic's Claude models to generate detailed fight predictions with confidence scores, method predictions, and betting analysis.

## Key Features

### 1. AI-Powered Fight Predictions
- **Dual Model Support**: Utilizes both GPT-4 and Claude-3 for diverse analytical perspectives
- **Comprehensive Analysis**: Each prediction includes:
  - Winner prediction with confidence percentage
  - Method of victory (KO/TKO, Submission, Decision)
  - Round prediction
  - Detailed reasoning based on fighter statistics
  - Historical performance analysis

### 2. Model Performance Tracking
- **Accuracy Metrics**: Tracks prediction accuracy for both models across events
- **Method Accuracy**: Monitors how well each model predicts the method of victory
- **Historical Comparison**: Compare model performance over time
- **Event-by-Event Breakdown**: See how each model performed for specific UFC events

### 3. Fighter Statistics Database
- **Comprehensive Stats**: Over 50 data points per fighter including:
  - Strike accuracy and defense
  - Takedown success rates
  - Submission attempts
  - Physical attributes (height, reach, stance)
  - Win/loss record by method
- **Auto-Updates**: Fighter stats are automatically updated from UFCStats.com
- **Historical Tracking**: Maintains historical performance data

### 4. Betting Analysis & Market Intelligence
- **Odds Integration**: Real-time odds from multiple sportsbooks
- **Value Identification**: Highlights fights where AI confidence exceeds implied probability
- **Edge Calculation**: Shows percentage edge for potential value bets
- **Risk Assessment**: Categorizes bets by confidence level

## User Commands

### `/upcoming`
**Description**: Displays the next upcoming UFC event with interactive prediction options

**Features**:
- Shows complete fight card (Main Card and Preliminaries)
- Interactive buttons to generate predictions for each card type
- Displays event date, location, and venue
- Shows fighter records and weight classes
- Allows switching between GPT and Claude models

**Usage**: Simply type `/upcoming` to see the next event

---

### `/predict [fighter1] [fighter2] [card] [model]`
**Description**: Generate a specific fight prediction

**Parameters**:
- `fighter1` (optional): First fighter's name
- `fighter2` (optional): Second fighter's name  
- `card` (optional): "main" or "prelims"
- `model` (optional): "gpt" or "claude"

**Usage Examples**:
- `/predict` - Shows prediction options for current event
- `/predict fighter1:Max fighter2:Alex` - Specific fight prediction
- `/predict card:main model:claude` - All main card predictions using Claude

---

### `/stats`
**Description**: View comprehensive model performance statistics

**Features**:
- Overall accuracy comparison between GPT and Claude
- Win prediction accuracy percentages
- Method prediction accuracy
- Confidence calibration analysis
- Event-by-event performance breakdown
- Interactive dropdown to view specific event details

**Output Includes**:
- Total predictions made by each model
- Correct winner predictions
- Correct method predictions
- Average confidence scores
- Performance trends

---

### `/checkstats [fighter]`
**Description**: View detailed statistics for a specific fighter

**Parameters**:
- `fighter` (required): Fighter's name

**Features**:
- Complete statistical profile
- Strike and grappling metrics
- Physical attributes
- Recent performance trends
- Win/loss breakdown by method
- Option to force update from UFCStats.com

**Usage**: `/checkstats fighter:Israel Adesanya`

---

### `/model [type]`
**Description**: Switch between GPT and Claude for predictions

**Parameters**:
- `type` (required): "gpt" or "claude"

**Features**:
- Sets default model for all predictions
- Persists across sessions
- Shows current model in use

**Usage**: `/model type:claude`

---

### `/donate`
**Description**: Support FightGenie's development and server costs

**Features**:
- Multiple donation options
- Cryptocurrency support
- Direct links to payment platforms

---

### `/status`
**Description**: View comprehensive bot status and helpful information

**Features**:
- Real-time bot status (online/offline)
- Server and user count
- Current UFC event information
- 30-day prediction statistics
- Feature overview
- Quick tips for using the bot
- Support information

---

### `/help`
**Description**: Display all available commands with descriptions

## Admin Commands (Restricted Access)

Admin commands are restricted to the designated admin server (ID: 496121279712329756) and require:
1. Administrator permissions in Discord
2. Password verification (stored in environment variable)

### `/admin advance [password]`
**Description**: Advance to the next UFC event after current event concludes

**Security**: 
- Requires admin server
- Requires administrator role
- Requires password verification

**Features**:
- Marks current event as completed
- Fetches next event from UFCStats.com
- Updates fight card automatically
- Clears old predictions

---

### `/admin forceupdate [password]`
**Description**: Force update the current event data

**Security**:
- Requires admin server  
- Requires administrator role
- Requires password verification

**Features**:
- Re-scrapes event data from UFCStats.com
- Updates fight card changes
- Refreshes fighter matchups

---

### `/admin updatefighterstats [password]`
**Description**: Update statistics for all fighters in current event

**Security**:
- Requires admin server
- Requires administrator role  
- Requires password verification

**Features**:
- Batch updates all fighters
- Progress tracking
- Error reporting for failed updates
- Typically takes 2-5 minutes

---

### `/admin runallpredictions [password]`
**Description**: Generate all predictions for the current event

**Security**:
- Requires admin server
- Requires administrator role
- Requires password verification  

**Features**:
- Generates predictions for both models
- Covers main card and preliminaries
- Stores in database for quick retrieval
- Shows success/failure for each generation

---

### `/admin syncpredictions [password]`
**Description**: Sync prediction outcomes with fight results

**Security**:
- Requires admin server
- Requires administrator role
- Requires password verification

**Features**:
- Compares predictions with actual results
- Updates accuracy statistics
- Calculates model performance metrics

## Technical Architecture

### Technology Stack
- **Language**: Node.js (JavaScript)
- **Database**: SQLite with custom schema
- **AI Models**: OpenAI GPT-4, Anthropic Claude-3
- **Data Source**: UFCStats.com (web scraping)
- **Odds API**: The Odds API for betting lines
- **Discord Library**: Discord.js v14

### Database Schema
- `events`: UFC event information and fight cards
- `fighter_stats`: Comprehensive fighter statistics
- `stored_predictions`: AI model predictions
- `prediction_outcomes`: Results tracking
- `market_analysis`: Betting market data
- `user_preferences`: User model preferences

### Security Features
- Environment variable configuration
- Admin command restrictions by server ID
- Password protection for sensitive operations
- Permission-based access control
- Secure API key management

### Model Selection Strategy
The bot uses two distinct AI models to provide diverse analytical perspectives:

**GPT-4 Strengths**:
- Statistical analysis focus
- Quantitative reasoning
- Historical pattern recognition
- Odds correlation

**Claude-3 Strengths**:
- Contextual fight analysis
- Style matchup evaluation
- Narrative reasoning
- Intangible factors consideration

## Deployment & Maintenance

### Environment Variables Required
```
DISCORD_TOKEN=your_discord_token
DISCORD_CLIENT_ID=your_client_id
ANTHROPIC_API_KEY=your_anthropic_key
OPENAI_API_KEY=your_openai_key
ODDS_API_KEY=your_odds_api_key
ADMIN_PASSWORD=rc123
DB_PATH=./database.db
NODE_ENV=production
LOG_LEVEL=info
```

### Admin Server Configuration
The admin commands are restricted to server ID: `496121279712329756`. This ensures that sensitive operations like advancing events or forcing updates can only be performed in the designated admin server.

### Password Protection
All admin commands now require a password parameter that matches the `ADMIN_PASSWORD` environment variable. This adds an extra layer of security beyond Discord permissions.

## Performance Metrics

### Response Times
- Prediction Generation: 15-30 seconds
- Stats Lookup: <2 seconds
- Event Display: <1 second
- Fighter Updates: 3-5 seconds per fighter

### Accuracy Statistics (Historical)
- GPT-4 Win Prediction: ~68% accuracy
- Claude-3 Win Prediction: ~66% accuracy
- Method Prediction: ~45% accuracy (both models)
- Confidence Calibration: Well-calibrated above 65% confidence

### Scalability
- Supports unlimited Discord servers
- Caches predictions for performance
- Batch processing for fighter updates
- Async operation for all API calls

## Future Enhancements
- Live fight tracking during events
- Parlay combination analysis
- Fighter comparison tools
- Training camp news integration
- Injury report analysis
- Social media sentiment analysis
- Custom user prediction tracking

## Support & Contact
For issues, feature requests, or support:
- GitHub Issues: [Project Repository]
- Discord Support Server: [Invite Link]
- Email: support@fightgenie.ai

## License & Terms
FightGenie is proprietary software. All predictions are for entertainment purposes only. Not responsible for betting decisions. Must be 21+ to use betting features.

---

*Last Updated: December 2024*
*Version: 2.0.0*