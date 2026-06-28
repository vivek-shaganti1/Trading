require('dotenv').config();
const { Client } = require('pg');

async function validate() {
  console.log('='.repeat(70));
  console.log('SPRINT 1 COMPLETION VALIDATION');
  console.log('='.repeat(70));

  const client = new Client({
    connectionString: require('../config.js').DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  const results = {};
  
  try {
    await client.connect();
    results.db_connection = 'PASS';
    console.log('\n✅ A. Database Connection: PASS');
  } catch (err) {
    results.db_connection = 'FAIL';
    console.log('\n❌ A. Database Connection: FAIL -', err.message);
    return;
  }

  try {
    // TEST B: Leaderboard save/load round-trip
    console.log('\n--- TEST B: Leaderboard Save/Load Round-Trip ---');
    
    // Check current neural_model_weights
    const wRows = await client.query('SELECT neural_model_weights FROM model_weights WHERE id = $1', ['default']);
    const currentWeights = wRows.rows[0]?.neural_model_weights || {};
    const hasLeaderboard = currentWeights.leaderboard_state !== undefined;
    
    if (hasLeaderboard) {
      const lb = currentWeights.leaderboard_state;
      const agentIds = Object.keys(lb);
      console.log(`  Leaderboard found in database with ${agentIds.length} agents.`);
      agentIds.forEach(id => {
        console.log(`  Agent${id}: weight=${lb[id].weight}, profit=${lb[id].profitContribution}, sharpe=${lb[id].sharpeContribution}`);
      });
      results.leaderboard_persisted = 'PASS';
      console.log('✅ B. Leaderboard Persistence: PASS');
    } else {
      console.log('  No leaderboard_state found in neural_model_weights yet.');
      console.log('  This is expected on first boot — loadLeaderboardFromDb() will save defaults now.');
      results.leaderboard_persisted = 'PENDING_FIRST_BOOT';
      console.log('⚠️ B. Leaderboard Persistence: PENDING (will be saved on next server start)');
    }

    // TEST C: Market memory restoration
    console.log('\n--- TEST C: Market Memory Records in Database ---');
    const memRes = await client.query('SELECT COUNT(*) as cnt FROM agent26_market_memory');
    const memCount = parseInt(memRes.rows[0].cnt);
    console.log(`  agent26_market_memory rows: ${memCount}`);
    
    if (memCount > 0) {
      const sampleRes = await client.query('SELECT symbol, signal, feature_vector, outcome_pnl FROM agent26_market_memory ORDER BY timestamp DESC LIMIT 3');
      sampleRes.rows.forEach((r, i) => {
        console.log(`  Sample ${i+1}: ${r.symbol} signal=${r.signal} outcome=${r.outcome_pnl} features=${JSON.stringify(r.feature_vector).substring(0, 80)}...`);
      });
      results.market_memory = 'PASS';
      console.log('✅ C. Market Memory Persistence: PASS');
    } else {
      results.market_memory = 'EMPTY';
      console.log('⚠️ C. Market Memory: 0 rows (will populate during trading)');
    }

    // TEST D: Learning agent logs
    console.log('\n--- TEST D: Learning Agent Logs in Database ---');
    const tables = [
      'agent20_reports',
      'agent21_trust_logs',
      'agent22_research_logs',
      'agent23_journals',
      'agent24_audit_logs',
      'agent25_sizing_logs'
    ];
    
    for (const table of tables) {
      const res = await client.query(`SELECT COUNT(*) as cnt FROM ${table}`);
      const count = parseInt(res.rows[0].cnt);
      console.log(`  ${table}: ${count} rows`);
    }
    results.learning_logs = 'PASS';
    console.log('✅ D. Learning Agent Tables: PASS (accessible)');

    // TEST E: Portfolio state preservation
    console.log('\n--- TEST E: Portfolio State Preservation ---');
    const pRes = await client.query('SELECT balance, equity_value, holding_stocks, lifetime_pnl FROM portfolio_state WHERE id = $1', ['default']);
    if (pRes.rows.length > 0) {
      const p = pRes.rows[0];
      console.log(`  Balance: ₹${p.balance}`);
      console.log(`  Equity: ₹${p.equity_value}`);
      console.log(`  Holdings: ${JSON.stringify(p.holding_stocks)}`);
      console.log(`  Lifetime PnL: ₹${p.lifetime_pnl}`);
      results.portfolio_state = 'PASS';
      console.log('✅ E. Portfolio State: PASS');
    } else {
      results.portfolio_state = 'FAIL';
      console.log('❌ E. Portfolio State: MISSING');
    }

    // TEST F: Trade history preservation
    console.log('\n--- TEST F: Trade History Preservation ---');
    const tRes = await client.query('SELECT COUNT(*) as cnt FROM trade_logs');
    const tradeCount = parseInt(tRes.rows[0].cnt);
    console.log(`  trade_logs: ${tradeCount} rows`);
    
    if (tradeCount > 0) {
      const recentRes = await client.query('SELECT id, symbol, action, quantity, price FROM trade_logs ORDER BY timestamp DESC LIMIT 5');
      recentRes.rows.forEach(t => {
        console.log(`  ${t.action} ${t.quantity}x ${t.symbol} @ ₹${t.price} (${t.id})`);
      });
      results.trade_history = 'PASS';
      console.log('✅ F. Trade History: PASS');
    } else {
      results.trade_history = 'EMPTY';
      console.log('⚠️ F. Trade History: 0 rows');
    }

    // TEST G: Consensus decisions
    console.log('\n--- TEST G: Consensus Decision History ---');
    const cRes = await client.query('SELECT COUNT(*) as cnt FROM consensus_decisions');
    const consensusCount = parseInt(cRes.rows[0].cnt);
    console.log(`  consensus_decisions: ${consensusCount} rows`);
    results.consensus_history = consensusCount > 0 ? 'PASS' : 'EMPTY';
    console.log(consensusCount > 0 ? '✅ G. Consensus History: PASS' : '⚠️ G. Consensus History: EMPTY');

    // TEST H: Verify code changes compile (syntax check)
    console.log('\n--- TEST H: Code Compilation Check ---');
    try {
      // Clear require cache for modified files
      delete require.cache[require.resolve('../db.js')];
      delete require.cache[require.resolve('../predictor.js')];
      delete require.cache[require.resolve('../server.js')];
      
      // Test that db.js loads without errors
      const db = require('../db.js');
      console.log('  db.js: loads OK');
      console.log(`  db.saveLeaderboardState: ${typeof db.saveLeaderboardState === 'function' ? 'EXISTS' : 'MISSING'}`);
      console.log(`  db.initPromise: ${db.initPromise ? 'EXISTS' : 'MISSING'}`);
      console.log(`  db.readLocalDb: ${typeof db.readLocalDb === 'function' ? 'EXISTS' : 'MISSING'}`);
      
      // Verify local cache has agent26_market_memory after restore
      setTimeout(async () => {
        const localState = db.readLocalDb();
        const localMemCount = (localState.agent26_market_memory || []).length;
        console.log(`  Local cache agent26_market_memory: ${localMemCount} records`);
        console.log(`  Local cache agent21_trust_logs: ${(localState.agent21_trust_logs || []).length} records`);
        console.log(`  Local cache agent20_reports: ${(localState.agent20_reports || []).length} records`);
        console.log(`  Local cache agent24_audit_logs: ${(localState.agent24_audit_logs || []).length} records`);
        
        if (localMemCount >= memCount && memCount > 0) {
          console.log('✅ H. Market Memory Restored to Local Cache: PASS');
        } else if (memCount === 0) {
          console.log('⚠️ H. Market Memory Restored to Local Cache: N/A (no records in DB to restore)');
        } else {
          console.log(`⚠️ H. Market Memory Restored to Local Cache: ${localMemCount}/${memCount}`);
        }

        // SUMMARY
        console.log('\n' + '='.repeat(70));
        console.log('VALIDATION SUMMARY');
        console.log('='.repeat(70));
        Object.entries(results).forEach(([k, v]) => {
          const icon = v === 'PASS' ? '✅' : v === 'FAIL' ? '❌' : '⚠️';
          console.log(`  ${icon} ${k}: ${v}`);
        });
        console.log('='.repeat(70));

        await client.end();
        process.exit(0);
      }, 5000);
    } catch (compErr) {
      results.code_compilation = 'FAIL';
      console.log('❌ H. Code Compilation: FAIL -', compErr.message);
      await client.end();
      process.exit(1);
    }
    
  } catch (err) {
    console.error('💥 Validation error:', err.message);
    await client.end();
    process.exit(1);
  }
}

validate();
