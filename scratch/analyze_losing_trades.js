const { Client } = require('pg');
require('dotenv').config();

async function run() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  try {
    await client.connect();

    // Fetch all completed trades
    const res = await client.query('SELECT * FROM completed_trades');
    const trades = res.rows;

    const losing = trades.filter(t => parseFloat(t.net_pnl) < 0);
    const winning = trades.filter(t => parseFloat(t.net_pnl) >= 0);

    console.log(`Total Completed Trades: ${trades.length}`);
    console.log(`Winning Trades: ${winning.length}`);
    console.log(`Losing Trades: ${losing.length}`);

    // Grouping by symbol
    const symGroup = {};
    // Grouping by exit reason
    const exitGroup = {};
    // Grouping by execution mode
    const modeGroup = {};

    losing.forEach(t => {
      symGroup[t.symbol] = (symGroup[t.symbol] || 0) + 1;
      exitGroup[t.exit_reason] = (exitGroup[t.exit_reason] || 0) + 1;
      modeGroup[t.execution_mode] = (modeGroup[t.execution_mode] || 0) + 1;
    });

    console.log('\n--- LOSSES BY SYMBOL ---');
    console.log(symGroup);

    console.log('\n--- LOSSES BY EXIT REASON ---');
    console.log(exitGroup);

    console.log('\n--- LOSSES BY EXECUTION MODE ---');
    console.log(modeGroup);

    // Let's print each losing trade with details
    console.log('\n--- DETAILED LOSSES ---');
    losing.forEach((t, i) => {
      console.log(`${i+1}. Symbol: ${t.symbol} | PnL: ₹${t.net_pnl} | Entry Price: ₹${t.entry_price} | Exit Price: ₹${t.exit_price} | Exit Reason: ${t.exit_reason} | TQS: ${t.tqs} | Conf: ${t.confidence} | Hold Time: ${t.holding_minutes} mins`);
    });

  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}

run();
