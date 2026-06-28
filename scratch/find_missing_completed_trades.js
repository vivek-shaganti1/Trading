const { Client } = require('pg');
require('dotenv').config();

async function run() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  try {
    await client.connect();
    
    // 1. Get all trade logs (de-duplicated)
    const logsRes = await client.query('SELECT * FROM trade_logs ORDER BY timestamp ASC');
    const logs = logsRes.rows;
    
    const cleanLogs = [];
    logs.forEach(log => {
      const isDup = cleanLogs.some(prev => 
        prev.symbol === log.symbol &&
        prev.action === log.action &&
        Math.abs(parseFloat(prev.price) - parseFloat(log.price)) < 0.01 &&
        Math.abs(parseFloat(prev.quantity) - parseFloat(log.quantity)) < 0.01 &&
        Math.abs(new Date(prev.timestamp) - new Date(log.timestamp)) < 5000
      );
      if (!isDup) {
        cleanLogs.push(log);
      }
    });

    // 2. Get all completed trades
    const tradesRes = await client.query('SELECT * FROM completed_trades');
    const completed = tradesRes.rows;

    // 3. Get open positions from portfolio state
    const pStateRes = await client.query('SELECT holding_stocks FROM portfolio_state WHERE id = \'default\'');
    const openHoldings = pStateRes.rows[0].holding_stocks || [];

    console.log('--- COMPARING METRICS ---');
    console.log('Total de-duplicated trade logs:', cleanLogs.length);
    console.log('Total completed trades in table:', completed.length);
    console.log('Total open positions in table:', openHoldings.length);

    // Let's match each completed trade to its corresponding buy and sell log
    // And see if there are logs that are not accounted for
    const accountedLogs = new Set();

    completed.forEach(trade => {
      // Find matching BUY log
      const buyLog = cleanLogs.find(l => 
        l.symbol === trade.symbol && 
        l.action === 'BUY' && 
        Math.abs(parseFloat(l.price) - parseFloat(trade.entry_price)) < 0.01 &&
        Math.abs(parseFloat(l.quantity) - parseFloat(trade.quantity)) < 0.01 &&
        !accountedLogs.has(l.id)
      );
      if (buyLog) accountedLogs.add(buyLog.id);

      // Find matching SELL log
      const sellLog = cleanLogs.find(l => 
        l.symbol === trade.symbol && 
        l.action === 'SELL' && 
        Math.abs(parseFloat(l.price) - parseFloat(trade.exit_price)) < 0.01 &&
        Math.abs(parseFloat(l.quantity) - parseFloat(trade.quantity)) < 0.01 &&
        !accountedLogs.has(l.id)
      );
      if (sellLog) accountedLogs.add(sellLog.id);
    });

    // Account for open holdings
    openHoldings.forEach(h => {
      const buyLog = cleanLogs.find(l => 
        l.symbol === h.symbol && 
        l.action === 'BUY' && 
        Math.abs(parseFloat(l.price) - parseFloat(h.avgPrice)) < 0.01 &&
        Math.abs(parseFloat(l.quantity) - parseFloat(h.quantity)) < 0.01 &&
        !accountedLogs.has(l.id)
      );
      if (buyLog) accountedLogs.add(buyLog.id);
    });

    console.log('\n--- Unaccounted De-duplicated Trade Logs ---');
    let unaccountedCount = 0;
    cleanLogs.forEach(l => {
      if (!accountedLogs.has(l.id)) {
        console.log(`Unaccounted: ${l.timestamp.toISOString().substring(0, 16)} | ${l.action} ${l.symbol} | Price: ${l.price} | Qty: ${l.quantity} | Reason: ${l.reason}`);
        unaccountedCount++;
      }
    });
    console.log('Total unaccounted de-duplicated trade logs:', unaccountedCount);

  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}

run();
