const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');

// Load environment variables
require('dotenv').config();

const TRIGGER_WORD = process.env.TRIGGER_WORD || '!triggerBotHelp';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const LOCAL_LLM_URL = process.env.LOCAL_LLM_URL;

// Data storage
let memories = [];
let reminders = [];
let chatHistory = {};
let saveNextMode = {};
let importantUpdates = [];
let pendingNotifications = [];

// Your chat ID for responses
const MY_CHAT_ID = '918227967496@c.us';
const MY_TELEGRAM_CHAT_ID = process.env.MY_TELEGRAM_CHAT_ID;

// Unique bot message identifier to prevent processing own messages
const BOT_MESSAGE_PREFIX = '🤖QBOT_MSG_X7Y9Z2:';

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



// Load data on startup
function loadData() {
    try {
        if (fs.existsSync('saved_memories.json')) {
            memories = JSON.parse(fs.readFileSync('saved_memories.json', 'utf8'));
        }
        if (fs.existsSync('reminders.json')) {
            reminders = JSON.parse(fs.readFileSync('reminders.json', 'utf8'));
            scheduleExistingReminders();
        }
        if (fs.existsSync('chat_history.json')) {
            chatHistory = JSON.parse(fs.readFileSync('chat_history.json', 'utf8'));
        }
        if (fs.existsSync('important_updates.json')) {
            importantUpdates = JSON.parse(fs.readFileSync('important_updates.json', 'utf8'));
        }
    } catch (error) {
        console.log('Error loading data:', error.message);
    }
}

// Save data
function saveData() {
    fs.writeFileSync('saved_memories.json', JSON.stringify(memories, null, 2));
    fs.writeFileSync('reminders.json', JSON.stringify(reminders, null, 2));
    fs.writeFileSync('chat_history.json', JSON.stringify(chatHistory, null, 2));
    fs.writeFileSync('important_updates.json', JSON.stringify(importantUpdates, null, 2));
}

// QR code for authentication
client.on('qr', (qr) => {
    console.log('Scan this QR code with WhatsApp:');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('WhatsApp bot is ready!');
    loadData();
    setupDailySummary();
});

// Setup daily summary at 9 PM
function setupDailySummary() {
    cron.schedule('0 21 * * *', async () => {
        await sendDailySummary();
    });
}

// Send daily summary
async function sendDailySummary() {
    const today = new Date().toDateString();
    const todayReminders = reminders.filter(r => r.active && new Date(r.datetime).toDateString() === today);
    const unreadUpdates = importantUpdates.filter(u => !u.read);
    const recentMemories = memories.filter(m => new Date(m.timestamp).toDateString() === today);
    
    let summary = `🌆 Daily Summary - ${today}\n\n`;
    
    if (todayReminders.length > 0) {
        summary += `⏰ Today's Reminders (${todayReminders.length}):\n`;
        todayReminders.forEach((r, i) => {
            summary += `${i + 1}. ${r.task}\n`;
        });
        summary += '\n';
    }
    
    if (unreadUpdates.length > 0) {
        summary += `📰 Unread Updates (${unreadUpdates.length}):\n`;
        unreadUpdates.slice(0, 5).forEach((u, i) => {
            const priority = u.priority === 'HIGH' ? '🚨' : u.priority === 'MEDIUM' ? '🟡' : '🟢';
            summary += `${i + 1}. ${priority} ${u.content}\n`;
        });
        summary += '\n';
    }
    
    if (recentMemories.length > 0) {
        summary += `📝 New Memories (${recentMemories.length}):\n`;
        recentMemories.forEach((m, i) => {
            summary += `${i + 1}. ${m.content}\n`;
        });
    }
    
    if (todayReminders.length === 0 && unreadUpdates.length === 0 && recentMemories.length === 0) {
        summary += 'No new items today. Have a great evening! 🌙';
    }
    
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
    
    if (!chatHistory[chatId]) chatHistory[chatId] = [];
    
    chatHistory[chatId].push({ role: 'user', content: messageBody, timestamp: Date.now() });
    if (chatHistory[chatId].length > 20) {
        chatHistory[chatId] = chatHistory[chatId].slice(-20);
    }
    
    // Process ALL messages for auto-categorization
    // Skip bot's own messages and messages with trigger word
    if (!messageBody.startsWith(BOT_MESSAGE_PREFIX) && 
        (!message.fromMe || (message.fromMe && !messageBody.startsWith(TRIGGER_WORD)))) {
        console.log(`Processing message for auto-categorization from ${chatId} (fromMe: ${message.fromMe})`);
        await processIncomingMessage(message, messageBody, chatId);
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
            const activeRemindersCount = reminders.filter(r => r.active).length;
            const status = `📊 Bot Status:
• Memories: ${memories.length}
• Active reminders: ${activeRemindersCount}
• Important updates: ${importantUpdates.length}
• Chat history: ${chatHistory[chatId]?.length || 0} messages`;
            await sendToMyChat(status);
            return;
        }
        
        const interpretedAction = await interpretCommand(command);
        
        if (interpretedAction) {
            await executeAction(message, interpretedAction, command);
        } else {
            const response = await getAIResponse(chatId, command);
            await sendToMyChat(response);
            chatHistory[MY_CHAT_ID] = chatHistory[MY_CHAT_ID] || [];
            chatHistory[MY_CHAT_ID].push({ role: 'assistant', content: response, timestamp: Date.now() });
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
async function processIncomingMessage(message, messageBody, chatId) {
    try {
        console.log(`Attempting to categorize message: "${messageBody.substring(0, 50)}..."`);
        const categorization = await categorizeMessage(messageBody, chatId);
        
        if (categorization) {
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
            
            // Send immediate notification for high priority
            if (categorization.priority === 'HIGH') {
                await sendToMyChat(`🚨 High Priority: ${categorization.content} (from ${chatId})`);
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
    
    memories.push(memory);
    saveData();
    await message.reply('✅ Saved to memory: ' + content);
    
    // Send immediate notification
    await sendImmediateNotification('MEMORY', content, message.from);
}

// Schedule existing reminders on startup
function scheduleExistingReminders() {
    reminders.forEach(reminder => {
        if (reminder.active && !reminder.chatId.startsWith('telegram_')) {
            if (reminder.targetDateTime) {
                scheduleMultiStageReminder(reminder);
            }
        }
    });
}

// Get AI response
async function getAIResponse(chatId, userMessage) {
    const context = chatHistory[chatId] || [];
    const relevantMemories = memories.slice(-5);
    
    if (GEMINI_API_KEY && GEMINI_API_KEY !== 'your_gemini_api_key_here') {
        return await callGeminiAPI(userMessage, context, relevantMemories);
    } else {
        return `Hello! I received: "${userMessage}". Please configure GEMINI_API_KEY in .env for AI responses.`;
    }
}

// Call Gemini API
async function callGeminiAPI(userMessage, context = [], memories = []) {
    const systemPrompt = `You are a helpful personal assistant. Keep responses concise and friendly.`;
    
    let prompt = systemPrompt + '\n\n';
    
    if (memories.length > 0) {
        prompt += 'Relevant memories:\n' + memories.map(m => `- ${m.content}`).join('\n') + '\n\n';
    }
    
    if (context.length > 0) {
        prompt += 'Recent conversation:\n' + context.slice(-10).map(msg => `${msg.role}: ${msg.content}`).join('\n') + '\n\n';
    }
    
    prompt += `User: ${userMessage}\nAssistant:`;
    
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }]
        })
    });
    
    if (!response.ok) {
        throw new Error(`Gemini API error: ${response.status}`);
    }
    
    const data = await response.json();
    if (!data.candidates || !data.candidates[0] || !data.candidates[0].content) {
        throw new Error('Invalid response from Gemini API');
    }
    return data.candidates[0].content.parts[0].text.trim();
}

// Schedule multi-stage reminder notifications
function scheduleMultiStageReminder(reminder) {
    const targetDate = new Date(reminder.targetDateTime);
    const now = new Date();
    
    if (targetDate <= now) {
        console.error('Reminder time is in the past:', reminder.targetDateTime);
        return;
    }
    
    const totalDelay = targetDate.getTime() - now.getTime();
    const oneHour = 60 * 60 * 1000;
    const thirtyMinutes = 30 * 60 * 1000;
    
    // Schedule 1 hour before notification
    if (totalDelay > oneHour) {
        setTimeout(async () => {
            if (reminder.active) {
                await sendReminderNotification(`⏰ 1 hour reminder: ${reminder.task}`);
            }
        }, totalDelay - oneHour);
    }
    
    // Schedule 30 minutes before notification
    if (totalDelay > thirtyMinutes) {
        setTimeout(async () => {
            if (reminder.active) {
                await sendReminderNotification(`⏰ 30 minutes reminder: ${reminder.task}`);
            }
        }, totalDelay - thirtyMinutes);
    }
    
    // Schedule main reminder notification
    setTimeout(async () => {
        if (reminder.active) {
            try {
                await sendReminderNotification(`🔔 Reminder NOW: ${reminder.task}`);
                
                const index = reminders.findIndex(r => r.id === reminder.id);
                if (index !== -1) {
                    reminders.splice(index, 1);
                }
                saveData();
            } catch (error) {
                console.error('Error sending reminder:', error);
            }
        }
    }, totalDelay);
}

// Send reminder notification to both platforms
async function sendReminderNotification(message) {
    try {
        // Send to WhatsApp
        await sendToMyChat(message);
        
        // Send to Telegram
        if (telegramBot && MY_TELEGRAM_CHAT_ID) {
            await telegramBot.sendMessage(MY_TELEGRAM_CHAT_ID, message);
        }
    } catch (error) {
        console.error('Error sending reminder notification:', error);
    }
}

// Send immediate notification for new items
async function sendImmediateNotification(type, content, fromChatId) {
    const typeEmoji = {
        'REMINDER': '⏰',
        'MEMORY': '📝', 
        'IMPORTANT': '📰'
    };
    
    const message = `${typeEmoji[type]} New ${type.toLowerCase()}: ${content} (from ${fromChatId})`;
    
    try {
        // Send to WhatsApp
        await sendToMyChat(message);
        
        // Send to Telegram
        if (telegramBot && MY_TELEGRAM_CHAT_ID) {
            await telegramBot.sendMessage(MY_TELEGRAM_CHAT_ID, message);
        }
    } catch (error) {
        console.error('Error sending immediate notification:', error);
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
- REMINDER: Contains time/date references, tasks to do
- MEMORY: Personal info, preferences, facts to remember
- IMPORTANT: Urgent info, updates, news
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

// Calculate target datetime using Gemini AI
async function calculateTargetDateTime(reminder) {
    if (!GEMINI_API_KEY || GEMINI_API_KEY === 'your_gemini_api_key_here') {
        console.log('Gemini API key not configured, skipping datetime calculation');
        return reminder;
    }
    
    const prompt = `Calculate target datetime and extract clean task. Return JSON format:

{
  "task": "cleaned task description",
  "targetDateTime": "ISO datetime string or null",
  "priority": "HIGH|MEDIUM|LOW"
}

Rules:
- Current time: ${new Date().toISOString()}
- Extract clean task from original text, removing time references
- Calculate targetDateTime from time references in original text
- If no valid time found, set targetDateTime to null
- Priority: HIGH for urgent/soon, MEDIUM for normal, LOW for far future
- Examples: "tomorrow 3pm" → tomorrow at 15:00, "10am" → today/tomorrow 10:00

Original text: "${reminder.originalDateTime}"

Return only valid JSON:`;
    
    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }]
            })
        });
        
        if (!response.ok) {
            console.error('Gemini API error:', response.status);
            return reminder;
        }
        
        const data = await response.json();
        let rawResult = data.candidates[0].content.parts[0].text.trim();
        console.log('Raw Gemini response:', rawResult);
        
        // Clean up the response
        if (rawResult.startsWith('```json')) {
            rawResult = rawResult.replace(/```json\s*/, '').replace(/\s*```$/, '');
        }
        if (rawResult.startsWith('```')) {
            rawResult = rawResult.replace(/```\s*/, '').replace(/\s*```$/, '');
        }
        
        // Additional cleanup for common JSON issues
        rawResult = rawResult.replace(/\n/g, ' ').replace(/\r/g, '').trim();
        
        console.log('Cleaned response:', rawResult);
        
        const geminiResult = JSON.parse(rawResult);
        console.log('Gemini result:', geminiResult);
        
        // Preserve original reminder data and only update calculated fields
        const calculatedReminder = {
            ...reminder,
            task: geminiResult.task || reminder.task,
            targetDateTime: geminiResult.targetDateTime,
            priority: geminiResult.priority || 'MEDIUM'
        };
        
        console.log('Final calculated reminder:', calculatedReminder);
        return calculatedReminder;
    } catch (error) {
        console.error('Error calculating target datetime:', error);
        console.error('Failed to parse JSON response from Gemini');
        return reminder;
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
    const calculatedReminder = await calculateTargetDateTime(reminder);
    
    console.log('Creating reminder:', calculatedReminder);
    reminders.push(calculatedReminder);
    
    if (calculatedReminder.targetDateTime) {
        scheduleMultiStageReminder(calculatedReminder);
    }
    
    saveData();
    console.log('Reminder saved, total reminders:', reminders.length);
    
    // Send immediate notification
    await sendImmediateNotification('REMINDER', calculatedReminder.task, fromChatId);
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
    
    memories.push(memory);
    saveData();
    
    // Send immediate notification
    await sendImmediateNotification('MEMORY', memory.content, fromChatId);
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
    
    importantUpdates.push(update);
    saveData();
    
    // Send immediate notification
    await sendImmediateNotification('IMPORTANT', update.content, fromChatId);
}

// Interpret command using Gemini
async function interpretCommand(userCommand) {
    if (!GEMINI_API_KEY || GEMINI_API_KEY === 'your_gemini_api_key_here') {
        return null;
    }
    
    const interpretPrompt = `Analyze this user command and return ONLY one of these exact actions if it matches, otherwise return "NONE":

Actions:
- "SHOW_MEMORIES" - if user wants to see/list/show their memories or asks what they've saved
- "SHOW_REMINDERS" - if user wants to see/list/show their reminders or scheduled tasks
- "SAVE_MEMORY" - if user wants to save something to memory
- "SET_REMINDER" - if user wants to set a reminder or be reminded of something
- "DELETE_MEMORY" - if user wants to delete/remove a memory
- "CANCEL_REMINDER" - if user wants to cancel/delete a reminder
- "DELETE_ALL_MEMORIES" - if user wants to delete/clear all memories
- "DELETE_ALL_REMINDERS" - if user wants to delete/clear all reminders
- "SHOW_UPDATES" - if user wants to see important updates
- "DELETE_ALL_UPDATES" - if user wants to clear all updates

User command: "${userCommand}"

Return only the action name or "NONE":`;
    
    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: interpretPrompt }] }]
            })
        });
        
        if (!response.ok) return null;
        
        const data = await response.json();
        const action = data.candidates[0].content.parts[0].text.trim();
        
        return action === 'NONE' ? null : action;
    } catch (error) {
        console.error('Error interpreting command:', error);
        return null;
    }
}

// Execute action for messages
async function executeAction(message, action, command) {
    const chatId = message.fromMe ? (message.to || message.from) : message.from;
    
    switch (action) {
        case 'SHOW_MEMORIES':
            // Reload memories from file to get latest data
            try {
                if (fs.existsSync('saved_memories.json')) {
                    const fileContent = fs.readFileSync('saved_memories.json', 'utf8');
                    if (fileContent.trim()) {
                        memories = JSON.parse(fileContent);
                    }
                }
            } catch (error) {
                console.error('Error loading memories:', error.message);
                memories = [];
            }
            if (memories.length === 0) {
                await sendToMyChat('📝 No memories saved yet.');
                return;
            }
            const memoryList = memories.map((m, i) => `${i + 1}. ${m.content}${m.autoCreated ? ' (auto)' : ''}`);
            await sendToMyChat(`📝 Your memories:\n${memoryList.join('\n')}`);
            break;
            
        case 'SHOW_REMINDERS':
            // Reload reminders from file to get latest data
            try {
                if (fs.existsSync('reminders.json')) {
                    const fileContent = fs.readFileSync('reminders.json', 'utf8');
                    if (fileContent.trim()) {
                        reminders = JSON.parse(fileContent);
                    }
                }
            } catch (error) {
                console.error('Error loading reminders:', error.message);
                reminders = [];
            }
            const activeReminders = reminders.filter(r => r.active);
            if (activeReminders.length === 0) {
                await sendToMyChat('⏰ No active reminders.');
                return;
            }
            const reminderList = activeReminders.map((r, i) => {
                const date = r.targetDateTime ? new Date(r.targetDateTime).toLocaleString() : 'No date';
                const auto = r.autoCreated ? ' (auto)' : '';
                return `${i + 1}. ${r.task} - ${date}${auto}`;
            });
            await sendToMyChat(`⏰ Your reminders:\n${reminderList.join('\n')}`);
            break;
            
        case 'SHOW_UPDATES':
            if (importantUpdates.length === 0) {
                await sendToMyChat('📰 No important updates.');
                return;
            }
            const updateList = importantUpdates.map((u, i) => {
                const priority = u.priority === 'HIGH' ? '🚨' : u.priority === 'MEDIUM' ? '🟡' : '🟢';
                return `${i + 1}. ${priority} ${u.content} (${u.timestamp})`;
            });
            await sendToMyChat(`📰 Important updates:\n${updateList.join('\n')}`);
            importantUpdates.forEach(u => u.read = true);
            saveData();
            break;
            
        case 'CANCEL_REMINDER':
            await handleCancelReminder(message, command);
            break;
            
        case 'DELETE_MEMORY':
            await handleDeleteMemory(message, command);
            break;
            
        case 'SAVE_MEMORY':
            await handleSaveMemory(message, command);
            break;
            
        case 'SET_REMINDER':
            await handleSetReminder(message, command);
            break;
            
        case 'DELETE_ALL_MEMORIES':
            await handleDeleteAllMemories(message);
            break;
            
        case 'DELETE_ALL_REMINDERS':
            await handleDeleteAllReminders(message);
            break;
            
        case 'DELETE_ALL_UPDATES':
            await handleDeleteAllUpdates();
            break;
            
        default:
            const response = await getAIResponse(MY_CHAT_ID, command);
            await sendToMyChat(response);
    }
}



// Handler functions for actions
async function handleCancelReminder(message, command) {
    const match = command.match(/(\d+)/) || extractNumberFromText(command);
    if (!match) {
        await sendToMyChat('❌ Please specify which reminder number to cancel');
        return;
    }
    
    const reminderIndex = parseInt(match[1] || match) - 1;
    const activeReminders = reminders.filter(r => r.active);
    
    if (reminderIndex < 0 || reminderIndex >= activeReminders.length) {
        await sendToMyChat('❌ Invalid reminder number');
        return;
    }
    
    const targetReminder = activeReminders[reminderIndex];
    const mainIndex = reminders.findIndex(r => r.id === targetReminder.id);
    if (mainIndex !== -1) {
        reminders.splice(mainIndex, 1);
    }
    saveData();
    await sendToMyChat(`✅ Cancelled reminder: ${targetReminder.task}`);
}

async function handleDeleteAllMemories(message) {
    if (memories.length === 0) {
        await sendToMyChat('📝 No memories to delete.');
        return;
    }
    const count = memories.length;
    memories.length = 0;
    saveData();
    await sendToMyChat(`✅ Deleted all ${count} memories.`);
}

async function handleDeleteAllReminders(message) {
    const activeCount = reminders.filter(r => r.active).length;
    if (activeCount === 0) {
        await sendToMyChat('⏰ No active reminders to delete.');
        return;
    }
    reminders.length = 0;
    saveData();
    await sendToMyChat(`✅ Cancelled all ${activeCount} reminders.`);
}

async function handleDeleteAllUpdates() {
    if (importantUpdates.length === 0) {
        await sendToMyChat('📰 No updates to delete.');
        return;
    }
    const count = importantUpdates.length;
    importantUpdates.length = 0;
    saveData();
    await sendToMyChat(`✅ Deleted all ${count} updates.`);
}



async function handleDeleteMemory(message, command) {
    const match = command.match(/(\d+)/) || extractNumberFromText(command);
    if (!match) {
        await sendToMyChat('❌ Please specify which memory number to delete');
        return;
    }
    
    const memoryIndex = parseInt(match[1] || match) - 1;
    
    if (memoryIndex < 0 || memoryIndex >= memories.length) {
        await sendToMyChat('❌ Invalid memory number');
        return;
    }
    
    const deletedMemory = memories.splice(memoryIndex, 1)[0];
    saveData();
    await sendToMyChat(`✅ Deleted memory: ${deletedMemory.content}`);
}

async function handleSaveMemory(message, command) {
    const contentToSave = command.replace(/save.*?memory.*?that/i, '').replace(/save.*?to.*?memory/i, '').trim();
    
    if (!contentToSave) {
        await sendToMyChat('❌ Please specify what to save');
        return;
    }
    
    const memory = {
        content: contentToSave,
        timestamp: new Date().toLocaleString(),
        chatId: MY_CHAT_ID,
        priority: 'MEDIUM',
        autoCreated: false
    };
    
    memories.push(memory);
    saveData();
    await sendToMyChat('✅ Saved to memory: ' + contentToSave);
    
    // Send immediate notification
    await sendImmediateNotification('MEMORY', contentToSave, MY_CHAT_ID);
}

async function handleSetReminder(message, command) {
    const chatId = message.fromMe ? (message.to || message.from) : message.from;
    
    const reminder = {
        id: Date.now(),
        task: command.replace(/remind me (to |about |of )?/i, '').trim(),
        createdAt: new Date().toISOString(),
        originalDateTime: command,
        targetDateTime: null,
        chatId: chatId,
        active: true,
        autoCreated: false
    };
    
    // Calculate target datetime using Gemini
    const calculatedReminder = await calculateTargetDateTime(reminder);
    
    reminders.push(calculatedReminder);
    saveData();
    
    if (calculatedReminder.targetDateTime) {
        scheduleMultiStageReminder(calculatedReminder);
        const targetDate = new Date(calculatedReminder.targetDateTime);
        await sendToMyChat(`🕒 Reminder set for ${targetDate.toLocaleString()}: "${calculatedReminder.task}"`);
    } else {
        await sendToMyChat(`❌ Could not parse date/time from: "${command}"`);
        return;
    }
    
    // Send immediate notification
    await sendImmediateNotification('REMINDER', calculatedReminder.task, chatId);
}

// Extract number from text using words
function extractNumberFromText(text) {
    const lowerText = text.toLowerCase();
    
    // Handle "last" keyword
    if (lowerText.includes('last')) {
        if (lowerText.includes('reminder')) {
            const activeReminders = reminders.filter(r => r.active);
            return activeReminders.length;
        }
        if (lowerText.includes('memory')) {
            return memories.length;
        }
    }
    
    const numberWords = {
        'first': 1, 'second': 2, 'third': 3, 'fourth': 4, 'fifth': 5,
        'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5
    };
    
    for (const [word, num] of Object.entries(numberWords)) {
        if (lowerText.includes(word)) {
            return num;
        }
    }
    return null;
}

// Start the client
client.initialize();

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\nShutting down WhatsApp bot...');
    process.exit(0);
});