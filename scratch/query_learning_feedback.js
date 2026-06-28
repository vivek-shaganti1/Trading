require('dotenv').config();
const { Client } = require('pg');

async function runQuery() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    const res = await client.query('SELECT * FROM learning_feedback ORDER BY timestamp DESC LIMIT 3;');
    console.log('--- LEARNING FEEDBACK ENTRIES ---');
    console.log(JSON.stringify(res.rows, null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}

runQuery();
