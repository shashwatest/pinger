const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const cron = require('node-cron');
const sharedUtils = require('./shared-utils');

// Load environment variables
require('dotenv').config();

const TRIGGER_WORD = process.env.TRIGGER_WORD || '!triggerBotHelp';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Local state
let saveNextMode = {};
let pendingNotifications = [];

// Your chat ID for responses
const MY_CHAT_ID = '918227967496@c.us';
const MY_TELEGRAM_CHAT_ID = process.env.MY_TELEGRAM_CHAT_ID;

// Unique bot message identifier to prevent processing own messages
const BOT_MESSAGE_PREFIX = 'ShashBot:';

// Telegram bot for cross-platform notifications
let telegramBot = null;
try {
    const TelegramBot = require('node-telegram-bot-api');
    if (process.env.TELEGRAM_BOT_TOKEN) {
        telegramBot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN);
    }
} catch (error) {
    console.log('Telegram not available for notifications');
}

// Initialize client
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: { headless: true }
});





// QR code for authentication
client.on('qr', (qr) => {
    console.log('Scan this QR code with WhatsApp:');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('WhatsApp bot is ready!');
    sharedUtils.loadData();
    sharedUtils.scheduleExistingReminders(sendReminderNotification, (r) => !r.chatId.startsWith('telegram_'));
    sharedUtils.setupDailySummary(sendDailySummary);
    sharedUtils.setupPeriodicReminderCheck(sendReminderNotification, (r) => !r.chatId.startsWith('telegram_'));
});

// Send daily summary
async function sendDailySummary() {
    const summary = sharedUtils.generateDailySummary();
    await sendToMyChat(summary);
}

// Listen for outgoing messages
client.on('message_create', async (message) => {
    if (message.fromMe) {
        await client.emit('message', message);
    }
});

// Unified message handler for both incoming and outgoing messages
client.on('message', async (message) => {
    if (message.from === 'status@broadcast') return;
    
    const chatId = message.fromMe ? (message.to || message.from) : message.from;
    const messageBody = message.body;
    
    console.log(`${message.fromMe ? 'Sent' : 'Received'} message ${message.fromMe ? 'to' : 'from'} ${chatId}: "${messageBody}"`);
    
    // Check contact processing rules
    const contactInfo = sharedUtils.shouldProcessContact(chatId);
    if (!contactInfo.process) {
        console.log(`Ignoring message from ${chatId}: ${contactInfo.reason}`);
        return;
    }
    
    sharedUtils.addToHistory(chatId, 'user', messageBody);
    
    // Process ALL messages for auto-categorization
    // Skip bot's own messages and messages with trigger word
    if (!messageBody.startsWith(BOT_MESSAGE_PREFIX) && 
        (!message.fromMe || (message.fromMe && !messageBody.startsWith(TRIGGER_WORD)))) {
        console.log(`Processing message for auto-categorization from ${chatId} (fromMe: ${message.fromMe})`);
        await processIncomingMessage(message, messageBody, chatId, contactInfo);
    }
    
    // Only respond if trigger word is used
    if (!messageBody.startsWith(TRIGGER_WORD)) {
        return;
    }
    
    const command = messageBody.substring(TRIGGER_WORD.length).trim();
    
    try {
        if (command === 'test' || command === '') {
            await sendToMyChat('🤖 Bot is working! Trigger word: ' + TRIGGER_WORD);
            return;
        }
        
        if (command === '!dbg status') {
            const memories = sharedUtils.getMemories();
            const reminders = sharedUtils.getReminders();
            const importantUpdates = sharedUtils.getImportantUpdates();
            const chatHistory = sharedUtils.getChatHistory();
            const contacts = sharedUtils.getContactLists();
            const activeRemindersCount = reminders.filter(r => r.active).length;
            const status = `📊 Bot Status:
            • Memories: ${memories.length}
            • Active reminders: ${activeRemindersCount}
            • Important updates: ${importantUpdates.length}
            • Blocked contacts: ${contacts.blocked.length}
            • Priority contacts: ${contacts.priority.length}
            • Chat history: ${chatHistory[chatId]?.length || 0} messages`;
            await sendToMyChat(status);
            return;
        }
        
        // Check for direct commands first
        if (command.startsWith('block ')) {
            await handleDirectBlock(command);
            return;
        }
        
        if (command.startsWith('unblock ')) {
            await handleDirectUnblock(command);
            return;
        }
        
        if (command.startsWith('add priority ')) {
            await handleDirectAddPriority(command);
            return;
        }
        
        if (command.startsWith('remove priority ')) {
            await handleDirectRemovePriority(command);
            return;
        }
        
        const interpretedAction = await sharedUtils.interpretCommand(command, GEMINI_API_KEY);
        
        if (interpretedAction) {
            await executeAction(interpretedAction, command);
        } else {
            const response = await sharedUtils.getAIResponse(chatId, command, GEMINI_API_KEY);
            await sendToMyChat(response);
            sharedUtils.addToHistory(MY_CHAT_ID, 'assistant', response);
        }
        
    } catch (error) {
        console.error('Error processing message:', error);
        await sendToMyChat('❌ Sorry, something went wrong');
    }
});

// Helper function to send responses only to my chat
async function sendToMyChat(text) {
    try {
        const myChat = await client.getChatById(MY_CHAT_ID);
        await myChat.sendMessage(BOT_MESSAGE_PREFIX + ' ' + text);
    } catch (error) {
        console.error('Error sending to my chat:', error);
    }
}

// Process incoming messages for auto-categorization
async function processIncomingMessage(message, messageBody, chatId, contactInfo) {
    try {
        // Apply contact-specific rules
        const ruleResult = sharedUtils.applyContactRules(messageBody, contactInfo);
        if (!ruleResult.processMessage) {
            console.log(`Message ignored due to contact rules: ${ruleResult.modifications.join(', ')}`);
            return;
        }
        
        console.log(`Attempting to categorize message: "${messageBody.substring(0, 50)}..."`);
        const categorization = await categorizeMessage(messageBody, chatId);
        
        if (categorization) {
            // Apply contact priority to categorization
            if (contactInfo.priority === 'HIGH') {
                categorization.priority = 'HIGH';
            }
            
            console.log(`Message categorized as: ${categorization.type} with priority: ${categorization.priority}`);
            
            switch (categorization.type) {
                case 'REMINDER':
                    await autoCreateReminder(categorization, chatId);
                    console.log('Auto-created reminder');
                    break;
                case 'MEMORY':
                    await autoSaveMemory(categorization, chatId);
                    console.log('Auto-saved memory');
                    break;
                case 'IMPORTANT':
                    await saveImportantUpdate(categorization, chatId);
                    console.log('Saved important update');
                    break;
            }
            
            // Send immediate notification for high priority or priority contacts
            if (categorization.priority === 'HIGH' || contactInfo.priority === 'HIGH') {
                const contactName = contactInfo.name ? ` (${contactInfo.name})` : '';
                await sendToMyChat(`🚨 High Priority: ${categorization.content} (from ${chatId}${contactName})`);
            }
        } else {
            console.log('Message not categorized (returned null)');
        }
    } catch (error) {
        console.error('Error processing incoming message:', error);
    }
}

// Save memory function
async function saveMemory(message, content) {
    const memory = {
        content: content,
        timestamp: new Date().toLocaleString(),
        chatId: message.from
    };
    
    sharedUtils.addMemory(memory);
    await message.reply('✅ Saved to memory: ' + content);
    
    // Send immediate notification
    await sharedUtils.sendImmediateNotification('MEMORY', content, message.from, telegramBot, MY_TELEGRAM_CHAT_ID);
}









// Send reminder notification to Telegram only
async function sendReminderNotification(message) {
    try {
        // Send to Telegram only
        if (telegramBot && MY_TELEGRAM_CHAT_ID) {
            await telegramBot.sendMessage(MY_TELEGRAM_CHAT_ID, message);
        }
    } catch (error) {
        console.error('Error sending reminder notification:', error);
    }
}



// Categorize incoming messages using Gemini
async function categorizeMessage(messageBody, fromChatId) {
    if (!GEMINI_API_KEY || GEMINI_API_KEY === 'your_gemini_api_key_here') {
        console.log('Gemini API key not configured, skipping categorization');
        return null;
    }
    
    console.log('Sending message to Gemini for categorization...');
    
    const categorizePrompt = `Analyze this message and categorize it. Return JSON format:

        {
        "type": "REMINDER|MEMORY|IMPORTANT|NONE",
        "priority": "HIGH|MEDIUM|LOW",
        "content": "formatted for whatsapp and briefly summarised extracted content ensuring easy readability",
        "datetime": "exact date/time as mentioned in message, null if no date/time"
        }

        Rules:
        - MEMORY: containing information about birthdays, anniversaries or containing the keyword "!memory". and strcitly nothing else should be categorized as memory.
        - REMINDER: Contains time/date references with tasks to do (and not birthdays or anniversaries) or containing the keyword "!reminder"
        - IMPORTANT: Urgent info, updates, news or containing the keyword "!important"
        - HIGH priority: Urgent, time-sensitive, emergency
        - MEDIUM priority: Important but not urgent
        - LOW priority: General info
        - For datetime: Extract EXACTLY as written (e.g. "tomorrow at 3pm", "21st September 2025", "10am")

        Message: "${messageBody}"

        Return only valid JSON:`;
    
    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: categorizePrompt }] }]
            })
        });
        
        if (!response.ok) return null;
        
        const data = await response.json();
        let rawResult = data.candidates[0].content.parts[0].text.trim();
        console.log('Gemini response:', rawResult);
        
        // Remove markdown code blocks if present
        if (rawResult.startsWith('```json')) {
            rawResult = rawResult.replace(/```json\s*/, '').replace(/\s*```$/, '');
        }
        
        const result = JSON.parse(rawResult);
        console.log('Parsed result:', result);
        
        return result.type === 'NONE' ? null : result;
    } catch (error) {
        console.error('Error categorizing message:', error);
        return null;
    }
}



// Auto-create reminder from categorized message
async function autoCreateReminder(categorization, fromChatId) {
    const reminder = {
        id: Date.now(),
        task: categorization.content,
        createdAt: new Date().toISOString(),
        originalDateTime: categorization.datetime,
        targetDateTime: null,
        chatId: fromChatId,
        active: true,
        priority: categorization.priority,
        autoCreated: true
    };
    
    // Calculate target datetime using Gemini
    const calculatedReminder = await sharedUtils.calculateTargetDateTime(reminder, GEMINI_API_KEY);
    
    console.log('Creating reminder:', calculatedReminder);
    sharedUtils.addReminder(calculatedReminder);
    
    if (calculatedReminder.targetDateTime) {
        sharedUtils.scheduleMultiStageReminder(calculatedReminder, sendReminderNotification);
    }
    
    console.log('Reminder saved, total reminders:', sharedUtils.getReminders().length);
    
    // Send immediate notification
    await sharedUtils.sendImmediateNotification('REMINDER', calculatedReminder.task, fromChatId, telegramBot, MY_TELEGRAM_CHAT_ID);
}

// Auto-save memory from categorized message
async function autoSaveMemory(categorization, fromChatId) {
    const memory = {
        content: categorization.content,
        timestamp: new Date().toLocaleString(),
        chatId: fromChatId,
        priority: categorization.priority,
        autoCreated: true
    };
    
    sharedUtils.addMemory(memory);
    
    // Send immediate notification
    await sharedUtils.sendImmediateNotification('MEMORY', memory.content, fromChatId, telegramBot, MY_TELEGRAM_CHAT_ID);
}

// Save important update
async function saveImportantUpdate(categorization, fromChatId) {
    const update = {
        id: Date.now(),
        content: categorization.content,
        timestamp: new Date().toLocaleString(),
        chatId: fromChatId,
        priority: categorization.priority,
        read: false
    };
    
    sharedUtils.addImportantUpdate(update);
    
    // Send immediate notification
    await sharedUtils.sendImmediateNotification('IMPORTANT', update.content, fromChatId, telegramBot, MY_TELEGRAM_CHAT_ID);
}



// Execute action for messages
async function executeAction(action, command) {
    if (['CANCEL_REMINDER', 'DELETE_MEMORY', 'SAVE_MEMORY', 'SET_REMINDER', 'BLOCK_CONTACT', 'UNBLOCK_CONTACT'].includes(action)) {
        // Handle actions that need special WhatsApp-specific logic
        switch (action) {
            case 'CANCEL_REMINDER':
                await sharedUtils.handleCancelReminder(command, sendToMyChat);
                break;
            case 'DELETE_MEMORY':
                await sharedUtils.handleDeleteMemory(command, sendToMyChat);
                break;
            case 'SAVE_MEMORY':
                await sharedUtils.handleSaveMemory(command, MY_CHAT_ID, sendToMyChat, telegramBot, MY_TELEGRAM_CHAT_ID);
                break;
            case 'SET_REMINDER':
                await sharedUtils.createReminder(command, MY_CHAT_ID, GEMINI_API_KEY, sendReminderNotification, sendToMyChat, telegramBot, MY_TELEGRAM_CHAT_ID);
                break;
            case 'BLOCK_CONTACT':
                await handleBlockContact(command);
                break;
            case 'UNBLOCK_CONTACT':
                await handleUnblockContact(command);
                break;
        }
    } else {
        // Use shared execution for display actions
        await sharedUtils.executeAction(action, command, sendToMyChat);
    }
}







// Handle block contact
async function handleBlockContact(command) {
    const match = command.match(/block\s+contact\s+(.+)/i);
    if (!match) {
        await sendToMyChat('❌ Use: "block contact [chat_id] [reason]"');
        return;
    }
    
    const parts = match[1].split(' ');
    const chatId = parts[0];
    const reason = parts.slice(1).join(' ') || 'Manual block';
    
    sharedUtils.addBlockedContact(chatId, reason);
    await sendToMyChat(`✅ Blocked contact: ${chatId}`);
}

// Handle unblock contact
async function handleUnblockContact(command) {
    const match = command.match(/unblock\s+contact\s+(.+)/i);
    if (!match) {
        await sendToMyChat('❌ Use: "unblock contact [chat_id]"');
        return;
    }
    
    const chatId = match[1].trim();
    const removed = sharedUtils.removeBlockedContact(chatId);
    
    if (removed) {
        await sendToMyChat(`✅ Unblocked contact: ${chatId}`);
    } else {
        await sendToMyChat(`❌ Contact not found in blocked list: ${chatId}`);
    }
}

// Direct block command
async function handleDirectBlock(command) {
    const input = command.replace('block ', '').trim();
    if (!input) {
        await sendToMyChat('❌ Use: "block [phone_number/chat_id] [reason]"');
        return;
    }
    
    const parts = input.split(' ');
    const identifier = parts[0];
    const reason = parts.slice(1).join(' ') || 'Manual block';
    
    const chatId = sharedUtils.phoneToWhatsAppId(identifier);
    sharedUtils.addBlockedContact(chatId, reason);
    await sendToMyChat(`✅ Blocked: ${identifier} -> ${chatId}`);
}

// Direct unblock command
async function handleDirectUnblock(command) {
    const input = command.replace('unblock ', '').trim();
    if (!input) {
        await sendToMyChat('❌ Use: "unblock [phone_number/chat_id]"');
        return;
    }
    
    const chatId = sharedUtils.phoneToWhatsAppId(input);
    const removed = sharedUtils.removeBlockedContact(chatId);
    
    if (removed) {
        await sendToMyChat(`✅ Unblocked: ${input} -> ${chatId}`);
    } else {
        await sendToMyChat(`❌ Not found in blocked list: ${chatId}`);
    }
}

// Direct add priority command
async function handleDirectAddPriority(command) {
    const input = command.replace('add priority ', '').trim();
    const parts = input.split(' ');
    
    if (parts.length < 2) {
        await sendToMyChat('❌ Use: "add priority [phone/chatId] [name] [keywords]"\nExample: "add priority 9876543210 Vipul bhaiya,urgent"');
        return;
    }
    
    const identifier = parts[0];
    const name = parts[1];
    const keywords = parts.slice(2).join(' ').split(',').map(k => k.trim()).filter(k => k);
    
    const chatId = sharedUtils.phoneToWhatsAppId(identifier);
    const rules = keywords.length > 0 ? [{ type: 'ONLY_KEYWORDS', keywords }] : [];
    
    sharedUtils.addPriorityContact(chatId, 'HIGH', rules, name);
    await sendToMyChat(`✅ Added priority contact: ${name} (${chatId})\nKeywords: ${keywords.join(', ') || 'All messages'}`);
}

// Direct remove priority command
async function handleDirectRemovePriority(command) {
    const input = command.replace('remove priority ', '').trim();
    if (!input) {
        await sendToMyChat('❌ Use: "remove priority [phone_number/chat_id]"');
        return;
    }
    
    const chatId = sharedUtils.phoneToWhatsAppId(input);
    const removed = sharedUtils.removePriorityContact(chatId);
    
    if (removed) {
        await sendToMyChat(`✅ Removed priority contact: ${removed.name || chatId}`);
    } else {
        await sendToMyChat(`❌ Not found in priority list: ${chatId}`);
    }
}

// Start the client
client.initialize();

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\nShutting down WhatsApp bot...');
    process.exit(0);
});