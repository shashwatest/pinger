# WhatsApp & Telegram Personal Assistant Bot

An intelligent personal assistant that runs locally with AI-powered auto-categorization, cross-platform notifications, and multi-stage reminders on both WhatsApp and Telegram.

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. **Get Telegram Bot Token:**
   - Open Telegram and search for `@BotFather`
   - Send `/newbot` and follow instructions
   - Choose a name (e.g., "My Personal Assistant")
   - Choose a username ending in "bot" (e.g., "mypersonalassistant_bot")
   - Copy the token you receive

3. Configure your API keys in `.env`:
   ```
   TRIGGER_WORD=!triggerBotHelp
   GEMINI_API_KEY=your_actual_gemini_api_key_here
   TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here
   MY_TELEGRAM_CHAT_ID=your_telegram_chat_id
   ```

4. Get a free Gemini API key from [Google AI Studio](https://makersuite.google.com/app/apikey)

5. Run the bots:
   ```bash
   # WhatsApp only
   npm start
   
   # Telegram only
   npm run telegram
   
   # Both together
   npm run both
   ```

6. For WhatsApp: Scan the QR code with WhatsApp on your phone
7. For Telegram: Search for your bot username and start a chat

## Usage

### Trigger-Word Commands
All manual commands must start with your trigger word (default: `!triggerBotHelp`)

- `!triggerBotHelp how are you?` - Normal conversation
- `!triggerBotHelp save to memory that I am learning coding`
- `!triggerBotHelp remind me to call Alex at 5pm`
- `!triggerBotHelp show memories` - View saved memories
- `!triggerBotHelp show reminders` - View active reminders
- `!triggerBotHelp !dbg status` - Shows bot status

### Auto-Categorization (No Trigger Word Needed)
The bot automatically processes ALL messages and categorizes them using AI:

**Automatic Reminders:**
- "Meeting tomorrow at 3pm" → Auto-creates reminder
- "Call mom at 6pm" → Auto-creates reminder
- "Deadline on Friday" → Auto-creates reminder

**Automatic Memories:**
- "I prefer coffee over tea" → Auto-saves to memory
- "My birthday is March 15th" → Auto-saves to memory
- "I work at Google" → Auto-saves to memory

**Important Updates:**
- "Flight delayed by 2 hours" → Auto-categorized as important
- "Meeting cancelled" → Auto-categorized as important

## Key Features

### 🤖 AI-Powered Intelligence
- **Gemini Integration**: Uses Google Gemini AI for natural language processing
- **Auto-Categorization**: Automatically identifies reminders, memories, and important updates
- **Smart DateTime Parsing**: Understands "tomorrow at 3pm", "next Friday", "in 2 hours"
- **Priority Detection**: Automatically assigns HIGH/MEDIUM/LOW priority levels

### ⏰ Multi-Stage Reminders
- **3-Stage Notifications**: 1 hour before, 30 minutes before, and at event time
- **Cross-Platform Delivery**: All reminders sent to both WhatsApp and Telegram
- **Natural Language**: "remind me to call Alex tomorrow at 5pm"
- **Automatic Scheduling**: Auto-created reminders from regular messages

### 📱 Cross-Platform Sync
- **Shared Data**: All memories, reminders, and updates sync between platforms
- **Instant Notifications**: Immediate alerts when new items are created
- **Real-Time Updates**: Changes reflect instantly across both bots

### 🧠 Memory Management
- **Persistent Storage**: Remembers personal preferences and information
- **Auto-Save**: Automatically captures important personal details
- **Context Awareness**: Uses saved memories in conversations

### 🔔 Notification System
- **Immediate Alerts**: Instant notifications for all new items
- **Priority-Based**: High priority items get special attention
- **Cross-Platform**: Notifications sent to both WhatsApp and Telegram simultaneously

## Data Structure

### Reminders Format
```json
{
  "id": 1758407706387,
  "task": "cleaned task description",
  "createdAt": "2025-09-20T22:35:06.387Z",
  "originalDateTime": "original user text",
  "targetDateTime": "2025-09-21T23:59:59Z",
  "chatId": "source platform",
  "active": true,
  "priority": "HIGH|MEDIUM|LOW",
  "autoCreated": true
}
```

## Files Created
- `saved_memories.json` - Shared memories from both platforms
- `reminders.json` - Shared reminders with enhanced metadata
- `important_updates.json` - Auto-categorized important information
- `chat_history.json` - Conversation history for context
- `mem_media/` - Downloaded media from memories (WhatsApp only)

## Advanced Features

### Daily Summary
- Automatic daily summary at 9 PM
- Shows today's reminders, unread updates, and new memories

### Debug Commands
- `!triggerBotHelp !dbg status` - Bot status and statistics
- Real-time logging for troubleshooting

### Error Handling
- Graceful fallbacks when AI services are unavailable
- Robust JSON parsing with cleanup
- Cross-platform error recovery

## Technical Details

### AI Processing Pipeline
1. **Message Categorization**: Gemini analyzes all incoming messages
2. **DateTime Calculation**: AI converts natural language to ISO timestamps
3. **Priority Assignment**: Automatic urgency detection
4. **Cross-Platform Sync**: Real-time data synchronization

### Supported DateTime Formats
- "tomorrow at 3pm"
- "next Friday at 10am"
- "in 2 hours"
- "21st September 2025"
- "10am" (assumes today/tomorrow)

### Bot Message Identification
- Uses unique prefix `🤖QBOT_MSG_X7Y9Z2:` to prevent processing own messages
- Prevents infinite loops and duplicate processing