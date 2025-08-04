# Slash Commands Migration Guide

## Overview

Fight Genie has been migrated from prefix commands (`$`) to Discord slash commands (`/`) to comply with Discord's requirements and avoid needing the Message Content Intent permission.

## Migration Summary

### Before (Prefix Commands)
- `$upcoming` - Show upcoming event
- `$predict` - Generate predictions
- `$model [claude/gpt]` - Switch AI models
- `$stats` - View model statistics
- `$checkstats [fighter]` - Check fighter stats
- `$donate` - Support the bot
- `$sub` - Check subscription status
- `$help` - Show help

### After (Slash Commands)
- `/upcoming` - Show upcoming event
- `/predict` - Generate predictions with options
- `/model [type]` - Switch AI models
- `/stats [fighter]` - View model statistics or fighter stats
- `/checkstats <fighter>` - Check fighter stats (required parameter)
- `/donate` - Support the bot
- `/sub` - Check subscription status
- `/help` - Show help
- `/admin` - Admin commands with subcommands

## Key Changes

### 1. Command Structure
- **Old**: `$command argument`
- **New**: `/command option:value`

### 2. Admin Commands
Admin commands are now consolidated under `/admin` with subcommands:
- `/admin advance` - Advance to next event
- `/admin forceupdate` - Force update current event
- `/admin updatefighterstats` - Update all fighter stats
- `/admin runallpredictions` - Generate all predictions
- `/admin syncpredictions` - Sync predictions from database

### 3. Improved User Experience
- **Autocomplete**: Slash commands provide better autocomplete
- **Validation**: Parameters are validated before execution
- **Discoverability**: Users can see all available commands by typing `/`
- **Help Text**: Each command shows helpful descriptions

### 4. Permission Changes
- **Removed**: `GuildMessages` and `MessageContent` intents
- **Kept**: `Guilds` and `GuildMessageReactions` intents
- **Result**: No longer requires Message Content Intent permission

## Deployment Steps

### 1. Deploy Slash Commands
```bash
npm run deploy-commands
```

### 2. Update Environment Variables
Ensure your `.env` file includes:
```
DISCORD_CLIENT_ID=your_client_id_here
```

### 3. Update Bot Permissions
The bot now requires fewer permissions:
- ✅ `applications.commands` (for slash commands)
- ✅ `bot` (basic bot permissions)
- ❌ No longer needs Message Content Intent

## Backward Compatibility

The bot maintains backward compatibility:
- **Prefix commands** (`$`) still work for existing users
- **Slash commands** (`/`) are the new preferred method
- **Button interactions** continue to work as before
- **Existing functionality** remains unchanged

## Benefits of Migration

1. **Compliance**: Meets Discord's new requirements
2. **Better UX**: Improved command discovery and validation
3. **Future-Proof**: Aligns with Discord's direction
4. **Reduced Permissions**: No longer needs Message Content Intent
5. **Professional**: Slash commands appear more polished

## Command Mapping Reference

| Old Command | New Slash Command | Notes |
|-------------|-------------------|-------|
| `$upcoming` | `/upcoming` | Identical functionality |
| `$predict` | `/predict` | Now has optional parameters |
| `$model claude` | `/model type:claude` | Parameter-based |
| `$model gpt` | `/model type:gpt` | Parameter-based |
| `$stats` | `/stats` | Same functionality |
| `$checkstats Fighter` | `/checkstats fighter:Fighter` | Required parameter |
| `$donate` | `/donate` | Identical functionality |
| `$sub` | `/sub` | Identical functionality |
| `$help` | `/help` | Updated for slash commands |
| `$advance` | `/admin advance` | Now a subcommand |
| `$forceupdate` | `/admin forceupdate` | Now a subcommand |
| `$updatefighterstats` | `/admin updatefighterstats` | Now a subcommand |
| `$runallpredictions` | `/admin runallpredictions` | Now a subcommand |
| `$syncpredictions` | `/admin syncpredictions` | Now a subcommand |

## Testing

After deployment, test the following:
1. `/upcoming` - Verify event display works
2. `/predict` - Test prediction generation
3. `/model type:gpt` - Test model switching
4. `/stats` - Verify statistics display
5. `/checkstats fighter:TestFighter` - Test fighter stats
6. `/admin advance` - Test admin functionality (admin only)

## Troubleshooting

### Commands Not Appearing
- Run `npm run deploy-commands` to register slash commands
- Wait up to 1 hour for global commands to propagate
- Check bot has `applications.commands` permission

### Permission Errors
- Ensure bot has proper permissions in the server
- Admin commands only work in authorized servers
- Check user has required permissions for admin commands

### Functionality Issues
- Verify all environment variables are set
- Check bot logs for specific error messages
- Ensure database is accessible and up to date
