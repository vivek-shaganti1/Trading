const db = require('../backend/db');
const tb = require('../backend/tradingBot');

async function run() {
  console.log('=== SECTION 5 — RESTART TEST ===');
  
  // 1. Mark today's EOD as sent (already marked in db, let's double check/ensure)
  await db.initPromise;
  const todayStr = '2026-06-12';
  
  console.log(`Setting EOD state for today (${todayStr}) as sent...`);
  await db.saveEodReportState({
    date: todayStr,
    sent: true,
    sent_at: new Date().toISOString()
  });

  console.log('Restarting simulation: Clearing in-memory variables...');
  // Force reset of in-memory lastEodReportSentDate to mimic fresh server restart
  // We can get or check if lastEodReportSentDate exists in tradingBot.js, or just let the script run since this is a new node process!
  // A new node process inherently has a clean in-memory state.
  
  console.log('Triggering finalizeMarketDay...');
  
  // Intercept alerts.sendTelegram to confirm if any message is sent
  const alerts = require('../backend/alerts');
  let messageSent = false;
  const originalSend = alerts.sendTelegram;
  alerts.sendTelegram = async (msg) => {
    messageSent = true;
    console.log('[ALERT LOGGED]:', msg.substring(0, 100));
    return originalSend(msg);
  };

  // We need to override getSystemTime to return a time after 15:30 so it doesn't return early due to market time check
  // But wait, the current time is 16:26, so it's already after 15:30!
  
  await tb.finalizeMarketDay(todayStr);

  if (messageSent) {
    console.log('FAIL: Telegram message was sent despite EOD being already marked as sent.');
    console.log('Result: FAIL');
  } else {
    console.log('PASS: No Telegram message sent, successfully skipped!');
    console.log('Result: PASS');
  }
  
  // Restore original function
  alerts.sendTelegram = originalSend;
  process.exit(0);
}

run().catch(console.error);
