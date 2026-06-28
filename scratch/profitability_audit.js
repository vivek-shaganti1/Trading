const db = require('../backend/db');
const broker = require('../backend/broker');
const config = require('../shared/config');

async function runAudit() {
  console.log('🔄 INITIALIZING AUDIT ENGINE...');
  
  // Wait a moment for DB connection
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  const trades = await db.getTradeLogs(1000);
  console.log(`📊 Total transactions found: ${trades.length}`);

  // Group transactions by symbol and sort by timestamp ascending
  const sorted = [...trades].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  const symbolGroups = {};
  for (const t of sorted) {
    if (!symbolGroups[t.symbol]) symbolGroups[t.symbol] = [];
    symbolGroups[t.symbol].push(t);
  }

  const completedTrades = [];
  const openTrades = [];

  for (const [symbol, txs] of Object.entries(symbolGroups)) {
    let currentQty = 0;
    let totalCost = 0;
    let buysList = [];
    
    for (const tx of txs) {
      if (tx.action === 'BUY') {
        buysList.push(tx);
        currentQty += parseFloat(tx.quantity);
        totalCost += parseFloat(tx.quantity) * parseFloat(tx.price);
      } else if (tx.action === 'SELL') {
        const sellQty = parseFloat(tx.quantity);
        const sellPrice = parseFloat(tx.price);
        
        if (currentQty === 0) {
          // Sell without buy (short selling or mismatch)
          console.warn(`⚠️ Warning: SELL without corresponding BUY for ${symbol}`);
          continue;
        }

        const avgEntryPrice = totalCost / currentQty;
        const entryTime = new Date(buysList[0].timestamp);
        const exitTime = new Date(tx.timestamp);
        const durationMin = (exitTime - entryTime) / 60000;
        
        const realizedPnL = (sellPrice - avgEntryPrice) * sellQty;

        // Fetch expected target return from the trade reasons/DB if available
        // Usually, default target is 5% (or 0.5% in the tests)
        let expectedReturnPct = 0.05; // standard target
        // Let's check reason for target clues
        if (tx.reason && tx.reason.includes('exit at')) {
          // standard exit
        }
        
        completedTrades.push({
          symbol,
          entryPrice: avgEntryPrice,
          exitPrice: sellPrice,
          pnl: realizedPnL,
          durationMin,
          qty: sellQty,
          entryTime,
          exitTime,
          reason: tx.reason,
          expectedProfit: avgEntryPrice * sellQty * expectedReturnPct,
          actualProfit: realizedPnL
        });

        // Reduce current quantity
        currentQty -= sellQty;
        if (currentQty <= 0) {
          currentQty = 0;
          totalCost = 0;
          buysList = [];
        } else {
          totalCost = avgEntryPrice * currentQty;
        }
      }
    }

    if (currentQty > 0) {
      const avgEntryPrice = totalCost / currentQty;
      const entryTime = new Date(buysList[0].timestamp);
      const currentPrice = broker.getLTP(symbol) || avgEntryPrice;
      const durationMin = (new Date() - entryTime) / 60000;
      const unrealizedPnL = (currentPrice - avgEntryPrice) * currentQty;

      openTrades.push({
        symbol,
        entryPrice: avgEntryPrice,
        currentPrice,
        qty: currentQty,
        pnl: unrealizedPnL,
        durationMin,
        entryTime,
        expectedProfit: avgEntryPrice * currentQty * 0.05
      });
    }
  }

  console.log('\n======================================================');
  console.log('✅ COMPLETED TRADES AUDIT');
  console.log('======================================================');
  let totalWinPnL = 0;
  let totalLossPnL = 0;
  let wins = 0;
  let losses = 0;
  let totalHoldTime = 0;

  completedTrades.forEach((t, i) => {
    console.log(`${i+1}. [COMPLETED] ${t.symbol} | Qty: ${t.qty}`);
    console.log(`   - Entry Price: ₹${t.entryPrice.toFixed(2)} (${t.entryTime.toISOString()})`);
    console.log(`   - Exit Price:  ₹${t.exitPrice.toFixed(2)} (${t.exitTime.toISOString()})`);
    console.log(`   - Duration:    ${t.durationMin.toFixed(2)} mins`);
    console.log(`   - PnL:         ₹${t.pnl.toFixed(2)}`);
    console.log(`   - Expected:    ₹${t.expectedProfit.toFixed(2)} | Actual: ₹${t.actualProfit.toFixed(2)}`);
    
    if (t.pnl > 0) {
      wins++;
      totalWinPnL += t.pnl;
    } else {
      losses++;
      totalLossPnL += t.pnl;
    }
    totalHoldTime += t.durationMin;
  });

  console.log('\n======================================================');
  console.log('🔍 OPEN TRADES AUDIT');
  console.log('======================================================');
  openTrades.forEach((t, i) => {
    console.log(`${i+1}. [OPEN] ${t.symbol} | Qty: ${t.qty}`);
    console.log(`   - Entry Price:   ₹${t.entryPrice.toFixed(2)}`);
    console.log(`   - Current Price: ₹${t.currentPrice.toFixed(2)}`);
    console.log(`   - Duration:      ${t.durationMin.toFixed(2)} mins`);
    console.log(`   - UnPnL:         ₹${t.pnl.toFixed(2)}`);
  });

  const totalCompleted = completedTrades.length;
  const winRate = totalCompleted > 0 ? (wins / totalCompleted) * 100 : 0;
  const avgWin = wins > 0 ? totalWinPnL / wins : 0;
  const avgLoss = losses > 0 ? totalLossPnL / losses : 0;
  const profitFactor = Math.abs(totalLossPnL) > 0 ? totalWinPnL / Math.abs(totalLossPnL) : (wins > 0 ? 999 : 1);
  const expectancy = totalCompleted > 0 ? (totalWinPnL + totalLossPnL) / totalCompleted : 0;
  const avgHold = totalCompleted > 0 ? totalHoldTime / totalCompleted : 0;

  // Capital utilization calculation
  const valuation = await broker.getValuation();
  const totalVal = valuation.totalVal;
  const equityVal = valuation.equityValue;
  const capUtilization = (equityVal / totalVal) * 100;

  console.log('\n======================================================');
  console.log('📈 STATISTICAL SUMMARY METRICS');
  console.log('======================================================');
  console.log(`- Win Rate:                      ${winRate.toFixed(2)}% (${wins}/${totalCompleted})`);
  console.log(`- Avg Profit per Win:            ₹${avgWin.toFixed(2)}`);
  console.log(`- Avg Loss per Loss:             ₹${avgLoss.toFixed(2)}`);
  console.log(`- Profit Factor:                 ${profitFactor.toFixed(2)}`);
  console.log(`- Mathematical Expectancy:       ₹${expectancy.toFixed(2)}`);
  console.log(`- Average Holding Time:          ${avgHold.toFixed(2)} mins`);
  console.log(`- Current Capital Utilization:   ${capUtilization.toFixed(2)}%`);
  console.log('======================================================\n');
  
  process.exit(0);
}

runAudit().catch(err => {
  console.error(err);
  process.exit(1);
});
