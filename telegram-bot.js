const TelegramBot = require('node-telegram-bot-api');
const sharedUtils = require('./shared-utils');

// Load environment variables
require('dotenv').config();

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

// Local state
let saveNextMode = {};

// Initialize bot
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });



// Message handler
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const messageText = msg.text || '';
    
    // Only respond to private messages
    if (msg.chat.type !== 'private') return;
    
    console.log(`Telegram message from ${chatId}: "${messageText}"`);
    
    // Check contact processing rules
    const contactInfo = sharedUtils.shouldProcessContact(`telegram_${chatId}`);
    if (!contactInfo.process) {
        console.log(`Ignoring message from telegram_${chatId}: ${contactInfo.reason}`);
        return;
    }
    
    // Add message to history
    sharedUtils.addToHistory(chatId, 'user', messageText);
    
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
            await bot.sendMessage(chatId, status);
            return;
        }
        
        // Show memories command (specific phrases only)
        if (command === 'show memories' || command === 'list memories' || command === 'my memories' || command.includes('what have I asked you to remember')) {
            sharedUtils.reloadMemories();
            const memories = sharedUtils.getMemories();
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
            sharedUtils.reloadReminders();
            const reminders = sharedUtils.getReminders();
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
        
        // Show updates command
        if (command === 'show updates' || command === 'list updates' || command === 'my updates' || command.includes('important updates')) {
            const importantUpdates = sharedUtils.getImportantUpdates();
            if (importantUpdates.length === 0) {
                await bot.sendMessage(chatId, '📰 No important updates.');
                return;
            }
            const updateList = importantUpdates.map((u, i) => {
                const priority = u.priority === 'HIGH' ? '🚨' : u.priority === 'MEDIUM' ? '🟡' : '🟢';
                return `${i + 1}. ${priority} ${u.content} (${u.timestamp})`;
            }).join('\n');
            await bot.sendMessage(chatId, `📰 Important updates:\n${updateList}\n\nTo clear: "delete all updates"`);
            importantUpdates.forEach(u => u.read = true);
            sharedUtils.saveData();
            return;
        }
        
        // Delete all commands
        if (command.includes('delete all memories') || command.includes('clear all memories')) {
            const count = sharedUtils.clearAllMemories();
            if (count === 0) {
                await bot.sendMessage(chatId, '📝 No memories to delete.');
                return;
            }
            await bot.sendMessage(chatId, `✅ Deleted all ${count} memories.`);
            return;
        }
        
        if (command.includes('delete all reminders') || command.includes('clear all reminders') || command.includes('cancel all reminders')) {
            const activeCount = sharedUtils.clearAllReminders();
            if (activeCount === 0) {
                await bot.sendMessage(chatId, '⏰ No active reminders to delete.');
                return;
            }
            await bot.sendMessage(chatId, `✅ Cancelled all ${activeCount} reminders.`);
            return;
        }
        
        if (command.includes('delete all updates') || command.includes('clear all updates')) {
            const count = sharedUtils.clearAllUpdates();
            if (count === 0) {
                await bot.sendMessage(chatId, '📰 No updates to delete.');
                return;
            }
            await bot.sendMessage(chatId, `✅ Deleted all ${count} updates.`);
            return;
        }
        
        // Cancel reminder command (check first)
        if (command.includes('cancel reminder') || command.includes('delete reminder')) {
            await sharedUtils.handleCancelReminder(command, (msg) => bot.sendMessage(chatId, msg));
            return;
        }
        
        // Delete memory command
        if (command.includes('delete memory') || command.includes('remove memory')) {
            await sharedUtils.handleDeleteMemory(command, (msg) => bot.sendMessage(chatId, msg));
            return;
        }
        
        // Save memory commands
        if (command.includes('save') && command.includes('memory')) {
            await sharedUtils.handleSaveMemory(command, `telegram_${chatId}`, (msg) => bot.sendMessage(chatId, msg), bot, MY_TELEGRAM_CHAT_ID);
            return;
        }
        
        if (command === 'save next to memory') {
            saveNextMode[chatId] = true;
            await bot.sendMessage(chatId, '💾 Ready to save your next message to memory');
            return;
        }
        
        // Check for direct commands first
        if (command.startsWith('block ')) {
            await handleDirectBlock(chatId, command);
            return;
        }
        
        if (command.startsWith('unblock ')) {
            await handleDirectUnblock(chatId, command);
            return;
        }
        
        if (command.startsWith('add priority ')) {
            await handleDirectAddPriority(chatId, command);
            return;
        }
        
        if (command.startsWith('remove priority ')) {
            await handleDirectRemovePriority(chatId, command);
            return;
        }
        
        // Try AI command interpretation first
        const interpretedAction = await sharedUtils.interpretCommand(command, GEMINI_API_KEY);
        
        if (interpretedAction) {
            await executeAction(chatId, interpretedAction, command);
        } else if (command.includes('remind')) {
            await sharedUtils.createReminder(command, `telegram_${chatId}`, GEMINI_API_KEY, sendReminderNotification, (msg) => bot.sendMessage(chatId, msg), bot, MY_TELEGRAM_CHAT_ID);
        } else {
            // Regular chat - get AI response
            const response = await sharedUtils.getAIResponse(chatId, command, GEMINI_API_KEY);
            await bot.sendMessage(chatId, response);
            
            // Add bot response to history
            sharedUtils.addToHistory(chatId, 'assistant', response);
        }
        
    } catch (error) {
        console.error('Error processing Telegram message:', error);
        await bot.sendMessage(chatId, '❌ Sorry, something went wrong');
    }
});



// Save memory (for save next mode)
async function saveMemory(chatId, messageText) {
    const memory = {
        content: messageText,
        timestamp: new Date().toISOString(),
        chatId: `telegram_${chatId}`
    };
    
    sharedUtils.addMemory(memory);
    await bot.sendMessage(chatId, '✅ Saved to memory: ' + messageText);
    
    // Send immediate notification
    await sharedUtils.sendImmediateNotification('MEMORY', messageText, `telegram_${chatId}`, bot, MY_TELEGRAM_CHAT_ID);
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



















// Execute action for Telegram
async function executeAction(chatId, action, command) {
    if (['CANCEL_REMINDER', 'DELETE_MEMORY', 'SAVE_MEMORY', 'SET_REMINDER', 'BLOCK_CONTACT', 'UNBLOCK_CONTACT'].includes(action)) {
        // Handle actions that need special Telegram-specific logic
        switch (action) {
            case 'CANCEL_REMINDER':
                await sharedUtils.handleCancelReminder(command, (msg) => bot.sendMessage(chatId, msg));
                break;
            case 'DELETE_MEMORY':
                await sharedUtils.handleDeleteMemory(command, (msg) => bot.sendMessage(chatId, msg));
                break;
            case 'SAVE_MEMORY':
                await sharedUtils.handleSaveMemory(command, `telegram_${chatId}`, (msg) => bot.sendMessage(chatId, msg), bot, MY_TELEGRAM_CHAT_ID);
                break;
            case 'SET_REMINDER':
                await sharedUtils.createReminder(command, `telegram_${chatId}`, GEMINI_API_KEY, sendReminderNotification, (msg) => bot.sendMessage(chatId, msg), bot, MY_TELEGRAM_CHAT_ID);
                break;
            case 'BLOCK_CONTACT':
                await handleBlockContact(chatId, command);
                break;
            case 'UNBLOCK_CONTACT':
                await handleUnblockContact(chatId, command);
                break;
        }
    } else {
        // Use shared execution for display actions
        await sharedUtils.executeAction(action, command, (msg) => bot.sendMessage(chatId, msg));
    }
}

// Handle block contact
async function handleBlockContact(chatId, command) {
    const match = command.match(/block\s+contact\s+(.+)/i);
    if (!match) {
        await bot.sendMessage(chatId, '❌ Use: "block contact [chat_id] [reason]"');
        return;
    }
    
    const parts = match[1].split(' ');
    const targetChatId = parts[0];
    const reason = parts.slice(1).join(' ') || 'Manual block';
    
    sharedUtils.addBlockedContact(targetChatId, reason);
    await bot.sendMessage(chatId, `✅ Blocked contact: ${targetChatId}`);
}

// Handle unblock contact
async function handleUnblockContact(chatId, command) {
    const match = command.match(/unblock\s+contact\s+(.+)/i);
    if (!match) {
        await bot.sendMessage(chatId, '❌ Use: "unblock contact [chat_id]"');
        return;
    }
    
    const targetChatId = match[1].trim();
    const removed = sharedUtils.removeBlockedContact(targetChatId);
    
    if (removed) {
        await bot.sendMessage(chatId, `✅ Unblocked contact: ${targetChatId}`);
    } else {
        await bot.sendMessage(chatId, `❌ Contact not found in blocked list: ${targetChatId}`);
    }
}

// Direct block command
async function handleDirectBlock(chatId, command) {
    const input = command.replace('block ', '').trim();
    if (!input) {
        await bot.sendMessage(chatId, '❌ Use: "block [phone_number/chat_id] [reason]"');
        return;
    }
    
    const parts = input.split(' ');
    const identifier = parts[0];
    const reason = parts.slice(1).join(' ') || 'Manual block';
    
    const targetChatId = sharedUtils.phoneToWhatsAppId(identifier);
    sharedUtils.addBlockedContact(targetChatId, reason);
    await bot.sendMessage(chatId, `✅ Blocked: ${identifier} -> ${targetChatId}`);
}

// Direct unblock command
async function handleDirectUnblock(chatId, command) {
    const input = command.replace('unblock ', '').trim();
    if (!input) {
        await bot.sendMessage(chatId, '❌ Use: "unblock [phone_number/chat_id]"');
        return;
    }
    
    const targetChatId = sharedUtils.phoneToWhatsAppId(input);
    const removed = sharedUtils.removeBlockedContact(targetChatId);
    
    if (removed) {
        await bot.sendMessage(chatId, `✅ Unblocked: ${input} -> ${targetChatId}`);
    } else {
        await bot.sendMessage(chatId, `❌ Not found in blocked list: ${targetChatId}`);
    }
}

// Direct add priority command
async function handleDirectAddPriority(chatId, command) {
    const input = command.replace('add priority ', '').trim();
    const parts = input.split(' ');
    
    if (parts.length < 2) {
        await bot.sendMessage(chatId, '❌ Use: "add priority [phone/chatId] [name] [keywords]"\nExample: "add priority 9876543210 Vipul bhaiya,urgent"');
        return;
    }
    
    const identifier = parts[0];
    const name = parts[1];
    const keywords = parts.slice(2).join(' ').split(',').map(k => k.trim()).filter(k => k);
    
    const targetChatId = sharedUtils.phoneToWhatsAppId(identifier);
    const rules = keywords.length > 0 ? [{ type: 'ONLY_KEYWORDS', keywords }] : [];
    
    sharedUtils.addPriorityContact(targetChatId, 'HIGH', rules, name);
    await bot.sendMessage(chatId, `✅ Added priority contact: ${name} (${targetChatId})\nKeywords: ${keywords.join(', ') || 'All messages'}`);
}

// Direct remove priority command
async function handleDirectRemovePriority(chatId, command) {
    const input = command.replace('remove priority ', '').trim();
    if (!input) {
        await bot.sendMessage(chatId, '❌ Use: "remove priority [phone_number/chat_id]"');
        return;
    }
    
    const targetChatId = sharedUtils.phoneToWhatsAppId(input);
    const removed = sharedUtils.removePriorityContact(targetChatId);
    
    if (removed) {
        await bot.sendMessage(chatId, `✅ Removed priority contact: ${removed.name || targetChatId}`);
    } else {
        await bot.sendMessage(chatId, `❌ Not found in priority list: ${targetChatId}`);
    }
}

// Send daily summary
async function sendDailySummary() {
    if (!MY_TELEGRAM_CHAT_ID) return;
    const summary = sharedUtils.generateDailySummary();
    await bot.sendMessage(MY_TELEGRAM_CHAT_ID, summary);
}

// Start bot
console.log('Telegram bot starting...');
sharedUtils.loadData();
sharedUtils.scheduleExistingReminders(sendReminderNotification, (r) => r.chatId.startsWith('telegram_'));
sharedUtils.setupDailySummary(sendDailySummary);
sharedUtils.setupPeriodicReminderCheck(sendReminderNotification, (r) => r.chatId.startsWith('telegram_'));

bot.on('polling_error', (error) => {
    console.log('Telegram polling error:', error);
});

console.log('Telegram bot is ready!');

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\nShutting down Telegram bot...');
    process.exit(0);
});