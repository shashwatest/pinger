const fs = require('fs');
const contactManager = require('./contact-manager');

let memories = [];
let reminders = [];
let chatHistory = {};
let scheduleItems = [];

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
        if (fs.existsSync('schedule.json')) {
            scheduleItems = JSON.parse(fs.readFileSync('schedule.json', 'utf8'));
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
    fs.writeFileSync('schedule.json', JSON.stringify(scheduleItems, null, 2));
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
    
    const label = reminder.contactLabel || (reminder.priority === 'HIGH' ? '🔴' : reminder.priority === 'MEDIUM' ? '🟡' : '🟢');
    
    if (totalDelay > oneHour) {
        const oneHourBeforeTime = targetDate.getTime() - oneHour;
        const oneHourDelay = oneHourBeforeTime - now.getTime();
        
        if (oneHourDelay > 0 && oneHourDelay <= maxTimeout) {
            console.log(`Scheduling 1-hour reminder in ${Math.round(oneHourDelay / 1000 / 60)} minutes`);
            setTimeout(async () => {
                const currentReminder = reminders.find(r => r.id === reminder.id);
                if (currentReminder && currentReminder.active) {
                    await notificationCallback(`1 hour reminder: ${label} ${reminder.task}`);
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
                    await notificationCallback(`30 minutes reminder: ${label} ${reminder.task}`);
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
                    await notificationCallback(`Reminder NOW: ${label} ${reminder.task}`);
                    
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

async function categorizeMessage(messageBody, apiKey) {
    if (!apiKey || apiKey === 'your_gemini_api_key_here') {
        console.log('Gemini API key not configured, skipping categorization');
        return null;
    }
    
    console.log('Sending message to Gemini for categorization...');
    
    const categorizePrompt = `Analyze this message and categorize it. Return JSON format:

        {
        "type": "REMINDER|MEMORY|SCHEDULE|NONE",
        "priority": "HIGH|MEDIUM|LOW",
        "content": "formatted for whatsapp and briefly summarised extracted content ensuring easy readability",
        "datetime": "exact date/time as mentioned in message, null if no date/time"
        }

        Rules:
        - MEMORY: containing information about birthdays, anniversaries or containing the keyword "!memory". and strictly nothing else should be categorized as memory.
        - REMINDER: Contains time/date references with tasks to do (and not birthdays or anniversaries) or containing the keyword "!reminder"
        - SCHEDULE: Tasks/meetings/appointments for a specific day (especially "today", "tomorrow") with or without specific time, or containing the keyword "!schedule". Examples: "I need to meet professor at 3pm today", "dentist appointment tomorrow", "gym session today evening"
        - HIGH priority: Only for urgent, time-sensitive, emergency, or critical meetings
        - MEDIUM priority: Regular tasks, appointments, meetings (DEFAULT for most schedule items)
        - LOW priority: Optional or flexible tasks
        - For datetime: Extract EXACTLY as written (e.g. "tomorrow at 3pm", "today at 5pm", "21st September 2025", "10am")

        Message: "${messageBody}"

        Return only valid JSON:`;
    
    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
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

function reloadSchedule() {
    try {
        if (fs.existsSync('schedule.json')) {
            const fileContent = fs.readFileSync('schedule.json', 'utf8');
            if (fileContent.trim()) {
                scheduleItems = JSON.parse(fileContent);
            }
        }
    } catch (error) {
        console.error('Error loading schedule:', error.message);
        scheduleItems = [];
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
        - "SHOW_SCHEDULE" - if user wants to see their schedule for a day
        - "ADD_SCHEDULE" - if user wants to add something to their schedule
        - "DELETE_ALL_SCHEDULE" - if user wants to clear all schedule items
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
            
        case 'SHOW_SCHEDULE':
            reloadSchedule();
            const todaySchedule = getTodaySchedule();
            if (todaySchedule.length === 0) {
                await messageSender('No schedule items for today.');
                return;
            }
            const scheduleList = todaySchedule.map((s, i) => {
                const time = s.targetDateTime ? new Date(s.targetDateTime).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : 'No time';
                const label = s.contactLabel || (s.priority === 'HIGH' ? '🔴' : s.priority === 'MEDIUM' ? '🟡' : '🟢');
                return `${i + 1}. ${label} ${s.task} - ${time}`;
            });
            await messageSender(`Today's Schedule:\n${scheduleList.join('\n')}`);
            break;
            
        case 'DELETE_ALL_MEMORIES':
            const memCount = clearAllMemories();
            await messageSender(memCount === 0 ? 'No memories to delete.' : `Deleted all ${memCount} memories.`);
            break;
            
        case 'DELETE_ALL_REMINDERS':
            const remCount = clearAllReminders();
            await messageSender(remCount === 0 ? 'No active reminders to delete.' : `Cancelled all ${remCount} reminders.`);
            break;
            
        case 'DELETE_ALL_SCHEDULE':
            const schedCount = clearAllSchedule();
            await messageSender(schedCount === 0 ? 'No schedule items to delete.' : `Deleted all ${schedCount} schedule items.`);
            break;
            
        case 'ADD_SCHEDULE':
            await messageSender('Use: "schedule [task] at [time]" or "add to schedule [task]"');
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

function setupMorningSchedule(scheduleCallback) {
    const cron = require('node-cron');
    cron.schedule('0 7 * * *', scheduleCallback);
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
    
    const todaySchedule = getTodaySchedule();
    
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
    
    if (todaySchedule.length > 0) {
        summary += `Today's Schedule (${todaySchedule.length} items):\n`;
        todaySchedule.forEach((s, i) => {
            const time = s.targetDateTime ? new Date(s.targetDateTime).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : 'No time';
            summary += `${i + 1}. ${s.task} - ${time}\n`;
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
    
    if (todayReminders.length === 0 && upcomingReminders.length === 0 && todaySchedule.length === 0 && todayMemories.length === 0) {
        summary += 'No new items created today and no upcoming reminders. Have a great evening!';
    }
    
    return summary;
}

function generateMorningSchedule() {
    const today = new Date().toDateString();
    const todaySchedule = getTodaySchedule();
    
    if (todaySchedule.length === 0) {
        return `Good morning! ☀️\n\nYou have no scheduled items for today (${today}).\n\nHave a great day!`;
    }
    
    let message = `Good morning! ☀️\n\nHere's your schedule for today (${today}):\n\n`;
    
    todaySchedule.forEach((s, i) => {
        const time = s.targetDateTime ? new Date(s.targetDateTime).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : 'No specific time';
        const label = s.contactLabel || (s.priority === 'HIGH' ? '🔴' : s.priority === 'MEDIUM' ? '🟡' : '🟢');
        message += `${i + 1}. ${label} ${s.task} - ${time}\n`;
    });
    
    message += '\nHave a productive day! 💪';
    return message;
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

function clearAllSchedule() {
    const count = scheduleItems.length;
    scheduleItems.length = 0;
    saveData();
    return count;
}

function getTodaySchedule() {
    const today = new Date().toDateString();
    return scheduleItems.filter(s => {
        if (!s.targetDateTime) return false;
        return new Date(s.targetDateTime).toDateString() === today;
    }).sort((a, b) => new Date(a.targetDateTime) - new Date(b.targetDateTime));
}

function getScheduleForDate(date) {
    const targetDateStr = date.toDateString();
    return scheduleItems.filter(s => {
        if (!s.targetDateTime) return false;
        return new Date(s.targetDateTime).toDateString() === targetDateStr;
    }).sort((a, b) => new Date(a.targetDateTime) - new Date(b.targetDateTime));
}

function parseDateFromCommand(dateStr) {
    const lower = dateStr.toLowerCase();
    const now = new Date();
    
    if (lower === 'today') return now;
    if (lower === 'tomorrow') {
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        return tomorrow;
    }
    
    if (dateStr.includes('-')) {
        return new Date(dateStr);
    }
    
    if (dateStr.includes('/')) {
        const parts = dateStr.split('/');
        return new Date(now.getFullYear(), parseInt(parts[0]) - 1, parseInt(parts[1]));
    }
    
    return now;
}

async function handleAddSchedule(command, chatId, apiKey, notificationFn, messageSender, notificationBot, telegramChatId) {
    const scheduleItem = {
        id: Date.now(),
        task: command.replace(/schedule|add to schedule|!schedule/gi, '').trim(),
        createdAt: new Date().toISOString(),
        originalDateTime: command,
        targetDateTime: null,
        chatId: chatId,
        priority: 'MEDIUM',
        autoCreated: false
    };
    
    const calculated = await calculateTargetDateTime(scheduleItem, apiKey);
    
    if (!calculated.targetDateTime) {
        const today = new Date();
        today.setHours(10, 0, 0, 0);
        calculated.targetDateTime = today.toISOString();
    }
    
    addScheduleItem(calculated);
    
    const reminder = {
        id: Date.now() + 1,
        task: calculated.task,
        createdAt: calculated.createdAt,
        originalDateTime: calculated.originalDateTime,
        targetDateTime: calculated.targetDateTime,
        chatId: chatId,
        active: true,
        priority: calculated.priority,
        autoCreated: false,
        isScheduleLinked: true
    };
    
    addReminder(reminder);
    
    if (calculated.targetDateTime) {
        scheduleMultiStageReminder(reminder, notificationFn);
        const targetDate = new Date(calculated.targetDateTime);
        await messageSender(`Added to schedule for ${targetDate.toLocaleDateString()} at ${targetDate.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}: "${calculated.task}"`);
    } else {
        await messageSender(`Added to schedule: "${calculated.task}" (no specific time)`);
    }
    
    await sendImmediateNotification('SCHEDULE', calculated.task, chatId, notificationBot, telegramChatId);
}

function addScheduleItem(item) {
    if (!item.timestamp || !item.timestamp.includes('T')) {
        item.timestamp = new Date().toISOString();
    }
    scheduleItems.push(item);
    saveData();
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

async function sendReminderNotification(message, notificationBot, chatId) {
    try {
        if (notificationBot && chatId) {
            await notificationBot.sendMessage(chatId, message);
        }
    } catch (error) {
        console.error('Error sending reminder notification:', error);
    }
}

async function handleDirectBlock(command, chatId, messageSender) {
    const input = command.replace(/block\s+/i, '').trim();
    if (!input) {
        await messageSender('Use: "block [phone/chatId] [name] [reason]"');
        return;
    }
    
    const parts = input.split(' ');
    const identifier = parts[0];
    const name = parts.length > 1 ? parts[1] : '';
    const reason = parts.slice(2).join(' ') || 'Manual block';
    
    const targetChatId = phoneToWhatsAppId(identifier);
    contactManager.addBlockedContact(targetChatId, reason, name);
    await messageSender(`Blocked: ${name || identifier} (${targetChatId})`);
}

async function handleDirectUnblock(command, chatId, messageSender) {
    const input = command.replace(/unblock\s+/i, '').trim();
    if (!input) {
        await messageSender('Use: "unblock [name/phone/chatId]"');
        return;
    }
    
    const contacts = contactManager.getContactLists();
    
    let targetContact = contacts.blocked.find(c => 
        c.chatId === input || 
        c.chatId === phoneToWhatsAppId(input) ||
        (c.name && c.name.toLowerCase() === input.toLowerCase())
    );
    
    if (!targetContact) {
        await messageSender(`Not found in blocked list: ${input}`);
        return;
    }
    
    const removed = contactManager.removeBlockedContact(targetContact.chatId);
    await messageSender(`Unblocked: ${removed.name || removed.chatId}`);
}

async function handleDirectAddPriority(command, chatId, messageSender) {
    const input = command.replace(/add priority\s+/i, '').trim();
    const parts = input.split(' ');
    
    if (parts.length < 2) {
        await messageSender('Use: "add priority [phone/chatId] [name] [keywords]"\nExample: "add priority 9876543210 Vipul bhaiya,urgent"');
        return;
    }
    
    const identifier = parts[0];
    const name = parts[1];
    const keywords = parts.slice(2).join(' ').split(',').map(k => k.trim()).filter(k => k);
    
    const targetChatId = phoneToWhatsAppId(identifier);
    const rules = keywords.length > 0 ? [{ type: 'ONLY_KEYWORDS', keywords }] : [];
    
    contactManager.addPriorityContact(targetChatId, 'HIGH', rules, name);
    await messageSender(`Added priority contact: ${name} (${targetChatId})\nKeywords: ${keywords.join(', ') || 'All messages'}`);
}

async function handleDirectRemovePriority(command, chatId, messageSender) {
    const input = command.replace(/remove priority\s+/i, '').trim();
    if (!input) {
        await messageSender('Use: "remove priority [name/phone/chatId]"');
        return;
    }
    
    const contacts = contactManager.getContactLists();
    
    let targetContact = contacts.priority.find(c => 
        c.chatId === input || 
        c.chatId === phoneToWhatsAppId(input) ||
        (c.name && c.name.toLowerCase() === input.toLowerCase())
    );
    
    if (!targetContact) {
        await messageSender(`Not found in priority list: ${input}`);
        return;
    }
    
    const removed = contactManager.removePriorityContact(targetContact.chatId);
    await messageSender(`Removed priority contact: ${removed.name || removed.chatId}`);
}

function getStatusMessage(chatId) {
    const activeRemindersCount = reminders.filter(r => r.active).length;
    const todaySchedule = getTodaySchedule();
    const contacts = contactManager.getContactLists();
    return `Bot Status:
• Memories: ${memories.length}
• Active reminders: ${activeRemindersCount}
• Today's schedule: ${todaySchedule.length} items
• Blocked contacts: ${contacts.blocked.length}
• Priority contacts: ${contacts.priority.length}
• Chat history: ${chatHistory[chatId]?.length || 0} messages`;
}

async function handleCommonCommands(command, fullChatId, chatId, apiKey, notificationFn, messageSender, notificationBot, telegramChatId, saveNextMode) {
    if (command === 'show memories' || command === 'list memories' || command === 'my memories' || command.includes('what have I asked you to remember')) {
        reloadMemories();
        if (memories.length === 0) {
            await messageSender('No memories saved yet.');
            return true;
        }
        const memoryList = memories.map((m, i) => `${i + 1}. ${m.content}${m.autoCreated ? ' (auto)' : ''}`);
        await messageSender(`Your memories:\n${memoryList.join('\n')}\n\nTo delete: "delete memory 1"`);
        return true;
    }
    
    if (command === 'show reminders' || command === 'list reminders' || command === 'my reminders') {
        reloadReminders();
        const activeReminders = reminders.filter(r => r.active);
        if (activeReminders.length === 0) {
            await messageSender('No active reminders.');
            return true;
        }
        const reminderList = activeReminders.map((r, i) => {
            const date = r.targetDateTime ? new Date(r.targetDateTime).toLocaleString() : 'No date';
            return `${i + 1}. ${r.task} - ${date}${r.autoCreated ? ' (auto)' : ''}`;
        });
        await messageSender(`Your reminders:\n${reminderList.join('\n')}\n\nTo cancel: "cancel reminder 1"`);
        return true;
    }
    
    if (command === 'show schedule' || command === 'list schedule' || command === 'my schedule' || command.includes('schedule for')) {
        reloadSchedule();
        const dateMatch = command.match(/schedule\s+(?:for\s+)?(today|tomorrow|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2})/i);
        const targetDate = dateMatch ? parseDateFromCommand(dateMatch[1]) : new Date();
        const scheduleForDate = getScheduleForDate(targetDate);
        
        if (scheduleForDate.length === 0) {
            const dateStr = targetDate.toDateString();
            await messageSender(`No schedule items for ${dateStr}.`);
            return true;
        }
        
        const dateStr = targetDate.toDateString();
        const scheduleList = scheduleForDate.map((s, i) => {
            const time = s.targetDateTime ? new Date(s.targetDateTime).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : 'No time';
            const label = s.contactLabel || (s.priority === 'HIGH' ? '🔴' : s.priority === 'MEDIUM' ? '🟡' : '🟢');
            return `${i + 1}. ${label} ${s.task} - ${time}`;
        });
        await messageSender(`Schedule for ${dateStr}:\n${scheduleList.join('\n')}`);
        return true;
    }
    
    if (command.includes('delete all memories') || command.includes('clear all memories')) {
        const count = clearAllMemories();
        await messageSender(count === 0 ? 'No memories to delete.' : `Deleted all ${count} memories.`);
        return true;
    }
    
    if (command.includes('delete all reminders') || command.includes('clear all reminders') || command.includes('cancel all reminders')) {
        const activeCount = clearAllReminders();
        await messageSender(activeCount === 0 ? 'No active reminders to delete.' : `Cancelled all ${activeCount} reminders.`);
        return true;
    }
    
    if (command.includes('delete all schedule') || command.includes('clear all schedule') || command.includes('clear schedule')) {
        const count = clearAllSchedule();
        await messageSender(count === 0 ? 'No schedule items to delete.' : `Deleted all ${count} schedule items.`);
        return true;
    }
    
    if (command.includes('cancel reminder') || command.includes('delete reminder')) {
        await handleCancelReminder(command, messageSender);
        return true;
    }
    
    if (command.includes('delete memory') || command.includes('remove memory')) {
        await handleDeleteMemory(command, messageSender);
        return true;
    }
    
    if (command.includes('save') && command.includes('memory')) {
        await handleSaveMemory(command, fullChatId, messageSender, notificationBot, telegramChatId);
        return true;
    }
    
    if (command === 'save next to memory') {
        saveNextMode[chatId] = true;
        await messageSender('Ready to save your next message to memory');
        return true;
    }
    
    const interpretedAction = await interpretCommand(command, apiKey);
    
    if (interpretedAction) {
        if (['CANCEL_REMINDER', 'DELETE_MEMORY', 'SAVE_MEMORY', 'SET_REMINDER', 'ADD_SCHEDULE'].includes(interpretedAction)) {
            switch (interpretedAction) {
                case 'CANCEL_REMINDER':
                    await handleCancelReminder(command, messageSender);
                    break;
                case 'DELETE_MEMORY':
                    await handleDeleteMemory(command, messageSender);
                    break;
                case 'SAVE_MEMORY':
                    await handleSaveMemory(command, fullChatId, messageSender, notificationBot, telegramChatId);
                    break;
                case 'SET_REMINDER':
                    await createReminder(command, fullChatId, apiKey, notificationFn, messageSender, notificationBot, telegramChatId);
                    break;
                case 'ADD_SCHEDULE':
                    await handleAddSchedule(command, fullChatId, apiKey, notificationFn, messageSender, notificationBot, telegramChatId);
                    break;
            }
        } else {
            await executeAction(interpretedAction, command, messageSender);
        }
        return true;
    }
    
    if (command.includes('remind')) {
        await createReminder(command, fullChatId, apiKey, notificationFn, messageSender, notificationBot, telegramChatId);
        return true;
    }
    
    return false;
}

module.exports = {
    loadData,
    saveData,
    reloadMemories,
    reloadReminders,
    reloadSchedule,
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
    sendReminderNotification,
    categorizeMessage,
    handleDirectBlock,
    handleDirectUnblock,
    handleDirectAddPriority,
    handleDirectRemovePriority,
    getStatusMessage,
    handleCommonCommands,
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
    getScheduleItems: () => scheduleItems,
    getTodaySchedule,
    getScheduleForDate,
    addMemory,
    addReminder,
    addScheduleItem,
    removeReminder,
    removeMemory,
    clearAllMemories,
    clearAllReminders,
    clearAllSchedule,
    setupMorningSchedule,
    generateMorningSchedule,
    handleAddSchedule
};