const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const cron = require('node-cron');
const sharedUtils = require('./shared-utils');

require('dotenv').config();

const TRIGGER_WORD = process.env.TRIGGER_WORD || '!triggerBotHelp';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

let saveNextMode = {};

const MY_CHAT_ID = `91${process.env.MY_WHATSAPP_NUMBER}@c.us`;
const MY_TELEGRAM_CHAT_ID = process.env.MY_TELEGRAM_CHAT_ID;
const BOT_MESSAGE_PREFIX = `${process.env.MY_BOT_NAME}:`;

let telegramBot = null;
try {
    const TelegramBot = require('node-telegram-bot-api');
    if (process.env.TELEGRAM_BOT_TOKEN) {
        telegramBot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN);
    }
} catch (error) {
    console.log('Telegram not available for notifications');
}

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: { headless: true }
});

client.on('qr', (qr) => {
    console.log('Scan this QR code with WhatsApp:');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('WhatsApp bot is ready!');
    sharedUtils.loadData();
    const notificationFn = (msg) => sharedUtils.sendReminderNotification(msg, telegramBot, MY_TELEGRAM_CHAT_ID);
    sharedUtils.scheduleExistingReminders(notificationFn, (r) => !r.chatId.startsWith('telegram_'));
    sharedUtils.setupDailySummary(() => {
        const summary = sharedUtils.generateDailySummary();
        sendToMyChat(summary);
    });
    sharedUtils.setupMorningSchedule(() => {
        const schedule = sharedUtils.generateMorningSchedule();
        sendToMyChat(schedule);
    });
    sharedUtils.setupPeriodicReminderCheck(notificationFn, (r) => !r.chatId.startsWith('telegram_'));
});



client.on('message_create', async (message) => {
    if (message.fromMe) {
        await client.emit('message', message);
    }
});
client.on('message', async (message) => {
    if (message.from === 'status@broadcast') return;
    
    const chatId = message.fromMe ? (message.to || message.from) : message.from;
    const messageBody = message.body;
    
    console.log(`${message.fromMe ? 'Sent' : 'Received'} message ${message.fromMe ? 'to' : 'from'} ${chatId}: "${messageBody}"`);
    
    const contactInfo = sharedUtils.shouldProcessContact(chatId);
    if (!contactInfo.process) {
        console.log(`Ignoring message from ${chatId}: ${contactInfo.reason}`);
        return;
    }
    
    sharedUtils.addToHistory(chatId, 'user', messageBody);
    
    if (!messageBody.startsWith(BOT_MESSAGE_PREFIX) && 
        (!message.fromMe || (message.fromMe && !messageBody.startsWith(TRIGGER_WORD)))) {
        console.log(`Processing message for auto-categorization from ${chatId} (fromMe: ${message.fromMe})`);
        await processIncomingMessage(message, messageBody, chatId, contactInfo);
    }
    
    if (!messageBody.startsWith(TRIGGER_WORD)) {
        return;
    }
    
    const command = messageBody.substring(TRIGGER_WORD.length).trim();
    
    try {
        if (command === 'test' || command === '') {
            await sendToMyChat('Bot is working! Trigger word: ' + TRIGGER_WORD);
            return;
        }
        
        if (command === '!dbg status') {
            await sendToMyChat(sharedUtils.getStatusMessage(chatId));
            return;
        }
        
        if (command.startsWith('block ')) {
            await sharedUtils.handleDirectBlock(command, chatId, sendToMyChat);
            return;
        }
        
        if (command.startsWith('unblock ')) {
            await sharedUtils.handleDirectUnblock(command, chatId, sendToMyChat);
            return;
        }
        
        if (command.startsWith('add priority ')) {
            await sharedUtils.handleDirectAddPriority(command, chatId, sendToMyChat);
            return;
        }
        
        if (command.startsWith('remove priority ')) {
            await sharedUtils.handleDirectRemovePriority(command, chatId, sendToMyChat);
            return;
        }
        
        const interpretedAction = await sharedUtils.interpretCommand(command, GEMINI_API_KEY);
        
        if (interpretedAction) {
            const notificationFn = (msg) => sharedUtils.sendReminderNotification(msg, telegramBot, MY_TELEGRAM_CHAT_ID);
            if (['CANCEL_REMINDER', 'DELETE_MEMORY', 'SAVE_MEMORY', 'SET_REMINDER'].includes(interpretedAction)) {
                switch (interpretedAction) {
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
                        await sharedUtils.createReminder(command, MY_CHAT_ID, GEMINI_API_KEY, notificationFn, sendToMyChat, telegramBot, MY_TELEGRAM_CHAT_ID);
                        break;
                }
            } else {
                await sharedUtils.executeAction(interpretedAction, command, sendToMyChat);
            }
        } else {
            const response = await sharedUtils.getAIResponse(chatId, command, GEMINI_API_KEY);
            await sendToMyChat(response);
            sharedUtils.addToHistory(MY_CHAT_ID, 'assistant', response);
        }
        
    } catch (error) {
        console.error('Error processing message:', error);
        await sendToMyChat('Sorry, something went wrong');
    }
});

async function sendToMyChat(text) {
    try {
        const myChat = await client.getChatById(MY_CHAT_ID);
        await myChat.sendMessage(BOT_MESSAGE_PREFIX + ' ' + text);
    } catch (error) {
        console.error('Error sending to my chat:', error);
    }
}

async function processIncomingMessage(message, messageBody, chatId, contactInfo) {
    try {
        const ruleResult = sharedUtils.applyContactRules(messageBody, contactInfo);
        if (!ruleResult.processMessage) {
            console.log(`Message ignored due to contact rules: ${ruleResult.modifications.join(', ')}`);
            return;
        }
        
        console.log(`Attempting to categorize message: "${messageBody.substring(0, 50)}..."`);
        const categorization = await sharedUtils.categorizeMessage(messageBody, GEMINI_API_KEY);
        
        if (categorization) {
            console.log(`Message categorized as: ${categorization.type} with priority: ${categorization.priority}`);
            
            if (contactInfo.priority === 'HIGH' && contactInfo.name) {
                categorization.contactLabel = contactInfo.name;
            }
            
            switch (categorization.type) {
                case 'REMINDER':
                    await autoCreateReminder(categorization, chatId);
                    console.log('Auto-created reminder');
                    break;
                case 'MEMORY':
                    await autoSaveMemory(categorization, chatId);
                    console.log('Auto-saved memory');
                    break;
                case 'SCHEDULE':
                    await autoAddSchedule(categorization, chatId);
                    console.log('Auto-added to schedule');
                    break;
            }
            

        } else {
            console.log('Message not categorized (returned null)');
        }
    } catch (error) {
        console.error('Error processing incoming message:', error);
    }
}









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
        contactLabel: categorization.contactLabel,
        autoCreated: true
    };
    
    const calculatedReminder = await sharedUtils.calculateTargetDateTime(reminder, GEMINI_API_KEY);
    
    if (categorization.contactLabel) {
        calculatedReminder.contactLabel = categorization.contactLabel;
    }
    
    console.log('Creating reminder:', calculatedReminder);
    sharedUtils.addReminder(calculatedReminder);
    
    if (calculatedReminder.targetDateTime) {
        const notificationFn = (msg) => sharedUtils.sendReminderNotification(msg, telegramBot, MY_TELEGRAM_CHAT_ID);
        sharedUtils.scheduleMultiStageReminder(calculatedReminder, notificationFn);
    }
    
    console.log('Reminder saved, total reminders:', sharedUtils.getReminders().length);
    
    await sharedUtils.sendImmediateNotification('REMINDER', calculatedReminder.task, fromChatId, telegramBot, MY_TELEGRAM_CHAT_ID);
}

async function autoSaveMemory(categorization, fromChatId) {
    const memory = {
        content: categorization.content,
        timestamp: new Date().toISOString(),
        chatId: fromChatId,
        priority: categorization.priority,
        autoCreated: true
    };
    
    sharedUtils.addMemory(memory);
    
    await sharedUtils.sendImmediateNotification('MEMORY', memory.content, fromChatId, telegramBot, MY_TELEGRAM_CHAT_ID);
}

async function autoAddSchedule(categorization, fromChatId) {
    const scheduleItem = {
        id: Date.now(),
        task: categorization.content,
        timestamp: new Date().toISOString(),
        originalDateTime: categorization.datetime || categorization.content,
        targetDateTime: null,
        chatId: fromChatId,
        priority: categorization.priority,
        contactLabel: categorization.contactLabel,
        autoCreated: true
    };
    
    const calculated = await sharedUtils.calculateTargetDateTime(scheduleItem, GEMINI_API_KEY);
    
    if (!calculated.task || calculated.task === '') {
        calculated.task = categorization.content;
    }
    
    if (!calculated.targetDateTime) {
        const today = new Date();
        today.setHours(10, 0, 0, 0);
        calculated.targetDateTime = today.toISOString();
    }
    
    if (!calculated.priority) {
        calculated.priority = categorization.priority;
    }
    
    if (categorization.contactLabel) {
        calculated.contactLabel = categorization.contactLabel;
    }
    
    sharedUtils.addScheduleItem(calculated);
    
    const reminder = {
        id: Date.now() + 1,
        task: calculated.task,
        createdAt: calculated.timestamp,
        originalDateTime: calculated.originalDateTime,
        targetDateTime: calculated.targetDateTime,
        chatId: fromChatId,
        active: true,
        priority: calculated.priority,
        autoCreated: true,
        isScheduleLinked: true
    };
    
    sharedUtils.addReminder(reminder);
    
    if (calculated.targetDateTime) {
        const notificationFn = (msg) => sharedUtils.sendReminderNotification(msg, telegramBot, MY_TELEGRAM_CHAT_ID);
        sharedUtils.scheduleMultiStageReminder(reminder, notificationFn);
    }
    
    await sharedUtils.sendImmediateNotification('SCHEDULE', calculated.task, fromChatId, telegramBot, MY_TELEGRAM_CHAT_ID);
}







client.initialize();

process.on('SIGINT', () => {
    console.log('\nShutting down WhatsApp bot...');
    process.exit(0);
});