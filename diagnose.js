const dns = require('dns');
const https = require('https');

console.log('Running WhatsApp Bot Diagnostics...\n');

// Check DNS resolution
console.log('1. Checking DNS resolution for web.whatsapp.com...');
dns.resolve4('web.whatsapp.com', (err, addresses) => {
    if (err) {
        console.log('   ❌ DNS resolution failed:', err.message);
    } else {
        console.log('   ✅ DNS resolved:', addresses.join(', '));
    }
    
    // Check HTTPS connectivity
    console.log('\n2. Checking HTTPS connectivity to WhatsApp...');
    const req = https.get('https://web.whatsapp.com', (res) => {
        console.log('   ✅ HTTPS connection successful');
        console.log('   Status code:', res.statusCode);
        res.resume();
        
        console.log('\n3. Checking session data...');
        const fs = require('fs');
        if (fs.existsSync('.wwebjs_auth')) {
            console.log('   ⚠️  Session folder exists (.wwebjs_auth)');
            console.log('   If bot fails, try deleting this folder');
        } else {
            console.log('   ✅ No session folder (fresh start)');
        }
        
        console.log('\n✅ All diagnostics passed!');
        console.log('You can now run: npm start');
    });
    
    req.on('error', (err) => {
        console.log('   ❌ HTTPS connection failed:', err.message);
        console.log('\nPossible solutions:');
        console.log('- Check your firewall settings');
        console.log('- Try using a VPN');
        console.log('- Check if WhatsApp is blocked in your region');
    });
    
    req.setTimeout(10000, () => {
        req.destroy();
        console.log('   ❌ Connection timeout');
    });
});
