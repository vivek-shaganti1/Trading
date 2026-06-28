const { Client } = require('pg');
require('dotenv').config();

async function run() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  try {
    await client.connect();

    // 1. Get all rows for June 15, 2026
    const res = await client.query(`
      SELECT * FROM throughput_history 
      WHERE timestamp >= '2026-06-15T00:00:00.000Z' 
        AND timestamp < '2026-06-16T00:00:00.000Z'
      ORDER BY timestamp ASC
    `);
    const rows = res.rows;
    console.log('Today rows count:', rows.length);

    if (rows.length === 0) {
      console.log('No rows today.');
      return;
    }

    // Last cycle is the last element
    const lastCycle = rows[rows.length - 1];

    // Let's also fetch trade logs for today to get actual BUY orders filled (to count fills accurately)
    const tLogsRes = await client.query(`
      SELECT * FROM trade_logs
      WHERE timestamp >= '2026-06-15T00:00:00.000Z' 
        AND timestamp < '2026-06-16T00:00:00.000Z'
    `);
    const todayTrades = tLogsRes.rows;
    console.log('Today trades count:', todayTrades.length);

    console.log('\n================ LAST CYCLE CORES ================');
    console.log('Raw Last Cycle Row:', JSON.stringify(lastCycle, null, 2));
    
    // Funnel stages mapping for Last Cycle:
    // Scanned -> TQS -> Confidence -> Risk -> Consensus -> Submit -> Fill
    // Let's use the mapping defined in tradingBot.js or the database fields:
    // Let's check tradingBot.js:
    // scanned = t.scanned
    // TQS = t.ranked
    // Confidence = t.scored
    // Risk = t.consensus
    // Consensus = t.passed_risk
    // Submit = t.executed
    // Fill = buyTrades count for that cycle (or executed if buyTrades is 0)
    
    const lastScanned = lastCycle.scanned;
    const lastTQS = lastCycle.ranked;
    const lastConfidence = lastCycle.scored;
    const lastRisk = lastCycle.consensus;
    const lastConsensus = lastCycle.passed_risk;
    const lastSubmit = lastCycle.executed;
    // For last cycle, if we had a buy trade at the same time:
    // BALKRISIND Buy timestamp is 2026-06-15T08:22:56.534Z.
    // The throughput log is at 2026-06-15T08:22:57.653Z.
    // So last cycle had 1 BUY order executed and filled. Let's check:
    const lastFill = lastSubmit > 0 ? lastSubmit : (todayTrades.filter(t => t.action === 'BUY' && Math.abs(new Date(t.timestamp) - new Date(lastCycle.timestamp)) < 5000).length);

    console.log(`Scanned: ${lastScanned}`);
    console.log(`TQS: ${lastTQS}`);
    console.log(`Confidence: ${lastConfidence}`);
    console.log(`Risk: ${lastRisk}`);
    console.log(`Consensus: ${lastConsensus}`);
    console.log(`Submit: ${lastSubmit}`);
    console.log(`Fill: ${lastFill}`);

    console.log('\n================ ENTIRE SESSION CORES ================');
    const sessScanned = rows.reduce((sum, r) => sum + r.scanned, 0);
    const sessTQS = rows.reduce((sum, r) => sum + r.ranked, 0);
    const sessConfidence = rows.reduce((sum, r) => sum + r.scored, 0);
    const sessRisk = rows.reduce((sum, r) => sum + r.consensus, 0);
    const sessConsensus = rows.reduce((sum, r) => sum + r.passed_risk, 0);
    const sessSubmit = rows.reduce((sum, r) => sum + r.executed, 0);
    const sessFill = todayTrades.filter(t => t.action === 'BUY').length;

    console.log(`Scanned: ${sessScanned}`);
    console.log(`TQS: ${sessTQS}`);
    console.log(`Confidence: ${sessConfidence}`);
    console.log(`Risk: ${sessRisk}`);
    console.log(`Consensus: ${sessConsensus}`);
    console.log(`Submit: ${sessSubmit}`);
    console.log(`Fill: ${sessFill}`);

  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}

run();
