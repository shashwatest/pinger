# WhatsApp & Telegram Personal Assistant Bot

A minimal personal assistant that runs locally and responds only to trigger-word messages on both WhatsApp and Telegram.

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

All commands must start with your trigger word (default: `!triggerBotHelp`)

### Basic Chat
- `!triggerBotHelp how are you?` - Normal conversation

### Memory Management
- `!triggerBotHelp save to memory that I am learning coding`
- `!triggerBotHelp save next to memory` - Saves your next message
- Memories are shared between WhatsApp and Telegram

### Reminders
- `!triggerBotHelp remind me to call Alex at 5pm`
- `!triggerBotHelp remind me to attend meeting tomorrow at 10am`
- `!triggerBotHelp remind me about project on 6th of October at 3pm`
- Reminders work across both platforms

### Debug
- `!triggerBotHelp !dbg status` - Shows bot status

## Features

- ✅ Works on both WhatsApp and Telegram
- ✅ Shared memory and reminders across platforms
- ✅ Trigger-word based responses
- ✅ Persistent memory storage
- ✅ Scheduled reminders with date support
- ✅ Chat context awareness
- ✅ Local data storage (JSON files)

## Files Created
- `saved_memories.json` - Shared memories from both platforms
- `reminders.json` - Shared reminders for both platforms
- `chat_history.json` - Conversation history
- `mem_media/` - Downloaded media from memories (WhatsApp only)