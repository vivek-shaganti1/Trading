const { Client } = require('pg');
require('dotenv').config();

async function run() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  try {
    await client.connect();
    const pState = await client.query('SELECT holding_stocks FROM portfolio_state WHERE id = \'default\'');
    const holdings = pState.rows[0].holding_stocks;
    console.log('Open positions count:', holdings.length);
    let totalCost = 0;
    holdings.forEach((h, i) => {
      const cost = h.avgPrice * h.quantity;
      totalCost += cost;
      console.log(`${i+1}. Symbol: ${h.symbol} | Qty: ${h.quantity} | Avg Price: ₹${h.avgPrice} | Cost: ₹${cost}`);
    });
    console.log('Total Cost of Holdings:', totalCost);
  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}
run();
