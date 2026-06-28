require('dotenv').config();
const { Client } = require('pg');

async function readCommands() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false
    }
  });

  try {
    await client.connect();
    const res = await client.query('SELECT * FROM telegram_commands ORDER BY timestamp DESC LIMIT 1');
    if (res.rows.length === 0) {
      console.log('TELEGRAM_COMMANDS_EMPTY');
    } else {
      console.log(JSON.stringify(res.rows[0], null, 2));
    }
  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}
readCommands();
