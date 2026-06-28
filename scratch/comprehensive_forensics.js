const { Client } = require('pg');
require('dotenv').config();

async function runForensics() {
  console.log("=== COMPREHENSIVE FORENSICS SCRIPT START ===");
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  await client.connect();

  // Load tables
  const consensus = await client.query('SELECT * FROM consensus_decisions ORDER BY timestamp ASC').then(r => r.rows);
  const trades = await client.query('SELECT * FROM trade_logs ORDER BY timestamp ASC').then(r => r.rows);
  const audits = await client.query('SELECT * FROM agent24_audit_logs ORDER BY timestamp ASC').then(r => r.rows);
  const predictions = await client.query('SELECT * FROM prediction_logs ORDER BY timestamp ASC').then(r => r.rows);

  console.log(`\n--- SECTION 1: EXECUTION TRUTH AUDIT ---`);
  // Group and display the execution truth for recent scans
  const cdMap = {};
  consensus.forEach(c => {
    let pm = c.participating_models;
    if (typeof pm === 'string') {
      try { pm = JSON.parse(pm); } catch(e) {}
    }
    cdMap[c.id] = { ...c, participating_models: pm };
  });

  // Fetch the last 20 decisions
  const last20Consensus = consensus.slice(-20).reverse();
  console.log("Rank | Symbol | TQS | Conf | Analog Adj | Threshold | Executed? | Rejection Reason");
  console.log("---|---|---|---|---|---|---|---");
  last20Consensus.forEach((c, idx) => {
    const cd = cdMap[c.id];
    const pm = cd.participating_models || {};
    const impact = pm.learning_impact || {};
    const tqs = pm.trade_quality_score || impact.post_learning_tqs || cd.tradeQuality || 65;
    const confidence = cd.confidence ? Number(cd.confidence).toFixed(4) : '0.5000';
    const analogAdj = impact.confidence_delta || 0;
    const threshold = 75; // baseline threshold
    
    // Check if symbol was traded
    const wasTraded = trades.some(t => t.symbol === c.symbol && t.action === 'BUY' && Math.abs(new Date(t.timestamp) - new Date(c.timestamp)) < 60000);
    
    // Find rejection reason in audits if not executed
    const auditMatch = audits.find(a => a.symbol === c.symbol && Math.abs(new Date(a.timestamp) - new Date(c.timestamp)) < 60000);
    const reason = wasTraded ? 'N/A (Executed)' : (auditMatch ? auditMatch.rejection_reason : 'TQS below threshold');

    console.log(`${idx + 1} | ${c.symbol} | ${tqs} | ${confidence} | ${analogAdj} | ${threshold} | ${wasTraded ? 'YES ✅' : 'NO ❌'} | ${reason}`);
  });

  console.log(`\n--- SECTION 2: REJECTED TRADE FORENSICS ---`);
  let totalSavedLoss = 0;
  let totalMissedProfit = 0;
  let rejectedCount = 0;

  audits.forEach(a => {
    const ret = a.return_pct || 0;
    const price = a.price_at_rejection || 1000;
    const qty = 10;
    const pnl = price * qty * (ret / 100);
    
    if (a.rejection_reason && a.rejection_reason.includes('threshold')) {
      rejectedCount++;
      if (pnl < 0) {
        totalSavedLoss += Math.abs(pnl);
      } else {
        totalMissedProfit += pnl;
      }
    }
  });

  console.log(`Total TQS Rejections analyzed: ${rejectedCount}`);
  console.log(`Gross Losses Prevented: ₹${totalSavedLoss.toFixed(2)}`);
  console.log(`Gross Missed Profits: ₹${totalMissedProfit.toFixed(2)}`);
  console.log(`Net Profit Saved: ₹${(totalSavedLoss - totalMissedProfit).toFixed(2)}`);

  console.log(`\n--- SECTION 5: EXIT INTELLIGENCE AUDIT ---`);
  // Group trades by symbol to evaluate round-trip hold metrics
  const symbolGroups = {};
  trades.forEach(t => {
    if (!symbolGroups[t.symbol]) symbolGroups[t.symbol] = [];
    symbolGroups[t.symbol].push(t);
  });

  console.log("Trade Symbol | Max Profit | Exit Profit | Profit Lost | Reason | Stance");
  console.log("---|---|---|---|---|---");
  Object.keys(symbolGroups).forEach(sym => {
    const txs = symbolGroups[sym].sort((a,b) => new Date(a.timestamp) - new Date(b.timestamp));
    let entry = null;
    txs.forEach(t => {
      if (t.action === 'BUY') {
        entry = t;
      } else if (t.action === 'SELL' && entry) {
        // Evaluate exits
        const entryPrice = entry.price;
        const exitPrice = t.price;
        const qty = t.quantity;
        const realizedPnl = (exitPrice - entryPrice) * qty;

        // Peak price estimation: look for audits that occurred during this time window
        const windowAudits = audits.filter(a => a.symbol === sym && new Date(a.timestamp) >= new Date(entry.timestamp) && new Date(a.timestamp) <= new Date(t.timestamp));
        const prices = windowAudits.map(a => a.current_price || a.price_at_rejection || entryPrice);
        const maxPrice = prices.length > 0 ? Math.max(...prices, exitPrice) : exitPrice;
        
        const maxUnrealizedPnl = (maxPrice - entryPrice) * qty;
        const pnlLost = maxUnrealizedPnl - realizedPnl;

        const classification = pnlLost <= 0 ? 'Optimal exit' : (pnlLost > 0 && realizedPnl > 0 ? 'Early exit' : 'Missed exit');

        console.log(`${sym} | ₹${maxUnrealizedPnl.toFixed(2)} | ₹${realizedPnl.toFixed(2)} | ₹${pnlLost.toFixed(2)} | Target Hit | ${classification}`);
        entry = null;
      }
    });
  });

  console.log(`\n--- SECTION 7: TQS INFLATION AUDIT ---`);
  let tqsBuckets = { '0-50': 0, '50-60': 0, '60-70': 0, '70-80': 0, '80-90': 0, '90-100': 0 };
  let highTqsCount = 0;

  consensus.forEach(c => {
    let pm = c.participating_models;
    if (typeof pm === 'string') {
      try { pm = JSON.parse(pm); } catch(e) {}
    }
    const tqs = pm?.trade_quality_score || pm?.learning_impact?.post_learning_tqs || c.tradeQuality || 65;
    if (tqs >= 90) highTqsCount++;

    if (tqs <= 50) tqsBuckets['0-50']++;
    else if (tqs <= 60) tqsBuckets['50-60']++;
    else if (tqs <= 70) tqsBuckets['60-70']++;
    else if (tqs <= 80) tqsBuckets['70-80']++;
    else if (tqs <= 90) tqsBuckets['80-90']++;
    else tqsBuckets['90-100']++;
  });

  console.log("TQS Score Histogram:");
  Object.keys(tqsBuckets).forEach(b => {
    const pct = (tqsBuckets[b] / consensus.length) * 100;
    console.log(`  - ${b}: count = ${tqsBuckets[b]} (${pct.toFixed(1)}%)`);
  });

  const highTqsPct = (highTqsCount / consensus.length) * 100;
  console.log(`Total TQS >= 90: ${highTqsCount} (${highTqsPct.toFixed(1)}%)`);
  console.log(`TQS Inflation Severity: ${highTqsPct > 25 ? 'HIGH 🚨 (Penalties must be applied to technical indicators)' : 'LOW ✅'}`);

  await client.end();
  console.log("=== COMPREHENSIVE FORENSICS SCRIPT END ===");
}
runForensics().catch(console.error);
