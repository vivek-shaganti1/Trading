const { Client } = require('pg');
require('dotenv').config();

async function run() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  try {
    await client.connect();
    
    // 1. Get all trade logs in chronological order
    const res = await client.query('SELECT * FROM trade_logs ORDER BY timestamp ASC');
    const logs = res.rows;
    
    console.log(`Reconstructing ledger from ${logs.length} trade logs...`);
    let cash = 12000; // start capital
    
    // Let's keep track of open positions to see cost basis
    const holdings = {}; // symbol -> { qty, cost }
    
    logs.forEach((log) => {
      const qty = parseFloat(log.quantity);
      const price = parseFloat(log.price);
      const totalVal = parseFloat(log.total_value);
      
      if (log.action === 'BUY') {
        cash -= totalVal;
        if (!holdings[log.symbol]) holdings[log.symbol] = { qty: 0, cost: 0 };
        holdings[log.symbol].qty += qty;
        holdings[log.symbol].cost += totalVal;
      } else if (log.action === 'SELL') {
        cash += totalVal;
        if (holdings[log.symbol]) {
          holdings[log.symbol].qty -= qty;
          holdings[log.symbol].cost -= (holdings[log.symbol].cost / (holdings[log.symbol].qty + qty)) * qty;
          if (holdings[log.symbol].qty <= 0) {
            delete holdings[log.symbol];
          }
        }
      }
      console.log(`Log: ${log.timestamp.toISOString().substring(0, 16)} | ${log.action} ${log.symbol} | Qty: ${qty} | Price: ₹${price} | Val: ₹${totalVal} | Reconstructed Cash: ₹${cash.toFixed(2)}`);
    });
    
    console.log('\n--- Final Reconstructed State ---');
    console.log('Reconstructed Cash Balance:', cash.toFixed(2));
    
    const pState = await client.query('SELECT * FROM portfolio_state WHERE id = \'default\'');
    console.log('Actual Database Portfolio State:', pState.rows[0]);
    
  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}

run();
