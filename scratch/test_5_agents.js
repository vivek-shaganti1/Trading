require('dotenv').config();
const predictor = require('../backend/predictor');
const config = require('../shared/config');

// Helper to back up keys
const origGeminiKey = config.GEMINI_API_KEY;
const origGroqKey = config.GROQ_API_KEY;

async function testScenario(name, geminiKey, groqKey) {
  console.log(`\n==================================================`);
  console.log(`🧪 TEST SCENARIO: ${name}`);
  console.log(`==================================================`);
  
  // Apply temporary api key overrides
  config.GEMINI_API_KEY = geminiKey;
  config.GROQ_API_KEY = groqKey;

  const closes = [1500, 1502, 1498, 1500];
  try {
    const res = await predictor.getPrediction('RELIANCE', closes);
    console.log(`✓ Resulting Consensus Signal: ${res.signal}`);
    console.log(`✓ Resulting Consolidated Confidence: ${res.confidence}`);
  } catch (err) {
    console.error('❌ Prediction failed:', err);
  }
}

async function runAllTests() {
  // Scenario 1: Both APIs available (or whatever the active key states are)
  await testScenario('ALL AGENTS ACTIVE', origGeminiKey, origGroqKey);

  // Scenario 2: Gemini API disabled/failed
  await testScenario('GEMINI OFFLINE (GROQ ACTIVE)', null, origGroqKey);

  // Scenario 3: Groq API disabled/failed
  await testScenario('GROQ OFFLINE (GEMINI ACTIVE)', origGeminiKey, null);

  // Scenario 4: Both offline
  await testScenario('BOTH EXTERNAL AIs OFFLINE', null, null);

  // Restore keys
  config.GEMINI_API_KEY = origGeminiKey;
  config.GROQ_API_KEY = origGroqKey;
}

runAllTests().then(() => {
  console.log('\n🏁 5-Agent Validation Tests Complete.');
  process.exit(0);
}).catch(err => {
  console.error(err);
  process.exit(1);
});
