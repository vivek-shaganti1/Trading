require('dotenv').config();
const { Client } = require('pg');

async function checkHistory() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();

    // 1. Fetch prediction_logs
    const plRes = await client.query('SELECT * FROM prediction_logs ORDER BY timestamp DESC LIMIT 50');
    // Fetch consensus_decisions to align votes
    const cdRes = await client.query('SELECT * FROM consensus_decisions ORDER BY timestamp DESC LIMIT 50');

    const cds = {};
    cdRes.rows.forEach(r => {
      cds[r.id] = r;
    });

    if (plRes.rows.length === 0) {
      console.log('HISTORY_EMPTY');
    } else {
      console.log('Symbol | Signal | Confidence | A1 | A2 | A3 | A4 | Final | Executed | PnL');
      console.log('---|---|---|---|---|---|---|---|---|---');
      plRes.rows.forEach(r => {
        const cd = cds[r.id] || {};
        const pm = cd.participating_models || {};
        const a1 = pm.agent1?.signal || r.custom_signal || 'HOLD';
        const a2 = pm.agent2?.signal || 'HOLD';
        const a3 = pm.agent3?.signal || r.kraken_signal || 'HOLD';
        const a4 = pm.agent4?.signal || 'HOLD';
        
        console.log(`${r.symbol} | ${r.signal} | ${cd.confidence || '0.50'} | ${a1} | ${a2} | ${a3} | ${a4} | ${r.signal} | ${r.consensus ? 'true' : 'false'} | ${r.pnl !== null ? '₹' + r.pnl : '-'}`);
      });
    }

    // 2. Win rate calculations
    // An agent vote is counted as correct if the trade consensus was executed, target exited, and PnL >= 0, or if final consensus was loss and agent voted opposite.
    // Let's filter prediction logs that have exits and PnLs
    const completed = plRes.rows.filter(r => r.pnl !== null && r.consensus);
    console.log(`\nCompleted trades with outcome: ${completed.length}`);
    
    if (completed.length > 0) {
      let a1_corr = 0, a2_corr = 0, a3_corr = 0, a4_corr = 0, consensus_corr = 0;
      completed.forEach(r => {
        const cd = cds[r.id] || {};
        const pm = cd.participating_models || {};
        const outcome = r.pnl >= 0 ? 'WIN' : 'LOSS';
        
        const correctSignal = r.pnl >= 0 ? r.signal : (r.signal === 'BUY' ? 'SELL' : 'BUY');
        
        if ((pm.agent1?.signal || r.custom_signal) === correctSignal) a1_corr++;
        if ((pm.agent2?.signal || 'HOLD') === correctSignal) a2_corr++;
        if ((pm.agent3?.signal || r.kraken_signal) === correctSignal) a3_corr++;
        if (pm.agent4?.signal === correctSignal) a4_corr++;
        if (r.pnl >= 0) consensus_corr++;
      });

      console.log('1. Win rate by agent:');
      console.log(`   - Agent 1: ${((a1_corr / completed.length) * 100).toFixed(1)}%`);
      console.log(`   - Agent 2: ${((a2_corr / completed.length) * 100).toFixed(1)}%`);
      console.log(`   - Agent 3: ${((a3_corr / completed.length) * 100).toFixed(1)}%`);
      console.log(`   - Agent 4: ${((a4_corr / completed.length) * 100).toFixed(1)}%`);
      console.log('2. Win rate by consensus:');
      console.log(`   - Consensus Win Rate: ${((consensus_corr / completed.length) * 100).toFixed(1)}%`);
    } else {
      console.log('\nWin rates: N/A (no closed trades present in logs history)');
    }

    // 3. learning_feedback count
    console.log('\n4. Current learning_feedback entries:');
    const lfRes = await client.query('SELECT * FROM learning_feedback ORDER BY timestamp DESC LIMIT 5');
    if (lfRes.rows.length === 0) {
      console.log('TABLE_EMPTY');
    } else {
      console.log(JSON.stringify(lfRes.rows, null, 2));
    }

    // 4. daily_model_performance
    console.log('\n5. Current daily_model_performance entries:');
    const dpRes = await client.query('SELECT * FROM daily_model_performance ORDER BY date DESC LIMIT 5');
    if (dpRes.rows.length === 0) {
      console.log('TABLE_EMPTY');
    } else {
      console.log(JSON.stringify(dpRes.rows, null, 2));
    }

  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}

checkHistory();
