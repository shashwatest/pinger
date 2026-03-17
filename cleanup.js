const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🧹 Cleaning up WhatsApp bot...\n');

// Kill node processes related to this bot
console.log('1. Stopping any running bot processes...');
try {
    if (process.platform === 'win32') {
        // Kill node processes that might be running the bot
        execSync('taskkill /F /IM node.exe /FI "WINDOWTITLE eq npm*" 2>nul', { stdio: 'ignore' });
    } else {
        execSync('pkill -f "node bot.js" 2>/dev/null || true', { stdio: 'ignore' });
        execSync('pkill -f "node telegram-bot.js" 2>/dev/null || true', { stdio: 'ignore' });
    }
    console.log('   ✅ Stopped bot processes');
} catch (err) {
    console.log('   ℹ️  No bot processes to stop');
}

// Wait a bit for processes to release files
console.log('\n2. Waiting for file locks to release...');
setTimeout(() => {
    // Try to remove session folder
    console.log('\n3. Removing session data...');
    const sessionPath = '.wwebjs_auth';
    
    if (fs.existsSync(sessionPath)) {
        try {
            fs.rmSync(sessionPath, { recursive: true, force: true, maxRetries: 3, retryDelay: 1000 });
            console.log('   ✅ Session data removed successfully');
        } catch (err) {
            console.log('   ⚠️  Could not remove session data:', err.message);
            console.log('   Please manually delete the .wwebjs_auth folder');
        }
    } else {
        console.log('   ℹ️  No session data to remove');
    }
    
    console.log('\n✅ Cleanup complete!');
    console.log('You can now run: npm start');
}, 2000);
