// Backtesting and Benchmark Engine for Agent 1 Performance Audit & Alpha Detection
const fs = require('fs');

function runBacktest(dataRows, model, symbol, initialCapital = 100000.0) {
  let balance = initialCapital;
  let shares = 0;
  let entryPrice = 0;
  let entryIndex = -1;
  const trades = [];
  
  const dailyEquity = [];
  
  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];
    const price = row.close;
    
    // Check exit (e.g. standard 5-day horizon exit or Sell signal)
    if (shares > 0) {
      const holdingDays = i - entryIndex;
      const probs = model.predict ? model.predict(row.inputs) : [0, 0, 1]; // fallback
      
      const shouldSell = (holdingDays >= 5) || 
                         (probs[1] > probs[0] && probs[1] > probs[2] && probs[1] >= 0.35);
      
      if (shouldSell) {
        const exitPrice = price;
        const pnl = (exitPrice - entryPrice) * shares;
        balance += (shares * entryPrice) + pnl; // Add back principal + pnl
        trades.push({
          type: 'BUY',
          entryPrice,
          exitPrice,
          pnl,
          pct: ((exitPrice - entryPrice) / entryPrice) * 100
        });
        shares = 0;
        entryPrice = 0;
        entryIndex = -1;
      }
    }
    
    // Check entry
    if (shares === 0 && i < dataRows.length - 5) {
      const probs = model.predict ? model.predict(row.inputs) : [1, 0, 0];
      const shouldBuy = (probs[0] > probs[1] && probs[0] > probs[2] && probs[0] >= 0.35);
      
      if (shouldBuy) {
        entryPrice = price;
        entryIndex = i;
        shares = Math.floor(balance / price);
        balance -= shares * entryPrice;
      }
    }
    
    const equity = balance + shares * price;
    dailyEquity.push(equity);
  }
  
  // Close any open position at the end
  if (shares > 0) {
    const exitPrice = dataRows[dataRows.length - 1].close;
    const pnl = (exitPrice - entryPrice) * shares;
    balance += (shares * entryPrice) + pnl; // Add back principal + pnl
    trades.push({
      type: 'BUY',
      entryPrice,
      exitPrice,
      pnl,
      pct: ((exitPrice - entryPrice) / entryPrice) * 100
    });
  }
  
  const finalValue = balance;
  const totalReturn = (finalValue - initialCapital) / initialCapital;
  
  // Metrics Calculations
  const winningTrades = trades.filter(t => t.pnl > 0).length;
  const losingTrades = trades.filter(t => t.pnl <= 0).length;
  const totalTrades = trades.length;
  const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0.0;
  
  const grossProfit = trades.filter(t => t.pnl > 0).reduce((sum, t) => sum + t.pnl, 0);
  const grossLoss = Math.abs(trades.filter(t => t.pnl < 0).reduce((sum, t) => sum + t.pnl, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit;
  
  // Calculate Daily Returns
  const dailyReturns = [];
  let peak = initialCapital;
  let maxDrawdown = 0;
  
  for (let i = 1; i < dailyEquity.length; i++) {
    const r = (dailyEquity[i] - dailyEquity[i - 1]) / dailyEquity[i - 1];
    dailyReturns.push(r);
    
    if (dailyEquity[i] > peak) {
      peak = dailyEquity[i];
    }
    const dd = ((peak - dailyEquity[i]) / peak) * 100;
    if (dd > maxDrawdown) {
      maxDrawdown = dd;
    }
  }
  
  // Annualized metrics (assuming 252 trading days per year)
  const nYears = dailyEquity.length / 252;
  const cagr = nYears > 0 ? (Math.pow(finalValue / initialCapital, 1 / nYears) - 1) * 100 : totalReturn * 100;
  
  const avgReturn = dailyReturns.reduce((a, b) => a + b, 0) / (dailyReturns.length || 1);
  const stdReturn = Math.sqrt(dailyReturns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / (dailyReturns.length || 1));
  const sharpe = stdReturn > 0 ? (avgReturn / stdReturn) * Math.sqrt(252) : 0.0;
  
  const downsideReturns = dailyReturns.filter(r => r < 0);
  const downsideStd = Math.sqrt(downsideReturns.reduce((sum, r) => sum + Math.pow(r, 2), 0) / (dailyReturns.length || 1));
  const sortino = downsideStd > 0 ? (avgReturn / downsideStd) * Math.sqrt(252) : 0.0;
  
  return {
    totalTrades,
    winningTrades,
    losingTrades,
    winRate,
    profitFactor,
    maxDrawdown,
    sharpe,
    sortino,
    cagr,
    finalValue,
    dailyReturns
  };
}

function calculateAlphaMetrics(strategyReturns, benchmarkReturns) {
  // Pad arrays if length mismatches
  const len = Math.min(strategyReturns.length, benchmarkReturns.length);
  const excessReturns = [];
  
  for (let i = 0; i < len; i++) {
    excessReturns.push(strategyReturns[i] - benchmarkReturns[i]);
  }
  
  const avgExcess = excessReturns.reduce((a, b) => a + b, 0) / (excessReturns.length || 1);
  const trackingError = Math.sqrt(excessReturns.reduce((sum, r) => sum + Math.pow(r - avgExcess, 2), 0) / (excessReturns.length || 1));
  const informationRatio = trackingError > 0 ? (avgExcess / trackingError) * Math.sqrt(252) : 0.0;
  
  const totalStrategyRet = strategyReturns.reduce((sum, r) => sum + r, 0) * 100;
  const totalBenchRet = benchmarkReturns.reduce((sum, r) => sum + r, 0) * 100;
  const excessReturnPct = totalStrategyRet - totalBenchRet;
  
  return {
    excessReturnPct,
    informationRatio
  };
}

module.exports = {
  runBacktest,
  calculateAlphaMetrics
};
