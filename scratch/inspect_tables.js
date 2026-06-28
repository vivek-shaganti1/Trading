const db = require('../db');

(async () => {
  await db.initPromise;
  const data = db.readLocalDb();
  
  console.log('--- COMPLETED TRADES ---');
  const completed = data.completed_trades || [];
  console.log(JSON.stringify(completed.slice(-5), null, 2));
  
  console.log('--- TRADE LOGS ---');
  const tradeLogs = data.trade_logs || [];
  console.log(JSON.stringify(tradeLogs.slice(-5), null, 2));

  process.exit(0);
})();
