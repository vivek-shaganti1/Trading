const { Pool } = require('pg');
require('dotenv').config();

async function main() {
  console.log('--- DIRECT POSTGRES FIX ---');
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set in env.');
    process.exit(1);
  }
  
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  
  const client = await pool.connect();
  try {
    console.log('Connected to Postgres. Querying current state...');
    const curRes = await client.query("SELECT * FROM portfolio_state WHERE id = 'default'");
    console.log('Before Fix:', curRes.rows[0]);
    
    console.log('Updating portfolio_state...');
    await client.query(`
      UPDATE portfolio_state 
      SET balance = 7306.34, 
          equity_value = 0, 
          holding_stocks = '[]', 
          lifetime_pnl = -4693.66, 
          updated_at = NOW() 
      WHERE id = 'default'
    `);
    console.log('Update query completed.');
    
    const aftRes = await client.query("SELECT * FROM portfolio_state WHERE id = 'default'");
    console.log('After Fix:', aftRes.rows[0]);
  } catch (err) {
    console.error('Database query failed:', err);
  } finally {
    client.release();
    await pool.end();
  }
  
  process.exit(0);
}

main().catch(console.error);
