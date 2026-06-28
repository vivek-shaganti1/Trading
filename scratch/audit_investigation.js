require('dotenv').config();
const { Client } = require('pg');

async function audit() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  try {
    await client.connect();
    console.log('=== Neon PostgreSQL Connection Established ===');

    // 1. Check counts of tables
    const tables = [
      'portfolio_state',
      'daily_stats',
      'trade_logs',
      'consensus_decisions',
      'learning_feedback',
      'agent_memory',
      'paper_trading_results',
      'daily_model_performance',
      'agent20_reports',
      'agent21_trust_logs',
      'agent22_research_logs',
      'agent23_journals',
      'agent24_audit_logs',
      'agent25_sizing_logs',
      'agent26_market_memory',
      'nightly_learning_reports'
    ];

    console.log('\n--- Table Row Counts ---');
    for (const table of tables) {
      try {
        const countRes = await client.query(`SELECT COUNT(*) FROM ${table}`);
        console.log(`${table}: ${countRes.rows[0].count}`);
      } catch (err) {
        console.log(`${table}: Error or Not Found (${err.message})`);
      }
    }

    // 2. Fetch current portfolio_state
    console.log('\n--- portfolio_state content ---');
    const pState = await client.query('SELECT * FROM portfolio_state');
    console.log(JSON.stringify(pState.rows, null, 2));

    // 3. Fetch all trade logs today (IST, 2026-06-11)
    console.log('\n--- Trade Logs for Today (2026-06-11) ---');
    const tLogs = await client.query("SELECT * FROM trade_logs WHERE timestamp >= '2026-06-11 00:00:00+00' ORDER BY timestamp ASC");
    console.log(JSON.stringify(tLogs.rows, null, 2));

    // 4. Fetch last 20 trade logs overall
    console.log('\n--- Last 20 Trade Logs ---');
    const last20Trades = await client.query('SELECT * FROM trade_logs ORDER BY timestamp DESC LIMIT 20');
    console.log(JSON.stringify(last20Trades.rows, null, 2));

    // 5. Fetch last 10 consensus_decisions
    console.log('\n--- Last 10 Consensus Decisions ---');
    const cDecisions = await client.query('SELECT * FROM consensus_decisions ORDER BY timestamp DESC LIMIT 10');
    console.log(JSON.stringify(cDecisions.rows.map(r => ({
      id: r.id,
      timestamp: r.timestamp,
      symbol: r.symbol,
      decision: r.decision,
      confidence: r.confidence,
      tqs: r.participating_models ? r.participating_models.trade_quality_score : null
    })), null, 2));

  } catch (err) {
    console.error('Audit query error:', err);
  } finally {
    await client.end();
  }
}

audit();
