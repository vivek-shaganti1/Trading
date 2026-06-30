const tradingBot = require('./tradingBot');
const runtimeState = require('./runtimeState');

async function testPipeline() {
  console.log('=== V11.0 Phase 10: Trading Pipeline & Rejection Audit ===');

  console.log('[1] Initiating Simulated Trading Loop Tick...');
  
  // Since we are mocking the time, we'll force tradingBot.runScan() to execute.
  try {
    tradingBot.resumeEntries();
    await tradingBot.start(); // This triggers pre_market_check and scanner
  } catch (err) {
    console.error('Trading loop start error (expected if broker simulator exits early):', err.message);
  }

  // Wait 10 seconds for the scanner to process symbols and populate rejection logs
  console.log('[2] Waiting for Pipeline Processing...');
  await new Promise(r => setTimeout(r, 10000));
  
  const snapshot = runtimeState.getSnapshot();
  console.log('[3] Fetching Pipeline Output from runtimeState...');
  
  const rejections = snapshot.funnel.last_rejected || [];
  if (rejections.length > 0) {
    console.log(`✅ PASS: Pipeline processed correctly. Captured ${rejections.length} structured rejection reasons.`);
    console.log(`   Sample Rejection: ${JSON.stringify(rejections[0])}`);
  } else {
    console.error(`❌ FAIL: Pipeline did not generate any rejection logs in runtimeState.`);
  }

  const universe = snapshot.funnel.stage1_total || 0;
  if (universe > 0) {
    console.log(`✅ PASS: Pipeline Stage 1 (Universe) properly initialized with ${universe} symbols.`);
  } else {
    console.error(`❌ FAIL: Universe size is 0.`);
  }

  tradingBot.stop();
  process.exit(0);
}

testPipeline();
