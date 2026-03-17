// Quick test script to verify AI configuration
require('dotenv').config();

function getAIConfig() {
    const useLocalLLM = process.env.USE_LOCAL_LLM === 'true';
    
    if (useLocalLLM) {
        const localLLMUrl = process.env.LOCAL_LLM_URL;
        const ollamaModel = process.env.OLLAMA_MODEL || 'llama2';
        
        if (!localLLMUrl || localLLMUrl === 'your_local_llm_url_here') {
            console.warn('USE_LOCAL_LLM is true but LOCAL_LLM_URL not configured');
            return { type: 'none' };
        }
        
        return { 
            type: 'ollama', 
            url: localLLMUrl,
            model: ollamaModel
        };
    } else {
        const geminiKey = process.env.GEMINI_API_KEY;
        
        if (!geminiKey || geminiKey === 'your_gemini_api_key_here') {
            return { type: 'none' };
        }
        
        return { 
            type: 'gemini', 
            apiKey: geminiKey 
        };
    }
}

console.log('=== AI Configuration Test ===\n');

const config = getAIConfig();

console.log('Environment Variables:');
console.log('  USE_LOCAL_LLM:', process.env.USE_LOCAL_LLM);
console.log('  LOCAL_LLM_URL:', process.env.LOCAL_LLM_URL);
console.log('  OLLAMA_MODEL:', process.env.OLLAMA_MODEL);
console.log('  GEMINI_API_KEY:', process.env.GEMINI_API_KEY ? '***configured***' : 'not set');

console.log('\nDetected Configuration:');
console.log('  Provider Type:', config.type);

if (config.type === 'ollama') {
    console.log('  Ollama URL:', config.url);
    console.log('  Ollama Model:', config.model);
    console.log('\n✅ Ollama configuration detected');
    console.log('⚠️  Make sure Ollama is running: ollama serve');
    console.log('⚠️  Make sure model is downloaded: ollama pull', config.model);
} else if (config.type === 'gemini') {
    console.log('  Gemini API Key:', config.apiKey.substring(0, 10) + '...');
    console.log('\n✅ Gemini configuration detected');
} else {
    console.log('\n❌ No AI provider configured!');
    console.log('\nTo configure:');
    console.log('  For Ollama: Set USE_LOCAL_LLM=true and LOCAL_LLM_URL');
    console.log('  For Gemini: Set USE_LOCAL_LLM=false and GEMINI_API_KEY');
}

console.log('\n=== Test Complete ===');
