require('dotenv').config();
const { Client } = require('pg');

async function dumpRaw() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false
    }
  });

  try {
    await client.connect();
    
    console.log('--- RAW model_weights ---');
    const r1 = await client.query('SELECT * FROM model_weights');
    console.log(JSON.stringify(r1.rows, null, 2));

    console.log('--- RAW prediction_logs ---');
    const r2 = await client.query('SELECT * FROM prediction_logs ORDER BY timestamp DESC LIMIT 1');
    console.log(JSON.stringify(r2.rows, null, 2));

    console.log('--- RAW consensus_decisions ---');
    const r3 = await client.query('SELECT * FROM consensus_decisions ORDER BY timestamp DESC LIMIT 1');
    console.log(JSON.stringify(r3.rows, null, 2));

  } catch(err) {
    console.error(err);
  } finally {
    await client.end();
  }
}
dumpRaw();
