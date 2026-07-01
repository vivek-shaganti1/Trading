const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function run() {
  try {
    await pool.query("DELETE FROM daily_stats");
    await pool.query("DELETE FROM risk_events");
    await pool.query("DELETE FROM alerts");
    await pool.query("UPDATE portfolio_state SET balance = 12000, equity_value = 0, holding_stocks = '[]' WHERE id = 'default'");
    console.log("Database cleaned for production.");
  } catch (err) {
    console.error("DB Error:", err);
  } finally {
    pool.end();
  }
}
run();
