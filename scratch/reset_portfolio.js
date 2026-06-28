#!/usr/bin/env node
const db = require('../backend/db');
const config = require('../shared/config');

(async () => {
  console.log('[RESET] Waiting for DB initialization...');
  await db.initPromise;
  console.log('[RESET] DB ready. Resetting portfolio state to clean 12k...');

  // Reset portfolio state
  await db.updatePortfolioState({
    strategy: 'DAY_TRADING',
    balance: 12000.00,
    equity_value: 0.00,
    current_daily_target: config.DAILY_PROFIT_TARGET_START || 1000,
    lifetime_pnl: 0.00,
    holding_stocks: []
  });

  console.log('[RESET] Portfolio state reset successfully.');

  // Reset paper trading results table
  if (db.isNeonOnline()) {
    try {
      await db.runQueryDirect('DELETE FROM completed_trades');
      await db.runQueryDirect('DELETE FROM trade_logs');
      await db.runQueryDirect('DELETE FROM daily_stats');
      await db.runQueryDirect('DELETE FROM shadow_trades');
      
      // Reset paper_trading_results row in Postgres
      await db.runQueryDirect(`
        INSERT INTO paper_trading_results (id, trading_days_tracked, win_rate, profit_factor, sharpe_ratio, max_drawdown, accuracy, net_pnl, details, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
        ON CONFLICT (id) DO UPDATE SET
          trading_days_tracked = EXCLUDED.trading_days_tracked,
          win_rate = EXCLUDED.win_rate,
          profit_factor = EXCLUDED.profit_factor,
          sharpe_ratio = EXCLUDED.sharpe_ratio,
          max_drawdown = EXCLUDED.max_drawdown,
          accuracy = EXCLUDED.accuracy,
          net_pnl = EXCLUDED.net_pnl,
          details = EXCLUDED.details,
          updated_at = NOW()
      `, ['default', 0, 0.00, 1.00, 0.00, 0.00, 0.00, 0.00, '{}']);
      
      console.log('[RESET] Postgres tables (completed_trades, trade_logs, daily_stats, shadow_trades, paper_trading_results) cleared/reset.');
    } catch (err) {
      console.error('[RESET ERROR] Failed to clear postgres tables:', err.message);
    }
  } else {
    console.log('[RESET WARNING] Neon Postgres is offline or in local cache mode. Skipping DB truncate.');
  }

  // Also clean up local JSON data structure
  const data = db.readLocalDb();
  data.completed_trades = [];
  data.trade_logs = [];
  data.daily_stats = [];
  data.shadow_trades = [];
  data.paper_trading_results = {
    id: 'default',
    trading_days_tracked: 0,
    win_rate: 0.00,
    profit_factor: 1.00,
    sharpe_ratio: 0.00,
    max_drawdown: 0.00,
    accuracy: 0.00,
    net_pnl: 0.00,
    details: {}
  };
  db.writeLocalDb(data);
  console.log('[RESET] Local DB lists (completed_trades, trade_logs, daily_stats, shadow_trades, paper_trading_results) cleared.');

  process.exit(0);
})();
