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
    whatsappClient = new Client({ authStrategy: new LocalAuth({ clientId: 'telegram-notifications' }), puppeteer: { headless: true } });
    whatsappClient.initialize();
} catch (error) {
    console.log('WhatsApp not available for notifications');
}

if (!TELEGRAM_BOT_TOKEN) {
    console.error('Please set TELEGRAM_BOT_TOKEN in .env file');
    process.exit(1);
}

let saveNextMode = {};

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });
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
sharedUtils.setupPeriodicReminderCheck(notificationFn, (r) => r.chatId.startsWith('telegram_'));

bot.on('polling_error', (error) => {
    console.log('Telegram polling error:', error);
});

console.log('Telegram bot is ready!');

process.on('SIGINT', () => {
    console.log('\nShutting down Telegram bot...');
    process.exit(0);
});