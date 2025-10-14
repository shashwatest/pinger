const fs = require('fs');
const contactManager = require('./contact-manager');

let memories = [];
let reminders = [];
let chatHistory = {};
let importantUpdates = [];

function loadData() {
    try {
        if (fs.existsSync('saved_memories.json')) {
            memories = JSON.parse(fs.readFileSync('saved_memories.json', 'utf8'));
        }
        if (fs.existsSync('reminders.json')) {
            reminders = JSON.parse(fs.readFileSync('reminders.json', 'utf8'));
        }
        if (fs.existsSync('chat_history.json')) {
            chatHistory = JSON.parse(fs.readFileSync('chat_history.json', 'utf8'));
        }
        if (fs.existsSync('important_updates.json')) {
            importantUpdates = JSON.parse(fs.readFileSync('important_updates.json', 'utf8'));
        }
        contactManager.loadContactLists();
    } catch (error) {
        console.log('Error loading data:', error.message);
    }
}

function saveData() {
    fs.writeFileSync('saved_memories.json', JSON.stringify(memories, null, 2));
    fs.writeFileSync('reminders.json', JSON.stringify(reminders, null, 2));
    fs.writeFileSync('chat_history.json', JSON.stringify(chatHistory, null, 2));
    fs.writeFileSync('important_updates.json', JSON.stringify(importantUpdates, null, 2));
}

async function callGeminiAPI(userMessage, context = [], memoriesContext = [], apiKey) {
    const systemPrompt = `You are ${process.env.MY_BOT_NAME}, Suman Verma's AI friend, remember you are not an assistant. 
    Respond in human-like language and be as precise or detailed based on your judgement of what would suffice for the query
    Your name is the Bengali pronunciation of "Shashwat"`;
    
    let prompt = systemPrompt + '\n\n';
    
    if (memoriesContext.length > 0) {
        prompt += 'Relevant memories:\n' + memoriesContext.map(m => `- ${m.content}`).join('\n') + '\n\n';
    }
    
    if (context.length > 0) {
        prompt += 'Recent conversation:\n' + context.slice(-10).map(msg => `${msg.role}: ${msg.content}`).join('\n') + '\n\n';
    }
    
    prompt += `User: ${userMessage}\nAssistant:`;
    
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
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

async function getAIResponse(chatId, userMessage, apiKey) {
    const context = chatHistory[chatId] || [];
    const relevantMemories = memories.slice(-5);
    
    if (apiKey && apiKey !== 'your_gemini_api_key_here') {
        return await callGeminiAPI(userMessage, context, relevantMemories, apiKey);
    } else {
        return `Hello! I received: "${userMessage}". Please configure GEMINI_API_KEY in .env for AI responses.`;
    }
}

async function calculateTargetDateTime(reminder, apiKey) {
    if (!apiKey || apiKey === 'your_gemini_api_key_here') {
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
- Current local time: ${new Date().toLocaleString()}
- Extract clean task from original text, removing time references
- Calculate targetDateTime in LOCAL timezone (not UTC)
- If no valid time found, set targetDateTime to null
- Priority: HIGH for urgent/soon, MEDIUM for normal, LOW for far future
- Examples: "tomorrow 3pm" → tomorrow at 15:00 LOCAL TIME, "10am" → today/tomorrow 10:00 LOCAL TIME
- IMPORTANT: Return datetime in local timezone format, not UTC

Original text: "${reminder.originalDateTime}"

Return only valid JSON:`;
    
    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
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
        
        if (rawResult.startsWith('```json')) {
            rawResult = rawResult.replace(/```json\s*/, '').replace(/\s*```$/, '');
        }
        if (rawResult.startsWith('```')) {
            rawResult = rawResult.replace(/```\s*/, '').replace(/\s*```$/, '');
        }
        
        rawResult = rawResult.replace(/\n/g, ' ').replace(/\r/g, '').trim();
        
        const geminiResult = JSON.parse(rawResult);
        
        return {
            ...reminder,
            task: geminiResult.task || reminder.task,
            targetDateTime: geminiResult.targetDateTime,
            priority: geminiResult.priority || 'MEDIUM'
        };
    } catch (error) {
        console.error('Error calculating target datetime:', error);
        return reminder;
    }
}

function scheduleMultiStageReminder(reminder, notificationCallback) {
    if (!reminder.active) {
        console.log(`Skipping inactive reminder: ${reminder.task}`);
        return;
    }
    
    const targetDate = new Date(reminder.targetDateTime);
    const now = new Date();
    
    console.log(`Scheduling reminder: ${reminder.task} (ID: ${reminder.id})`);
    console.log(`Target time: ${targetDate.toISOString()}`);
    console.log(`Current time: ${now.toISOString()}`);
    
    if (targetDate <= now) {
        console.error('Reminder time is in the past:', reminder.targetDateTime);
        reminder.active = false;
        saveData();
        return;
    }
    
    const totalDelay = targetDate.getTime() - now.getTime();
    const oneHour = 60 * 60 * 1000;
    const thirtyMinutes = 30 * 60 * 1000;
    const maxTimeout = 2147483647;
    
    console.log(`Total delay: ${Math.round(totalDelay / 1000 / 60)} minutes`);
    
    if (totalDelay > maxTimeout) {
        console.log(`Reminder too far in future (${Math.round(totalDelay / 1000 / 60 / 60 / 24)} days), will be rescheduled on next startup`);
        return;
    }
    
    if (totalDelay > oneHour) {
        const oneHourBeforeTime = targetDate.getTime() - oneHour;
        const oneHourDelay = oneHourBeforeTime - now.getTime();
        
        if (oneHourDelay > 0 && oneHourDelay <= maxTimeout) {
            console.log(`Scheduling 1-hour reminder in ${Math.round(oneHourDelay / 1000 / 60)} minutes`);
            setTimeout(async () => {
                const currentReminder = reminders.find(r => r.id === reminder.id);
                if (currentReminder && currentReminder.active) {
                    await notificationCallback(`1 hour reminder: ${reminder.task}`);
                }
            }, oneHourDelay);
        }
    }
    
    if (totalDelay > thirtyMinutes) {
        const thirtyMinBeforeTime = targetDate.getTime() - thirtyMinutes;
        const thirtyMinDelay = thirtyMinBeforeTime - now.getTime();
        
        if (thirtyMinDelay > 0 && thirtyMinDelay <= maxTimeout) {
            console.log(`Scheduling 30-min reminder in ${Math.round(thirtyMinDelay / 1000 / 60)} minutes`);
            setTimeout(async () => {
                const currentReminder = reminders.find(r => r.id === reminder.id);
                if (currentReminder && currentReminder.active) {
                    await notificationCallback(`30 minutes reminder: ${reminder.task}`);
                }
            }, thirtyMinDelay);
        }
    }
    
    if (totalDelay <= maxTimeout) {
        console.log(`Scheduling main reminder in ${Math.round(totalDelay / 1000 / 60)} minutes`);
        setTimeout(async () => {
            try {
                const currentReminder = reminders.find(r => r.id === reminder.id);
                if (currentReminder && currentReminder.active) {
                    await notificationCallback(`Reminder NOW: ${reminder.task}`);
                    
                    currentReminder.active = false;
                    saveData();
                }
            } catch (error) {
                console.error('Error sending reminder:', error);
            }
        }, totalDelay);
    } else {
        console.log(`Main reminder too far in future, will be scheduled on next startup`);
    }
}

async function sendImmediateNotification(type, content, fromChatId, telegramBot, telegramChatId) {
    const message = `New ${type.toLowerCase()}: ${content} (from ${fromChatId})`;
    
    try {
        if (telegramBot && telegramChatId) {
            await telegramBot.sendMessage(telegramChatId, message);
        }
    } catch (error) {
        console.error('Error sending immediate notification:', error);
    }
}

function scheduleExistingReminders(notificationCallback, filterFn = () => true) {
    const activeReminders = reminders.filter(r => r.active && r.targetDateTime);
    console.log(`Found ${activeReminders.length} active reminders to schedule...`);
    
    let scheduledCount = 0;
    let pastCount = 0;
    
    activeReminders.forEach(reminder => {
        if (filterFn(reminder)) {
            const targetDate = new Date(reminder.targetDateTime);
            const now = new Date();
            
            if (targetDate <= now) {
                console.log(`Marking past reminder as inactive: ${reminder.task} (was scheduled for ${targetDate.toISOString()})`);
                reminder.active = false;
                pastCount++;
                return;
            }
            
            console.log(`Scheduling existing reminder: ${reminder.task} for ${targetDate.toISOString()}`);
            scheduleMultiStageReminder(reminder, notificationCallback);
            scheduledCount++;
        }
    });
    
    console.log(`Scheduled ${scheduledCount} future reminders, marked ${pastCount} past reminders as inactive`);
    
    if (pastCount > 0) {
        saveData();
    }
}

function addToHistory(chatId, role, content) {
    if (!chatHistory[chatId]) chatHistory[chatId] = [];
    
    chatHistory[chatId].push({ role, content, timestamp: Date.now() });
    if (chatHistory[chatId].length > 20) {
        chatHistory[chatId] = chatHistory[chatId].slice(-20);
    }
}

function reloadMemories() {
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
}

function reloadReminders() {
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
}

function extractNumberFromText(text) {
    const lowerText = text.toLowerCase();
    
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

async function interpretCommand(userCommand, apiKey) {
    if (!apiKey || apiKey === 'your_gemini_api_key_here') {
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
        - "SHOW_BLOCKED" - if user wants to see blocked contacts
        - "SHOW_PRIORITY" - if user wants to see priority contacts
        - "BLOCK_CONTACT" - if user wants to block a contact
        - "UNBLOCK_CONTACT" - if user wants to unblock a contact
        - "ADD_PRIORITY" - if user wants to add a priority contact
        - "REMOVE_PRIORITY" - if user wants to remove a priority contact

        User command: "${userCommand}"

        Return only the action name or "NONE":`;
    
    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
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

async function executeAction(action, command, messageSender) {
    switch (action) {
        case 'SHOW_MEMORIES':
            reloadMemories();
            if (memories.length === 0) {
                await messageSender('No memories saved yet.');
                return;
            }
            const memoryList = memories.map((m, i) => `${i + 1}. ${m.content}${m.autoCreated ? ' (auto)' : ''}`);
            await messageSender(`Your memories:\n${memoryList.join('\n')}`);
            break;
            
        case 'SHOW_REMINDERS':
            reloadReminders();
            const activeReminders = reminders.filter(r => r.active);
            if (activeReminders.length === 0) {
                await messageSender('No active reminders.');
                return;
            }
            const reminderList = activeReminders.map((r, i) => {
                let dateStr = 'No date';
                if (r.targetDateTime) {
                    const targetDate = new Date(r.targetDateTime);
                    const localDate = targetDate.toLocaleDateString();
                    const localTime = targetDate.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
                    dateStr = `${localDate} at ${localTime}`;
                }
                const auto = r.autoCreated ? ' (auto)' : '';
                return `${i + 1}. ${r.task} - ${dateStr}${auto}`;
            });
            await messageSender(`Your reminders:\n${reminderList.join('\n')}`);
            break;
            
        case 'SHOW_UPDATES':
            if (importantUpdates.length === 0) {
                await messageSender('No important updates.');
                return;
            }
            const updateList = importantUpdates.map((u, i) => {
                const priority = u.priority === 'HIGH' ? 'HIGH' : u.priority === 'MEDIUM' ? 'MED' : 'LOW';
                return `${i + 1}. [${priority}] ${u.content} (${u.timestamp})`;
            });
            await messageSender(`Important updates:\n${updateList.join('\n')}`);
            importantUpdates.forEach(u => u.read = true);
            saveData();
            break;
            
        case 'DELETE_ALL_MEMORIES':
            const memCount = clearAllMemories();
            await messageSender(memCount === 0 ? 'No memories to delete.' : `Deleted all ${memCount} memories.`);
            break;
            
        case 'DELETE_ALL_REMINDERS':
            const remCount = clearAllReminders();
            await messageSender(remCount === 0 ? 'No active reminders to delete.' : `Cancelled all ${remCount} reminders.`);
            break;
            
        case 'DELETE_ALL_UPDATES':
            const updCount = clearAllUpdates();
            await messageSender(updCount === 0 ? 'No updates to delete.' : `Deleted all ${updCount} updates.`);
            break;
            
        case 'SHOW_BLOCKED':
            const contacts = contactManager.getContactLists();
            if (contacts.blocked.length === 0) {
                await messageSender('No blocked contacts.');
            } else {
                const blockedList = contacts.blocked.map((c, i) => 
                    `${i + 1}. ${c.name || c.chatId} - ${c.reason}`).join('\n');
                await messageSender(`Blocked contacts:\n${blockedList}`);
            }
            break;
            
        case 'SHOW_PRIORITY':
            const priorityList = contactManager.getContactLists();
            if (priorityList.priority.length === 0) {
                await messageSender('No priority contacts.');
            } else {
                const list = priorityList.priority.map((c, i) => 
                    `${i + 1}. ${c.name || c.chatId} - ${c.priority} (${c.rules.length} rules)`).join('\n');
                await messageSender(`Priority contacts:\n${list}`);
            }
            break;
            
        case 'ADD_PRIORITY':
            await messageSender('Use: "add priority [phone/chatId] [name] [keywords]"\nExample: "add priority 9876543210 Vipul bhaiya,urgent"');
            break;
            
        case 'REMOVE_PRIORITY':
            await messageSender('Use: "remove priority [phone/chatId]"');
            break;
    }
}

async function handleCancelReminder(command, messageSender) {
    const match = command.match(/(\d+)/) || [null, extractNumberFromText(command)];
    if (!match || !match[1]) {
        await messageSender('Please specify which reminder number to cancel');
        return;
    }
    
    const reminderIndex = parseInt(match[1]) - 1;
    const activeReminders = reminders.filter(r => r.active);
    
    if (reminderIndex < 0 || reminderIndex >= activeReminders.length) {
        await messageSender('Invalid reminder number');
        return;
    }
    
    const targetReminder = activeReminders[reminderIndex];
    removeReminder(targetReminder.id);
    await messageSender(`Cancelled reminder: ${targetReminder.task}`);
}

async function handleDeleteMemory(command, messageSender) {
    const match = command.match(/(\d+)/) || [null, extractNumberFromText(command)];
    if (!match || !match[1]) {
        await messageSender('Please specify which memory number to delete');
        return;
    }
    
    const memoryIndex = parseInt(match[1]) - 1;
    
    if (memoryIndex < 0 || memoryIndex >= memories.length) {
        await messageSender('Invalid memory number');
        return;
    }
    
    const deletedMemory = removeMemory(memoryIndex);
    await messageSender(`Deleted memory: ${deletedMemory.content}`);
}

async function handleSaveMemory(command, chatId, messageSender, notificationBot, telegramChatId) {
    const contentToSave = command.replace(/save.*?memory.*?that/i, '').replace(/save.*?to.*?memory/i, '').trim();
    
    if (!contentToSave) {
        await messageSender('Please specify what to save');
        return;
    }
    
    const memory = {
        content: contentToSave,
        timestamp: new Date().toISOString(),
        chatId: chatId,
        priority: 'MEDIUM',
        autoCreated: false
    };
    
    addMemory(memory);
    await messageSender('Saved to memory: ' + contentToSave);
    
    await sendImmediateNotification('MEMORY', contentToSave, chatId, notificationBot, telegramChatId);
}

async function createReminder(command, chatId, apiKey, notificationCallback, messageSender, notificationBot, telegramChatId) {
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
    
    const calculatedReminder = await calculateTargetDateTime(reminder, apiKey);
    addReminder(calculatedReminder);
    
    if (calculatedReminder.targetDateTime) {
        scheduleMultiStageReminder(calculatedReminder, notificationCallback);
        const targetDate = new Date(calculatedReminder.targetDateTime);
        await messageSender(`Reminder set for ${targetDate.toLocaleString()}: "${calculatedReminder.task}"`);
    } else {
        await messageSender(`Could not parse date/time from: "${command}"`);
        return;
    }
    
    await sendImmediateNotification('REMINDER', calculatedReminder.task, chatId, notificationBot, telegramChatId);
}

function setupDailySummary(summaryCallback) {
    const cron = require('node-cron');
    cron.schedule('0 21 * * *', summaryCallback);
}

function setupPeriodicReminderCheck(notificationCallback, filterFn = () => true) {
    const cron = require('node-cron');
    cron.schedule('0 0 * * *', () => {
        console.log('Checking for long-term reminders that can now be scheduled...');
        const now = new Date();
        const maxTimeout = 2147483647;
        const activeReminders = reminders.filter(r => r.active && r.targetDateTime && filterFn(r));
        
        let scheduledCount = 0;
        activeReminders.forEach(reminder => {
            const targetDate = new Date(reminder.targetDateTime);
            const totalDelay = targetDate.getTime() - now.getTime();
            
            if (totalDelay > 0 && totalDelay <= maxTimeout) {
                console.log(`Scheduling previously long-term reminder: ${reminder.task}`);
                scheduleMultiStageReminder(reminder, notificationCallback);
                scheduledCount++;
            }
        });
        
        if (scheduledCount > 0) {
            console.log(`Scheduled ${scheduledCount} long-term reminders`);
        }
    });
}

function generateDailySummary() {
    const today = new Date().toDateString();
    const now = new Date();
    const fourDaysFromNow = new Date(now.getTime() + (4 * 24 * 60 * 60 * 1000));
    
    const todayReminders = reminders.filter(r => {
        if (!r.createdAt) return false;
        return new Date(r.createdAt).toDateString() === today;
    });
    
    const upcomingReminders = reminders.filter(r => {
        if (!r.active || !r.targetDateTime) return false;
        const targetDate = new Date(r.targetDateTime);
        return targetDate >= now && targetDate <= fourDaysFromNow;
    }).sort((a, b) => new Date(a.targetDateTime) - new Date(b.targetDateTime));
    
    const todayUpdates = importantUpdates.filter(u => {
        if (!u.timestamp) return false;
        const updateDate = u.timestamp.includes('T') ? new Date(u.timestamp) : new Date(Date.parse(u.timestamp));
        return updateDate.toDateString() === today;
    });
    
    const todayMemories = memories.filter(m => {
        if (!m.timestamp) return false;
        const memoryDate = m.timestamp.includes('T') ? new Date(m.timestamp) : new Date(Date.parse(m.timestamp));
        return memoryDate.toDateString() === today;
    });
    
    let summary = `Daily Summary - ${today}\n\n`;
    
    if (todayReminders.length > 0) {
        summary += `New Reminders Created (${todayReminders.length}):\n`;
        todayReminders.forEach((r, i) => {
            const auto = r.autoCreated ? ' (auto)' : '';
            summary += `${i + 1}. ${r.task}${auto}\n`;
        });
        summary += '\n';
    }
    
    if (upcomingReminders.length > 0) {
        summary += `Upcoming Reminders (Next 4 Days):\n`;
        upcomingReminders.forEach((r, i) => {
            const targetDate = new Date(r.targetDateTime);
            const dateStr = targetDate.toLocaleDateString();
            const timeStr = targetDate.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
            summary += `${i + 1}. ${r.task} - ${dateStr} at ${timeStr}\n`;
        });
        summary += '\n';
    }
    
    if (todayUpdates.length > 0) {
        summary += `New Updates Created (${todayUpdates.length}):\n`;
        todayUpdates.slice(0, 5).forEach((u, i) => {
            const priority = u.priority === 'HIGH' ? 'HIGH' : u.priority === 'MEDIUM' ? 'MED' : 'LOW';
            summary += `${i + 1}. [${priority}] ${u.content}\n`;
        });
        summary += '\n';
    }
    
    if (todayMemories.length > 0) {
        summary += `New Memories Created (${todayMemories.length}):\n`;
        todayMemories.forEach((m, i) => {
            const auto = m.autoCreated ? ' (auto)' : '';
            summary += `${i + 1}. ${m.content}${auto}\n`;
        });
        summary += '\n';
    }
    
    if (todayReminders.length === 0 && upcomingReminders.length === 0 && todayUpdates.length === 0 && todayMemories.length === 0) {
        summary += 'No new items created today and no upcoming reminders. Have a great evening!';
    }
    
    return summary;
}

function phoneToWhatsAppId(input) {
    if (input.includes('@') || input.startsWith('telegram_')) {
        return input;
    }
    
    const cleanNumber = input.replace(/[\s\-\+]/g, '');
    
    if (cleanNumber.length === 10 && /^\d+$/.test(cleanNumber)) {
        return `91${cleanNumber}@c.us`;
    }
    
    if (/^\d+$/.test(cleanNumber)) {
        return `${cleanNumber}@c.us`;
    }
    
    return input;
}

function clearAllMemories() {
    const count = memories.length;
    memories.length = 0;
    saveData();
    return count;
}

function clearAllReminders() {
    const activeCount = reminders.filter(r => r.active).length;
    reminders.length = 0;
    saveData();
    return activeCount;
}

function clearAllUpdates() {
    const count = importantUpdates.length;
    importantUpdates.length = 0;
    saveData();
    return count;
}

function addMemory(memory) {
    if (!memory.timestamp || !memory.timestamp.includes('T')) {
        memory.timestamp = new Date().toISOString();
    }
    memories.push(memory);
    saveData();
}

function addReminder(reminder) {
    reminders.push(reminder);
    saveData();
}

function addImportantUpdate(update) {
    if (!update.timestamp || !update.timestamp.includes('T')) {
        update.timestamp = new Date().toISOString();
    }
    importantUpdates.push(update);
    saveData();
}

function removeReminder(id) {
    const index = reminders.findIndex(r => r.id === id);
    if (index !== -1) {
        reminders.splice(index, 1);
        saveData();
    }
}

function removeMemory(index) {
    if (index >= 0 && index < memories.length) {
        const deleted = memories.splice(index, 1)[0];
        saveData();
        return deleted;
    }
    return null;
}

module.exports = {
    loadData,
    saveData,
    reloadMemories,
    reloadReminders,
    addToHistory,
    callGeminiAPI,
    getAIResponse,
    calculateTargetDateTime,
    interpretCommand,
    executeAction,
    handleCancelReminder,
    handleDeleteMemory,
    handleSaveMemory,
    scheduleMultiStageReminder,
    scheduleExistingReminders,
    createReminder,
    setupDailySummary,
    generateDailySummary,
    setupPeriodicReminderCheck,
    sendImmediateNotification,
    shouldProcessContact: contactManager.shouldProcessContact,
    applyContactRules: contactManager.applyContactRules,
    addBlockedContact: contactManager.addBlockedContact,
    removeBlockedContact: contactManager.removeBlockedContact,
    addPriorityContact: contactManager.addPriorityContact,
    removePriorityContact: contactManager.removePriorityContact,
    getContactLists: contactManager.getContactLists,
    extractNumberFromText,
    phoneToWhatsAppId,
    getMemories: () => memories,
    getReminders: () => reminders,
    getChatHistory: () => chatHistory,
    getImportantUpdates: () => importantUpdates,
    addMemory,
    addReminder,
    addImportantUpdate,
    removeReminder,
    removeMemory,
    clearAllMemories,
    clearAllReminders,
    clearAllUpdates
};