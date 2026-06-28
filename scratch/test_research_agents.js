const db = require('../db');
const agentResearch = require('../agentResearch');
const predictor = require('../predictor');
const fs = require('fs');
const path = require('path');

async function testResearch() {
  console.log('🧪 RUNNING DRY-RUN RESEARCH AGENTS VALIDATION...');
  
  // Wait for database connections
  await new Promise(r => setTimeout(r, 2000));

  console.log('\n--- 1. Testing Agent 26 Prediction Storing ---');
  const featureVector = { rsi: 62.5, macd: 1.25, ema_dist: 4.50, sp500Change: 0.25, usdinrChange: -0.10, crudeChange: 0.15, leadingSector: 'BANKING' };
  await agentResearch.storePredictionMemory('AXISBANK', 'BUY', featureVector);

  console.log('\n--- 2. Testing Agent 24 Opportunity Rejection ---');
  await agentResearch.recordRejectedOpportunity('INFOSYS', 68, 'TQS 68 < 75 threshold', 1450.50);

  console.log('\n--- 3. Simulating price update to trigger 15m/30m audit logs ---');
  const dbPath = path.join(__dirname, '../db.json');
  const data = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  if (data.agent24_audit_logs && data.agent24_audit_logs.length > 0) {
    const log = data.agent24_audit_logs[data.agent24_audit_logs.length - 1];
    log.timestamp = new Date(Date.now() - 20 * 60 * 1000).toISOString(); // mock 20 minutes ago
    fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));
  }

  // Trigger update
  await agentResearch.updateOpportunityAudits();

  console.log('\n--- 4. Running Nightly Audits ---');
  await agentResearch.runNightlyAudits();

  console.log('\n--- 5. Verifying Database Cache entries ---');
  const freshData = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  console.log(`- Agent 24 Audit Logs: ${freshData.agent24_audit_logs?.length || 0}`);
  console.log(`- Agent 25 Sizing Logs: ${freshData.agent25_sizing_logs?.length || 0}`);
  console.log(`- Agent 26 Market Memory: ${freshData.agent26_market_memory?.length || 0}`);
  console.log(`- Nightly Learning Reports: ${freshData.nightly_learning_reports?.length || 0}`);

  if (
    (freshData.agent24_audit_logs?.length || 0) > 0 &&
    (freshData.agent25_sizing_logs?.length || 0) > 0 &&
    (freshData.agent26_market_memory?.length || 0) > 0 &&
    (freshData.nightly_learning_reports?.length || 0) > 0
  ) {
    console.log('\n✅ RESEARCH AGENTS 24, 25, 26 COMPILATION VERIFIED SUCCESSFULLY.');
  } else {
    console.log('\n❌ ERROR: Some research agent logs are missing.');
  }

  process.exit(0);
}

testResearch().catch(err => {
  console.error(err);
  process.exit(1);
});
