const db = require('../backend/db');
const backtest = require('../backend/backtestEngine');

async function runAll() {
  console.log("Initializing database connection...");
  await db.initPromise;

  console.log("\nRunning 30-Day Backtest...");
  const report30 = await backtest.runBacktest(30);
  console.log(report30 ? "30D Backtest Complete." : "30D Backtest Failed / No Trades.");

  console.log("\nRunning 90-Day Backtest...");
  const report90 = await backtest.runBacktest(90);
  console.log(report90 ? "90D Backtest Complete." : "90D Backtest Failed / No Trades.");

  console.log("\nRunning 180-Day Backtest...");
  const report180 = await backtest.runBacktest(180);
  console.log(report180 ? "180D Backtest Complete." : "180D Backtest Failed / No Trades.");

  console.log("\nAll backtests finished successfully.");
  process.exit(0);
}

runAll().catch(err => {
  console.error("Error running backtest suite:", err);
  process.exit(1);
});
