require('dotenv').config();
const config = require('../shared/config');

async function listModels() {
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${config.GEMINI_API_KEY}`;
  try {
    const response = await fetch(url);
    console.log('Status:', response.status);
    const data = await response.json();
    console.log(JSON.stringify(data, null, 2));
  } catch (err) {
    console.error(err);
  }
}
listModels();
