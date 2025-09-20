// Shared reminder system for both WhatsApp and Telegram
const fs = require('fs');

let reminders = [];

// Load reminders
function loadReminders() {
    try {
        if (fs.existsSync('reminders.json')) {
            reminders = JSON.parse(fs.readFileSync('reminders.json', 'utf8'));
        }
    } catch (error) {
        console.log('Error loading reminders:', error.message);
    }
}

// Save reminders
function saveReminders() {
    fs.writeFileSync('reminders.json', JSON.stringify(reminders, null, 2));
}

// Schedule reminder for both platforms
function scheduleReminderForBoth(reminder, whatsappClient, telegramBot) {
    const targetDate = new Date(reminder.datetime);
    const now = new Date();
    
    if (targetDate <= now) {
        console.error('Reminder time is in the past:', reminder.datetime);
        return;
    }
    
    const delay = targetDate.getTime() - now.getTime();
    
    setTimeout(async () => {
        if (reminder.active) {
            try {
                // Send to WhatsApp
                if (whatsappClient && !reminder.chatId.startsWith('telegram_')) {
                    const chat = await whatsappClient.getChatById(reminder.chatId);
                    await chat.sendMessage(`🔔 Reminder: ${reminder.task}`);
                }
                
                // Send to Telegram
                if (telegramBot && reminder.chatId.startsWith('telegram_')) {
                    const chatId = reminder.chatId.replace('telegram_', '');
                    await telegramBot.sendMessage(chatId, `🔔 Reminder: ${reminder.task}`);
                }
                
                reminder.active = false;
                saveReminders();
            } catch (error) {
                console.error('Error sending reminder:', error);
            }
        }
    }, delay);
}

module.exports = {
    loadReminders,
    saveReminders,
    scheduleReminderForBoth,
    getReminders: () => reminders,
    addReminder: (reminder) => {
        reminders.push(reminder);
        saveReminders();
    }
};