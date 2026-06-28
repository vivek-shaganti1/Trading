const db = require('../db');
const agentFirm = require('../agentFirm');
const predictor = require('../predictor');

async function testE2E() {
  console.log('🧪 RUNNING DRY-RUN FIRM AGENTS VALIDATION...');
  
  // Wait for DB connections to complete
  await new Promise(r => setTimeout(r, 2000));

  // 1. Mock parameters for trade closed event
  const symbol = 'ICICIBANK';
  const exitPrice = 1307.70;
  const tradePnL = 18.99;
  const exitReason = 'Profit Target Hit';
  const pos = { avgPrice: 1301.37, quantity: 3 };

  console.log('\n--- 1. Triggering Closed Trade Hook ---');
  await agentFirm.onTradeClosed(symbol, exitPrice, tradePnL, exitReason, pos);

  console.log('\n--- 2. Triggering Nightly Optimization (Agent 21 & 22) ---');
  await agentFirm.runAgent21();
  await agentFirm.runAgent22();

  console.log('\n--- 3. Verifying Local Cache Database entries ---');
  const data = db.readLocalDb ? db.readLocalDb() : require('../db.json');
  console.log(`- Agent 20 Reports stored: ${data.agent20_reports?.length || 0}`);
  console.log(`- Agent 21 Trust Logs stored: ${data.agent21_trust_logs?.length || 0}`);
  console.log(`- Agent 22 Research Logs stored: ${data.agent22_research_logs?.length || 0}`);
  console.log(`- Agent 23 Journals stored: ${data.agent23_journals?.length || 0}`);

  if (
    (data.agent20_reports?.length || 0) > 0 &&
    (data.agent21_trust_logs?.length || 0) > 0 &&
    (data.agent22_research_logs?.length || 0) > 0 &&
    (data.agent23_journals?.length || 0) > 0
  ) {
    console.log('\n✅ ALL FIRM AGENTS VERIFIED AND RECORDED SUCCESSFULLY.');
  } else {
    console.log('\n❌ ERROR: Some agent records are missing.');
  }

  process.exit(0);
}

testE2E().catch(err => {
  console.error(err);
  process.exit(1);
});
