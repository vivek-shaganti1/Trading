require('dotenv').config();
const config = require('../shared/config');

async function auditGemini() {
  console.log('--- GEMINI INTEGRATION AUDIT ---');
  
  // 1. Is GEMINI_API_KEY loaded?
  const keyLoaded = !!config.GEMINI_API_KEY;
  console.log(`1. GEMINI_API_KEY loaded: ${keyLoaded}`);
  
  // 2. Which model?
  const model = 'gemini-2.0-flash';
  console.log(`2. Configured Model: ${model}`);

  // 3. Prompt setup
  const symbol = 'RELIANCE';
  const ltp = 1258.8;
  const pred1 = { signal: 'BUY', reasoning: 'Stock momentum 0.20%, positive index' };
  const pred3 = { signal: 'HOLD', reasoning: 'Bearish EMA trends, downward movement' };
  const pred4 = { signal: 'HOLD', reasoning: 'Bearish global indices, sector average down' };

  const prompt = `
    You are the External AI Analysis Layer (Agent 2) of a quant trading platform.
    Analyze the trade signals and reasoning from three other specialized agents for ${symbol} at current price ₹${ltp}:
    
    Agent 1 (Custom Internal Model):
    - Recommended Signal: ${pred1.signal}
    - Reasoning: ${pred1.reasoning}
    
    Agent 3 (Technical Analysis Engine):
    - Recommended Signal: ${pred3.signal}
    - Reasoning: ${pred3.reasoning}
    
    Agent 4 (Market Context Engine):
    - Recommended Signal: ${pred4.signal}
    - Reasoning: ${pred4.reasoning}
    
    Your role:
    1. Provide an independent External AI trading decision (BUY, SELL, or HOLD) based on their signals, index direction, volatility, and global macro trends.
    2. Act as the Debate Moderator. Debate their outputs, challenge any weak logic, and output a debate summary explaining which signals were discarded and why.
    
    Respond strictly in JSON format matching this schema:
    {
      "signal": "BUY" | "SELL" | "HOLD",
      "confidence": float (0.0 to 1.0),
      "debate_summary": "detailed explanation of signal challenge and resolution"
    }
  `;

  console.log('6. Exact prompt sent to Gemini:');
  console.log(prompt.trim());

  // 4. Live API Call
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.GEMINI_API_KEY}`;
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }]
      })
    });

    console.log(`4. HTTP Status Code: ${response.status}`);
    
    const textData = await response.text();
    console.log('5. First 200 characters of Gemini response:');
    console.log(textData.substring(0, 200));

    if (response.ok) {
      const resData = JSON.parse(textData);
      const text = resData?.candidates?.[0]?.content?.parts?.[0]?.text;
      const cleanJson = text.replace(/```json/g, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(cleanJson);
      
      console.log(`7. Parsed signal returned by Gemini: ${parsed.signal}`);
      console.log(`8. Confidence returned by Gemini: ${parsed.confidence}`);
    } else {
      console.log('7. Parsed signal returned by Gemini: N/A (Failed request)');
      console.log('8. Confidence returned by Gemini: N/A (Failed request)');
    }
  } catch (err) {
    console.log('4. HTTP Status Code: Error');
    console.log(`Error message: ${err.message}`);
  }
}

auditGemini();
