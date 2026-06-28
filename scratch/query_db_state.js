const { Client } = require('pg');
require('dotenv').config();

async function checkDb() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  try {
    await client.connect();
    console.log('--- portfolio_state ---');
    const pState = await client.query('SELECT * FROM portfolio_state');
    console.log(pState.rows);

    console.log('--- daily_stats (last 5) ---');
    const dStats = await client.query('SELECT * FROM daily_stats ORDER BY date DESC LIMIT 5');
    console.log(dStats.rows);

    console.log('--- trade_logs (last 5) ---');
    const tLogs = await client.query('SELECT * FROM trade_logs ORDER BY timestamp DESC LIMIT 5');
    console.log(tLogs.rows);
  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}

checkDb();
