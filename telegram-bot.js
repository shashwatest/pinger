const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');

// Load environment variables
require('dotenv').config();

//const TRIGGER_WORD = process.env.TRIGGER_WORD || '!triggerBotHelp';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const MY_TELEGRAM_CHAT_ID = process.env.MY_TELEGRAM_CHAT_ID;
const MY_WHATSAPP_CHAT_ID = '918227967496@c.us';

// WhatsApp bot for cross-platform notifications
let whatsappClient = null;
try {
    const { Client, LocalAuth } = require('whatsapp-web.js');
    // Create a separate WhatsApp client instance for notifications
    whatsappClient = new Client({ authStrategy: new LocalAuth({ clientId: 'telegram-notifications' }), puppeteer: { headless: true } });
    whatsappClient.initialize();
} catch (error) {
    console.log('WhatsApp not available for notifications');
}

if (!TELEGRAM_BOT_TOKEN) {
    console.error('Please set TELEGRAM_BOT_TOKEN in .env file');
    process.exit(1);
}

// Shared data storage (same files as WhatsApp bot)
let memories = [];
let reminders = [];
let chatHistory = {};
let saveNextMode = {};
let importantUpdates = [];

// Initialize bot
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });

// Load shared data
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

// Save shared data
function saveData() {
    fs.writeFileSync('saved_memories.json', JSON.stringify(memories, null, 2));
    fs.writeFileSync('reminders.json', JSON.stringify(reminders, null, 2));
    fs.writeFileSync('chat_history.json', JSON.stringify(chatHistory, null, 2));
    fs.writeFileSync('important_updates.json', JSON.stringify(importantUpdates, null, 2));
}

// Message handler
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const messageText = msg.text || '';
    
    // Only respond to private messages
    if (msg.chat.type !== 'private') return;
    
    console.log(`Telegram message from ${chatId}: "${messageText}"`);
    
    // Initialize chat history
    if (!chatHistory[chatId]) {
        chatHistory[chatId] = [];
    }
    
    // Add message to history
    chatHistory[chatId].push({ role: 'user', content: messageText, timestamp: Date.now() });
    if (chatHistory[chatId].length > 20) {
        chatHistory[chatId] = chatHistory[chatId].slice(-20);
    }
    
    // No trigger word needed for Telegram - process all messages
    console.log(`Processing Telegram command: ${messageText}`);
    
    // Check if we're in save next mode
    if (saveNextMode[chatId]) {
        await saveMemory(chatId, messageText);
        delete saveNextMode[chatId];
        return;
    }
    
    const command = messageText.trim();
    
    try {
        // Test command
        if (command === 'test' || command === '') {
            await bot.sendMessage(chatId, '🤖 Telegram bot is working!');
            return;
        }
        
        // Debug command
        if (command === '!dbg status' || command === 'status') {
            const activeRemindersCount = reminders.filter(r => r.active).length;
            const status = `📊 Bot Status:
• Memories: ${memories.length}
• Active reminders: ${activeRemindersCount}
• Important updates: ${importantUpdates.length}
• Chat history: ${chatHistory[chatId]?.length || 0} messages`;
            await bot.sendMessage(chatId, status);
            return;
        }
        
        // Show memories command (specific phrases only)
        if (command === 'show memories' || command === 'list memories' || command === 'my memories' || command.includes('what have I asked you to remember')) {
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
                await bot.sendMessage(chatId, '📝 No memories saved yet.');
                return;
            }
            
            const memoryList = memories.map((m, i) => {
                const auto = m.autoCreated ? ' (auto)' : '';
                return `${i + 1}. ${m.content}${auto}`;
            }).join('\n');
            await bot.sendMessage(chatId, `📝 Your memories:\n${memoryList}\n\nTo delete: "delete memory 1"`);
            return;
        }
        
        // Show reminders command (specific phrases only)
        if (command === 'show reminders' || command === 'list reminders' || command === 'my reminders') {
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
                await bot.sendMessage(chatId, '⏰ No active reminders.');
                return;
            }
            
            const reminderList = activeReminders.map((r, i) => {
                const date = r.targetDateTime ? new Date(r.targetDateTime).toLocaleString() : 'No date';
                const auto = r.autoCreated ? ' (auto)' : '';
                return `${i + 1}. ${r.task} - ${date}${auto}`;
            }).join('\n');
            await bot.sendMessage(chatId, `⏰ Your reminders:\n${reminderList}\n\nTo cancel: "cancel reminder 1"`);
            return;
        }
        
        // Cancel reminder command (check first)
        if (command.includes('cancel reminder') || command.includes('delete reminder')) {
            const match = command.match(/(?:cancel|delete)\s+reminder\s+(\d+)/i);
            if (!match) {
                await bot.sendMessage(chatId, '❌ Use: "cancel reminder 1" (number from reminder list)');
                return;
            }
            
            const reminderIndex = parseInt(match[1]) - 1;
            const activeReminders = reminders.filter(r => r.active);
            
            if (reminderIndex < 0 || reminderIndex >= activeReminders.length) {
                await bot.sendMessage(chatId, '❌ Invalid reminder number. Check "show reminders" first.');
                return;
            }
            
            // Find and deactivate the actual reminder in the main array
            const targetReminder = activeReminders[reminderIndex];
            const mainIndex = reminders.findIndex(r => r.id === targetReminder.id);
            if (mainIndex !== -1) {
                reminders[mainIndex].active = false;
            }
            saveData();
            await bot.sendMessage(chatId, `✅ Cancelled reminder: ${targetReminder.task}`);
            return;
        }
        
        // Delete memory command
        if (command.includes('delete memory') || command.includes('remove memory')) {
            const match = command.match(/(?:delete|remove)\s+memory\s+(\d+)/i);
            if (!match) {
                await bot.sendMessage(chatId, '❌ Use: "delete memory 1" (number from memory list)');
                return;
            }
            
            const memoryIndex = parseInt(match[1]) - 1;
            
            if (memoryIndex < 0 || memoryIndex >= memories.length) {
                await bot.sendMessage(chatId, '❌ Invalid memory number. Check "show memories" first.');
                return;
            }
            
            const deletedMemory = memories.splice(memoryIndex, 1)[0];
            saveData();
            await bot.sendMessage(chatId, `✅ Deleted memory: ${deletedMemory.content}`);
            return;
        }
        
        // Save memory commands
        if (command.includes('save') && command.includes('memory')) {
            await saveMemoryFromCommand(chatId, command);
            return;
        }
        
        if (command === 'save next to memory') {
            saveNextMode[chatId] = true;
            await bot.sendMessage(chatId, '💾 Ready to save your next message to memory');
            return;
        }
        
        // Reminder command
        if (command.includes('remind')) {
            await setReminder(chatId, command);
            return;
        }
        
        // Regular chat - get AI response
        const response = await getAIResponse(chatId, command);
        await bot.sendMessage(chatId, response);
        
        // Add bot response to history
        chatHistory[chatId].push({ role: 'assistant', content: response, timestamp: Date.now() });
        
    } catch (error) {
        console.error('Error processing Telegram message:', error);
        await bot.sendMessage(chatId, '❌ Sorry, something went wrong');
    }
});

// Save memory from command
async function saveMemoryFromCommand(chatId, command) {
    const contentToSave = command.replace(/save.*?memory.*?that/i, '').replace(/save.*?to.*?memory/i, '').trim();
    
    if (!contentToSave) {
        await bot.sendMessage(chatId, '❌ Nothing to save. Use: save to memory that [your text]');
        return;
    }
    
    const memory = {
        content: contentToSave,
        timestamp: new Date().toLocaleString(),
        chatId: `telegram_${chatId}`
    };
    
    memories.push(memory);
    saveData();
    await bot.sendMessage(chatId, '✅ Saved to memory: ' + contentToSave);
    
    // Send immediate notification
    await sendImmediateNotification('MEMORY', contentToSave, `telegram_${chatId}`);
}

// Save memory (for save next mode)
async function saveMemory(chatId, messageText) {
    const memory = {
        content: messageText,
        timestamp: new Date().toLocaleString(),
        chatId: `telegram_${chatId}`
    };
    
    memories.push(memory);
    saveData();
    await bot.sendMessage(chatId, '✅ Saved to memory: ' + messageText);
    
    // Send immediate notification
    await sendImmediateNotification('MEMORY', messageText, `telegram_${chatId}`);
}

// Set reminder
async function setReminder(chatId, command) {
    const reminder = {
        id: Date.now(),
        task: command.replace(/remind me (to |about |of )?/i, '').trim(),
        createdAt: new Date().toISOString(),
        originalDateTime: command,
        targetDateTime: null,
        chatId: `telegram_${chatId}`,
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
        await bot.sendMessage(chatId, `🕒 Reminder set for ${targetDate.toLocaleString()}: "${calculatedReminder.task}"`);
    } else {
        await bot.sendMessage(chatId, `❌ Could not parse date/time from: "${command}"`);
        return;
    }
    
    // Send immediate notification
    await sendImmediateNotification('REMINDER', calculatedReminder.task, `telegram_${chatId}`);
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
                console.error('Error sending Telegram reminder:', error);
            }
        }
    }, totalDelay);
}

// Send reminder notification to Telegram only
async function sendReminderNotification(message) {
    try {
        // Send to Telegram only
        if (MY_TELEGRAM_CHAT_ID) {
            await bot.sendMessage(MY_TELEGRAM_CHAT_ID, message);
        }
    } catch (error) {
        console.error('Error sending reminder notification:', error);
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
        
        // Remove markdown code blocks if present
        if (rawResult.startsWith('```json')) {
            rawResult = rawResult.replace(/```json\s*/, '').replace(/\s*```$/, '');
        }
        
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
        return reminder;
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
        // Send to Telegram only
        if (MY_TELEGRAM_CHAT_ID) {
            await bot.sendMessage(MY_TELEGRAM_CHAT_ID, message);
        }
    } catch (error) {
        console.error('Error sending immediate notification:', error);
    }
}

// Schedule existing reminders on startup
function scheduleExistingReminders() {
    reminders.forEach(reminder => {
        if (reminder.active && reminder.targetDateTime) {
            scheduleMultiStageReminder(reminder);
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
    const systemPrompt = `You are ShashBot, Suman Verma's AI friend, remember you are not an assistant. 
    Respond in human-like language and be as precise or detailed based on your judgement of what would suffice for the query
    Your name is the Bengali pronunciation of "Shashwat"`;
    
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

// Start bot
console.log('Telegram bot starting...');
loadData();

bot.on('polling_error', (error) => {
    console.log('Telegram polling error:', error);
});

console.log('Telegram bot is ready!');

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\nShutting down Telegram bot...');
    process.exit(0);
});