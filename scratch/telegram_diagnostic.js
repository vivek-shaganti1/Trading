require('dotenv').config();

async function checkWebhook() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.error('❌ Bot token missing.');
    return;
  }

  const url = `https://api.telegram.org/bot${token}/getWebhookInfo`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    console.log('=== Webhook Info ===');
    console.log(JSON.stringify(data, null, 2));
  } catch (err) {
    console.error(err);
  }
}

checkWebhook();
