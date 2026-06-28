const db = require('../backend/db');

async function main() {
  console.log('--- STARTING CONCISE FINANCIAL FORENSIC CHECK (NO NESTED ARRAYS) ---');
  await db.initPromise;
  
  const localDb = db.readLocalDb();
  const lp = localDb.portfolio_state;
  console.log('\n=== LOCAL db.json FINANCIALS ===');
  console.log(`Balance        : ₹${lp.balance}`);
  console.log(`Equity Value   : ₹${lp.equity_value}`);
  console.log(`Lifetime PnL   : ₹${lp.lifetime_pnl}`);
  console.log(`Holdings Count : ${lp.holding_stocks ? lp.holding_stocks.length : 0}`);
  console.log(`Completed Trades Count: ${localDb.completed_trades.length}`);
  
  console.log('\n=== POSTGRES DB FINANCIALS ===');
  try {
    if (db.isNeonOnline()) {
      const pgState = await db.runQueryDirect('SELECT balance, equity_value, lifetime_pnl, holding_stocks FROM portfolio_state WHERE id = $1', ['default']);
      if (pgState && pgState.length > 0) {
        const p = pgState[0];
        const pgHoldings = typeof p.holding_stocks === 'string' ? JSON.parse(p.holding_stocks) : p.holding_stocks;
        console.log(`Balance        : ₹${p.balance}`);
        console.log(`Equity Value   : ₹${p.equity_value}`);
        console.log(`Lifetime PnL   : ₹${p.lifetime_pnl}`);
        console.log(`Holdings Count : ${pgHoldings ? pgHoldings.length : 0}`);
      } else {
        console.log('No portfolio_state row found in Postgres.');
      }
      
      const pgTrades = await db.runQueryDirect('SELECT COUNT(*) as count FROM completed_trades');
      console.log(`Completed Trades Count in Postgres: ${pgTrades ? pgTrades[0].count : 'error'}`);
    } else {
      console.log('Postgres is not online.');
    }
  } catch (err) {
    console.error('Error querying Postgres:', err);
  }
  
  await db.close();
  process.exit(0);
}

main().catch(console.error);
