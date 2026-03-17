const TelegramBot = require('node-telegram-bot-api');
const sharedUtils = require('./shared-utils');

require('dotenv').config();

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const MY_TELEGRAM_CHAT_ID = process.env.MY_TELEGRAM_CHAT_ID;
const MY_WHATSAPP_CHAT_ID = `91${process.env.MY_WHATSAPP_NUMBER}@c.us`;

let whatsappClient = null;
try {
    const { Client, LocalAuth } = require('whatsapp-web.js');
    whatsappClient = new Client({ 
        authStrategy: new LocalAuth({ clientId: 'telegram-notifications' }), 
        puppeteer: { 
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu'
            ]
        } 
    });
    whatsappClient.initialize().catch(err => {
        console.log('WhatsApp initialization failed:', err.message);
    });
} catch (error) {
    console.log('WhatsApp not available for notifications:', error.message);
}

if (!TELEGRAM_BOT_TOKEN) {
    console.error('Please set TELEGRAM_BOT_TOKEN in .env file');
    process.exit(1);
}

let saveNextMode = {};

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { 
    polling: {
        interval: 2000,
        autoStart: true,
        params: {
            timeout: 10
        }
    }
});

bot.on('polling_error', (error) => {
    console.log('Telegram polling error:', error.code || error.message);
    // Don't crash on network errors, just log and continue
});

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const messageText = msg.text || '';
    
    if (msg.chat.type !== 'private') return;
    
    console.log(`Telegram message from ${chatId}: "${messageText}"`);
    
    const contactInfo = sharedUtils.shouldProcessContact(`telegram_${chatId}`);
    if (!contactInfo.process) {
        console.log(`Ignoring message from telegram_${chatId}: ${contactInfo.reason}`);
        return;
    }
    
    sharedUtils.addToHistory(chatId, 'user', messageText);
    
    console.log(`Processing Telegram command: ${messageText}`);
    
    if (saveNextMode[chatId]) {
        const memory = {
            content: messageText,
            timestamp: new Date().toISOString(),
            chatId: `telegram_${chatId}`
        };
        sharedUtils.addMemory(memory);
        await bot.sendMessage(chatId, 'Saved to memory: ' + messageText);
        await sharedUtils.sendImmediateNotification('MEMORY', messageText, `telegram_${chatId}`, bot, MY_TELEGRAM_CHAT_ID);
        delete saveNextMode[chatId];
        return;
    }
    
    const command = messageText.trim();
    
    try {
        if (command === 'test' || command === '') {
            await bot.sendMessage(chatId, 'Telegram bot is working!');
            return;
        }
        
        if (command === '!dbg status' || command === 'status') {
            await bot.sendMessage(chatId, sharedUtils.getStatusMessage(chatId));
            return;
        }
        

        

        
        if (command.startsWith('block ')) {
            await sharedUtils.handleDirectBlock(command, chatId, (msg) => bot.sendMessage(chatId, msg));
            return;
        }
        
        if (command.startsWith('unblock ')) {
            await sharedUtils.handleDirectUnblock(command, chatId, (msg) => bot.sendMessage(chatId, msg));
            return;
        }
        
        if (command.startsWith('add priority ')) {
            await sharedUtils.handleDirectAddPriority(command, chatId, (msg) => bot.sendMessage(chatId, msg));
            return;
        }
        
        if (command.startsWith('remove priority ')) {
            await sharedUtils.handleDirectRemovePriority(command, chatId, (msg) => bot.sendMessage(chatId, msg));
            return;
        }
        
        if (command.startsWith('grant access ')) {
            const number = command.substring('grant access '.length).trim().replace(/\D/g, '');
            if (number.length >= 7) {
                const targetChatId = sharedUtils.phoneToWhatsAppId(number);
                sharedUtils.addBotAccessContact(targetChatId, number);
                await bot.sendMessage(chatId, `✅ Bot access granted to ${number}`);
            } else {
                await bot.sendMessage(chatId, '❌ Invalid number format. Use: grant access 1234567890');
            }
            return;
        }
        
        if (command.startsWith('revoke access ')) {
            const number = command.substring('revoke access '.length).trim().replace(/\D/g, '');
            if (number.length >= 7) {
                const targetChatId = sharedUtils.phoneToWhatsAppId(number);
                const removed = sharedUtils.removeBotAccessContact(targetChatId);
                if (removed) {
                    await bot.sendMessage(chatId, `✅ Bot access revoked from ${number}`);
                } else {
                    await bot.sendMessage(chatId, `❌ ${number} didn't have bot access`);
                }
            } else {
                await bot.sendMessage(chatId, '❌ Invalid number format. Use: revoke access 1234567890');
            }
            return;
        }
        
        if (command === 'list access') {
            const lists = sharedUtils.getContactLists();
            if (lists.botAccess.length === 0) {
                await bot.sendMessage(chatId, 'No contacts have bot access (only you)');
            } else {
                const accessList = lists.botAccess.map(c => 
                    `${c.name || c.chatId} (added: ${new Date(c.addedAt).toLocaleDateString()})`
                ).join('\n');
                await bot.sendMessage(chatId, `Bot Access List:\n${accessList}`);
            }
            return;
        }
        
        const notificationFn = (msg) => sharedUtils.sendReminderNotification(msg, bot, MY_TELEGRAM_CHAT_ID);
        const messageSender = (msg) => bot.sendMessage(chatId, msg);
        const handled = await sharedUtils.handleCommonCommands(command, `telegram_${chatId}`, chatId, GEMINI_API_KEY, notificationFn, messageSender, bot, MY_TELEGRAM_CHAT_ID, saveNextMode);
        
        if (!handled) {
            const response = await sharedUtils.getAIResponse(chatId, command, GEMINI_API_KEY);
            await bot.sendMessage(chatId, response);
            sharedUtils.addToHistory(chatId, 'assistant', response);
        }
        
    } catch (error) {
        console.error('Error processing Telegram message:', error);
        await bot.sendMessage(chatId, 'Sorry, something went wrong');
    }
});













console.log('Telegram bot starting...');
sharedUtils.loadData();
const notificationFn = (msg) => sharedUtils.sendReminderNotification(msg, bot, MY_TELEGRAM_CHAT_ID);
sharedUtils.scheduleExistingReminders(notificationFn, (r) => r.chatId.startsWith('telegram_'));
sharedUtils.setupDailySummary(() => {
    if (!MY_TELEGRAM_CHAT_ID) return;
    const summary = sharedUtils.generateDailySummary();
    bot.sendMessage(MY_TELEGRAM_CHAT_ID, summary);
});
sharedUtils.setupMorningSchedule(() => {
    if (!MY_TELEGRAM_CHAT_ID) return;
    const schedule = sharedUtils.generateMorningSchedule();
    bot.sendMessage(MY_TELEGRAM_CHAT_ID, schedule);
});
sharedUtils.setupPeriodicReminderCheck(notificationFn, (r) => r.chatId.startsWith('telegram_'));

console.log('Telegram bot is ready!');

process.on('SIGINT', () => {
    console.log('\nShutting down Telegram bot...');
    process.exit(0);
});