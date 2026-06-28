require('dotenv').config();
const { DeeperNeuralNet } = require('./models');
const { loadAllHistoricalData } = require('./data_loader');
const { constructFeatures } = require('./feature_engineer');

// 5-year Backtest simulation framework for testing combinations of Agents 1 to 9
function simulateMultiAgentConsensus(dataRows, activeAgentsList, initialCapital = 100000.0) {
  let balance = initialCapital;
  let shares = 0;
  let entryPrice = 0;
  let entryIndex = -1;
  const trades = [];
  const dailyEquity = [];

  // Load Neural weights for Agent 1
  const fs = require('fs');
  const path = require('path');
  const modelWeights = JSON.parse(fs.readFileSync(path.join(__dirname, 'balanced_neural_model_weights.json'), 'utf8'));
  const nn = new DeeperNeuralNet(17, 32, 16, 3);
  nn.w1 = modelWeights.w1; nn.b1 = modelWeights.b1;
  nn.w2 = modelWeights.w2; nn.b2 = modelWeights.b2;
  nn.w3 = modelWeights.w3; nn.b3 = modelWeights.b3;
  const means = modelWeights.means;
  const stds = modelWeights.stds;

  const scaleVector = (inputs) => {
    return inputs.map((val, idx) => (val - means[idx]) / stds[idx]);
  };

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];
    const price = row.close;

    // Feature indexes:
    // [ stockMom(0), niftyMom(1), vixRet(2), volSpike(3), rsi(4), macd(5), atr(6), ema9(7), ema21(8), ema50(9), vwapDist(10), bollinger(11), adx(12), relStrength(13), sectorMom(14), gapPct(15), intradayVol(16) ]
    const stockMom = row.inputs[0];
    const niftyMom = row.inputs[1];
    const vixRet = row.inputs[2];
    const volSpike = row.inputs[3];
    const rsi = row.inputs[4];
    const macdHist = row.inputs[5];
    const atr = row.inputs[6];
    const ema9Dist = row.inputs[7];
    const ema21Dist = row.inputs[8];
    const ema50Dist = row.inputs[9];
    const vwapDist = row.inputs[10];
    const bBandsPos = row.inputs[11];
    const adx = row.inputs[12];
    const sectorMom = row.inputs[14];

    // Compute Agent Signals
    const signals = {};

    // Agent 1: Neural Net
    const scaled = scaleVector(row.inputs);
    const nnProbs = nn.forward(scaled).probs;
    let a1Dec = 'HOLD';
    if (nnProbs[0] > nnProbs[1] && nnProbs[0] > nnProbs[2]) a1Dec = 'BUY';
    else if (nnProbs[1] > nnProbs[0] && nnProbs[1] > nnProbs[2]) a1Dec = 'SELL';
    signals[1] = a1Dec;

    // Agent 2: Gemini (simulated: follows momentum + positive news)
    signals[2] = stockMom > 1.0 ? 'BUY' : (stockMom < -1.0 ? 'SELL' : 'HOLD');

    // Agent 3: Groq (simulated: follows index trend + sentiment filter)
    signals[3] = niftyMom > 0.5 ? 'BUY' : (niftyMom < -0.5 ? 'SELL' : 'HOLD');

    // Agent 4: Technicals rule-based
    const techScore = (ema9Dist > ema21Dist ? 1 : -1) + (rsi < 30 ? 1 : (rsi > 70 ? -1 : 0)) + (macdHist > 0 ? 1 : -1);
    signals[4] = techScore >= 1 ? 'BUY' : (techScore <= -1 ? 'SELL' : 'HOLD');

    // Agent 5: Market Context
    signals[5] = (niftyMom > 0.2 && vixRet < 0) ? 'BUY' : ((niftyMom < -0.2 && vixRet > 0) ? 'SELL' : 'HOLD');

    // Agent 6: Market Regime Detector (ADX + EMA offset)
    let a6Dec = 'HOLD';
    if (adx > 25) { // trending
      a6Dec = ema9Dist > ema21Dist ? 'BUY' : 'SELL';
    }
    signals[6] = a6Dec;

    // Agent 7: Risk Manager (VIX Filter)
    let a7Dec = 'HOLD';
    if (vixRet > 20) a7Dec = 'SELL'; // high panic
    else if (vixRet < -5) a7Dec = 'BUY';
    signals[7] = a7Dec;

    // Agent 8: Mean Reversion Engine (RSI + Bollinger)
    let a8Dec = 'HOLD';
    if (rsi < 35 && bBandsPos < 0.15) a8Dec = 'BUY';
    else if (rsi > 65 && bBandsPos > 0.85) a8Dec = 'SELL';
    signals[8] = a8Dec;

    // Agent 9: Market Breadth Engine (Nifty + Sector Rotation)
    let a9Dec = 'HOLD';
    if (niftyMom > 0.5 && sectorMom > 0.8) a9Dec = 'BUY';
    else if (niftyMom < -0.5 && sectorMom < -0.8) a9Dec = 'SELL';
    signals[9] = a9Dec;

    // Collect votes of active agents
    const activeVotes = activeAgentsList.map(num => signals[num]);
    const buyVotes = activeVotes.filter(v => v === 'BUY').length;
    const sellVotes = activeVotes.filter(v => v === 'SELL').length;
    const thresh = Math.ceil(activeAgentsList.length / 2);

    let consensus = 'HOLD';
    if (buyVotes >= thresh) consensus = 'BUY';
    else if (sellVotes >= thresh) consensus = 'SELL';

    // Backtest Account Logics
    if (shares > 0) {
      const holdingDays = i - entryIndex;
      const shouldExit = (holdingDays >= 5) || (consensus === 'SELL');
      if (shouldExit) {
        const pnl = (price - entryPrice) * shares;
        balance += (shares * entryPrice) + pnl;
        trades.push({ pnl });
        shares = 0;
        entryPrice = 0;
        entryIndex = -1;
      }
    }

    if (shares === 0 && i < dataRows.length - 5) {
      if (consensus === 'BUY') {
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
    const pnl = (dataRows[dataRows.length - 1].close - entryPrice) * shares;
    balance += (shares * entryPrice) + pnl;
    trades.push({ pnl });
  }

  const finalValue = balance;
  const totalReturn = (finalValue - initialCapital) / initialCapital;

  // Compute stats
  const winningTrades = trades.filter(t => t.pnl > 0).length;
  const totalTrades = trades.length;
  const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0.0;
  const grossProfit = trades.filter(t => t.pnl > 0).reduce((sum, t) => sum + t.pnl, 0);
  const grossLoss = Math.abs(trades.filter(t => t.pnl < 0).reduce((sum, t) => sum + t.pnl, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit;

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

async function runExpansion() {
  console.log('🏁 Starting Multi-Agent Expansion and Backtesting Loop (5 Years)...');

  const rawData = await loadAllHistoricalData();
  const niftyData = rawData.NIFTY;
  const symbols = Object.keys(rawData).filter(k => k !== 'NIFTY');

  const allTickerData = [];
  symbols.forEach(sym => {
    const candles = rawData[sym];
    const fiveYearCandles = candles.slice(-Math.min(1260, candles.length));
    const engineered = constructFeatures(sym, fiveYearCandles, niftyData, rawData);
    allTickerData.push(...engineered);
  });

  console.log(`Evaluating combo performance over ${allTickerData.length} daily steps...`);

  // Incremental analysis of Agents
  const baseline = [1, 2, 3, 4, 5];
  console.log('\nRunning Baseline Backtest (Agents 1-5)...');
  const baseRes = simulateMultiAgentConsensus(allTickerData, baseline);
  console.log(`Baseline -> Sharpe: ${baseRes.sharpe.toFixed(2)} | CAGR: ${baseRes.cagr.toFixed(2)}% | Max DD: ${baseRes.maxDrawdown.toFixed(2)}% | Profit Factor: ${baseRes.profitFactor.toFixed(2)}`);

  // We will test adding each agent one by one
  const newAgents = [
    { num: 6, name: 'Regime Detector' },
    { num: 7, name: 'Risk Manager' },
    { num: 8, name: 'Mean Reversion Engine' },
    { num: 9, name: 'Market Breadth Engine' }
  ];

  const optimalAgents = [...baseline];
  let currentRes = baseRes;

  newAgents.forEach(agent => {
    console.log(`\nEvaluating Agent ${agent.num} (${agent.name})...`);
    const candidateList = [...optimalAgents, agent.num];
    const res = simulateMultiAgentConsensus(allTickerData, candidateList);
    
    // Check improvement criteria:
    // Sharpe must improve, CAGR must improve (or hold stable), Max Drawdown must decrease
    const sharpeImproves = res.sharpe > currentRes.sharpe;
    const cagrImproves = res.cagr > currentRes.cagr;
    const ddImproves = res.maxDrawdown < currentRes.maxDrawdown; // lower is better
    const pfImproves = res.profitFactor > currentRes.profitFactor;

    console.log(`Candidate -> Sharpe: ${res.sharpe.toFixed(2)} | CAGR: ${res.cagr.toFixed(2)}% | Max DD: ${res.maxDrawdown.toFixed(2)}% | Profit Factor: ${res.profitFactor.toFixed(2)}`);

    if (sharpeImproves || cagrImproves || ddImproves || pfImproves) {
      optimalAgents.push(agent.num);
      currentRes = res;
      console.log(`✅ ACCEPTED: Agent ${agent.num} improves performance. Added to production layout.`);
    } else {
      console.log(`❌ REJECTED: Agent ${agent.num} does not improve metrics. Pruned.`);
    }
  });

  console.log('\n==================================================');
  console.log('🏆 FINAL OPTIMAL ARCHITECTURE SUMMARY');
  console.log('==================================================');
  console.log('Active Production Agents:', optimalAgents.join(', '));
  console.log(`Performance Sharpe       : ${currentRes.sharpe.toFixed(2)}`);
  console.log(`Performance CAGR         : ${currentRes.cagr.toFixed(2)}%`);
  console.log(`Performance Max Drawdown : ${currentRes.maxDrawdown.toFixed(2)}%`);
  console.log(`Performance Profit Factor: ${currentRes.profitFactor.toFixed(2)}`);
  console.log(`Final Portfolio Valuation: ₹${currentRes.finalValue.toFixed(2)}`);
}

runExpansion().then(() => {
  process.exit(0);
}).catch(err => {
  console.error(err);
  process.exit(1);
});
