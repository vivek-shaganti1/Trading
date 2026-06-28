require('dotenv').config();

async function auditGroq() {
  const token = process.env.GROQ_API_KEY;
  const model = 'llama-3.3-70b-versatile';

  console.log('=== Groq Integration Audit ===');
  console.log(`1. Groq API Key loaded: ${token ? 'YES (length: ' + token.length + ')' : 'NO'}`);
  console.log(`2. Configured Model: ${model}`);

  if (!token) {
    console.error('❌ Aborting: Groq API Key is missing.');
    return;
  }

  const url = 'https://api.groq.com/openai/v1/chat/completions';
  console.log('\n3. Performing live completion request...');
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        model: model,
        messages: [{ role: 'user', content: 'Say hello' }]
      })
    });

    console.log(`4. HTTP Status Code: ${response.status}`);
    const resText = await response.text();
    console.log(`5. Response text (first 100 characters):`);
    console.log(resText.slice(0, 100));

    if (!response.ok) {
      console.log('❌ Authentication/Request failed.');
      console.log('Full Error Details:', resText);
    } else {
      console.log('✅ Completion succeeded!');
    }
  } catch (err) {
    console.error('💥 Live request failed:', err.message);
  }
}

auditGroq();
