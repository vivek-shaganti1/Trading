const { Pool } = require('pg');
require('dotenv').config();

async function run() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  try {
    const res = await pool.query('SELECT holding_stocks FROM portfolio_state');
    console.log(JSON.stringify(res.rows[0].holding_stocks, null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}
run();
