require('dotenv').config();
const { Client } = require('pg');

async function readTables() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false
    }
  });

  try {
    await client.connect();

    // 1. model_weights
    console.log('--- 1. model_weights ---');
    const mwRes = await client.query('SELECT * FROM model_weights');
    if (mwRes.rows.length === 0) {
      console.log('TABLE_EMPTY');
    } else {
      console.log('agent_name\tweight\tlast_updated');
      mwRes.rows.forEach(r => {
        console.log(`agent1\t${r.agent1_weight}\t${r.updated_at}`);
        console.log(`agent2\t${r.agent2_weight}\t${r.updated_at}`);
        console.log(`agent3\t${r.agent3_weight}\t${r.updated_at}`);
        console.log(`agent4\t${r.agent4_weight}\t${r.updated_at}`);
      });
    }

    // 2. prediction_logs
    console.log('\n--- 2. prediction_logs ---');
    const plRes = await client.query('SELECT * FROM prediction_logs ORDER BY timestamp DESC LIMIT 5');
    if (plRes.rows.length === 0) {
      console.log('TABLE_EMPTY');
    } else {
      plRes.rows.forEach(r => {
        console.log(`${r.id} | ${r.symbol} | ${r.signal} | ${r.confidence} | ${r.timestamp}`);
      });
    }

    // 3. consensus_decisions
    console.log('\n--- 3. consensus_decisions ---');
    const cdRes = await client.query('SELECT * FROM consensus_decisions ORDER BY timestamp DESC LIMIT 5');
    if (cdRes.rows.length === 0) {
      console.log('TABLE_EMPTY');
    } else {
      cdRes.rows.forEach(r => {
        // participating_models is JSONB
        const pm = r.participating_models || {};
        let buy = 0, hold = 0, sell = 0;
        Object.values(pm).forEach(v => {
          const sig = typeof v === 'string' ? v : v.signal;
          if (sig === 'BUY') buy++;
          else if (sig === 'HOLD') hold++;
          else if (sig === 'SELL') sell++;
        });
        console.log(`${r.id} | ${r.symbol} | ${buy} | ${hold} | ${sell} | ${r.decision}`);
      });
    }

    // 4. learning_feedback
    console.log('\n--- 4. learning_feedback ---');
    const lfRes = await client.query('SELECT * FROM learning_feedback ORDER BY timestamp DESC LIMIT 5');
    if (lfRes.rows.length === 0) {
      console.log('TABLE_EMPTY');
    } else {
      lfRes.rows.forEach(r => {
        console.log(`${r.prediction_id} | ${r.pnl >= 0 ? 'PROFIT' : 'LOSS'} | ${r.pnl} | ${r.learning_rate}`);
      });
    }

    // 5. agent_memory
    console.log('\n--- 5. agent_memory ---');
    const amRes = await client.query('SELECT * FROM agent_memory');
    if (amRes.rows.length === 0) {
      console.log('TABLE_EMPTY');
    } else {
      amRes.rows.forEach(r => {
        console.log(`${r.id} | default | ${JSON.stringify(r.winning_patterns || r.losing_patterns || {})} | ${r.updated_at}`);
      });
    }

    // 6. daily_model_performance
    console.log('\n--- 6. daily_model_performance ---');
    const dpRes = await client.query('SELECT * FROM daily_model_performance ORDER BY date DESC LIMIT 5');
    if (dpRes.rows.length === 0) {
      console.log('TABLE_EMPTY');
    } else {
      dpRes.rows.forEach(r => {
        console.log(`agent1 | ${r.agent1_accuracy} | - | -`);
        console.log(`agent2 | ${r.agent2_accuracy} | - | -`);
        console.log(`agent3 | ${r.agent3_accuracy} | - | -`);
        console.log(`agent4 | ${r.agent4_accuracy} | - | -`);
      });
    }

  } catch (err) {
    console.error('Error querying tables:', err.message);
  } finally {
    await client.end();
  }
}

readTables();
