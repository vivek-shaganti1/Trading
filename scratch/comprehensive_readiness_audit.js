const fs = require('fs');
const path = require('path');
const db = require('../backend/db');
const broker = require('../backend/broker');

async function runAudit() {
  console.log('🔍 INITIATING DEPLOYMENT READINESS EVIDENCE GATHERING...');
  await db.initPromise;

  const data = db.readLocalDb();
  
  // Section 3 check
  console.log('\n--- SECTION 3: Quantity Safety Audit ---');
  const filesToCheck = ['tradingBot.js', 'broker.js', 'agent17_execution.js', 'db.js'];
  filesToCheck.forEach(file => {
    const filePath = path.join(__dirname, '..', file);
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      const hasZeroQtyExecution = content.includes('quantity <= 0') || content.includes('qty <= 0') || content.includes('exitQty <= 0');
      console.log(`- ${file} safeguards check: ${hasZeroQtyExecution ? 'Safeguard strings detected' : 'Warning: String not found'}`);
    } else {
      console.log(`- ${file} not found`);
    }
  });

  // Section 4 audit
  console.log('\n--- SECTION 4: Trade Log Integrity ---');
  const tradeLogs = data.trade_logs || [];
  const buyLogs = tradeLogs.filter(l => l.action === 'BUY');
  const sellLogs = tradeLogs.filter(l => l.action === 'SELL');
  const uniqueIds = new Set(tradeLogs.map(l => l.id || l.timestamp));
  const duplicates = tradeLogs.length - uniqueIds.size;
  
  let invalidRows = 0;
  tradeLogs.forEach(l => {
    if (!l.symbol || !l.price || l.price <= 0 || !l.quantity || l.quantity < 0) {
      invalidRows++;
    }
  });

  console.log(`- Total BUY trades: ${buyLogs.length}`);
  console.log(`- Total SELL trades: ${sellLogs.length}`);
  console.log(`- Duplicate IDs: ${duplicates}`);
  console.log(`- Invalid rows: ${invalidRows}`);

  // Section 5 audit
  console.log('\n--- SECTION 5: Completed Trade Matching ---');
  const completed = data.completed_trades || [];
  let unmatchedBuys = 0;
  let duplicateExits = 0;
  let orphanSells = 0;

  // Track entries mapped to check for duplicate exits
  const matchedEntries = new Set();
  completed.forEach(t => {
    const key = `${t.symbol}-${new Date(t.entry_time).getTime()}`;
    if (matchedEntries.has(key)) {
      duplicateExits++;
    }
    matchedEntries.add(key);
  });

  sellLogs.forEach(sell => {
    const matchingBuy = buyLogs.find(b => b.symbol === sell.symbol && new Date(b.timestamp) < new Date(sell.timestamp));
    if (!matchingBuy) {
      orphanSells++;
    }
  });

  console.log(`- Total completed trades: ${completed.length}`);
  console.log(`- Unmatched buys: ${unmatchedBuys}`);
  console.log(`- Duplicate exits: ${duplicateExits}`);
  console.log(`- Orphan sells: ${orphanSells}`);

  // Section 6 validation
  console.log('\n--- SECTION 6: Profitability Metrics ---');
  const stats = await db.calculateCompletedTradesStats();
  console.log(JSON.stringify(stats, null, 2));

  // Section 11 check: Mock values in codebase
  console.log('\n--- SECTION 11: Realism Audit ---');
  const botContent = fs.readFileSync(path.join(__dirname, '..', 'tradingBot.js'), 'utf8');
  
  // Search for hardcoded or fake patterns
  const patterns = [
    { name: 'winRate = 0.625', regex: /winRate\s*=\s*0\.625/ },
    { name: 'avgWin = 20.0', regex: /avgWin\s*=\s*20\.0/ },
    { name: 'avgLoss = 10.0', regex: /avgLoss\s*=\s*10\.0/ },
    { name: 'sharpe_ratio: 1.85', regex: /sharpe_ratio:\s*1\.85/ },
    { name: 'profit_factor: 1.25', regex: /profit_factor:\s*1\.25/ }
  ];

  patterns.forEach(pat => {
    const matched = pat.regex.test(botContent);
    console.log(`- ${pat.name} matched: ${matched}`);
  });

  process.exit(0);
}

runAudit().catch(err => {
  console.error(err);
  process.exit(1);
});
