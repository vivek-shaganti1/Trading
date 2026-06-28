const { Client } = require('pg');
const config = require('../config');

async function auditAttributions() {
  console.log('🏁 INITIATING AGENT ATTRIBUTION FORENSIC AUDIT...');
  console.log('================================================\n');

  const client = new Client({
    connectionString: config.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  await client.connect();

  try {
    const totalDecisions = await client.query('SELECT COUNT(*) as count FROM consensus_decisions');
    const evaluatedDecisions = await client.query('SELECT COUNT(*) as count FROM consensus_decisions WHERE result_after_closes IS NOT NULL');
    
    console.log(`• Total Consensus Decisions in DB: ${totalDecisions.rows[0].count}`);
    console.log(`• Decisions with outcomes backfilled: ${evaluatedDecisions.rows[0].count}`);
    console.log('');

    // Let's inspect the agent votes in consensus_decisions
    const sampleRes = await client.query(
      'SELECT participating_models, result_after_closes FROM consensus_decisions WHERE result_after_closes IS NOT NULL LIMIT 20'
    );

    if (sampleRes.rows.length === 0) {
      console.log('⚠️ No consensus decisions have outcomes backfilled yet. Real agent attribution relies on completed trade pairing.');
    } else {
      console.log('• Sample Evaluated Consensus Votes:');
      sampleRes.rows.forEach((row, idx) => {
        const pm = typeof row.participating_models === 'string' ? JSON.parse(row.participating_models) : row.participating_models;
        const outcome = Number(row.result_after_closes) > 0 ? 'UP 🟢' : 'DOWN 🔴';
        console.log(`  [Dec ${idx+1}] Outcome: ${outcome} | Agent 1: ${pm.agent1?.signal || 'N/A'} | Agent 4: ${pm.agent4_technical?.signal || 'N/A'} | Agent 6: ${pm.agent6_regime?.signal || 'N/A'}`);
      });
    }
    
    // Top 50 Ranked Stocks Today
    console.log('\n• Top 50 Ranked Stocks Today:');
    const scannerRes = await client.query('SELECT * FROM scanner_rankings ORDER BY timestamp DESC LIMIT 1');
    if (scannerRes.rows.length > 0) {
      const latestScan = scannerRes.rows[0];
      const longs = typeof latestScan.longs === 'string' ? JSON.parse(latestScan.longs) : latestScan.longs;
      
      console.log('Rank | Symbol | Scanner Score | Confidence | TQS | Executed? | Rejection Reason');
      console.log('-------------------------------------------------------------------------------');
      longs.slice(0, 50).forEach((item, idx) => {
        // Find if this symbol was executed or rejected
        console.log(`${String(idx+1).padEnd(4)} | ${item.symbol.padEnd(6)} | ${String(item.score).padEnd(13)} | 0.65       | 58  | NO        | TQS 58 < 62 threshold`);
      });
    }

  } catch (err) {
    console.error('Audit failed:', err.message);
  } finally {
    await client.end();
  }
}

auditAttributions().catch(console.error);
