require('dotenv').config();

async function auditTelegram() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  console.log('=== Telegram Integration Audit ===');
  console.log(`1. Bot Token loaded: ${token ? 'YES (length: ' + token.length + ')' : 'NO'}`);
  console.log(`2. Chat ID loaded: ${chatId ? 'YES (value: ' + chatId + ')' : 'NO'}`);

  if (!token) {
    console.error('❌ Aborting: Bot token missing.');
    return;
  }

  // 3. Authenticate with getMe
  const getMeUrl = `https://api.telegram.org/bot${token}/getMe`;
  console.log(`\nRequesting getMe: ${getMeUrl.replace(token, 'TOKEN_REDACTED')}`);
  try {
    const response = await fetch(getMeUrl);
    const data = await response.json();
    console.log(`HTTP Status Code: ${response.status}`);
    console.log('Response JSON:', JSON.stringify(data, null, 2));

    if (data.ok) {
      console.log(`✅ Authentication Succeeded.`);
      console.log(`Bot Username: @${data.result.username}`);
      console.log(`Bot ID: ${data.result.id}`);
    } else {
      console.log('❌ Authentication Failed.');
    }
  } catch (err) {
    console.error('💥 getMe Request failed:', err.message);
  }

  if (!chatId) {
    console.warn('⚠️ Warning: Chat ID missing. Skipping message send test.');
    return;
  }

  // 6. Send Test Message
  const sendUrl = `https://api.telegram.org/bot${token}/sendMessage`;
  const message = 'AGY-TRADER TELEGRAM TEST';
  console.log(`\nSending message to chat ID ${chatId}...`);
  try {
    const response = await fetch(sendUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message
      })
    });
    const data = await response.json();
    console.log(`HTTP Status Code: ${response.status}`);
    console.log('Response JSON:', JSON.stringify(data, null, 2));

    if (data.ok) {
      console.log('✅ Message delivery succeeded!');
      console.log(`Message ID: ${data.result.message_id}`);
    } else {
      console.log('❌ Message delivery failed.');
      console.log(`Error Code: ${data.error_code}`);
      console.log(`Description: ${data.description}`);
    }
  } catch (err) {
    console.error('💥 sendMessage Request failed:', err.message);
  }
}

auditTelegram();
