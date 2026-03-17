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
    puppeteer: { 
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu'
        ],
        timeout: 120000
    },
    webVersionCache: {
        type: 'remote',
        remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.3000.1015901620-alpha.html'
    }
});

client.on('qr', (qr) => {
    console.log('\n=================================');
    console.log('Scan this QR code with WhatsApp:');
    console.log('=================================\n');
    qrcode.generate(qr, { small: true });
    console.log('\n=================================');
    console.log('Waiting for QR code scan...');
    console.log('=================================\n');
});

client.on('authenticated', () => {
    console.log('✅ WhatsApp authentication successful');
});

client.on('auth_failure', (msg) => {
    console.error('❌ WhatsApp authentication failed:', msg);
    console.log('Try deleting .wwebjs_auth folder and scanning QR again');
});

client.on('disconnected', (reason) => {
    console.log('⚠️  WhatsApp disconnected:', reason);
    console.log('Attempting to reconnect...');
});

client.on('loading_screen', (percent, message) => {
    console.log('Loading WhatsApp...', percent, message);
});

client.on('ready', async () => {
    console.log('\n✅ WhatsApp bot is ready and connected!');
    console.log('Trigger word:', TRIGGER_WORD);
    console.log('Your WhatsApp ID:', MY_CHAT_ID);
    console.log('=================================\n');

    try {
        await client.pupPage.evaluate(() => {
            const originalSendSeen = window.WWebJS.sendSeen;
            
            window.WWebJS.sendSeen = async function(chatId) {
                try {
                    // Try the original function
                    return await originalSendSeen.call(this, chatId);
                } catch (error) {
                    // If it crashes with the specific 'markedUnread' error, ignore it and continue
                    if (error.message && error.message.includes('markedUnread')) {
                        console.log('Prevented sendSeen crash for chat:', chatId);
                        return true; 
                    }
                    // If it's a different error, throw it
                    throw error;
                }
            };
        });
        console.log('✅ Applied "markedUnread" crash fix.');
    } catch (err) {
        console.error('Failed to apply crash fix:', err);
    }

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

    if (message.body.startsWith(BOT_MESSAGE_PREFIX)) return;
    
    const chatId = message.fromMe ? (message.to || message.from) : message.from;
    const messageBody = message.body;
    
    console.log(`${message.fromMe ? 'Sent' : 'Received'} message ${message.fromMe ? 'to' : 'from'} ${chatId}: "${messageBody}"`);
    
    const contactInfo = sharedUtils.shouldProcessContact(chatId);
    if (!contactInfo.process) {
        console.log(`Ignoring message from ${chatId}: ${contactInfo.reason}`);
        return;
    }
    
    sharedUtils.addToHistory(chatId, 'user', messageBody);
    
    if (!messageBody.startsWith(BOT_MESSAGE_PREFIX) && !messageBody.startsWith(TRIGGER_WORD)) {
        console.log(`Processing message for auto-categorization from ${chatId} (fromMe: ${message.fromMe})`);
        await processIncomingMessage(message, messageBody, chatId, contactInfo);
    }
    
    if (!messageBody.startsWith(TRIGGER_WORD)) {
        return;
    }
    
    // Check bot access permission
    if (!sharedUtils.hasBotAccess(chatId)) {
        console.log(`Bot access denied for ${chatId}`);
        return; // silently ignore - don't reveal bot exists
    }
    
    const command = messageBody.substring(TRIGGER_WORD.length).trim();
    const replyChatId = chatId; // reply to whoever sent the trigger word
    const replyFn = (msg) => sendToChat(replyChatId, msg);

    try {
        if (command === 'test' || command === '') {
            await replyFn('Bot is working! Trigger word: ' + TRIGGER_WORD);
            return;
        }
        
        if (command === '!dbg status') {
            await replyFn(sharedUtils.getStatusMessage(chatId));
            return;
        }
        
        if (command.startsWith('block ')) {
            await sharedUtils.handleDirectBlock(command, chatId, replyFn);
            return;
        }
        
        if (command.startsWith('unblock ')) {
            await sharedUtils.handleDirectUnblock(command, chatId, replyFn);
            return;
        }
        
        if (command.startsWith('add priority ')) {
            await sharedUtils.handleDirectAddPriority(command, chatId, replyFn);
            return;
        }
        
        if (command.startsWith('remove priority ')) {
            await sharedUtils.handleDirectRemovePriority(command, chatId, replyFn);
            return;
        }
        
        if (command.startsWith('grant access ')) {
            const number = command.substring('grant access '.length).trim().replace(/\D/g, '');
            if (number.length >= 7) {
                const targetChatId = sharedUtils.phoneToWhatsAppId(number);
                sharedUtils.addBotAccessContact(targetChatId, number);
                await replyFn(`✅ Bot access granted to ${number}`);
            } else {
                await replyFn('❌ Invalid number format. Use: grant access 1234567890');
            }
            return;
        }
        
        if (command.startsWith('revoke access ')) {
            const number = command.substring('revoke access '.length).trim().replace(/\D/g, '');
            if (number.length >= 7) {
                const targetChatId = sharedUtils.phoneToWhatsAppId(number);
                const removed = sharedUtils.removeBotAccessContact(targetChatId);
                if (removed) {
                    await replyFn(`✅ Bot access revoked from ${number}`);
                } else {
                    await replyFn(`❌ ${number} didn't have bot access`);
                }
            } else {
                await replyFn('❌ Invalid number format. Use: revoke access 1234567890');
            }
            return;
        }
        
        if (command === 'list access') {
            const lists = sharedUtils.getContactLists();
            if (lists.botAccess.length === 0) {
                await replyFn('No contacts have bot access (only you)');
            } else {
                const accessList = lists.botAccess.map(c => 
                    `${c.name || c.chatId} (added: ${new Date(c.addedAt).toLocaleDateString()})`
                ).join('\n');
                await replyFn(`Bot Access List:\n${accessList}`);
            }
            return;
        }
        
        const notificationFn = (msg) => sharedUtils.sendReminderNotification(msg, telegramBot, MY_TELEGRAM_CHAT_ID);
        const handled = await sharedUtils.handleCommonCommands(command, replyChatId, chatId, GEMINI_API_KEY, notificationFn, replyFn, telegramBot, MY_TELEGRAM_CHAT_ID, saveNextMode);
        
        if (!handled) {
            const response = await sharedUtils.getAIResponse(chatId, command, GEMINI_API_KEY);
            await replyFn(response);
            sharedUtils.addToHistory(replyChatId, 'assistant', response);
        }
        
    } catch (error) {
        console.error('Error processing message:', error);
        await replyFn('Sorry, something went wrong');
    }
});

// async function sendToMyChat(text) {
//     try {
//         // const myChat = await client.getChatById(MY_CHAT_ID);
//         // await myChat.sendMessage(BOT_MESSAGE_PREFIX + ' ' + text);
//         await client.sendMessage(MY_CHAT_ID, BOT_MESSAGE_PREFIX + ' ' + text);
//     } catch (error) {
//         console.error('Error sending to my chat:', error);
//     }
// }


async function sendToMyChat(text) {
    try {
        await client.sendMessage(MY_CHAT_ID, BOT_MESSAGE_PREFIX + ' ' + text);
    } catch (error) {
        console.error('Error sending to my chat:', error);
    }
}

async function sendToChat(targetChatId, text) {
    try {
        await client.sendMessage(targetChatId, BOT_MESSAGE_PREFIX + ' ' + text);
    } catch (error) {
        console.error('Error sending to chat:', targetChatId, error);
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
    
    calculated.task = categorization.content;
    calculated.priority = categorization.priority;
    
    if (!calculated.targetDateTime) {
        const today = new Date();
        today.setHours(10, 0, 0, 0);
        calculated.targetDateTime = today.toISOString();
    }
    
    if (categorization.contactLabel) {
        calculated.contactLabel = categorization.contactLabel;
    }
    
    sharedUtils.addScheduleItem(calculated);
    
    const reminder = {
        id: Date.now() + 1,
        task: categorization.content,
        createdAt: calculated.timestamp,
        originalDateTime: calculated.originalDateTime,
        targetDateTime: calculated.targetDateTime,
        chatId: fromChatId,
        active: true,
        priority: categorization.priority,
        contactLabel: categorization.contactLabel,
        autoCreated: true,
        isScheduleLinked: true
    };
    
    sharedUtils.addReminder(reminder);
    
    if (calculated.targetDateTime) {
        const notificationFn = (msg) => sharedUtils.sendReminderNotification(msg, telegramBot, MY_TELEGRAM_CHAT_ID);
        sharedUtils.scheduleMultiStageReminder(reminder, notificationFn);
    }
    
    await sharedUtils.sendImmediateNotification('SCHEDULE', categorization.content, fromChatId, telegramBot, MY_TELEGRAM_CHAT_ID);
}







console.log('Starting WhatsApp bot...');
console.log('Initializing client...');

// Set a timeout for initialization
const initTimeout = setTimeout(() => {
    console.error('❌ WhatsApp initialization timed out after 120 seconds');
    console.log('\nThis usually means:');
    console.log('1. Network connectivity issues');
    console.log('2. WhatsApp servers are slow/unreachable');
    console.log('3. Corrupted session data in .wwebjs_auth folder');
    console.log('\nTry deleting the .wwebjs_auth folder and restart');
    process.exit(1);
}, 120000);

client.once('ready', () => {
    clearTimeout(initTimeout);
});

client.initialize().catch(err => {
    clearTimeout(initTimeout);
    console.error('❌ WhatsApp initialization failed:', err.message);
    console.log('\nPossible causes:');
    console.log('1. No internet connection');
    console.log('2. DNS resolution issues (can\'t reach web.whatsapp.com)');
    console.log('3. Firewall blocking WhatsApp');
    console.log('4. Corrupted session data');
    console.log('\nTroubleshooting:');
    console.log('- Check your internet connection');
    console.log('- Try: ping web.whatsapp.com');
    console.log('- Check firewall settings');
    console.log('- Delete .wwebjs_auth folder and try again');
    console.log('- Try using a VPN if WhatsApp is blocked');
    process.exit(1);
});

process.on('SIGINT', () => {
    console.log('\nShutting down WhatsApp bot...');
    process.exit(0);
});