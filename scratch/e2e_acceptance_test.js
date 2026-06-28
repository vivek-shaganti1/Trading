const { fork } = require('child_process');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

async function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runTest() {
  console.log('🏁 STARTING AUTOMATED E2E PRODUCTION ACCEPTANCE TEST...');
  
  // 1. Startup Server B (Trading Engine) on port 3080
  console.log('[E2E] 1. Launching server.js child process on port 3080...');
  const env = { ...process.env, PORT: '3080', USE_LOCAL_CACHE: 'true' };
  const serverProc = fork(path.join(__dirname, '../server.js'), [], { env, silent: true });
  
  let output = '';
  serverProc.stdout.on('data', (data) => {
    output += data.toString();
  });
  serverProc.stderr.on('data', (data) => {
    console.error(`[SERVER ERROR] ${data.toString()}`);
  });

  await wait(8000); // Wait for async DB boot and warmup to complete

  // 2. Health check endpoint check
  console.log('[E2E] 2. Querying GET /api/health...');
  let healthOk = false;
  try {
    const healthJson = await new Promise((resolve, reject) => {
      http.get('http://localhost:3080/api/health', (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => resolve(JSON.parse(body)));
      }).on('error', reject);
    });

    console.log('[E2E] Health Payload:', JSON.stringify(healthJson, null, 2));
    if (healthJson.status === 'healthy' && healthJson.services.database) {
      healthOk = true;
      console.log('✅ HEALTH ENDPOINT PASSED!');
    }
  } catch (err) {
    console.error('❌ Health check query failed:', err.message);
  }

  // 3. WS Connect
  console.log('[E2E] 3. Verifying WebSocket connection...');
  let wsOk = false;
  try {
    const ws = new WebSocket('ws://localhost:3080/');
    wsOk = await new Promise((resolve) => {
      ws.on('open', () => {
        console.log('[E2E] WS connection opened.');
      });
      ws.on('message', (data) => {
        const payload = JSON.parse(data);
        if (payload.type === 'STATUS_UPDATE') {
          console.log('[E2E] Received status push: isRunning =', payload.data.isRunning);
          resolve(true);
          ws.close();
        }
      });
      ws.on('error', () => resolve(false));
      setTimeout(() => resolve(false), 5000);
    });
    if (wsOk) console.log('✅ WEBSOCKETS BROADCAST PASSED!');
  } catch (err) {
    console.error('❌ WS verification failed:', err.message);
  }

  // 4. Test Telegram commands via direct controller invocation
  console.log('[E2E] 4. Testing Telegram Controller /status...');
  let tgOk = false;
  try {
    const telegramControl = require('../telegramControl');
    const response = await telegramControl.handleTelegramMessage('/status', 12345);
    console.log('[E2E] Telegram Response:\n', response);
    if (response && response.includes('Quant Command Station Status')) {
      tgOk = true;
      console.log('✅ TELEGRAM CONTROLLER STATUS PASSED!');
    }
  } catch (err) {
    console.error('❌ Telegram handler invocation failed:', err.message);
  }

  // 5. Test Scheduler constraints (Mock market session boundaries)
  console.log('[E2E] 5. Validating scheduler time boundary filters...');
  let schedulerOk = false;
  try {
    const tradingBot = require('../tradingBot');
    const timeOpen = { hours: 10, minutes: 0, day: 1, dateStr: '2026-06-26' };
    const timeClosed = { hours: 16, minutes: 0, day: 1, dateStr: '2026-06-26' };
    const timeWeekend = { hours: 10, minutes: 0, day: 6, dateStr: '2026-06-27' };

    const openPass = tradingBot.isMarketOpenWindow(timeOpen);
    const closedFail = tradingBot.isMarketOpenWindow(timeClosed);
    const weekendFail = tradingBot.isMarketOpenWindow(timeWeekend);

    console.log(`[E2E] Monday 10:00 AM open window check: ${openPass}`);
    console.log(`[E2E] Monday 04:00 PM open window check: ${closedFail}`);
    console.log(`[E2E] Saturday 10:00 AM open window check: ${weekendFail}`);

    if (openPass && !closedFail && !weekendFail) {
      schedulerOk = true;
      console.log('✅ SCHEDULER BOUNDARIES PASSED!');
    }
  } catch (err) {
    console.error('❌ Scheduler check failed:', err.message);
  }

  // 6. Tear down server gracefully
  console.log('[E2E] 6. Shutting down E2E server process...');
  serverProc.kill('SIGINT');
  await wait(2000);
  
  const allPassed = healthOk && wsOk && tgOk && schedulerOk;
  console.log(`\n=========================================`);
  console.log(`🏆 E2E TEST RESULT: ${allPassed ? 'PASS 🎉' : 'FAIL ❌'}`);
  console.log(`• Health Check: ${healthOk ? 'PASS' : 'FAIL'}`);
  console.log(`• WebSocket Push: ${wsOk ? 'PASS' : 'FAIL'}`);
  console.log(`• Telegram Command: ${tgOk ? 'PASS' : 'FAIL'}`);
  console.log(`• Scheduler logic: ${schedulerOk ? 'PASS' : 'FAIL'}`);
  console.log(`=========================================`);
  
  process.exit(allPassed ? 0 : 1);
}

runTest().catch((err) => {
  console.error('[E2E CRITICAL FAILURE]', err);
  process.exit(1);
});
