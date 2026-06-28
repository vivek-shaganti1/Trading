const { Client } = require('pg');
require('dotenv').config();

async function run() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  try {
    await client.connect();
    const res = await client.query('SELECT decision, confidence, result_after_closes, final_outcome FROM consensus_decisions LIMIT 10');
    console.log(res.rows);
    
    const countRes = await client.query('SELECT COUNT(*) as count, COUNT(CASE WHEN result_after_closes IS NOT NULL THEN 1 END) as with_results FROM consensus_decisions');
    console.log(countRes.rows);
  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}
run();
