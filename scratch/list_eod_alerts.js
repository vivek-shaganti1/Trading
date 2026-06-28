const { Pool } = require('pg');
require('dotenv').config();

async function run() {
  if (!process.env.DATABASE_URL) {
    console.log('DATABASE_URL not set');
    return;
  }
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  try {
    const query = `
      SELECT timestamp, message FROM alerts 
      WHERE message LIKE '%EOD PERFORMANCE REPORT%' 
      ORDER BY timestamp DESC 
      LIMIT 6
    `;
    const res = await pool.query(query);
    res.rows.forEach((r, idx) => {
      console.log(`--- Alert #${idx + 1} ---`);
      console.log('Timestamp:', r.timestamp);
      // Find the date in the message, e.g. "EOD PERFORMANCE REPORT - 2026-06-12"
      const match = r.message.match(/EOD PERFORMANCE REPORT - (\d{4}-\d{2}-\d{2})/);
      console.log('Date in Message:', match ? match[1] : 'Unknown');
      console.log('Snippet:', r.message.substring(0, 150));
    });
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await pool.end();
  }
}

run().catch(console.error);
