const { Client } = require('pg');
require('dotenv').config();

async function runAudit() {
  console.log("=== INSTITUTIONAL VALIDATION AUDIT SCRIPT ===");
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  await client.connect();

  // 1. Fetch trade logs and consensus decisions
  const tradesRes = await client.query('SELECT * FROM trade_logs ORDER BY timestamp ASC');
  const consensusRes = await client.query('SELECT * FROM consensus_decisions ORDER BY timestamp ASC');
  const auditLogsRes = await client.query('SELECT * FROM agent24_audit_logs ORDER BY timestamp ASC');
  const predictionsRes = await client.query('SELECT * FROM prediction_logs ORDER BY timestamp ASC');

  const trades = tradesRes.rows;
  const consensus = consensusRes.rows;
  const auditLogs = auditLogsRes.rows;
  const predictions = predictionsRes.rows;

  console.log(`Loaded: ${trades.length} trades, ${consensus.length} consensus decisions, ${auditLogs.length} audit logs, ${predictions.length} predictions.`);

  // 2. Resolve Agent signals on completed predictions
  // Clean consensus participating models
  const cds = {};
  consensus.forEach(c => {
    let pm = c.participating_models;
    if (typeof pm === 'string') {
      try { pm = JSON.parse(pm); } catch(e) {}
    }
    cds[c.id] = { ...c, participating_models: pm };
  });

  // Align completed predictions with their outcomes
  const completedPredictions = predictions.filter(p => p.pnl !== null);
  console.log(`\nCompleted predictions with parsed P&L outcomes: ${completedPredictions.length}`);

  // Analyze every agent's accuracy and classification metrics
  const agentStats = {
    1: { name: 'Agent 1: ML Ensemble', tp: 0, fp: 0, tn: 0, fn: 0, profit: 0, loss: 0 },
    2: { name: 'Agent 2: Gemini', tp: 0, fp: 0, tn: 0, fn: 0, profit: 0, loss: 0 },
    3: { name: 'Agent 3: Groq', tp: 0, fp: 0, tn: 0, fn: 0, profit: 0, loss: 0 },
    4: { name: 'Agent 4: Technical', tp: 0, fp: 0, tn: 0, fn: 0, profit: 0, loss: 0 },
    5: { name: 'Agent 5: Context', tp: 0, fp: 0, tn: 0, fn: 0, profit: 0, loss: 0 },
    6: { name: 'Agent 6: Regime', tp: 0, fp: 0, tn: 0, fn: 0, profit: 0, loss: 0 },
    7: { name: 'Agent 7: Risk Manager', tp: 0, fp: 0, tn: 0, fn: 0, profit: 0, loss: 0 },
    9: { name: 'Agent 9: Breadth', tp: 0, fp: 0, tn: 0, fn: 0, profit: 0, loss: 0 },
    10: { name: 'Agent 10: Sector Rotation', tp: 0, fp: 0, tn: 0, fn: 0, profit: 0, loss: 0 }
  };

  completedPredictions.forEach(p => {
    const cd = cds[p.id] || {};
    const pm = cd.participating_models || {};
    const outcome = p.pnl > 0 ? 'BUY' : 'SELL'; // outcome classification proxy
    const isWin = p.pnl > 0;

    Object.keys(agentStats).forEach(id => {
      const stats = agentStats[id];
      const agentKey = id === '1' ? 'agent1' : id === '2' ? 'agent2_gemini' : id === '3' ? 'agent3_groq' :
                       id === '4' ? 'agent4_technical' : id === '5' ? 'agent5_context' :
                       id === '6' ? 'agent6_regime' : id === '7' ? 'agent7_risk' :
                       id === '9' ? 'agent9_breadth' : 'agent10_sector';
      
      const vote = pm[agentKey]?.signal || 'HOLD';
      
      if (vote === 'BUY') {
        if (isWin) {
          stats.tp++;
          stats.profit += Math.abs(p.pnl);
        } else {
          stats.fp++;
          stats.loss += Math.abs(p.pnl);
        }
      } else if (vote === 'SELL' || vote === 'HOLD') {
        if (!isWin) {
          stats.tn++;
        } else {
          stats.fn++;
        }
      }
    });
  });

  console.log("\n=== AGENT METRICS TABLE ===");
  Object.keys(agentStats).forEach(id => {
    const stats = agentStats[id];
    const total = stats.tp + stats.fp + stats.tn + stats.fn;
    const accuracy = total > 0 ? (stats.tp + stats.tn) / total : 0.50;
    const expectedProfit = (accuracy * stats.profit) - ((1 - accuracy) * stats.loss);
    console.log(`Agent ${id} (${stats.name}):`);
    console.log(`  - Accuracy: ${(accuracy * 100).toFixed(1)}%`);
    console.log(`  - Realized Profit Contrib: ₹${stats.profit.toFixed(2)}`);
    console.log(`  - Realized Loss Contrib: -₹${stats.loss.toFixed(2)}`);
    console.log(`  - False Positives (FP): ${stats.fp} | False Negatives (FN): ${stats.fn}`);
    console.log(`  - Expected Profit Contrib: ₹${expectedProfit.toFixed(2)}`);
  });

  // 3. TQS Above 95 Analysis
  const highTQSRes = await client.query("SELECT * FROM prediction_logs WHERE consensus = true");
  const highTQS = highTQSRes.rows;
  console.log(`\nPredictions executed via consensus: ${highTQS.length}`);

  let totalHighTqsPnl = 0;
  let highTqsCount = 0;
  highTQS.forEach(p => {
    const cd = cds[p.id];
    if (cd && cd.confidence >= 0.90) { // high TQS proxy
      totalHighTqsPnl += p.pnl || 0;
      highTqsCount++;
      console.log(`  Consensus trade: ${p.symbol} | PnL: ₹${p.pnl} | Price: ₹${p.entry_price}`);
    }
  });
  console.log(`Average P&L of high-confidence consensus trades: ₹${highTqsCount > 0 ? (totalHighTqsPnl / highTqsCount).toFixed(2) : 0}`);

  // 4. Trace last 100/500/1000 predictions accuracy
  const totalCount = consensus.length;
  console.log(`\nTotal consensus decisions logged: ${totalCount}`);
  
  await client.end();
  console.log("=== INSTITUTIONAL VALIDATION AUDIT SCRIPT END ===");
}

runAudit().catch(console.error);
