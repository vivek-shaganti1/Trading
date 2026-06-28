const fs = require('fs');
const path = require('path');
const { DeeperNeuralNet } = require('./models');
const { loadAllHistoricalData } = require('./data_loader');
const { constructFeatures } = require('./feature_engineer');

// Load scaled neural weights
const modelData = JSON.parse(fs.readFileSync(path.join(__dirname, 'balanced_neural_model_weights.json'), 'utf8'));
const nn = new DeeperNeuralNet(17, 32, 16, 3);
nn.w1 = modelData.w1; nn.b1 = modelData.b1;
nn.w2 = modelData.w2; nn.b2 = modelData.b2;
nn.w3 = modelData.w3; nn.b3 = modelData.b3;
const means = modelData.means;
const stds = modelData.stds;

function scaleVector(inputs) {
  return inputs.map((val, idx) => (val - means[idx]) / stds[idx]);
}

// Technical Indicators Helpers for Agent 3 backtest
function getEMA(closes, idx, period) {
  if (idx < period - 1) return closes[idx];
  let ema = closes[idx - period + 1];
  const k = 2 / (period + 1);
  for (let i = idx - period + 2; i <= idx; i++) {
    ema = closes[i] * k + ema * (1 - k);
  }
  return ema;
}

function getRSI(closes, idx, period = 14) {
  if (idx < period) return 50;
  let gains = 0, losses = 0;
  for (let i = idx - period + 1; i <= idx; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff;
    else losses -= diff;
  }
  if (losses === 0) return 100;
  const rs = gains / losses;
  return 100 - (100 / (1 + rs));
}

function getMACD(closes, idx) {
  const ema12 = getEMA(closes, idx, 12);
  const ema26 = getEMA(closes, idx, 26);
  return ema12 - ema26;
}

function runAgent3Decision(closes, idx) {
  const currentPrice = closes[idx];
  
  // 1. EMA Crossover
  const ema9 = getEMA(closes, idx, 9);
  const ema21 = getEMA(closes, idx, 21);
  const ema50 = getEMA(closes, idx, 50);
  const emaSignal = ema9 > ema21 ? 1 : -1;

  // 2. RSI
  const rsi = getRSI(closes, idx, 14);
  let rsiSignal = 0;
  if (rsi < 30) rsiSignal = 1;
  else if (rsi > 70) rsiSignal = -1;
  else rsiSignal = emaSignal;

  // 3. MACD
  const macdLine = getMACD(closes, idx);
  const macdSignal = macdLine > 0 ? 1 : -1;

  // 4. VWAP approximation (using current price vs 20-day SMA as VWAP proxy)
  let sum = 0;
  const period = Math.min(20, idx + 1);
  for (let i = idx - period + 1; i <= idx; i++) sum += closes[i];
  const vwap = sum / period;
  const vwapSignal = currentPrice > vwap ? 1 : -1;

  // 5. Momentum
  const prevPrice = closes[Math.max(0, idx - 5)];
  const roc = ((currentPrice - prevPrice) / prevPrice) * 100;
  const rocSignal = roc > 0 ? 1 : -1;

  const totalScore = emaSignal + rsiSignal + macdSignal + vwapSignal + rocSignal;
  
  if (totalScore >= 2) return 0; // BUY
  if (totalScore <= -2) return 1; // SELL
  return 2; // HOLD
}

// Standard Backtester
function simulateBacktest(dataRows, isAgent1, initialCapital = 100000.0) {
  let balance = initialCapital;
  let shares = 0;
  let entryPrice = 0;
  let entryIndex = -1;
  const trades = [];
  const dailyEquity = [];

  const closes = dataRows.map(r => r.close);

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];
    const price = row.close;

    // Classification decision
    let decision = 2; // HOLD
    if (isAgent1) {
      const scaled = scaleVector(row.inputs);
      const probs = nn.forward(scaled).probs;
      if (probs[0] > probs[1] && probs[0] > probs[2] && probs[0] >= 0.35) decision = 0;
      else if (probs[1] > probs[0] && probs[1] > probs[2] && probs[1] >= 0.35) decision = 1;
    } else {
      decision = runAgent3Decision(closes, i);
    }

    // Exit check
    if (shares > 0) {
      const holdingDays = i - entryIndex;
      const shouldExit = (holdingDays >= 5) || (decision === 1);
      
      if (shouldExit) {
        const exitPrice = price;
        const pnl = (exitPrice - entryPrice) * shares;
        balance += (shares * entryPrice) + pnl;
        trades.push({ pnl });
        shares = 0;
        entryPrice = 0;
        entryIndex = -1;
      }
    }

    // Entry check
    if (shares === 0 && i < dataRows.length - 5) {
      if (decision === 0) {
        entryPrice = price;
        entryIndex = i;
        shares = Math.floor(balance / price);
        balance -= shares * entryPrice;
      }
    }

    const equity = balance + shares * price;
    dailyEquity.push(equity);
  }

  // Close final position
  if (shares > 0) {
    const exitPrice = closes[closes.length - 1];
    const pnl = (exitPrice - entryPrice) * shares;
    balance += (shares * entryPrice) + pnl;
    trades.push({ pnl });
  }

  const finalValue = balance;
  const totalReturn = (finalValue - initialCapital) / initialCapital;

  // Metrics
  const winningTrades = trades.filter(t => t.pnl > 0).length;
  const totalTrades = trades.length;
  const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0.0;

  const grossProfit = trades.filter(t => t.pnl > 0).reduce((sum, t) => sum + t.pnl, 0);
  const grossLoss = Math.abs(trades.filter(t => t.pnl < 0).reduce((sum, t) => sum + t.pnl, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit;

  // Max Drawdown & Sharpe
  const dailyReturns = [];
  let peak = initialCapital;
  let maxDrawdown = 0;

  for (let i = 1; i < dailyEquity.length; i++) {
    const r = (dailyEquity[i] - dailyEquity[i - 1]) / dailyEquity[i - 1];
    dailyReturns.push(r);

    if (dailyEquity[i] > peak) peak = dailyEquity[i];
    const dd = ((peak - dailyEquity[i]) / peak) * 100;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  const nYears = dailyEquity.length / 252;
  const cagr = nYears > 0 ? (Math.pow(finalValue / initialCapital, 1 / nYears) - 1) * 100 : totalReturn * 100;

  const avgReturn = dailyReturns.reduce((a, b) => a + b, 0) / (dailyReturns.length || 1);
  const stdReturn = Math.sqrt(dailyReturns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / (dailyReturns.length || 1));
  const sharpe = stdReturn > 0 ? (avgReturn / stdReturn) * Math.sqrt(252) : 0.0;

  return {
    totalTrades,
    winRate,
    profitFactor,
    maxDrawdown,
    sharpe,
    cagr,
    finalValue
  };
}

async function runComparison() {
  console.log('🏁 Starting 5-Year Head-to-Head Backtest Comparison (Agent 1 vs Agent 3)...');
  
  const rawData = await loadAllHistoricalData();
  const niftyData = rawData.NIFTY;
  
  // Filter for last 5 years (approx. 1260 candles)
  const symbols = Object.keys(rawData).filter(k => k !== 'NIFTY');
  
  const allTickerData = [];
  symbols.forEach(sym => {
    const candles = rawData[sym];
    // Keep last 1260 candles (~5 years)
    const fiveYearCandles = candles.slice(-Math.min(1260, candles.length));
    const engineered = constructFeatures(sym, fiveYearCandles, niftyData, rawData);
    allTickerData.push(...engineered);
  });

  console.log(`Evaluating over ${allTickerData.length} multi-stock daily steps...`);

  // Run backtests
  console.log('\nRunning Agent 1 Backtest...');
  const a1Res = simulateBacktest(allTickerData, true);

  console.log('Running Agent 3 Backtest...');
  const a3Res = simulateBacktest(allTickerData, false);

  // Compute Classification Metrics on 5-year data
  const a1Preds = [];
  const a3Preds = [];
  const targets = [];
  const closes = allTickerData.map(r => r.close);

  allTickerData.forEach((row, i) => {
    // Agent 1
    const scaled = scaleVector(row.inputs);
    const probs = nn.forward(scaled).probs;
    let a1Dec = 2;
    if (probs[0] > probs[1] && probs[0] > probs[2]) a1Dec = 0;
    else if (probs[1] > probs[0] && probs[1] > probs[2]) a1Dec = 1;
    a1Preds.push(a1Dec);

    // Agent 3
    a3Preds.push(runAgent3Decision(closes, i));

    // Target
    targets.push(row.target);
  });

  const getMetrics = (preds) => {
    const correct = preds.filter((p, i) => p === targets[i]).length;
    const accuracy = (correct / preds.length) * 100;
    
    // Weighted F1 approximation
    let tp = 0, fp = 0, fn = 0;
    for (let idx = 0; idx < 3; idx++) {
      for (let i = 0; i < preds.length; i++) {
        if (preds[i] === idx && targets[i] === idx) tp++;
        else if (preds[i] === idx && targets[i] !== idx) fp++;
        else if (preds[i] !== idx && targets[i] === idx) fn++;
      }
    }
    const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
    const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
    const f1 = precision + recall > 0 ? 2 * (precision * recall) / (precision + recall) : 0;

    return {
      accuracy: parseFloat(accuracy.toFixed(2)),
      precision: parseFloat((precision * 100).toFixed(2)),
      recall: parseFloat((recall * 100).toFixed(2)),
      f1: parseFloat((f1 * 100).toFixed(2))
    };
  };

  const a1Metrics = getMetrics(a1Preds);
  const a3Metrics = getMetrics(a3Preds);

  console.log('\n--- HEAD-TO-HEAD BACKTEST RESULTS ---');
  console.log('Metric | Agent 1 (Balanced 17-Feat NN) | Agent 3 (Technicals Engine)');
  console.log('-------|---------------------------------|---------------------------');
  console.log(`Accuracy  | ${a1Metrics.accuracy}%`.padEnd(7) + ` | ${a3Metrics.accuracy}%`);
  console.log(`Precision | ${a1Metrics.precision}%`.padEnd(7) + ` | ${a3Metrics.precision}%`);
  console.log(`Recall    | ${a1Metrics.recall}%`.padEnd(7) + ` | ${a3Metrics.recall}%`);
  console.log(`F1 Score  | ${a1Metrics.f1}%`.padEnd(7) + ` | ${a3Metrics.f1}%`);
  console.log(`Trades    | ${a1Res.totalTrades}`.padEnd(7) + ` | ${a3Res.totalTrades}`);
  console.log(`Win Rate  | ${a1Res.winRate.toFixed(2)}%`.padEnd(7) + ` | ${a3Res.winRate.toFixed(2)}%`);
  console.log(`Profit Fac| ${a1Res.profitFactor.toFixed(2)}`.padEnd(7) + ` | ${a3Res.profitFactor.toFixed(2)}`);
  console.log(`Max DD    | ${a1Res.maxDrawdown.toFixed(2)}%`.padEnd(7) + ` | ${a3Res.maxDrawdown.toFixed(2)}%`);
  console.log(`Sharpe    | ${a1Res.sharpe.toFixed(2)}`.padEnd(7) + ` | ${a3Res.sharpe.toFixed(2)}`);
  console.log(`CAGR      | ${a1Res.cagr.toFixed(2)}%`.padEnd(7) + ` | ${a3Res.cagr.toFixed(2)}%`);
  console.log(`Final Port| ₹${a1Res.finalValue.toFixed(2)}`.padEnd(7) + ` | ₹${a3Res.finalValue.toFixed(2)}`);

  // Target comparison metrics: Sharpe, CAGR, Drawdown, Profit Factor
  const a1WinsSharpe = a1Res.sharpe > a3Res.sharpe;
  const a1WinsCAGR = a1Res.cagr > a3Res.cagr;
  const a1WinsDD = a1Res.maxDrawdown < a3Res.maxDrawdown; // lower is better
  const a1WinsPF = a1Res.profitFactor > a3Res.profitFactor;

  const replaceAgent3 = a1WinsSharpe && a1WinsCAGR && a1WinsDD && a1WinsPF;

  console.log('\n--- TARGET METRIC SCORECARD (Agent 1 vs Agent 3) ---');
  console.log(`• Sharpe Ratio   : Agent 1 (${a1Res.sharpe.toFixed(2)}) ${a1WinsSharpe ? 'BEATS' : 'FAILS TO BEAT'} Agent 3 (${a3Res.sharpe.toFixed(2)})`);
  console.log(`• CAGR           : Agent 1 (${a1Res.cagr.toFixed(2)}%) ${a1WinsCAGR ? 'BEATS' : 'FAILS TO BEAT'} Agent 3 (${a3Res.cagr.toFixed(2)}%)`);
  console.log(`• Max Drawdown   : Agent 1 (${a1Res.maxDrawdown.toFixed(2)}%) ${a1WinsDD ? 'BEATS' : 'FAILS TO BEAT'} Agent 3 (${a3Res.maxDrawdown.toFixed(2)}%)`);
  console.log(`• Profit Factor  : Agent 1 (${a1Res.profitFactor.toFixed(2)}) ${a1WinsPF ? 'BEATS' : 'FAILS TO BEAT'} Agent 3 (${a3Res.profitFactor.toFixed(2)})`);

  console.log('\n--- FINAL DECISION ---');
  if (replaceAgent3) {
    console.log('🏆 Winner: AGENT 1 wins on all four core metrics! Replace Agent 3 logic with Agent 1.');
    // Write a flag to local file for production predictor to load
    fs.writeFileSync(path.join(__dirname, 'swap_agent3_winner.json'), JSON.stringify({ replace: true, model: 'Agent 1 Retrained' }, null, 2));
  } else {
    console.log('❌ Winner: AGENT 3. Agent 1 failed to outperform Agent 3 on all four criteria. Keep Agent 3 active.');
    fs.writeFileSync(path.join(__dirname, 'swap_agent3_winner.json'), JSON.stringify({ replace: false, model: 'Agent 3 Original' }, null, 2));
  }
}

if (require.main === module) {
  runComparison().then(() => {
    process.exit(0);
  }).catch(err => {
    console.error(err);
    process.exit(1);
  });
}
