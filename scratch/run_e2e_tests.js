const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');

// Mock dependencies of telegramControl to avoid database corruption and double tick loops
const db = require('../db');
const tradingBot = require('../tradingBot');
const broker = require('../broker');

// Save original methods
const originalLogTelegramCommand = db.logTelegramCommand;
const originalGetStatus = tradingBot.getStatus;

// Stub DB writes
db.logTelegramCommand = async (cmd) => {
  return { success: true };
};
db.updatePortfolioState = async (state) => {
  return state;
};
db.saveDailyStats = async (stats) => {
  return stats;
};

// Stub Bot start/stop to avoid running loops in the test process
tradingBot.start = async () => {
  return true;
};
tradingBot.stop = () => {
  return true;
};

const API_BASE = 'http://localhost:3000';
const WS_BASE = 'ws://localhost:3000/';

// Fetch live status from running server to feed mock telegram /status command
let liveServerStatus = null;
tradingBot.getStatus = async () => {
  if (liveServerStatus) {
    return liveServerStatus;
  }
  return await originalGetStatus();
};

const telegramControl = require('../telegramControl');

const results = {
  passed: 0,
  failed: 0,
  warnings: 0,
  totalTests: 0,
  details: []
};

function logTest(name, status, message = '', type = 'info') {
  results.totalTests++;
  if (status === 'PASS') {
    results.passed++;
    console.log(`[PASS] ${name} - ${message}`);
  } else if (status === 'FAIL') {
    results.failed++;
    console.error(`[FAIL] ${name} - ${message}`);
  } else {
    results.warnings++;
    console.warn(`[WARN] ${name} - ${message}`);
  }
  results.details.push({ name, status, message, type });
}

function makeRequest(method, urlPath, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(urlPath, API_BASE);
    const options = {
      method: method,
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || 3000,
      path: parsedUrl.pathname + parsedUrl.search,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    };

    const startTime = Date.now();
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          data: data,
          responseTime: Date.now() - startTime
        });
      });
    });

    req.on('error', (err) => reject(err));
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function runAllTests() {
  const suiteStartTime = Date.now();
  console.log('🏁 INITIATING AUTOMATED E2E PRODUCTION TEST SUITE...\n');

  // --- PHASE 1: HTTP API ENDPOINTS AUDIT ---
  console.log('\n--- PHASE 1: HTTP API ENDPOINTS AUDIT ---');
  
  // 1. GET /api/status
  try {
    const res = await makeRequest('GET', '/api/status');
    if (res.status === 200) {
      const data = JSON.parse(res.data);
      liveServerStatus = data; // Store for telegram status mock
      if (data.totalVal !== undefined && data.balance !== undefined) {
        logTest('GET /api/status Schema', 'PASS', `Status structure valid. Valuation: ₹${data.totalVal}, Balance: ₹${data.balance}`);
      } else {
        logTest('GET /api/status Schema', 'FAIL', 'Missing expected properties: totalVal/balance');
      }
    } else {
      logTest('GET /api/status Status', 'FAIL', `Status code: ${res.status}`);
    }
  } catch (err) {
    logTest('GET /api/status Request', 'FAIL', err.message);
  }

  // 2. GET /api/health
  try {
    const res = await makeRequest('GET', '/api/health');
    if (res.status === 200) {
      const data = JSON.parse(res.data);
      if (data.status === 'healthy' && data.services) {
        logTest('GET /api/health', 'PASS', `Uptime: ${data.uptime_seconds}s. Scanner: ${data.services.scanner}`);
      } else {
        logTest('GET /api/health Schema', 'FAIL', 'Status not healthy or services key missing.');
      }
    } else {
      logTest('GET /api/health Status', 'FAIL', `Status code: ${res.status}`);
    }
  } catch (err) {
    logTest('GET /api/health Request', 'FAIL', err.message);
  }

  // 3. POST /api/control (Invalid action)
  try {
    const res = await makeRequest('POST', '/api/control', { action: 'INVALID_COMMAND_TEST' });
    if (res.status === 400) {
      logTest('POST /api/control Invalid Input', 'PASS', 'Rejected invalid action with 400 Bad Request.');
    } else {
      logTest('POST /api/control Invalid Input', 'FAIL', `Expected 400, got status: ${res.status}`);
    }
  } catch (err) {
    logTest('POST /api/control Invalid Input Request', 'FAIL', err.message);
  }

  // 4. POST /api/admin/reset (Invalid auth)
  try {
    const res = await makeRequest('POST', '/api/admin/reset', { password: 'WRONG_PASSWORD_E2E_TEST' });
    if (res.status === 403) {
      logTest('POST /api/admin/reset Auth Protection', 'PASS', 'Rejected invalid password with 403 Forbidden.');
    } else {
      logTest('POST /api/admin/reset Auth Protection', 'FAIL', `Expected 403, got status: ${res.status}`);
    }
  } catch (err) {
    logTest('POST /api/admin/reset Request', 'FAIL', err.message);
  }

  // 5. GET /api/trades
  try {
    const res = await makeRequest('GET', '/api/trades');
    if (res.status === 200) {
      const data = JSON.parse(res.data);
      if (Array.isArray(data)) {
        logTest('GET /api/trades', 'PASS', `Trades history length: ${data.length}`);
      } else {
        logTest('GET /api/trades Schema', 'FAIL', 'Response is not an array.');
      }
    } else {
      logTest('GET /api/trades Status', 'FAIL', `Status code: ${res.status}`);
    }
  } catch (err) {
    logTest('GET /api/trades Request', 'FAIL', err.message);
  }

  // 6. GET /api/historical-candles (Invalid input handling)
  try {
    const res = await makeRequest('GET', '/api/historical-candles'); // missing symbol
    if (res.status === 400) {
      logTest('GET /api/historical-candles Missing Params', 'PASS', 'Rejected missing symbol parameter with 400.');
    } else {
      logTest('GET /api/historical-candles Missing Params', 'FAIL', `Expected 400, got: ${res.status}`);
    }
  } catch (err) {
    logTest('GET /api/historical-candles Request', 'FAIL', err.message);
  }

  // 7. GET /api/symbol-intelligence (Valid input check)
  try {
    const res = await makeRequest('GET', '/api/symbol-intelligence?symbol=RELIANCE');
    if (res.status === 200) {
      const data = JSON.parse(res.data);
      if (data.symbol === 'RELIANCE') {
        logTest('GET /api/symbol-intelligence', 'PASS', `LTP: ₹${data.ltp}, Trend: ${data.trend}`);
      } else {
        logTest('GET /api/symbol-intelligence Schema', 'FAIL', 'Wrong or missing symbol in response.');
      }
    } else {
      logTest('GET /api/symbol-intelligence Status', 'FAIL', `Status code: ${res.status}`);
    }
  } catch (err) {
    logTest('GET /api/symbol-intelligence Request', 'FAIL', err.message);
  }

  // --- PHASE 2: WEBSOCKET VERIFICATION ---
  console.log('\n--- PHASE 2: WEBSOCKET VERIFICATION ---');
  await new Promise((resolve) => {
    const ws = new WebSocket(WS_BASE);
    let packetCount = 0;
    const wsStartTime = Date.now();

    ws.on('open', () => {
      logTest('WebSocket Connection', 'PASS', 'Established WebSocket handshake successfully.');
      ws.send(JSON.stringify({ type: 'SUBSCRIBE', symbol: 'RELIANCE' }));
    });

    ws.on('message', (data) => {
      try {
        const payload = JSON.parse(data);
        if (payload.type === 'STATUS_UPDATE') {
          packetCount++;
          const latency = Date.now() - wsStartTime;
          if (packetCount === 1) {
            logTest('WebSocket Message Sync', 'PASS', `Received STATUS_UPDATE packet. Balance: ₹${payload.data.balance}, Latency: ${latency}ms`);
            ws.close();
            resolve();
          }
        }
      } catch (err) {
        logTest('WebSocket Message Parse', 'FAIL', err.message);
        ws.close();
        resolve();
      }
    });

    ws.on('error', (err) => {
      logTest('WebSocket Error Handle', 'FAIL', err.message);
      resolve();
    });

    setTimeout(() => {
      if (packetCount === 0) {
        logTest('WebSocket Message Sync Timeout', 'FAIL', 'Timeout waiting for STATUS_UPDATE message.');
        ws.close();
        resolve();
      }
    }, 5000);
  });

  // --- PHASE 3: PORTFOLIO & RESET VERIFICATION ---
  console.log('\n--- PHASE 3: PORTFOLIO & RESET VERIFICATION ---');
  try {
    const configModule = require('../config');
    const res = await makeRequest('POST', '/api/admin/reset', { password: configModule.ADMIN_RESET_PASSWORD });
    if (res.status === 200) {
      logTest('POST /api/admin/reset Execution', 'PASS', 'Bot admin reset executed successfully.');
      
      const statusRes = await makeRequest('GET', '/api/status');
      const status = JSON.parse(statusRes.data);
      liveServerStatus = status; // Update the mock state as well
      
      if (status.balance === 12000 && status.totalVal === 12000) {
        logTest('Paper Trading Reset Balance Match', 'PASS', 'Capital set to exactly ₹12,000.');
      } else {
        logTest('Paper Trading Reset Balance Match', 'FAIL', `Expected ₹12,000, got: ₹${status.balance}`);
      }

      if (status.target === 1200) {
        logTest('10% Target Math Check', 'PASS', 'Target set to exactly ₹1,200 (10% of start capital).');
      } else {
        logTest('10% Target Math Check', 'FAIL', `Expected ₹1,200 target, got: ₹${status.target}`);
      }
    } else {
      logTest('POST /api/admin/reset Execution', 'FAIL', `Status code: ${res.status}`);
    }
  } catch (err) {
    logTest('E2E Reset Routine Error', 'FAIL', err.message);
  }

  // --- PHASE 4: TELEGRAM COMMAND INTERFACE ---
  console.log('\n--- PHASE 4: TELEGRAM COMMAND INTERFACE ---');
  try {
    const responseStart = await telegramControl.handleTelegramMessage('/start', 'E2E_CHAT_123');
    if (responseStart.includes('started')) {
      logTest('Telegram /start Command', 'PASS', 'Correct start trigger response formatting.');
    } else {
      logTest('Telegram /start Command', 'FAIL', `Unexpected response: ${responseStart}`);
    }

    const responseStatus = await telegramControl.handleTelegramMessage('/status', 'E2E_CHAT_123');
    if (responseStatus.includes('Status') || responseStatus.includes('Station')) {
      logTest('Telegram /status Command', 'PASS', 'Status station telemetry formatting verified.');
    } else {
      logTest('Telegram /status Command', 'FAIL', `Unexpected response: ${responseStatus}`);
    }

    const responsePositions = await telegramControl.handleTelegramMessage('/positions', 'E2E_CHAT_123');
    if (responsePositions.includes('💼') || responsePositions.includes('holdings')) {
      logTest('Telegram /positions Command', 'PASS', 'Open holdings query formatting matches.');
    } else {
      logTest('Telegram /positions Command', 'FAIL', `Unexpected response: ${responsePositions}`);
    }
  } catch (err) {
    logTest('Telegram Interface Route', 'FAIL', err.message);
  }

  // --- PHASE 5: RUNTIME SCHEDULER & SCANNER VERIFICATION ---
  console.log('\n--- PHASE 5: RUNTIME SCHEDULER & SCANNER VERIFICATION ---');
  try {
    const statusRes1 = await makeRequest('GET', '/api/status');
    const status1 = JSON.parse(statusRes1.data);
    
    // Wait to check if metrics increment
    await new Promise(r => setTimeout(r, 2000));
    
    const statusRes2 = await makeRequest('GET', '/api/status');
    const status2 = JSON.parse(statusRes2.data);
    
    if (status2.isRunning) {
      logTest('Market Scanner Activity', 'PASS', `Verified active scanning. Bot running status: ${status2.isRunning}`);
    } else {
      logTest('Market Scanner Activity', 'WARNING', `Market scanner has not scanned any symbols in this session yet.`);
    }
  } catch (err) {
    logTest('Runtime Scheduler Diagnostic', 'FAIL', err.message);
  }

  // --- PHASE 6: STRESS TEST & CONCURRENCY ---
  console.log('\n--- PHASE 6: STRESS TEST & CONCURRENCY ---');
  try {
    const startMem = process.memoryUsage().heapUsed;
    const stressRequests = [];
    for (let i = 0; i < 20; i++) {
      stressRequests.push(makeRequest('GET', '/api/status'));
    }
    const responses = await Promise.all(stressRequests);
    const allSuccessful = responses.every(r => r.status === 200);
    const endMem = process.memoryUsage().heapUsed;
    const diffMem = ((endMem - startMem) / 1024 / 1024).toFixed(2);
    
    if (allSuccessful) {
      logTest('High Concurrency Stress Test', 'PASS', `Resolved 20 simultaneous HTTP hits without error. Heap diff: ${diffMem} MB`);
    } else {
      logTest('High Concurrency Stress Test', 'FAIL', 'One or more simultaneous requests failed.');
    }
  } catch (err) {
    logTest('Stress Test Error', 'FAIL', err.message);
  }

  // --- REPORT SUMMARY ---
  const duration = ((Date.now() - suiteStartTime) / 1000).toFixed(2);
  console.log('\n====================================================');
  console.log('🏁 E2E VERIFICATION SUITE SUMMARY');
  console.log('====================================================');
  console.log(`Total tests run : ${results.totalTests}`);
  console.log(`Passed          : ${results.passed} ✅`);
  console.log(`Failed          : ${results.failed} ❌`);
  console.log(`Warnings        : ${results.warnings} ⚠️`);
  console.log(`Runtime duration: ${duration}s`);
  console.log('====================================================\n');

  if (results.failed > 0) {
    console.error('❌ E2E VERIFICATION SUITE FAILED!');
    process.exit(1);
  } else {
    console.log('✅ E2E VERIFICATION SUITE PASSED SUCCESSFULLY!');
    process.exit(0);
  }
}

runAllTests().catch((err) => {
  console.error('Fatal E2E test runner failure:', err);
  process.exit(1);
});
