const telegramControl = require('./telegramControl');
const config = require('../shared/config');

async function runTelegramTest() {
  console.log('=== V11.0 Phase 4: Telegram Command Latency Test ===');
  
  const commands = [
    '/status',
    '/portfolio',
    '/positions',
    '/health',
    '/runtime',
    '/orders',
    '/today',
    '/performance'
  ];

  let passed = 0;

  for (const cmd of commands) {
    const start = Date.now();
    try {
      const response = await telegramControl.handleTelegramMessage(cmd, config.TELEGRAM_CHAT_ID, 'test_user');
      const latency = Date.now() - start;
      if (latency < 2000 && response) {
        console.log(`✅ PASS: ${cmd} returned in ${latency}ms`);
        passed++;
      } else {
        console.error(`❌ FAIL: ${cmd} took ${latency}ms or returned null`);
      }
    } catch (err) {
      console.error(`❌ FAIL: ${cmd} threw an error: ${err.message}`);
    }
  }

  console.log(`\nTest Complete: ${passed}/${commands.length} Passed.`);
  process.exit(passed === commands.length ? 0 : 1);
}

runTelegramTest();
