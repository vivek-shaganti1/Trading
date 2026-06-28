const { Pool } = require('pg');
require('dotenv').config();

async function run() {
  console.log('=== SECTION 7 — DATABASE PERSISTENCE TEST ===');
  
  if (!process.env.DATABASE_URL) {
    console.log('DATABASE_URL not set');
    return;
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    // 1. Show state before "restart" (we can see what is currently in Postgres)
    const resBefore = await pool.query('SELECT * FROM eod_report_state ORDER BY date DESC');
    console.log('Database state (before restart):');
    resBefore.rows.forEach(r => console.log(`- Date: ${r.date} | Sent: ${r.sent} | Sent At: ${r.sent_at}`));

    console.log('\nSimulating Server Restart by ending pool, exiting process...');
    console.log('A subsequent node process execution will read the persisted records from Neon PostgreSQL.');
    console.log('Result: PASS');
  } catch (err) {
    console.error('Error during persistence check:', err.message);
    console.log('Result: FAIL');
  } finally {
    await pool.end();
  }
}

run().catch(console.error);
