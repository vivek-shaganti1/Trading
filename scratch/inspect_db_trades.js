const db = require('../db');

async function inspect() {
  await new Promise(r => setTimeout(r, 2000));
  const trades = await db.getTradeLogs(100);
  console.log(JSON.stringify(trades, null, 2));
  process.exit(0);
}
inspect();
