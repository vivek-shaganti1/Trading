const http = require('http');
const https = require('https');

const BASE_URL = process.env.API_URL || 'https://trading-s7ca.onrender.com';

async function fetchAPI(endpoint) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const client = BASE_URL.startsWith('https') ? https : http;
    const req = client.get(`${BASE_URL}${endpoint}`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          latency: Date.now() - start,
          data: data
        });
      });
    });
    req.on('error', reject);
    req.setTimeout(2000, () => {
      req.abort();
      reject(new Error('Timeout'));
    });
  });
}

async function runAudit() {
  console.log('=== V12.1 PRODUCTION ACCEPTANCE AUDIT ===');
  console.log('[PHASE A] Trying to reproduce HTTP 500 / timeouts / anomalies...');

  const endpoints = [
    '/api/status',
    '/api/health',
    '/api/portfolio-allocation',
    '/api/runtime',
    '/api/system',
    '/api/scheduler'
  ];

  let passed = true;
  for (const ep of endpoints) {
    try {
      const result = await fetchAPI(ep);
      if (result.status !== 200) {
        console.error(`❌ FAIL: ${ep} returned HTTP ${result.status}`);
        passed = false;
      } else if (result.latency > 1000) {
        console.error(`❌ FAIL: ${ep} latency ${result.latency}ms > 1000ms`);
        passed = false;
      } else {
        console.log(`✅ PASS: ${ep} (HTTP ${result.status}, ${result.latency}ms)`);
        // Verify JSON is valid
        JSON.parse(result.data);
      }
    } catch (err) {
      console.error(`❌ FAIL: ${ep} error: ${err.message}`);
      passed = false;
    }
  }

  console.log('\n[PHASE F] Stress Testing (50 concurrent requests)...');
  const stressPromises = [];
  for (let i = 0; i < 50; i++) {
    stressPromises.push(fetchAPI('/api/status'));
  }
  
  try {
    const results = await Promise.all(stressPromises);
    const failed = results.filter(r => r.status !== 200);
    const maxLatency = Math.max(...results.map(r => r.latency));
    if (failed.length > 0) {
      console.error(`❌ FAIL: Stress test had ${failed.length} HTTP 500s`);
      passed = false;
    } else {
      console.log(`✅ PASS: Stress test 50/50 successful. Max latency: ${maxLatency}ms`);
    }
  } catch(err) {
    console.error(`❌ FAIL: Stress test crashed: ${err.message}`);
    passed = false;
  }

  if (passed) {
    console.log('\n✅ ALL V12.1 ACCEPTANCE CRITERIA PASSED');
    process.exit(0);
  } else {
    console.error('\n❌ V12.1 AUDIT FAILED');
    process.exit(1);
  }
}

// Give server time to boot
setTimeout(runAudit, 4000);
