const { Client } = require('pg');
require('dotenv').config();

async function run() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  try {
    await client.connect();
    
    const res = await client.query('SELECT * FROM trade_logs ORDER BY timestamp ASC');
    const logs = res.rows;
    
    // De-duplicate logs: if symbol, action, quantity, price, and timestamp are close, ignore
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

    console.log(`De-duplicated trade logs: from ${logs.length} down to ${cleanLogs.length}`);
    
    let cash = 12000;
    cleanLogs.forEach(log => {
      const totalVal = parseFloat(log.total_value);
      if (log.action === 'BUY') {
        cash -= totalVal;
      } else {
        cash += totalVal;
      }
      console.log(`Clean Log: ${log.timestamp.toISOString().substring(0, 16)} | ${log.action} ${log.symbol} | Val: ₹${totalVal.toFixed(2)} | Cash: ₹${cash.toFixed(2)}`);
    });
    
    console.log('\nFinal Clean Cash Balance:', cash.toFixed(2));
    
  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}

run();
