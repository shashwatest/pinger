const fs = require('fs');

// Contact lists
let blockedContacts = [];
let priorityContacts = [];

// Load contact lists
function loadContactLists() {
    try {
        if (fs.existsSync('blocked_contacts.json')) {
            blockedContacts = JSON.parse(fs.readFileSync('blocked_contacts.json', 'utf8'));
        }
        if (fs.existsSync('priority_contacts.json')) {
            priorityContacts = JSON.parse(fs.readFileSync('priority_contacts.json', 'utf8'));
        }
    } catch (error) {
        console.log('Error loading contact lists:', error.message);
    }
}

// Save contact lists
function saveContactLists() {
    fs.writeFileSync('blocked_contacts.json', JSON.stringify(blockedContacts, null, 2));
    fs.writeFileSync('priority_contacts.json', JSON.stringify(priorityContacts, null, 2));
}

// Check if contact should be processed
function shouldProcessContact(chatId) {
    // Always process own messages and main chat
    if (chatId === '918227967496@c.us' || chatId.toString() === process.env.MY_TELEGRAM_CHAT_ID) {
        return { process: true, priority: 'HIGH', rules: [] };
    }
    
    // Check if blocked
    const blocked = blockedContacts.find(c => c.chatId === chatId);
    if (blocked) {
        return { process: false, reason: blocked.reason || 'Blocked contact' };
    }
    
    // Check if priority contact
    const priority = priorityContacts.find(c => c.chatId === chatId);
    if (priority) {
        return { 
            process: true, 
            priority: priority.priority || 'HIGH',
            rules: priority.rules || [],
            name: priority.name
        };
    }
    
    // Default: process with normal priority
    return { process: true, priority: 'MEDIUM', rules: [] };
}

// Add blocked contact
function addBlockedContact(chatId, reason = 'Manual block', name = '') {
    const existing = blockedContacts.find(c => c.chatId === chatId);
    if (existing) {
        existing.reason = reason;
        existing.name = name;
        existing.blockedAt = new Date().toISOString();
    } else {
        blockedContacts.push({
            chatId,
            name,
            reason,
            blockedAt: new Date().toISOString()
        });
    }
    saveContactLists();
}

// Remove blocked contact
function removeBlockedContact(chatId) {
    const index = blockedContacts.findIndex(c => c.chatId === chatId);
    if (index !== -1) {
        const removed = blockedContacts.splice(index, 1)[0];
        saveContactLists();
        return removed;
    }
    return null;
}

// Add priority contact
function addPriorityContact(chatId, priority = 'HIGH', rules = [], name = '') {
    const existing = priorityContacts.find(c => c.chatId === chatId);
    if (existing) {
        existing.priority = priority;
        existing.rules = rules;
        existing.name = name;
        existing.updatedAt = new Date().toISOString();
    } else {
        priorityContacts.push({
            chatId,
            name,
            priority,
            rules,
            addedAt: new Date().toISOString()
        });
    }
    saveContactLists();
}

// Remove priority contact
function removePriorityContact(chatId) {
    const index = priorityContacts.findIndex(c => c.chatId === chatId);
    if (index !== -1) {
        const removed = priorityContacts.splice(index, 1)[0];
        saveContactLists();
        return removed;
    }
    return null;
}

// Apply contact-specific rules
function applyContactRules(messageBody, contactInfo) {
    if (!contactInfo.rules || contactInfo.rules.length === 0) {
        return { processMessage: true, modifications: [] };
    }
    
    let processMessage = true;
    let modifications = [];
    
    for (const rule of contactInfo.rules) {
        switch (rule.type) {
            case 'IGNORE_KEYWORDS':
                if (rule.keywords && rule.keywords.some(keyword => 
                    messageBody.toLowerCase().includes(keyword.toLowerCase()))) {
                    processMessage = false;
                    modifications.push(`Ignored due to keyword: ${rule.keywords.join(', ')}`);
                }
                break;
                
            case 'ONLY_KEYWORDS':
                if (rule.keywords && !rule.keywords.some(keyword => 
                    messageBody.toLowerCase().includes(keyword.toLowerCase()))) {
                    processMessage = false;
                    modifications.push(`Only processing messages with: ${rule.keywords.join(', ')}`);
                }
                break;
                
            case 'AUTO_CATEGORIZE':
                if (rule.forceCategory) {
                    modifications.push(`Force category: ${rule.forceCategory}`);
                }
                break;
                
            case 'NOTIFICATION_ONLY':
                modifications.push('Notification only - no auto-processing');
                break;
        }
    }
    
    return { processMessage, modifications };
}

// Get contact lists for display
function getContactLists() {
    return {
        blocked: blockedContacts,
        priority: priorityContacts
    };
}

module.exports = {
    loadContactLists,
    saveContactLists,
    shouldProcessContact,
    addBlockedContact,
    removeBlockedContact,
    addPriorityContact,
    removePriorityContact,
    applyContactRules,
    getContactLists
};