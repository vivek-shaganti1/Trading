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
    console.log(JSON.stringify(pState.rows[0].holding_stocks, null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}
run();
