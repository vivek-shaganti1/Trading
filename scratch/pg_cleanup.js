/**
 * Postgres Cleanup: Sync clean local state to Postgres via public db API
 */
const db = require('../db');

async function pgCleanup() {
  console.log('[PG CLEANUP] Waiting for DB initialization...');
  await db.initPromise;
  
  const data = db.readLocalDb();
  const today = new Date().toISOString().split('T')[0];
  const balance = data.portfolio_state.balance || 7627.96;
  
  // 1. Save clean portfolio (no holdings) to Postgres
  await db.updatePortfolioState({
    holding_stocks: [],
    equity_value: 0,
    balance: balance
  });
  console.log(`[PG CLEANUP] Portfolio synced: balance=₹${balance}, holdings=[]`);
  
  // 2. Save today's daily_stats as ACTIVE with correct start_capital
  const stats = {
    date: today,
    start_capital: balance,
    end_capital: balance,
    net_pnl: 0,
    daily_target: 1000,
    target_met: false,
    strategy_switched: false,
    status: 'ACTIVE'
  };
  await db.saveDailyStats(stats);
  console.log(`[PG CLEANUP] Daily stats: start_capital=₹${balance}, status=ACTIVE`);
  
  // 3. Update local db too
  data.portfolio_state.holding_stocks = [];
  data.portfolio_state.equity_value = 0;
  data.daily_stats = data.daily_stats.filter(s => s.date !== today);
  data.daily_stats.push(stats);
  db.writeLocalDb(data);
  
  // 4. Verify
  const v = db.readLocalDb();
  console.log(`\n[PG CLEANUP] Verified:`);
  console.log(`  Balance: ₹${v.portfolio_state.balance}`);
  console.log(`  Holdings: ${(v.portfolio_state.holding_stocks || []).length}`);
  console.log(`  Completed trades: ${(v.completed_trades || []).length}`);
  const ts = (v.daily_stats || []).find(s => s.date === today);
  console.log(`  Today start_capital: ₹${ts?.start_capital}`);
  console.log(`  Today status: ${ts?.status}`);
  
  console.log('\n[PG CLEANUP] ✅ Done. Restart server.js now.');
  process.exit(0);
}

pgCleanup().catch(err => {
  console.error('[PG CLEANUP] Fatal:', err);
  process.exit(1);
});
