# Fight Genie
## Advanced UFC Fight Prediction & Analysis System
![Version](https://img.shields.io/badge/version-1.0.0-blue)
![Discord](https://img.shields.io/badge/discord-bot-7289da)
![Platform](https://img.shields.io/badge/platform-Discord-7289da)

Fight Genie is an advanced UFC fight prediction system utilizing dual AI models (GPT-4 and Claude 3.5 Sonnet), real-time odds integration, and comprehensive statistical analysis to provide accurate fight predictions and betting insights.

## Table of Contents
- [Overview](#overview)
- [System Architecture](#system-architecture)
- [Core Features](#core-features)
- [Technical Implementation](#technical-implementation)
- [Data Processing](#data-processing)
- [Prediction System](#prediction-system)
- [Security & Privacy](#security--privacy)
- [Payment Integration](#payment-integration)
- [Deployment](#deployment)
- [Future Roadmap](#future-roadmap)

## Overview

### Key Features
- Real-time fight predictions using dual AI models
- Live betting odds integration
- Comprehensive fighter statistics
- Secure payment processing (PayPal & Solana)
- Privacy-focused data handling
- Automated event management
- Detailed statistical analysis

### Access Tiers
- Event Access: $6.99 (expires 1:30 AM EST post-event)
- Lifetime Access: $50.00 (permanent server access)
- Solana Payments: 10% discount on all tiers

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

server_subscriptions
  - server_id, subscription_type, payment_id
  - status, event_id, expiration_date
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

### Payment Integration

#### Solana Integration
```javascript
Price Determination:
1. Jupiter API query for current SOL price
2. Apply 10% platform discount
3. Calculate SOL amount
4. Real-time conversion updates
```

#### PayPal Processing
```javascript
Payment Flow:
1. Create PayPal order
2. Process payment
3. Verify transaction
4. Activate subscription
```

## Security & Privacy

### Data Protection
```javascript
Stored Data (Minimal):
- Discord Server ID
- Discord Admin ID
- Payment Reference ID
- Subscription Status

Not Stored:
- Personal Information
- Payment Details
- User Messages
- IP Addresses
```

### Access Verification
```javascript
Verification Process:
1. Check lifetime access
2. Verify event access if needed
3. Validate subscription status
4. Grant appropriate permissions
```

## Testing & Validation

### Prediction Accuracy
```javascript
Tracking Metrics:
1. Winner prediction accuracy
2. Method prediction accuracy
3. Round prediction accuracy
4. Confidence correlation
5. Edge validation
```

### Performance Monitoring
```javascript
Key Metrics:
 Response time
1. Data freshness
2. System uptime
```

## Future Roadmap

### Azure Migration
Planned migration to cloud infrastructure if utilization increases:
1. Azure SQL Database
2. Azure App Service
3. Azure Functions
5. Azure Monitoring

### Feature Expansion
1. Enhanced statistical modeling
2. Additional payment methods
3. Advanced parlay analysis
4. Mobile application
5. API access

## Documentation Notes

### Command Reference
```javascript
User Commands:
$upcoming - Show current event
$predict - Generate predictions
$checkstats - Fighter statistics
$buy - Purchase access
$subscription - Check status

Admin Commands:
- $promo CODE - Users can redeem a promo code for event access
- $checkpromos - Admin only: View status of all promo codes
- $createnewcodes - Admin only: Generate new codes for next event
```

### Support
For technical support or inquiries:
- Email: rudycorradetti4@gmail.com

### Contributing
[Contributing guidelines and information]

### License
[License information]

---

## Technical Specifications

### System Requirements
- Node.js 16+
- SQLite3
- Discord.js v14+
- Minimum 2GB RAM
- 10GB Storage

### Installation
[Installation instructions]

### Configuration
[Configuration details]

### Testing
[Testing procedures]

Would you like me to:
1. Add more technical details to any section?
2. Include specific code examples?
3. Expand on any component?
4. Add deployment instructions?