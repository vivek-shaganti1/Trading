require('dotenv').config();
const { Client } = require('pg');

async function transparencyAudit() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();

    console.log('=== RAW prediction_logs ===');
    const plRes = await client.query('SELECT * FROM prediction_logs ORDER BY timestamp DESC LIMIT 1');
    console.log(JSON.stringify(plRes.rows[0], null, 2));

    console.log('\n=== RAW consensus_decisions ===');
    const cdRes = await client.query('SELECT * FROM consensus_decisions ORDER BY timestamp DESC LIMIT 1');
    console.log(JSON.stringify(cdRes.rows[0], null, 2));

  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}

transparencyAudit();
