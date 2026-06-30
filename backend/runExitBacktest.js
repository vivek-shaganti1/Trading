/**
 * Exit Intelligence Engine Backtest Simulator
 * Compares the old static/simplistic exit rules against the new Institutional Exit Engine.
 */

const exitIntelligenceEngine = require('./exitIntelligenceEngine');

// 1. Generate realistic price path (Random Walk with trend, swings, and volatility)
function generatePricePath(initialPrice, steps = 1000) {
  const path = [];
  let currentPrice = initialPrice;
  let trend = 0.0002; // general upward trend
  let volatility = 0.003;
  
  for (let i = 0; i < steps; i++) {
    // Periodically shift trend to simulate swings/reversals
    if (i % 200 === 0 && i > 0) {
      trend = (Math.random() - 0.5) * 0.001;
    }
    
    // Periodically expand volatility (news / climax)
    let currentVol = volatility;
    if (i % 150 > 135) {
      currentVol = volatility * 2.5; // high volatility zone
    }
    
    const changePct = trend + (Math.random() - 0.5) * currentVol * 2;
    currentPrice = currentPrice * (1 + changePct);
    
    // Mock volume
    let volume = Math.round(5000 + Math.random() * 10000);
    if (i % 150 > 135) {
      volume *= 3.0; // high volume on expansion
    }
    
    path.push({
      close: currentPrice,
      open: currentPrice * (1 - (Math.random() - 0.5) * 0.002),
      high: currentPrice * (1 + Math.random() * 0.003),
      low: currentPrice * (1 - Math.random() * 0.003),
      volume
    });
  }
  return path;
}

// 2. Old Exit Rules Simulation
function runOldExitStrategy(pricePath, entries) {
  let trades = [];
  
  for (const entryIdx of entries) {
    const entryPrice = pricePath[entryIdx].close;
    let maxPrice = entryPrice;
    let exitPrice = null;
    let exitReason = '';
    let exitIdx = -1;
    
    for (let j = entryIdx + 1; j < pricePath.length; j++) {
      const currentPrice = pricePath[j].close;
      const returnPct = ((currentPrice - entryPrice) / entryPrice) * 100;
      maxPrice = Math.max(maxPrice, currentPrice);
      const peakReturn = ((maxPrice - entryPrice) / entryPrice) * 100;
      
      // Stop Loss (1.5%) or Target (3.0%)
      if (returnPct <= -1.5) {
        exitPrice = currentPrice;
        exitReason = 'Stop Loss Hit';
        exitIdx = j;
        break;
      }
      if (returnPct >= 3.0) {
        exitPrice = currentPrice;
        exitReason = 'Profit Target Hit';
        exitIdx = j;
        break;
      }
      
      // Break-Even Protection (if peak >= 0.3% and return drops back to 0.05%)
      if (peakReturn >= 0.3 && returnPct <= 0.05) {
        exitPrice = currentPrice;
        exitReason = 'Break-Even Protection Hit';
        exitIdx = j;
        break;
      }
      
      // Trailing stop-loss
      if (peakReturn >= 0.8) {
        const trailingStopPrice = maxPrice * 0.996;
        if (currentPrice <= trailingStopPrice) {
          exitPrice = currentPrice;
          exitReason = 'Trailing Stop-Loss Hit';
          exitIdx = j;
          break;
        }
      }
      
      // Profit Lock (if peak >= 2.0% and drops below 1.5%)
      if (peakReturn >= 2.0 && returnPct < 1.5) {
        exitPrice = currentPrice;
        exitReason = 'Profit-Lock Hit';
        exitIdx = j;
        break;
      }
    }
    
    if (exitPrice) {
      const pnl = exitPrice - entryPrice;
      const returnPct = (pnl / entryPrice) * 100;
      trades.push({
        entryPrice,
        exitPrice,
        returnPct,
        pnl,
        exitReason,
        duration: exitIdx - entryIdx
      });
    }
  }
  return trades;
}

// 3. New Exit Engine Simulation
function runNewExitStrategy(pricePath, entries) {
  let trades = [];
  
  for (const entryIdx of entries) {
    const entryPrice = pricePath[entryIdx].close;
    let maxPrice = entryPrice;
    let exitPrice = null;
    let exitReason = '';
    let exitIdx = -1;
    
    for (let j = entryIdx + 1; j < pricePath.length; j++) {
      const currentPrice = pricePath[j].close;
      maxPrice = Math.max(maxPrice, currentPrice);
      
      // We pass the historical slice of candles up to step j
      const candlesSlice = pricePath.slice(Math.max(0, j - 40), j + 1);
      const position = {
        symbol: 'MOCK_STOCK',
        avgPrice: entryPrice,
        maxPrice: maxPrice,
        currentPrice: currentPrice,
        timestamp: new Date(Date.now() - (j - entryIdx) * 60000).toISOString()
      };
      
      const evalResult = exitIntelligenceEngine.evaluatePositionExits(position, candlesSlice);
      if (evalResult.shouldExit) {
        exitPrice = currentPrice;
        exitReason = evalResult.reason;
        exitIdx = j;
        break;
      }
    }
    
    if (exitPrice) {
      const pnl = exitPrice - entryPrice;
      const returnPct = (pnl / entryPrice) * 100;
      trades.push({
        entryPrice,
        exitPrice,
        returnPct,
        pnl,
        exitReason,
        duration: exitIdx - entryIdx
      });
    }
  }
  return trades;
}

// 4. Analysis & Comparison Metrics
function analyzeResults(trades) {
  if (trades.length === 0) return { winRate: 0, profitFactor: 0, netPnL: 0, sharpe: 0 };
  
  const wins = trades.filter(t => t.pnl > 0);
  const losses = trades.filter(t => t.pnl <= 0);
  
  const winRate = (wins.length / trades.length) * 100;
  
  const totalWinAmount = wins.reduce((sum, t) => sum + t.pnl, 0);
  const totalLossAmount = Math.abs(losses.reduce((sum, t) => sum + t.pnl, 0));
  const profitFactor = totalLossAmount > 0 ? (totalWinAmount / totalLossAmount) : totalWinAmount;
  
  const netPnL = trades.reduce((sum, t) => sum + t.pnl, 0);
  
  // Calculate average and standard deviation of returns
  const returns = trades.map(t => t.returnPct);
  const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, b) => a + Math.pow(b - avgReturn, 2), 0) / returns.length;
  const stdDev = Math.sqrt(variance) || 0.001;
  const sharpe = stdDev > 0 ? (avgReturn / stdDev) : 0;
  
  return {
    totalTrades: trades.length,
    winRate: winRate.toFixed(2),
    profitFactor: profitFactor.toFixed(2),
    netPnL: netPnL.toFixed(2),
    sharpe: sharpe.toFixed(2),
    avgDuration: (trades.reduce((sum, t) => sum + t.duration, 0) / trades.length).toFixed(1)
  };
}

// Run Main Backtest Simulation
async function main() {
  console.log('🤖 Starting Exit Intelligence Engine Backtest Simulator...');
  
  // Generate prices starting at ₹100
  const pricePath = generatePricePath(100, 1000);
  
  // Create 60 entry points spaced out
  const entries = [];
  for (let i = 50; i < 900; i += 15) {
    entries.push(i);
  }
  
  console.log(`📈 Running backtest on ${pricePath.length} mock prices with ${entries.length} trade entry points...`);
  
  const oldTrades = runOldExitStrategy(pricePath, entries);
  const newTrades = runNewExitStrategy(pricePath, entries);
  
  const oldMetrics = analyzeResults(oldTrades);
  const newMetrics = analyzeResults(newTrades);
  
  console.log('\n===============================================================');
  console.log('📊 BACKTEST COMPARATIVE REPORT: OLD vs NEW EXIT INTELLIGENCE');
  console.log('===============================================================');
  console.log(`Metric                  Old Exit Strategy     New Exit Engine`);
  console.log(`---------------------------------------------------------------`);
  console.log(`Total Trades Completed:  ${oldMetrics.totalTrades.toString().padEnd(21)} ${newMetrics.totalTrades}`);
  console.log(`Win Rate (%):            ${(oldMetrics.winRate + '%').padEnd(21)} ${newMetrics.winRate}%`);
  console.log(`Profit Factor:           ${oldMetrics.profitFactor.toString().padEnd(21)} ${newMetrics.profitFactor}`);
  console.log(`Net Return (Pts):        ${oldMetrics.netPnL.toString().padEnd(21)} ${newMetrics.netPnL}`);
  console.log(`Sharpe Ratio:            ${oldMetrics.sharpe.toString().padEnd(21)} ${newMetrics.sharpe}`);
  console.log(`Avg Duration (bars):     ${oldMetrics.avgDuration.toString().padEnd(21)} ${newMetrics.avgDuration}`);
  console.log('===============================================================\n');
  
  if (parseFloat(newMetrics.sharpe) > parseFloat(oldMetrics.sharpe)) {
    console.log('🟢 SUCCESS: The new Exit Intelligence Engine provides superior risk-adjusted performance (Sharpe Ratio).');
  } else {
    console.log('⚠️ WARNING: The new Exit Engine did not beat the old engine. Adjusting weights might be needed.');
  }
}

main().catch(err => console.error(err));
