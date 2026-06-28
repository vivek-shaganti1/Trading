/**
 * Full Reset: Clean stale data from BOTH local db.json AND Postgres
 * This ensures a clean start with no stale holdings, halts, or inflated start_capital
 */
const db = require('../db');

async function fullReset() {
  console.log('[FULL RESET] Waiting for DB initialization...');
  await db.initPromise;
  
  // 1. Clean local db.json
  const data = db.readLocalDb();
  
  // Remove all completed trades with synthetic symbols or halt-victim trades
  const syntheticPattern = /^(STRTECH|TELE|TEXT|ENER|SERV|INDU)\d*/;
  const origCompleted = (data.completed_trades || []).length;
  data.completed_trades = (data.completed_trades || []).filter(t => {
    if (syntheticPattern.test(t.symbol)) return false;
    if (t.entry_price === t.exit_price && (t.exit_reason || '').includes('Emergency Liquidation')) return false;
    return true;
  });
  console.log(`[FULL RESET] Completed trades: ${origCompleted} -> ${data.completed_trades.length}`);
  
  // Clear holdings
  data.portfolio_state.holding_stocks = [];
  data.portfolio_state.balance = data.portfolio_state.balance || 9104.60;
  data.portfolio_state.equity_value = 0;
  console.log(`[FULL RESET] Holdings cleared. Balance: ₹${data.portfolio_state.balance}`);
  
  // Reset daily_stats — remove halted entries and set today fresh
  const today = new Date().toISOString().split('T')[0];
  data.daily_stats = (data.daily_stats || []).filter(s => 
    s.status === 'COMPLETED' && s.date !== today
  );
  console.log(`[FULL RESET] Daily stats cleaned. Remaining: ${data.daily_stats.length}`);
  
  db.writeLocalDb(data);
  console.log('[FULL RESET] Local db.json written.');
  
  // 2. Clean Postgres tables
  try {
    // Delete today's halted daily_stats from Postgres
    await db.pool.query(`DELETE FROM daily_stats WHERE date = $1`, [today]);
    console.log(`[FULL RESET] Postgres: Deleted today's daily_stats`);
    
    // Delete synthetic completed_trades from Postgres
    await db.pool.query(`DELETE FROM completed_trades WHERE symbol ~ '^(STRTECH|TELE|TEXT|ENER|SERV|INDU)[0-9]*$'`);
    console.log(`[FULL RESET] Postgres: Deleted synthetic completed_trades`);
    
    // Delete halt-victim completed_trades from Postgres  
    await db.pool.query(`DELETE FROM completed_trades WHERE entry_price = exit_price AND exit_reason LIKE '%Emergency Liquidation%'`);
    console.log(`[FULL RESET] Postgres: Deleted halt-victim completed_trades`);
    
    // Clear portfolio holdings in Postgres
    await db.pool.query(`UPDATE portfolio_state SET holding_stocks = '[]'::jsonb WHERE id = 1`);
    console.log(`[FULL RESET] Postgres: Cleared portfolio holdings`);
    
    // Verify remaining state
    const { rows: stats } = await db.pool.query(`SELECT * FROM daily_stats ORDER BY date DESC LIMIT 5`);
    console.log('[FULL RESET] Remaining daily_stats:', stats.map(s => `${s.date}: start=${s.start_capital}, end=${s.end_capital}, status=${s.status}`));
    
    const { rows: ct } = await db.pool.query(`SELECT count(*) as c FROM completed_trades`);
    console.log(`[FULL RESET] Remaining completed_trades: ${ct[0].c}`);
    
    const { rows: ps } = await db.pool.query(`SELECT balance, holding_stocks FROM portfolio_state WHERE id = 1`);
    if (ps.length > 0) {
      const holdings = typeof ps[0].holding_stocks === 'string' ? JSON.parse(ps[0].holding_stocks) : ps[0].holding_stocks;
      console.log(`[FULL RESET] Portfolio: balance=₹${ps[0].balance}, holdings=${holdings.length}`);
    }
    
  } catch (pgErr) {
    console.error('[FULL RESET] Postgres cleanup error:', pgErr.message);
  }
  
  console.log('\n[FULL RESET] ✅ Complete. Restart server.js now.');
  process.exit(0);
}

fullReset().catch(err => {
  console.error('[FULL RESET] Fatal error:', err);
  process.exit(1);
});
