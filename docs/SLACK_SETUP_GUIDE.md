# HearWise Slack Integration Setup Guide

## Your Existing Slack App Credentials

- **App ID**: `your_slack_app_id`
- **Client ID**: `your_slack_client_id`

## Configuration Audit

### Required OAuth Scopes

Add these scopes to your Slack App in the "OAuth & Permissions" section:

#### Bot Token Scopes
- `chat:write` - Send messages to channels and DMs
- `chat:write.public` - Post messages in channels the bot isn't a member of
- `im:write` - Send direct messages to users
- `im:history` - Read message history in DMs
- `channels:history` - Read message history in channels
- `groups:history` - Read message history in private channels
- `mpim:history` - Read message history in group DMs
- `users:read` - Read user information
- `users:read.email` - Read user email addresses
- `commands` - Handle slash commands

#### User Token Scopes (if needed for user-level actions)
- `chat:write`
- `im:write`
- `channels:write`

### Required Bot Permissions

In the "OAuth & Permissions" section, ensure these bot permissions are enabled:

- **Send messages as HearWise**
- **Post messages in channels**
- **Send direct messages**
- **Read messages in public channels**
- **Read messages in private channels**
- **Read message history**
- **Add reactions**
- **Use slash commands**

### Required Event Subscriptions

In the "Event Subscriptions" section, enable these events:

#### Bot Events
- `app_mention` - When the bot is mentioned (@HearWise)
- `message.channels` - Messages in public channels
- `message.groups` - Messages in private channels
- `message.im` - Direct messages to the bot
- `message.mpim` - Messages in group DMs
- `huddle_space_created` - When a Slack Huddle starts (for live monitoring)
- `huddle_space_deleted` - When a Slack Huddle ends (for live monitoring)
- `call_started` - When a Slack Call starts (for live monitoring)
- `call_ended` - When a Slack Call ends (for live monitoring)

#### Workspace Events
- `team_join` - When a new user joins the workspace

### Required Slash Commands

In the "Slash Commands" section, create these commands:

| Command | Description | Usage Hint |
|---------|-------------|------------|
| `/hearwise` | Main HearWise command | Get your hearing health overview |
| `/hearwise risk` | Get current risk assessment | View your hearing risk score |
| `/hearwise summary` | Get daily/weekly summary | View your listening summary |

### Socket Mode Configuration

Since you're using Socket Mode (recommended for development):

1. Go to "Basic Information" > "App-Level Tokens"
2. Create a new app-level token with scope `connections:write`
3. Save the token as `SLACK_APP_LEVEL_TOKEN`
4. Enable Socket Mode in "Basic Information" > "Socket Mode"

### Environment Variables Required

Create a `.env` file in your project root:

```env
SLACK_APP_ID=your_slack_app_id
SLACK_CLIENT_ID=your_slack_client_id
SLACK_CLIENT_SECRET=your_client_secret_from_slack
SLACK_SIGNING_SECRET=your_signing_secret_from_slack
SLACK_APP_LEVEL_TOKEN=xapp-your-app-level-token
PORT=3000
```

### Configuration Changes Required

1. **OAuth & Permissions**:
   - Add all required bot scopes listed above
   - Add all required bot permissions
   - Save and reinstall the app to your workspace

2. **Event Subscriptions**:
   - Enable Socket Mode (recommended) or provide a Request URL
   - Subscribe to all required events
   - Save changes

3. **Slash Commands**:
   - Create `/hearwise` command
   - Create `/hearwise risk` command
   - Create `/hearwise summary` command
   - Set Request URL to your server endpoint (e.g., `http://localhost:3000/slack/events`)

4. **Basic Information**:
   - Enable Socket Mode (if using Socket Mode)
   - Create app-level token with `connections:write` scope

5. **Install App**:
   - After making changes, reinstall the app to your workspace
   - Save the Bot User OAuth Token (starts with `xoxb-`)

### Missing Configuration Checklist

Based on typical Slack App configurations, you likely need to add:

- [ ] Bot scopes: `chat:write`, `im:write`, `im:history`, `commands`, `users:read`
- [ ] Bot permissions: Send messages, DM users, Read messages
- [ ] Event subscriptions: `app_mention`, `message.im`, `message.channels`
- [ ] Slash commands: `/hearwise`, `/hearwise risk`, `/hearwise summary`
- [ ] Socket Mode enabled with app-level token
- [ ] App reinstalled to workspace after configuration changes

### Verification Steps

Once configured, verify:

1. **Bot is installed**: Check "Install App" section shows your workspace
2. **Bot has permissions**: Bot token has required scopes
3. **Socket Mode is enabled**: Socket Mode toggle is on
4. **Slash commands are created**: All three commands listed
5. **Events are subscribed**: Required events are enabled

### Next Steps

1. Update your Slack App configuration with the items above
2. Reinstall the app to your workspace
3. Provide the following credentials for the backend:
   - Client Secret (from "OAuth & Permissions")
   - Signing Secret (from "Basic Information")
   - Bot User OAuth Token (from "OAuth & Permissions" after reinstall)
   - App-Level Token (from "Basic Information" > "App-Level Tokens")

4. Run the backend server
5. Test with the `/hearwise` command in Slack
