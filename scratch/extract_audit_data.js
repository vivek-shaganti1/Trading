const db = require('../backend/db');
const tradingBot = require('../backend/tradingBot');

(async () => {
  await db.initPromise;
  const dbData = db.readLocalDb();
  
  // 1. Throughput history from today
  const istOffset = 5.5 * 60 * 60 * 1000;
  const now = new Date();
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  const istDate = new Date(utc + istOffset);
  const todayStr = istDate.toISOString().split('T')[0];

  const isTodayIST = (tsString) => {
    if (!tsString) return false;
    const date = new Date(tsString);
    const dateIST = new Date(date.getTime() + istOffset);
    return dateIST.toISOString().split('T')[0] === todayStr;
  };

  const todayThroughput = (dbData.throughput_history || []).filter(t => isTodayIST(t.timestamp));
  const todayTrades = (dbData.trade_logs || []).filter(t => isTodayIST(t.timestamp));
  const buyTrades = todayTrades.filter(t => t.action === 'BUY');
  const sellTrades = todayTrades.filter(t => t.action === 'SELL');

  console.log('--- DB & CACHE RECONCILIATION ---');
  console.log('Total Throughput records today:', todayThroughput.length);
  console.log('Total Trade records today:', todayTrades.length);
  console.log('Buy Trades today:', buyTrades.length);
  console.log('Sell Trades today:', sellTrades.length);

  if (todayThroughput.length > 0) {
    console.log('Last throughput record:', JSON.stringify(todayThroughput[todayThroughput.length - 1], null, 2));
  } else {
    console.log('No throughput records found for today.');
  }

  // 2. Active session state in memory
  const status = await tradingBot.getStatus();
  console.log('--- GETSTATUS PAYLOAD OVERVIEW ---');
  console.log('isRunning:', status.isRunning);
  console.log('marketDataMode:', status.marketDataMode);
  console.log('marketDataProvider:', status.marketDataProvider);
  console.log('priceValidationStatus:', status.priceValidationStatus);
  console.log('preMarketState:', JSON.stringify(status.preMarketState, null, 2));
  console.log('executionFunnel:', JSON.stringify(status.executionFunnel, null, 2));
  console.log('ordersRejectedToday:', dbData.orders_rejected_today);
  console.log('zeroQtyRejections:', dbData.zero_qty_rejections);

  // 3. Scanner rankings details
  const rankings = dbData.scanner_rankings || [];
  console.log('--- SCANNER RANKINGS IN DB ---');
  console.log('Rankings count:', rankings.length);
  if (rankings.length > 0) {
    const lastR = rankings[rankings.length - 1];
    console.log('Last ranking timestamp:', lastR.timestamp);
    console.log('Last ranking totalScanned:', lastR.totalScanned);
    console.log('Last ranking longs count:', lastR.longs ? lastR.longs.length : 0);
    console.log('Last ranking shorts count:', lastR.shorts ? lastR.shorts.length : 0);
  }

  // 4. Latest 10 cycles details
  console.log('--- LAST 10 CYCLES FROM PIPELINE LOGS ---');
  const pipeLogs = dbData.pipeline_logs || [];
  const latest10Logs = pipeLogs.slice(-10);
  latest10Logs.forEach((log, index) => {
    console.log(`Cycle #${index + 1} | Time: ${log.timestamp} | Universe: ${log.universe} | Scanned: ${log.scanned} | Researched (S1): ${log.stage1_research} | Ranked (S2): ${log.stage2_ranked} | Candidates (S3): ${log.stage3_candidates} | Consensus (S4): ${log.stage4_consensus} | Executed (S5): ${log.stage5_executed} | Passed Risk: ${log.passed_risk || 0}`);
  });

  process.exit(0);
})();
