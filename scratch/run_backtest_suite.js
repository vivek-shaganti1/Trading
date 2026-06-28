const { Client } = require('pg');
require('dotenv').config();

async function runBacktestSuite() {
  console.log("🏁 STARTING PROFITABILITY BACKTEST SUITE (WITH RISK CONTROLS)...");
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  await client.connect();

  const res = await client.query('SELECT * FROM agent24_audit_logs ORDER BY timestamp ASC');
  const audits = res.rows;
  console.log(`Loaded ${audits.length} opportunity audit rows for backtesting.`);

  if (audits.length === 0) {
    console.log("No audit records found to backtest.");
    await client.end();
    return;
  }

  const dailyAudits = {};
  audits.forEach(a => {
    if (!a.timestamp) return;
    const dateStr = new Date(a.timestamp).toISOString().split('T')[0];
    if (!dailyAudits[dateStr]) dailyAudits[dateStr] = [];
    dailyAudits[dateStr].push(a);
  });

  const dates = Object.keys(dailyAudits).sort();

  function simulate(config) {
    let balance = 12000;
    let totalPnL = 0;
    let tradesCount = 0;
    let wins = 0;
    let losses = 0;
    let totalUtilized = 0;
    let utilTicks = 0;
    let totalSavedLoss = 0;
    let totalMissedProfit = 0;

    dates.forEach(date => {
      const dayAudits = dailyAudits[date] || [];
      let dailyPnL = 0;
      let activePositionsCount = 0;
      const dailyTarget = 1000;
      
      dayAudits.forEach(a => {
        const tqs = a.tqs || 65;
        const symbol = a.symbol;
        const price = a.price_at_rejection || 1000;
        let returnPct = a.return_pct || 0;

        // Apply SL/Target constraints to returns: max -2% loss, max +5% profit
        if (returnPct > 5.0) returnPct = 5.0;
        if (returnPct < -2.0) returnPct = -2.0;

        let threshold = config.baseThreshold;
        if (config.targetDriven) {
          const progressPct = (dailyPnL / dailyTarget) * 100;
          if (progressPct >= 90) {
            threshold = Math.min(85, config.baseThreshold + 5);
          } else if (progressPct < 50 && balance > 6000) {
            threshold = Math.max(60, config.baseThreshold - 3);
          }
        }

        const passesThreshold = tqs >= threshold;

        let allocPct = config.baseAllocPct;
        if (config.adaptiveSizing) {
          const idleCashPct = (balance / (balance + (activePositionsCount * price * 10))) * 100;
          if (idleCashPct > 60) {
            allocPct *= 1.30; // 30% boost for high idle cash
          }
          allocPct = Math.max(5, Math.min(20, allocPct));
        }

        const tradeSize = balance * (allocPct / 100);
        const qty = Math.floor(tradeSize / price);

        if (passesThreshold && activePositionsCount < config.maxPositions && qty > 0) {
          activePositionsCount++;
          const tradePnL = qty * price * (returnPct / 100);
          dailyPnL += tradePnL;
          balance += tradePnL;
          tradesCount++;
          if (tradePnL > 0) wins++;
          else if (tradePnL < 0) losses++;
          
          totalUtilized += qty * price;
          utilTicks++;
        } else {
          const estPnL = 10 * price * (returnPct / 100);
          if (estPnL > 0) {
            totalMissedProfit += estPnL;
          } else {
            totalSavedLoss += Math.abs(estPnL);
          }
        }
      });

      totalPnL += dailyPnL;
    });

    const winRate = tradesCount > 0 ? wins / tradesCount : 0.5;
    const avgUtilPct = utilTicks > 0 ? (totalUtilized / utilTicks) / 12000 * 100 : 0;

    return {
      finalValue: balance,
      netPnL: balance - 12000,
      tradesCount,
      winRate: winRate * 100,
      wins,
      losses,
      avgUtilPct,
      totalSavedLoss,
      totalMissedProfit
    };
  }

  const baseline = simulate({
    baseThreshold: 75,
    baseAllocPct: 10,
    maxPositions: 3,
    targetDriven: false,
    adaptiveSizing: false
  });

  const improved = simulate({
    baseThreshold: 65,
    baseAllocPct: 12,
    maxPositions: 8,
    targetDriven: true,
    adaptiveSizing: true
  });

  console.log("\n=======================================================");
  console.log("📊 COMPARATIVE BACKTEST RESULTS (WITH SL/TP)");
  console.log("=======================================================");
  console.log("Metric                  | Baseline (Old)   | Improved (New)");
  console.log("------------------------|------------------|-------------------");
  console.log(`Starting Portfolio Value | ₹12000.00        | ₹12000.00`);
  console.log(`Final Portfolio Value    | ₹${baseline.finalValue.toFixed(2)}`.padEnd(24) + ` | ₹${improved.finalValue.toFixed(2)}`);
  console.log(`Net Profit / Loss (PnL) | ₹${baseline.netPnL.toFixed(2)}`.padEnd(24) + ` | ₹${improved.netPnL.toFixed(2)}`);
  console.log(`Total Trades Executed   | ${baseline.tradesCount}`.padEnd(24) + ` | ${improved.tradesCount}`);
  console.log(`Win Rate                | ${baseline.winRate.toFixed(2)}%`.padEnd(24) + ` | ${improved.winRate.toFixed(2)}%`);
  console.log(`Wins / Losses           | ${baseline.wins}W / ${baseline.losses}L`.padEnd(24) + ` | ${improved.wins}W / ${improved.losses}L`);
  console.log(`Average Capital Util %  | ${baseline.avgUtilPct.toFixed(1)}%`.padEnd(24) + ` | ${improved.avgUtilPct.toFixed(1)}%`);
  console.log("=======================================================");
  
  if (improved.netPnL > baseline.netPnL) {
    console.log(`\n🎉 PROOF OF IMPROVEMENT: Net profit increased by ₹${(improved.netPnL - baseline.netPnL).toFixed(2)}!`);
  } else {
    console.log("\n❌ NO IMPROVEMENT detected. Refine parameters.");
  }

  await client.end();
}

runBacktestSuite().catch(console.error);
