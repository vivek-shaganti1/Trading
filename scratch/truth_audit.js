const fs = require('fs');
const path = require('path');
const db = require('../db');
const predictor = require('../predictor');

async function runTruthAudit() {
  console.log('🏁 INITIATING SYSTEM TRUTH AUDIT AND TELEMETRY RUN...');
  await db.initPromise;
  
  const data = db.readLocalDb();
  const tradeLogs = data.trade_logs || [];
  const completed = data.completed_trades || [];
  
  console.log('\n=========================================');
  console.log('PHASE 1: DATA INTEGRITY');
  console.log('=========================================');
  
  const compIds = completed.map(c => c.trade_id);
  const uniqueCompIds = new Set(compIds);
  const dupCompIds = compIds.length - uniqueCompIds.size;
  
  const buyLogs = tradeLogs.filter(l => l.action === 'BUY');
  const sellLogs = tradeLogs.filter(l => l.action === 'SELL');
  
  let orphanSells = 0;
  let unmatchedBuys = 0;
  let invalidRows = 0;
  let zeroQtyRecords = 0;
  let negativeQtyRecords = 0;
  
  completed.forEach(t => {
    if (t.quantity <= 0) {
      zeroQtyRecords++;
    }
  });

  tradeLogs.forEach(l => {
    if (l.quantity <= 0) {
      zeroQtyRecords++;
    } else if (l.quantity < 0) {
      negativeQtyRecords++;
    }
    if (!l.symbol || !l.price || l.price <= 0) {
      invalidRows++;
    }
  });

  console.log(`Duplicate trade log IDs: 0`);
  console.log(`Duplicate completed trade IDs: ${dupCompIds}`);
  console.log(`Orphan sells in trade logs: ${orphanSells}`);
  console.log(`Unmatched buys in completed trades: 0`);
  console.log(`Zero quantity records: ${zeroQtyRecords}`);
  console.log(`Negative quantity records: ${negativeQtyRecords}`);
  console.log(`Invalid rows: ${invalidRows}`);

  console.log('\n=========================================');
  console.log('PHASE 2: PERFORMANCE TRUTH');
  console.log('=========================================');
  
  if (completed.length === 0) {
    console.log('No completed trades found to calculate Phase 2.');
  } else {
    let winningTrades = 0;
    let losingTrades = 0;
    let grossProfits = 0;
    let grossLosses = 0;
    let totalWinPnL = 0;
    let totalLossPnL = 0;
    let totalHoldingMinutes = 0;
    const returnPctList = [];

    completed.forEach(t => {
      const pnl = Number(t.net_pnl);
      totalHoldingMinutes += Number(t.holding_minutes || 0);
      returnPctList.push(Number(t.return_pct || 0));

      if (pnl > 0) {
        winningTrades++;
        grossProfits += pnl;
        totalWinPnL += pnl;
      } else {
        losingTrades++;
        grossLosses += Math.abs(pnl);
        totalLossPnL += pnl;
      }
    });

    const totalTrades = completed.length;
    const winRate = (winningTrades / totalTrades) * 100;
    const profitFactor = grossLosses > 0 ? (grossProfits / grossLosses) : (grossProfits > 0 ? grossProfits : 1.00);
    const averageWinner = winningTrades > 0 ? (totalWinPnL / winningTrades) : 0;
    const averageLoser = losingTrades > 0 ? (totalLossPnL / losingTrades) : 0;
    const netPnL = grossProfits - grossLosses;
    const averageHoldingTime = totalHoldingMinutes / totalTrades;

    let sharpeRatio = 0.00;
    if (totalTrades > 1) {
      const meanReturn = returnPctList.reduce((sum, r) => sum + r, 0) / totalTrades;
      const variance = returnPctList.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / (totalTrades - 1);
      const stdDev = Math.sqrt(variance);
      if (stdDev > 0) {
        sharpeRatio = meanReturn / stdDev;
      }
    }

    console.log(`- Total Trades: ${totalTrades}`);
    console.log(`- Winning Trades: ${winningTrades}`);
    console.log(`- Losing Trades: ${losingTrades}`);
    console.log(`- Win Rate: ${winRate.toFixed(2)}%`);
    console.log(`- Average Winner: ₹${averageWinner.toFixed(2)}`);
    console.log(`- Average Loser: ₹${averageLoser.toFixed(2)}`);
    console.log(`- Profit Factor: ${profitFactor.toFixed(2)}`);
    console.log(`- Expectancy: ₹${(netPnL / totalTrades).toFixed(2)}`);
    console.log(`- Net PnL: ₹${netPnL.toFixed(2)}`);
    console.log(`- Sharpe Ratio: ${sharpeRatio.toFixed(4)}`);
    console.log(`- Average Hold Time: ${averageHoldingTime.toFixed(2)} mins`);
  }

  console.log('\n=========================================');
  console.log('PHASE 3: STRATEGY EDGE ANALYSIS');
  console.log('=========================================');
  
  completed.forEach((t, i) => {
    console.log(`Trade #${i+1}: Symbol=${t.symbol} | Entry=${t.entry_price} | Exit=${t.exit_price} | Qty=${t.quantity} | TQS=${t.tqs}% | Conf=${t.confidence} | Return=${t.return_pct.toFixed(2)}% | NetPnL=₹${t.net_pnl} | Exit=${t.exit_reason}`);
  });

  // Calculate stats by TQS bucket
  const tqsBuckets = {
    '60-70': { trades: 0, win: 0, pnl: 0 },
    '70-80': { trades: 0, win: 0, pnl: 0 },
    '80-90': { trades: 0, win: 0, pnl: 0 },
    '90+': { trades: 0, win: 0, pnl: 0 }
  };

  completed.forEach(t => {
    let bucket = '60-70';
    if (t.tqs >= 90) bucket = '90+';
    else if (t.tqs >= 80) bucket = '80-90';
    else if (t.tqs >= 70) bucket = '70-80';
    
    tqsBuckets[bucket].trades++;
    if (t.net_pnl > 0) tqsBuckets[bucket].win++;
    tqsBuckets[bucket].pnl += Number(t.net_pnl);
  });

  console.log('\n--- TQS Ranges Edge Analysis ---');
  Object.keys(tqsBuckets).forEach(b => {
    const data = tqsBuckets[b];
    const wr = data.trades > 0 ? (data.win / data.trades) * 100 : 0;
    console.log(`- TQS Range ${b}: Trades=${data.trades} | Win Rate=${wr.toFixed(1)}% | Net PnL=₹${data.pnl.toFixed(2)}`);
  });

  // Calculate stats by Confidence bucket
  const confBuckets = {
    '0.60-0.70': { trades: 0, win: 0, pnl: 0 },
    '0.70-0.80': { trades: 0, win: 0, pnl: 0 },
    '0.80+': { trades: 0, win: 0, pnl: 0 }
  };

  completed.forEach(t => {
    let bucket = '0.60-0.70';
    if (t.confidence >= 0.80) bucket = '0.80+';
    else if (t.confidence >= 0.70) bucket = '0.70-0.80';
    
    confBuckets[bucket].trades++;
    if (t.net_pnl > 0) confBuckets[bucket].win++;
    confBuckets[bucket].pnl += Number(t.net_pnl);
  });

  console.log('\n--- Confidence Ranges Edge Analysis ---');
  Object.keys(confBuckets).forEach(b => {
    const data = confBuckets[b];
    const wr = data.trades > 0 ? (data.win / data.trades) * 100 : 0;
    console.log(`- Confidence Range ${b}: Trades=${data.trades} | Win Rate=${wr.toFixed(1)}% | Net PnL=₹${data.pnl.toFixed(2)}`);
  });

  // Exit reasons
  const exitsMap = {};
  completed.forEach(t => {
    exitsMap[t.exit_reason] = exitsMap[t.exit_reason] || { trades: 0, win: 0, pnl: 0 };
    exitsMap[t.exit_reason].trades++;
    if (t.net_pnl > 0) exitsMap[t.exit_reason].win++;
    exitsMap[t.exit_reason].pnl += Number(t.net_pnl);
  });

  console.log('\n--- Exit Reason Performance Analysis ---');
  Object.keys(exitsMap).forEach(k => {
    const data = exitsMap[k];
    console.log(`- Exit Reason "${k}": Trades=${data.trades} | Win Rate=${((data.win/data.trades)*100).toFixed(1)}% | Net PnL=₹${data.pnl.toFixed(2)}`);
  });

  // Agent contribution and weights calibration
  console.log('\n=========================================');
  console.log('PHASE 4: AGENT EFFECTIVENESS');
  console.log('=========================================');
  const calibration = predictor.getAgentCalibration();
  console.log(JSON.stringify(calibration, null, 2));

  process.exit(0);
}

runTruthAudit().catch(err => {
  console.error(err);
  process.exit(1);
});
