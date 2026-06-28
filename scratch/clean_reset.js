#!/usr/bin/env node
/**
 * clean_reset.js
 * --------------
 * Re-initializes simulated trading state. Wipes simulated history, trade logs, prediction logs,
 * rejections, audits, and sets balance to ₹12,000.
 */

const db = require('../backend/db');

(async () => {
  console.log('[RESET] Waiting for database connection initialization...');
  await db.initPromise;
  console.log('[RESET] Database connection ready.');

  try {
    // 1. Wipe simulation tables in Postgres if connected
    if (db.isNeonOnline()) {
      console.log('[RESET] Wiping database tables in Neon PostgreSQL...');
      const tablesToTruncate = [
        'completed_trades',
        'trade_logs',
        'prediction_logs',
        'consensus_decisions',
        'risk_events',
        'agent24_audit_logs',
        'opportunity_tracker',
        'threshold_history',
        'scanner_rankings',
        'daily_stats',
        'performance_metrics',
        'shadow_trades',
        'learning_feedback'
      ];
      for (const table of tablesToTruncate) {
        try {
          await db.runQueryDirect(`TRUNCATE TABLE ${table} CASCADE`);
          console.log(`   ✓ Truncated table: ${table}`);
        } catch (e) {
          console.error(`   ✗ Error truncating ${table}:`, e.message);
        }
      }
    }

    // 2. Reset local JSON database cache
    console.log('[RESET] Resetting local JSON database cache...');
    const data = db.readLocalDb ? db.readLocalDb() : {};

    // Wipe arrays
    data.completed_trades = [];
    data.trade_logs = [];
    data.prediction_logs = [];
    data.consensus_decisions = [];
    data.risk_events = [];
    data.agent24_audit_logs = [];
    data.opportunity_tracker = [];
    data.threshold_history = [];
    data.scanner_rankings = [];
    data.daily_stats = [];
    data.performance_metrics = [];
    data.shadow_trades = [];
    data.learning_feedback = [];

    // Re-initialize portfolio state
    data.portfolio_state = {
      id: 'default',
      strategy: 'EXPECTANCY_ENGINE',
      balance: 12000,
      equity_value: 0,
      current_daily_target: 600,
      lifetime_pnl: 0,
      holding_stocks: []
    };

    // Re-initialize paper trading results
    data.paper_trading_results = {
      id: 'default',
      trading_days_tracked: 0,
      win_rate: 0,
      profit_factor: 1,
      sharpe_ratio: 0,
      max_drawdown: 0,
      accuracy: 0,
      net_pnl: 0,
      details: {}
    };

    // Write local DB back to disk
    if (db.writeLocalDb) {
      db.writeLocalDb(data);
    } else {
      const fs = require('fs');
      fs.writeFileSync('./db.json', JSON.stringify(data, null, 2));
    }
    console.log('   ✓ Local JSON DB reset successfully.');

    // 3. Update database table entries for default states
    if (db.isNeonOnline()) {
      console.log('[RESET] Initializing Postgres portfolio_state and paper_trading_results default values...');
      await db.runQueryDirect(`
        INSERT INTO portfolio_state (id, strategy, balance, equity_value, current_daily_target, lifetime_pnl, holding_stocks)
        VALUES ('default', 'EXPECTANCY_ENGINE', 12000, 0, 600, 0, '[]'::jsonb)
        ON CONFLICT (id) DO UPDATE SET
          strategy = EXCLUDED.strategy,
          balance = EXCLUDED.balance,
          equity_value = EXCLUDED.equity_value,
          current_daily_target = EXCLUDED.current_daily_target,
          lifetime_pnl = EXCLUDED.lifetime_pnl,
          holding_stocks = EXCLUDED.holding_stocks
      `);
      await db.runQueryDirect(`
        INSERT INTO paper_trading_results (id, trading_days_tracked, win_rate, profit_factor, sharpe_ratio, max_drawdown, accuracy, net_pnl, details)
        VALUES ('default', 0, 0, 1.0, 0, 0, 0, 0, '{}'::jsonb)
        ON CONFLICT (id) DO UPDATE SET
          trading_days_tracked = EXCLUDED.trading_days_tracked,
          win_rate = EXCLUDED.win_rate,
          profit_factor = EXCLUDED.profit_factor,
          sharpe_ratio = EXCLUDED.sharpe_ratio,
          max_drawdown = EXCLUDED.max_drawdown,
          accuracy = EXCLUDED.accuracy,
          net_pnl = EXCLUDED.net_pnl,
          details = EXCLUDED.details
      `);
      console.log('   ✓ PostgreSQL tables populated with initial reset states.');
    }

    console.log('\n[RESET] Simulation state reset complete!');
    process.exit(0);
  } catch (err) {
    console.error('[RESET] Critical error running reset script:', err);
    process.exit(1);
  }
})();
