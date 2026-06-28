const { Client } = require('pg');
const config = require('../config');

(async () => {
  const client = new Client({
    connectionString: config.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  await client.connect();
  
  const res = await client.query('SELECT * FROM portfolio_state');
  console.log('Raw PG portfolio_state:');
  console.log(JSON.stringify(res.rows, null, 2));
  
  const res2 = await client.query('SELECT count(*) FROM completed_trades');
  console.log('Raw PG completed_trades count:', res2.rows[0].count);
  
  await client.end();
})();
