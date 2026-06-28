const config = require('./config');
const db = require('./db');
const providerHealth = require('./providerHealth');

// In-memory alert cache for dashboard UI polling/sockets
const recentAlerts = [];

function addAlertToCache(title, message, type = 'info') {
  recentAlerts.unshift({
    timestamp: new Date().toISOString(),
    title,
    message,
    type
  });
  if (recentAlerts.length > 50) {
    recentAlerts.pop();
  }
}

const alerts = {
  // Return cached alerts for UI
  getRecentAlerts() {
    return recentAlerts;
  },

  // Telegram dispatch helper
  async sendTelegram(message) {
    console.log(`[TELEGRAM OUT]: ${message}`);
    addAlertToCache('Telegram Notification', message, 'telegram');

    if (!config.TELEGRAM_BOT_TOKEN || !config.TELEGRAM_CHAT_ID) {
      console.warn('Telegram Credentials missing in environment. Mocking alert.');
      try { await db.logAlert({ type: 'telegram', message, status: 'MOCKED' }); } catch(e) {}
      return false;
    }

    const startTime = Date.now();
    try {
      const url = `https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/sendMessage`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: config.TELEGRAM_CHAT_ID,
          text: message,
          parse_mode: 'HTML'
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error('Telegram API error:', errText);
        providerHealth.recordCall('Telegram', startTime, false, `Status ${response.status}`);
        try { await db.logAlert({ type: 'telegram', message, status: 'FAILED' }); } catch(e) {}
        return false;
      }
      providerHealth.recordCall('Telegram', startTime, true, '200 OK');
      try { await db.logAlert({ type: 'telegram', message, status: 'SENT' }); } catch(e) {}
      return true;
    } catch (err) {
      providerHealth.recordCall('Telegram', startTime, false, err.message);
      console.error('Telegram notification failed:', err);
      try { await db.logAlert({ type: 'telegram', message, status: 'FAILED' }); } catch(e) {}
      return false;
    }
  }
};

module.exports = alerts;
