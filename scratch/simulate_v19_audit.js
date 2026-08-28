const db = require('../backend/db');
const tradingBot = require('../backend/tradingBot');
const marketScanner = require('../scratch/market_scanner');

async function run() {
  await db.initDB();
  console.log("=== V19 PIPELINE AUDIT TRACE ===");
  try {
    const scanResults = await marketScanner.scanUniverse();
    const valuation = { balance: 100000, equityValue: 100000, totalVal: 200000 };
    // Force a position in DB so it doesn't crash on activePositions
    await tradingBot.processScannerRankings(scanResults, valuation);
  } catch (e) {
    console.error(e);
  }
  process.exit(0);
}
run();
