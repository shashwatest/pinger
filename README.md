# ShashBot - WhatsApp & Telegram Personal Assistant

An intelligent personal assistant named ShashBot that runs locally with AI-powered auto-categorization, smart notifications, and multi-stage reminders across WhatsApp and Telegram platforms.

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. **Get Telegram Bot Token:**
   - Open Telegram and search for `@BotFather`
   - Send `/newbot` and follow instructions
   - Choose a name (e.g., "ShashBot")
   - Choose a username ending in "bot" (e.g., "shashbot_personal_bot")
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

## How It Works

### WhatsApp Bot Behavior
- **Trigger-Word Only**: Responds ONLY when messages start with `!triggerBotHelp`
- **Silent Auto-Processing**: Automatically categorizes ALL messages but sends notifications only to Telegram
- **Manual Commands**: Full command support when using trigger word

### Telegram Bot Behavior  
- **No Trigger Word**: Processes all messages directly
- **Notification Hub**: Receives ALL notifications from both platforms
- **Full Functionality**: Complete access to all features without trigger words

### Dual Processing System
1. **Auto-Categorization**: Every message is analyzed by Gemini AI for automatic extraction of reminders, memories, and important updates
2. **Manual Commands**: Trigger-word commands for explicit actions and conversations

## Usage

### WhatsApp Commands (Trigger Word Required)
All commands must start with `!triggerBotHelp`:

- `!triggerBotHelp how are you?` - Chat with ShashBot
- `!triggerBotHelp save to memory that I prefer tea over coffee`
- `!triggerBotHelp remind me to call mom at 6pm tomorrow`
- `!triggerBotHelp show memories` - View saved memories
- `!triggerBotHelp show reminders` - View active reminders
- `!triggerBotHelp !dbg status` - Bot status and statistics

### Telegram Commands (No Trigger Word)
Direct commands without any prefix:

- `how are you?` - Chat with ShashBot
- `save to memory that I work at Google`
- `remind me about the meeting tomorrow at 10am`
- `show memories` - View saved memories
- `show reminders` - View active reminders
- `status` - Bot status and statistics

### Auto-Categorization (Both Platforms)
The bot automatically processes ALL messages using AI:

**Automatic Reminders:**
- "Meeting tomorrow at 3pm" → Auto-creates reminder
- "Call dentist at 2pm on Friday" → Auto-creates reminder
- "Project deadline next Monday" → Auto-creates reminder

**Automatic Memories:**
- "My birthday is March 15th" → Auto-saves to memory
- "I prefer working from home" → Auto-saves to memory
- "My favorite restaurant is Pizza Palace" → Auto-saves to memory

**Important Updates:**
- "Flight delayed by 2 hours" → Auto-categorized as important
- "Meeting cancelled" → Auto-categorized as important

## Key Features

### 🤖 AI-Powered Intelligence
- **Gemini Integration**: Uses Google Gemini 2.5 Flash for natural language processing
- **Smart Categorization**: Automatically identifies reminders, memories, and important updates
- **Intelligent DateTime Parsing**: Understands "tomorrow at 3pm", "next Friday", "in 2 hours"
- **Priority Detection**: Automatically assigns HIGH/MEDIUM/LOW priority levels

### ⏰ Multi-Stage Reminder System
- **3-Stage Notifications**: 1 hour before, 30 minutes before, and at event time
- **Telegram Delivery**: All reminder notifications sent to Telegram only
- **Natural Language**: Supports complex datetime expressions
- **Cross-Platform Creation**: Reminders created on either platform work seamlessly

### 📱 Smart Notification System
- **Telegram-Centric**: All auto-generated notifications go to Telegram only
- **WhatsApp Silence**: WhatsApp stays quiet unless trigger word is used
- **Immediate Alerts**: Instant notifications when new items are detected
- **Priority-Based**: High priority items get special attention

### 🧠 Unified Memory System
- **Cross-Platform Sync**: Memories shared between WhatsApp and Telegram
- **Auto-Detection**: Automatically captures personal information
- **Context Awareness**: Uses saved memories in conversations
- **Manual Management**: Add, view, and delete memories explicitly

### 📊 Advanced Features
- **Daily Summary**: Automatic summary at 9 PM with today's reminders and updates
- **Real-Time Sync**: Changes reflect instantly across both platforms
- **Robust Error Handling**: Graceful fallbacks when AI services are unavailable
- **Debug Tools**: Comprehensive status and logging for troubleshooting

## Data Structure

### Enhanced Reminder Format
```json
{
  "id": 1758407706387,
  "task": "cleaned task description",
  "createdAt": "2025-01-21T10:30:00.000Z",
  "originalDateTime": "original user text",
  "targetDateTime": "2025-01-22T15:00:00.000Z",
  "chatId": "source platform identifier",
  "active": true,
  "priority": "HIGH|MEDIUM|LOW",
  "autoCreated": true
}
```

## Files Created
- `saved_memories.json` - Shared memories from both platforms
- `reminders.json` - Enhanced reminders with full metadata
- `important_updates.json` - Auto-categorized important information
- `chat_history.json` - Conversation history for context
- `mem_media/` - Downloaded media from memories (WhatsApp only)

## Technical Architecture

### AI Processing Pipeline
1. **Message Analysis**: Gemini analyzes every incoming message
2. **Smart Categorization**: Identifies type (reminder/memory/important/none)
3. **DateTime Calculation**: Converts natural language to precise timestamps
4. **Priority Assignment**: Automatic urgency detection based on content
5. **Cross-Platform Sync**: Real-time data synchronization

### Supported DateTime Formats
- "tomorrow at 3pm" → Next day at 15:00
- "next Friday at 10am" → Following Friday at 10:00
- "in 2 hours" → Current time + 2 hours
- "21st September 2025" → Specific date
- "10am" → Today or tomorrow at 10:00 (smart detection)

### Bot Identification System
- **WhatsApp**: Uses `ShashBot:` prefix to prevent processing own messages
- **Telegram**: Built-in message filtering prevents infinite loops
- **Cross-Platform**: Unique identifiers prevent duplicate processing

## Personality & Behavior

ShashBot is designed as Suman Verma's AI friend with these characteristics:
- **Name Origin**: Bengali pronunciation of "Shashwat" (eternal)
- **Personality**: Friendly, human-like responses rather than formal assistant tone
- **Adaptability**: Adjusts response detail based on query complexity
- **Memory Integration**: Uses personal memories to provide contextual responses

## Error Handling & Reliability

- **Graceful Degradation**: Works even when AI services are temporarily unavailable
- **JSON Validation**: Robust parsing with automatic cleanup
- **Cross-Platform Recovery**: Independent operation if one platform fails
- **Data Persistence**: Automatic saving and loading of all data
- **Logging**: Comprehensive debug information for troubleshooting