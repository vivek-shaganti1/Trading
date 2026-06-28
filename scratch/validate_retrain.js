require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { DeeperNeuralNet, GradientBoostedTrees, RandomForest } = require('./models');
const { loadAllHistoricalData } = require('./data_loader');
const { constructFeatures } = require('./feature_engineer');
const { runBacktest, calculateAlphaMetrics } = require('./backtester');
const db = require('../backend/db');

// 1. Generate 100 Synthetic Market Scenarios (10 vectors per scenario type)
function generateSyntheticScenarios() {
  const scenarios = [];
  const labels = { BUY: 0, SELL: 1, HOLD: 2 };
  
  // Feature Indexes:
  // [ stockMom(0), niftyMom(1), vixRet(2), volSpike(3), rsi(4), macd(5), atr(6), ema9(7), ema21(8), ema50(9), vwapDist(10), bollinger(11), adx(12), relStrength(13), sectorMom(14), gapPct(15), intradayVol(16) ]

  const genInputs = (type) => {
    const inputs = new Array(17).fill(0.0);
    if (type === 'strong_bull') {
      inputs[0] = 3.5 + Math.random(); // high stock return
      inputs[1] = 1.8 + Math.random() * 0.5; // positive index
      inputs[2] = -5.0 - Math.random() * 5.0; // falling VIX
      inputs[3] = 1.2 + Math.random() * 0.5; // average volume
      inputs[4] = 65 + Math.random() * 15; // high RSI
      inputs[5] = 0.5 + Math.random(); // positive MACD
      inputs[7] = 1.0; inputs[8] = 2.0; inputs[9] = 3.0; // bullish EMA offsets
      inputs[10] = 1.5; // above VWAP
      inputs[11] = 0.8; // upper Bollinger
      inputs[12] = 30 + Math.random() * 20; // strong trend ADX
      inputs[13] = 1.5; // excess momentum
      inputs[14] = 2.0; // sector positive
      return { inputs, target: labels.BUY };
    }
    if (type === 'strong_bear') {
      inputs[0] = -3.5 - Math.random();
      inputs[1] = -1.8 - Math.random() * 0.5;
      inputs[2] = 12.0 + Math.random() * 8.0; // rising VIX
      inputs[3] = 1.4 + Math.random() * 0.6; // high volume
      inputs[4] = 20 + Math.random() * 15; // low RSI
      inputs[5] = -0.5 - Math.random();
      inputs[7] = -1.0; inputs[8] = -2.0; inputs[9] = -3.0; // bearish EMA
      inputs[10] = -1.5;
      inputs[11] = 0.2;
      inputs[12] = 30 + Math.random() * 20;
      inputs[13] = -1.5;
      inputs[14] = -2.0;
      return { inputs, target: labels.SELL };
    }
    if (type === 'sideways') {
      inputs[0] = (Math.random() - 0.5) * 0.2; // zero return
      inputs[1] = (Math.random() - 0.5) * 0.1;
      inputs[2] = (Math.random() - 0.5) * 2.0;
      inputs[3] = 0.8 + Math.random() * 0.2; // dry volume
      inputs[4] = 45 + Math.random() * 10; // neutral RSI
      inputs[5] = (Math.random() - 0.5) * 0.1;
      inputs[10] = 0.0;
      inputs[11] = 0.5; // mid Bollinger
      inputs[12] = 10 + Math.random() * 8; // low ADX
      inputs[13] = 0.0;
      inputs[14] = 0.0;
      return { inputs, target: labels.HOLD };
    }
    if (type === 'panic_crash') {
      inputs[0] = -7.0 - Math.random() * 3.0;
      inputs[1] = -4.5 - Math.random() * 1.5;
      inputs[2] = 35.0 + Math.random() * 20.0; // massive VIX spike
      inputs[3] = 2.5 + Math.random() * 1.5; // heavy panic volume
      inputs[4] = 10 + Math.random() * 10; // oversold RSI
      inputs[5] = -2.0 - Math.random() * 3.0;
      inputs[10] = -5.0;
      inputs[11] = -0.1;
      inputs[12] = 45 + Math.random() * 15;
      inputs[13] = -3.5;
      inputs[14] = -4.0;
      return { inputs, target: labels.SELL };
    }
    if (type === 'earnings_gap_up') {
      inputs[0] = 1.0;
      inputs[3] = 3.0 + Math.random() * 2.0; // high volume
      inputs[15] = 4.0 + Math.random() * 3.0; // massive gap up
      inputs[16] = 2.0; // high volatility
      return { inputs, target: labels.BUY };
    }
    if (type === 'earnings_gap_down') {
      inputs[0] = -1.0;
      inputs[3] = 3.0 + Math.random() * 2.0;
      inputs[15] = -4.0 - Math.random() * 3.0; // gap down
      inputs[16] = 2.0;
      return { inputs, target: labels.SELL };
    }
    if (type === 'volume_breakout') {
      inputs[0] = 2.5 + Math.random();
      inputs[3] = 4.0 + Math.random() * 3.0; // volume spike
      inputs[12] = 25 + Math.random() * 10;
      return { inputs, target: labels.BUY };
    }
    if (type === 'false_breakout') {
      inputs[0] = 1.5;
      inputs[3] = 1.8;
      inputs[4] = 72.0; // overbought RSI
      inputs[12] = 15.0; // weak ADX trend
      return { inputs, target: labels.HOLD };
    }
    if (type === 'high_vix') {
      inputs[0] = (Math.random() - 0.5) * 4.0;
      inputs[2] = 20.0 + Math.random() * 10.0;
      inputs[16] = 3.0 + Math.random() * 2.0; // high intraday range
      return { inputs, target: labels.HOLD };
    }
    if (type === 'low_liquidity') {
      inputs[3] = 0.2 + Math.random() * 0.2; // very dry volume
      inputs[12] = 8.0;
      return { inputs, target: labels.HOLD };
    }
    return { inputs, target: labels.HOLD };
  };

  const categories = [
    'strong_bull', 'strong_bear', 'sideways', 'panic_crash', 'earnings_gap_up',
    'earnings_gap_down', 'volume_breakout', 'false_breakout', 'high_vix', 'low_liquidity'
  ];

  categories.forEach(cat => {
    for (let i = 0; i < 10; i++) {
      scenarios.push({
        category: cat,
        ...genInputs(cat)
      });
    }
  });

  return scenarios;
}

// Evaluate synthetic scenarios accuracy
function evaluateSynthetic(model, scenarios) {
  let sidewaysCorrect = 0, sidewaysTotal = 0;
  let bullCorrect = 0, bullTotal = 0;
  let bearCorrect = 0, bearTotal = 0;
  
  const misclassifications = [];

  scenarios.forEach(sc => {
    const probs = model.forward ? model.forward(sc.inputs).probs : model.predict(sc.inputs);
    
    // Decided class logic matching threshold filter
    let signal = 2; // HOLD
    if (probs[0] > probs[1] && probs[0] > probs[2] && probs[0] >= 0.35) signal = 0;
    else if (probs[1] > probs[0] && probs[1] > probs[2] && probs[1] >= 0.35) signal = 1;

    if (sc.category === 'sideways') {
      sidewaysTotal++;
      if (signal === 2) sidewaysCorrect++;
      else if (signal === 0) misclassifications.push({ scenario: 'Sideways => BUY', probs });
    } else if (sc.category === 'strong_bull') {
      bullTotal++;
      if (signal === 0) bullCorrect++;
      else if (signal === 1) misclassifications.push({ scenario: 'Bullish => SELL', probs });
    } else if (sc.category === 'strong_bear') {
      bearTotal++;
      if (signal === 1) bearCorrect++;
      else if (signal === 0) misclassifications.push({ scenario: 'Bearish => BUY', probs });
    }
  });

  return {
    sidewaysAcc: sidewaysTotal > 0 ? (sidewaysCorrect / sidewaysTotal) * 100 : 0.0,
    bullAcc: bullTotal > 0 ? (bullCorrect / bullTotal) * 100 : 0.0,
    bearAcc: bearTotal > 0 ? (bearCorrect / bearTotal) * 100 : 0.0,
    misclassifications
  };
}

async function main() {
  console.log('🏁 Starting Large-Scale Agent 1 Training & Optimization Loop...\n');
  
  // Wait for postgres startup Validate restore sync to finish first
  console.log('Connecting to PostgreSQL database...');
  await new Promise(resolve => setTimeout(resolve, 5000));

  // 1. Download/Load 10-year historical NSE data
  const rawData = await loadAllHistoricalData();
  const niftyData = rawData.NIFTY;
  
  if (!niftyData || niftyData.length === 0) {
    console.error('Error: Nifty 50 historical data missing. Pipeline halted.');
    return;
  }

  // 2. Feature Engineering & Dataset Partitioning (80% Train, 20% Backtest/Validation)
  console.log('\nEngineering indicator features & partitioning datasets...');
  const trainRows = [];
  const testRows = [];
  const testDataByTicker = {};

  const symbols = Object.keys(rawData).filter(k => k !== 'NIFTY');
  symbols.forEach(sym => {
    const candles = rawData[sym];
    const engineered = constructFeatures(sym, candles, niftyData, rawData);
    
    // Split: 80% train, 20% validation/test
    const splitIdx = Math.round(engineered.length * 0.8);
    const symTrain = engineered.slice(0, splitIdx);
    const symTest = engineered.slice(splitIdx);
    
    trainRows.push(...symTrain);
    testRows.push(...symTest);
    testDataByTicker[sym] = symTest;
  });

  console.log(`Total Training Samples: ${trainRows.length}`);
  console.log(`Total Validation/Backtesting Samples: ${testRows.length}`);

  // Create input/label arrays
  const X_train = trainRows.map(r => r.inputs);
  const y_train = trainRows.map(r => r.target);
  const X_test = testRows.map(r => r.inputs);
  const y_test = testRows.map(r => r.target);

  // 3. Initialize Architectures
  const nn = new DeeperNeuralNet(17, 32, 16, 3);
  const rf = new RandomForest(15, 4);
  const gbdt = new GradientBoostedTrees(15, 3);

  // 4. Generate Synthetic Scenarios for target calibration
  const syntheticScenarios = generateSyntheticScenarios();

  // 5. Training and Optimization Loop
  console.log('\nStarting model optimization...');
  let epoch = 0;
  const maxEpochs = 50;
  let optimalWeights = null;
  let bestScore = -100;
  let targetMet = false;

  while (epoch < maxEpochs) {
    epoch++;
    
    // Neural Net backpropagation SGD
    // Shuffle train rows
    const shuffleIdx = Array.from({ length: X_train.length }, (_, i) => i);
    shuffleIdx.sort(() => Math.random() - 0.5);
    
    shuffleIdx.forEach(idx => {
      nn.train(X_train[idx], y_train[idx], 0.01);
    });

    // Evaluate on synthetic validation scenarios
    const evalResults = evaluateSynthetic(nn, syntheticScenarios);
    
    // Run backtest over validation dataset for RELIANCE to compute Sharpe
    const relTest = testDataByTicker.RELIANCE;
    const backtestRes = runBacktest(relTest, nn, 'RELIANCE');
    
    const overallAcc = evalResults.sidewaysAcc + evalResults.bullAcc + evalResults.bearAcc;
    const score = overallAcc + backtestRes.sharpe * 10;

    // Check target conditions:
    // - Sideways HOLD accuracy > 80%
    // - Bull BUY accuracy > 80%
    // - Bear SELL accuracy > 80%
    // - Sharpe ratio is positive/stable
    const criteriaMet = evalResults.sidewaysAcc >= 80 && 
                        evalResults.bullAcc >= 80 && 
                        evalResults.bearAcc >= 80 &&
                        backtestRes.sharpe > 0.0;

    if (score > bestScore) {
      bestScore = score;
      optimalWeights = {
        w1: nn.w1,
        b1: nn.b1,
        w2: nn.w2,
        b2: nn.b2,
        w3: nn.w3,
        b3: nn.b3,
        inputDim: 17,
        h1: 32,
        h2: 16,
        outputDim: 3
      };
      if (criteriaMet) {
        targetMet = true;
      }
    }

    if (epoch % 10 === 0 || criteriaMet) {
      console.log(`Epoch ${epoch} | Sideways HOLD: ${evalResults.sidewaysAcc.toFixed(1)}% | Bull BUY: ${evalResults.bullAcc.toFixed(1)}% | Bear SELL: ${evalResults.bearAcc.toFixed(1)}% | RELIANCE Sharpe: ${backtestRes.sharpe.toFixed(2)}`);
      if (criteriaMet) {
        console.log('✅ Optimization thresholds met successfully!');
        break;
      }
    }
  }

  // 6. Train baselines for benchmarking
  console.log('\nTraining GBDT and Random Forest baselines...');
  rf.train(X_train, y_train);
  gbdt.train(X_train, y_train);

  // 7. Final Backtesting & Performance Report
  console.log('\nGenerating backtesting performance comparisons (Last 2 years)...');
  
  // Set up optimal weights to neural net for final evaluation
  nn.w1 = optimalWeights.w1; nn.b1 = optimalWeights.b1;
  nn.w2 = optimalWeights.w2; nn.b2 = optimalWeights.b2;
  nn.w3 = optimalWeights.w3; nn.b3 = optimalWeights.b3;

  // Let's run backtests on RELIANCE for all architectures
  const relianceTest = testDataByTicker.RELIANCE;
  const finalNN = runBacktest(relianceTest, nn, 'RELIANCE');
  const finalRF = runBacktest(relianceTest, rf, 'RELIANCE');
  const finalGBDT = runBacktest(relianceTest, gbdt, 'RELIANCE');

  // Benchmark Buy & Hold RELIANCE
  const bhRelReturn = (relianceTest[relianceTest.length - 1].close - relianceTest[0].close) / relianceTest[0].close;
  const bhRelFinalVal = 100000.0 * (1 + bhRelReturn);
  
  // Benchmark Buy & Hold NIFTY
  const niftyTest = rawData.NIFTY.slice(rawData.NIFTY.length - relianceTest.length);
  const bhNiftyReturn = (niftyTest[niftyTest.length - 1].close - niftyTest[0].close) / niftyTest[0].close;
  const bhNiftyFinalVal = 100000.0 * (1 + bhNiftyReturn);

  // Create daily returns for Nifty / Reliance Buy & Hold
  const bhNiftyDaily = [];
  for (let i = 1; i < niftyTest.length; i++) {
    bhNiftyDaily.push((niftyTest[i].close - niftyTest[i - 1].close) / niftyTest[i - 1].close);
  }
  const bhRelDaily = [];
  for (let i = 1; i < relianceTest.length; i++) {
    bhRelDaily.push((relianceTest[i].close - relianceTest[i - 1].close) / relianceTest[i - 1].close);
  }

  // Calculate Excess returns and Information Ratio vs Nifty 50 Buy & Hold
  const irNifty = calculateAlphaMetrics(finalNN.dailyReturns, bhNiftyDaily);
  const irRel = calculateAlphaMetrics(finalNN.dailyReturns, bhRelDaily);

  // Synthetic validations final count
  const finalSynthetic = evaluateSynthetic(nn, syntheticScenarios);

  console.log('\n--- MODEL COMPARISON TABLE ---');
  console.log('Model | Total Trades | Win Rate % | Profit Factor | Max Drawdown % | Sharpe Ratio | Sortino Ratio | CAGR % | Final Value');
  console.log('---|---|---|---|---|---|---|---|---');
  console.log(`Neural Net (17x32x16x3) | ${finalNN.totalTrades} | ${finalNN.winRate.toFixed(1)}% | ${finalNN.profitFactor.toFixed(2)} | ${finalNN.maxDrawdown.toFixed(1)}% | ${finalNN.sharpe.toFixed(2)} | ${finalNN.sortino.toFixed(2)} | ${finalNN.cagr.toFixed(1)}% | ₹${finalNN.finalValue.toFixed(2)}`);
  console.log(`Random Forest | ${finalRF.totalTrades} | ${finalRF.winRate.toFixed(1)}% | ${finalRF.profitFactor.toFixed(2)} | ${finalRF.maxDrawdown.toFixed(1)}% | ${finalRF.sharpe.toFixed(2)} | ${finalRF.sortino.toFixed(2)} | ${finalRF.cagr.toFixed(1)}% | ₹${finalRF.finalValue.toFixed(2)}`);
  console.log(`Gradient Boosted GBDT | ${finalGBDT.totalTrades} | ${finalGBDT.winRate.toFixed(1)}% | ${finalGBDT.profitFactor.toFixed(2)} | ${finalGBDT.maxDrawdown.toFixed(1)}% | ${finalGBDT.sharpe.toFixed(2)} | ${finalGBDT.sortino.toFixed(2)} | ${finalGBDT.cagr.toFixed(1)}% | ₹${finalGBDT.finalValue.toFixed(2)}`);
  
  console.log('\n--- BENCHMARK PERFORMANCE COMPARISON ---');
  console.log('Strategy | Total Return % | Final Portfolio Value');
  console.log('---|---|---');
  console.log(`Optimized Neural Net | ${(totalReturnVal = (finalNN.finalValue - 100000.0) / 1000).toFixed(2)}% | ₹${finalNN.finalValue.toFixed(2)}`);
  console.log(`Buy & Hold NIFTY 50 | ${(bhNiftyReturn * 100).toFixed(2)}% | ₹${bhNiftyFinalVal.toFixed(2)}`);
  console.log(`Buy & Hold RELIANCE | ${(bhRelReturn * 100).toFixed(2)}% | ₹${bhRelFinalVal.toFixed(2)}`);

  console.log('\n--- ALPHA MEASUREMENT & DETECTION ---');
  console.log(`• Excess return over NIFTY 50: ${irNifty.excessReturnPct.toFixed(2)}%`);
  console.log(`• Excess return over RELIANCE: ${irRel.excessReturnPct.toFixed(2)}%`);
  console.log(`• Information Ratio vs NIFTY 50: ${irNifty.informationRatio.toFixed(3)}`);
  console.log(`• Information Ratio vs RELIANCE: ${irRel.informationRatio.toFixed(3)}`);

  console.log('\n--- SYNTHETIC SCENARIOS VALIDATION ---');
  console.log(`• Sideways market HOLD accuracy: ${finalSynthetic.sidewaysAcc.toFixed(1)}%`);
  console.log(`• Bullish trend BUY accuracy: ${finalSynthetic.bullAcc.toFixed(1)}%`);
  console.log(`• Bearish trend SELL accuracy: ${finalSynthetic.bearAcc.toFixed(1)}%`);
  console.log(`• Misclassifications reported: ${finalSynthetic.misclassifications.length}`);
  finalSynthetic.misclassifications.slice(0, 5).forEach((m, idx) => {
    console.log(`  [${idx + 1}] Bias: ${m.scenario} (Softmax: [BUY=${(m.probs[0]*100).toFixed(1)}%, SELL=${(m.probs[1]*100).toFixed(1)}%, HOLD=${(m.probs[2]*100).toFixed(1)}%])`);
  });

  // 8. Persist the final optimal weights to the Neon PostgreSQL database
  console.log('\nWriting optimal calibrated weights back to PostgreSQL model_weights table...');
  try {
    const defaultWeights = {
      agent1_weight: 0.35,
      agent2_weight: 0.25,
      agent3_weight: 0.20,
      agent4_weight: 0.20,
      emaWeight: 0.4,
      rsiWeight: 0.3,
      macdWeight: 0.3,
      rsiThreshold: 50,
      adaptationCount: 1,
      neural_model_weights: optimalWeights
    };
    
    await db.updatePortfolioState({
      model_weights: defaultWeights
    });
    console.log('✅ Success: Optimal weights persisted successfully to database!');
  } catch (dbErr) {
    console.error('Error writing weights to database:', dbErr.message);
  }

  // 9. Feature Importance ranking
  console.log('\n--- FEATURE IMPORTANCE AUDIT (OPTIMIZED NETWORK) ---');
  const featureNames = [
    'Stock Momentum', 'Nifty Momentum', 'VIX Return', 'Volume Spike Score',
    'RSI (14)', 'MACD Hist', 'ATR (14)', 'EMA9 Dist', 'EMA21 Dist', 'EMA50 Dist',
    'VWAP Distance', 'Bollinger Position', 'ADX (14)', 'Relative Strength vs Nifty',
    'Sector Momentum', 'Gap %', 'Intraday Volatility'
  ];

  const rankings = featureNames.map((name, idx) => {
    const absSum = optimalWeights.w1[idx].reduce((sum, val) => sum + Math.abs(val), 0);
    return { name, value: absSum };
  }).sort((a, b) => b.value - a.value);

  console.log('Rank | Feature Name | Contribution Weight');
  console.log('---|---|---');
  rankings.forEach((r, idx) => {
    console.log(`${idx + 1} | ${r.name} | ${r.value.toFixed(4)}`);
  });

  // Export report json
  fs.writeFileSync(path.join(__dirname, 'audit_report.json'), JSON.stringify({
    finalNN,
    finalRF,
    finalGBDT,
    bhNiftyReturn,
    bhRelReturn,
    irNifty,
    irRel,
    finalSynthetic,
    rankings
  }, null, 2));
}

main().then(() => {
  // Let the connection pool gracefully terminate
  process.exit(0);
}).catch(err => {
  console.error(err);
  process.exit(1);
});
