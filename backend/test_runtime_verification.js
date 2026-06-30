async function runVerification() {
  console.log('=== V10.2 Phase 1: Production Verification Suite ===\n');
  const port = process.env.PORT || 10000;
  const baseUrl = `http://localhost:${port}`;
  
  const endpoints = [
    '/api/status',
    '/api/health',
    '/api/runtime',
    '/api/system',
    '/api/scheduler',
    '/api/database',
    '/api/broker',
    '/api/trades',
    '/api/completed-trades',
    '/api/portfolio-allocation',
    '/api/market-breadth',
    '/api/analytics'
  ];

  let passed = 0;
  let failed = 0;

  for (const ep of endpoints) {
    try {
      const res = await fetch(`${baseUrl}${ep}`);
      if (res.ok) {
        console.log(`✅ GET ${ep} -> ${res.status} OK`);
        passed++;
      } else {
        console.error(`❌ GET ${ep} -> ${res.status}`);
        failed++;
      }
    } catch (err) {
      console.warn(`⚠️ GET ${ep} -> ${err.message} (Is the server running?)`);
      failed++;
    }
  }

  console.log(`\nVerification Complete: ${passed} Passed, ${failed} Failed/Skipped.`);
  if (failed === 0 && passed === endpoints.length) {
    console.log('🎉 ALL TESTS PASSED. Ready for deployment.');
  } else {
    console.log('⚠️ SOME TESTS FAILED. DO NOT DEPLOY.');
  }
}

runVerification();
