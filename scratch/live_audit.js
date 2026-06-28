const db = require('../backend/db');
const tradingBot = require('../backend/tradingBot');

(async () => {
  await db.initPromise;
  const data = db.readLocalDb();
  
  console.log('=== LATEST SCANNER RANKINGS ===');
  const rankings = data.scanner_rankings || [];
  const lastRank = rankings[rankings.length - 1];
  console.log(JSON.stringify(lastRank, null, 2));

  console.log('=== LATEST PIPELINE LOGS ===');
  const pipeLogs = data.pipeline_logs || [];
  console.log(JSON.stringify(pipeLogs.slice(-3), null, 2));

  console.log('=== LATEST THROUGHPUT HISTORY ===');
  const th = data.throughput_history || [];
  console.log(JSON.stringify(th.slice(-3), null, 2));

  console.log('=== LATEST TRADE LOGS ===');
  const trades = data.trade_logs || [];
  console.log(JSON.stringify(trades.slice(-5), null, 2));

  console.log('=== BOT STATUS PAYLOAD ===');
  const status = await tradingBot.getStatus();
  console.log(JSON.stringify(status, null, 2));

  process.exit(0);
})();
