require('dotenv').config();
const { Client } = require('pg');

async function runSelect() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false
    }
  });

  try {
    await client.connect();
    const res = await client.query(`
      SELECT *
      FROM telegram_commands
      ORDER BY timestamp DESC
      LIMIT 5;
    `);
    
    if (res.rows.length === 0) {
      console.log('TABLE_EMPTY');
    } else {
      console.log('Query result:');
      console.log(JSON.stringify(res.rows, null, 2));
    }
  } catch (err) {
    console.error('Error executing query:', err.message);
  } finally {
    await client.end();
  }
}

runSelect();
