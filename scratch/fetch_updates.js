require('dotenv').config();

async function fetchUpdates() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.error('❌ Bot token missing.');
    return;
  }

  const url = `https://api.telegram.org/bot${token}/getUpdates?limit=20`;
  console.log(`📡 Fetching updates from: ${url.replace(token, 'TOKEN_REDACTED')}`);

  try {
    const response = await fetch(url);
    const data = await response.json();
    console.log(`HTTP Status: ${response.status}`);
    console.log(JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('💥 Error fetching updates:', err.message);
  }
}

fetchUpdates();
