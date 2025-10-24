# ShashBot - WhatsApp & Telegram Personal Assistant

An intelligent personal assistant named ShashBot that runs locally with AI-powered auto-categorization, smart notifications, and multi-stage reminders across WhatsApp and Telegram platforms. Features both cloud-based (Gemini) and local (Ollama) AI processing options.

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

3. **Choose AI Processing Option:**

   **Option A: Cloud-based (Gemini)**
   - Get a free Gemini API key from [Google AI Studio](https://makersuite.google.com/app/apikey)
   - Configure in `.env`:
     ```
     GEMINI_API_KEY=your_actual_gemini_api_key_here
     ```

   **Option B: Local AI (Ollama)**
   - Install Ollama from [https://ollama.com](https://ollama.com)
   - Pull the required model:
     ```bash
     ollama pull llama2
     ```
   - Configure in `.env`:
     ```
     OLLAMA_API_URL=http://localhost:11434
     OLLAMA_MODEL=llama2
     ```

4. Configure your bot settings in `.env`:
   ```
   TRIGGER_WORD=!triggerBotHelp
   TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here
   MY_TELEGRAM_CHAT_ID=your_telegram_chat_id
   MY_WHATSAPP_NUMBER=your_whatsapp_number
   MY_BOT_NAME=ShashBot
   ```

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
1. **Auto-Categorization**: Every message is analyzed by AI for automatic extraction of reminders, memories, and important updates
2. **Manual Commands**: Trigger-word commands for explicit actions and conversations

## Usage

### WhatsApp Commands (Trigger Word Required)
All commands must start with `!triggerBotHelp`:

**Basic Commands:**
- `!triggerBotHelp how are you?` - Chat with ShashBot
- `!triggerBotHelp save to memory that I prefer tea over coffee`
- `!triggerBotHelp remind me to call mom at 6pm tomorrow`
- `!triggerBotHelp show memories` - View saved memories
- `!triggerBotHelp show reminders` - View active reminders
- `!triggerBotHelp show schedule` - View today's schedule
- `!triggerBotHelp !dbg status` - Bot status and statistics

**Contact Management:**
- `!triggerBotHelp block 9876543210 spam messages` - Block contact by phone
- `!triggerBotHelp unblock 9876543210` - Unblock contact
- `!triggerBotHelp add priority 9876543210 Vipul bhaiya,urgent` - Add priority contact with keywords
- `!triggerBotHelp remove priority 9876543210` - Remove priority contact
- `!triggerBotHelp show blocked` - View blocked contacts
- `!triggerBotHelp show priority` - View priority contacts

### Telegram Commands (No Trigger Word)
Direct commands without any prefix:

**Basic Commands:**
- `how are you?` - Chat with ShashBot
- `save to memory that I work at Google`
- `remind me about the meeting tomorrow at 10am`
- `show memories` - View saved memories
- `show reminders` - View active reminders
- `show schedule` - View today's schedule
- `status` - Bot status and statistics

**Contact Management:**
- `block 9876543210 annoying` - Block contact by phone
- `unblock 9876543210` - Unblock contact
- `add priority 9876543210 Boss urgent,emergency` - Add priority contact with keywords
- `remove priority 9876543210` - Remove priority contact
- `show blocked` - View blocked contacts
- `show priority` - View priority contacts

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

**Schedule Items:**
- "Gym session today evening" → Auto-adds to schedule
- "Dentist appointment tomorrow" → Auto-adds to schedule
- "Team meeting at 3pm today" → Auto-adds to schedule

## Key Features

### 🤖 AI-Powered Intelligence
- **Dual AI Support**: Choose between cloud-based Gemini or local Ollama processing
- **Smart Categorization**: Automatically identifies reminders, memories, and schedule items
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

### 🛡️ Contact Management System
- **Blocked Contacts**: Completely ignore messages from specific contacts
- **Priority Contacts**: VIP treatment with enhanced notifications
- **Keyword Filtering**: Process only messages containing specific words
- **Phone Number Support**: Easy blocking using phone numbers (auto-converts to chat IDs)
- **Cross-Platform**: Contact rules work across WhatsApp and Telegram

### 📊 Advanced Features
- **Daily Summary**: Automatic summary at 9 PM with today's reminders and updates
- **Morning Schedule**: Daily schedule overview at 7 AM
- **Real-Time Sync**: Changes reflect instantly across both platforms
- **Robust Error Handling**: Graceful fallbacks when AI services are unavailable
- **Debug Tools**: Comprehensive status and logging for troubleshooting

## Privacy & Security

### 🔒 Local Processing with Ollama
- **Complete Privacy**: All AI processing happens locally on your machine
- **No Data Transmission**: Messages never leave your device for AI processing
- **Offline Capability**: Works without internet connection once Ollama is set up
- **Full Control**: You own and control the AI model and all data

### 🛡️ General Privacy Features
- **Local Storage**: All data stored locally in JSON files
- **Contact Privacy**: Blocked/priority contact lists excluded from git
- **Secure Storage**: Personal information protected in local files
- **No Cloud Dependencies**: Optional cloud processing only if explicitly configured

## Example Use Cases

### Personal Productivity
- **Meeting Management**: "Team meeting tomorrow at 2pm" → Auto-creates reminder with notifications
- **Task Tracking**: "Submit project report by Friday" → Schedule item with priority
- **Memory Storage**: "My anniversary is on June 15th" → Auto-saves to memory

### Contact Management
- **VIP Handling**: Add boss as priority contact with "urgent" keyword filtering
- **Spam Blocking**: Block promotional numbers and newsletters
- **Family Priority**: Ensure family messages always get through with high priority

### Cross-Platform Workflow
- **Create on WhatsApp**: Set reminders while on the go
- **Manage on Telegram**: Review and organize all items from desktop
- **Unified Experience**: Seamless sync between platforms

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

## Contact Management

### Priority Contact Rules

**Rule Types:**
- `ONLY_KEYWORDS` - Process only messages containing specific keywords
- `IGNORE_KEYWORDS` - Skip messages with specific keywords
- `AUTO_CATEGORIZE` - Force messages into specific categories
- `NOTIFICATION_ONLY` - Send notifications but skip auto-processing

**Priority Levels:**
- `HIGH` - Immediate notifications, elevated processing
- `MEDIUM` - Normal processing (default)
- `LOW` - Lower priority processing

### Examples

**Block Spam Contact:**
```
!triggerBotHelp block 9876543210 sends spam
```

**Add VIP with Keyword Filter:**
```
!triggerBotHelp add priority 9876543210 Boss urgent,emergency
```
Only processes messages from Boss containing "urgent" OR "emergency"

**Add Family Member (All Messages):**
```
!triggerBotHelp add priority 9123456789 Mom
```
Processes ALL messages from Mom with HIGH priority

### Phone Number Auto-Conversion
- `9876543210` → `919876543210@c.us` (adds +91 for Indian numbers)
- `919876543210` → `919876543210@c.us` (adds WhatsApp suffix)
- `telegram_123456789` → `telegram_123456789` (keeps Telegram format)

## Files Created
- `saved_memories.json` - Shared memories from both platforms
- `reminders.json` - Enhanced reminders with full metadata
- `schedule.json` - Schedule items with datetime information
- `chat_history.json` - Conversation history for context
- `blocked_contacts.json` - List of blocked contacts with reasons
- `priority_contacts.json` - Priority contacts with custom rules
- `mem_media/` - Downloaded media from memories (WhatsApp only)

## Technical Architecture

### AI Processing Pipeline
1. **Contact Filtering**: Check if contact should be processed (blocked/priority rules)
2. **Rule Application**: Apply contact-specific processing rules
3. **Message Analysis**: AI analyzes qualifying messages (Gemini or Ollama)
4. **Smart Categorization**: Identifies type (reminder/memory/schedule/none)
5. **DateTime Calculation**: Converts natural language to precise timestamps
6. **Priority Assignment**: Automatic urgency detection + contact priority
7. **Cross-Platform Sync**: Real-time data synchronization

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
- **Contact Management**: Shared contact lists work across both platforms

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
- **Contact Validation**: Phone number auto-conversion with error handling
- **Logging**: Comprehensive debug information for troubleshooting