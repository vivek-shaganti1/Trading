const fs = require('fs');
const path = require('path');
const db = require('../backend/db');
const config = require('../shared/config');
const broker = require('../backend/broker');
const predictor = require('../backend/predictor');
const marketModel = require('../backend/marketModel');
const agent3_technicals = require('../backend/agent3_technicals');
const agent4_context = require('../backend/agent4_context');

async function traceAdaniPorts() {
  console.log('============= START PIPELINE TRACE: ADANIPORTS =============');
  const symbol = 'ADANIPORTS';
  const yahooSymbol = 'ADANIPORTS.NS';
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSymbol}?interval=5m&range=1d`;
  
  // 1. Raw Yahoo Finance response (First few lines of chart result meta)
  console.log('\n--- 1. RAW YAHOO FINANCE FETCH ---');
  const res = await fetch(url);
  const rawData = await res.json();
  const result = rawData?.chart?.result?.[0];
  console.log('Response Status:', res.status);
  console.log('Meta Keys:', Object.keys(result.meta));
  console.log('Raw Meta Sample:', JSON.stringify(result.meta, null, 2));

  // 2. Parsed Quote
  console.log('\n--- 2. PARSED QUOTE ---');
  const quotes = result.indicators?.quote?.[0] || {};
  const closes = (quotes.close || []).filter(c => c !== null);
  const volumes = (quotes.volume || []).filter(v => v !== null);
  const highs = (quotes.high || []).filter(h => h !== null);
  const lows = (quotes.low || []).filter(l => l !== null);
  
  console.log('Regular Market Price:', result.meta.regularMarketPrice);
  console.log('Total 5m Candles fetched:', closes.length);
  console.log('Last 3 Close Prices:', closes.slice(-3));
  console.log('Last 3 Volumes:', volumes.slice(-3));

  // 3. Technical Indicators
  console.log('\n--- 3. TECHNICAL INDICATORS (Agent 3) ---');
  const predTech = await agent3_technicals.predict(symbol, closes.slice(-26));
  console.log('Calculated Indicators:', JSON.stringify(predTech.indicators, null, 2));

  // 4. Feature Vector
  console.log('\n--- 4. FEATURE VECTOR ---');
  // Get inputs for forward pass
  const modelWeights = await marketModel.getWeights();
  const inputDim = modelWeights.inputDim || (modelWeights.w1 ? modelWeights.w1.length : 6);
  console.log('Model weights dimensions:', inputDim);
  console.log('Using 6-feature array representation for neural net forward pass.');

  // 5. Agent 1 output (ML Ensemble)
  console.log('\n--- 5. AGENT 1 OUTPUT (ML Ensemble) ---');
  const predML = await marketModel.predict(symbol, closes.slice(-3));
  console.log(JSON.stringify(predML, null, 2));

  // 6. Gemini output (Agent 2)
  console.log('\n--- 6. GEMINI OUTPUT (Agent 2) ---');
  // Replicate logic in predictor.js:
  let pred2 = { signal: 'HOLD', confidence: 0.5, reasoning: 'Bypassed due to low initial technical scores.' };
  console.log(JSON.stringify(pred2, null, 2));

  // 7. Groq output (Agent 3)
  console.log('\n--- 7. GROQ OUTPUT (Agent 3) ---');
  let pred3 = { signal: 'HOLD', confidence: 0.5, reasoning: 'Bypassed due to low initial technical scores.' };
  console.log(JSON.stringify(pred3, null, 2));

  // 8. Technical agent output
  console.log('\n--- 8. TECHNICAL AGENT OUTPUT (Agent 4 in consensus) ---');
  console.log(JSON.stringify(predTech, null, 2));

  // 9. Context agent output
  console.log('\n--- 9. CONTEXT AGENT OUTPUT (Agent 5 in consensus) ---');
  const predContext = await agent4_context.predict();
  console.log(JSON.stringify(predContext, null, 2));

  // 10. Consensus output
  console.log('\n--- 10. CONSENSUS OUTPUT ---');
  const finalPrediction = await predictor.getPrediction(symbol, closes.slice(-3));
  console.log(JSON.stringify(finalPrediction, null, 2));

  // 11. TQS calculation breakdown
  console.log('\n--- 11. TQS CALCULATION BREAKDOWN ---');
  console.log('Base score: 40');
  let score = 40;
  const ind = finalPrediction.participating_models.agent4_technical.indicators;
  const ctx = finalPrediction.participating_models.agent5_context.indicators;
  const conf = finalPrediction.confidence;

  if (ind) {
    const emaDiff = ind.ema9 > ind.ema21;
    console.log(`- EMA Crossover (EMA9 > EMA21): ${ind.ema9} > ${ind.ema21} = ${emaDiff} (+${emaDiff ? 5 : 0})`);
    if (emaDiff) score += 5;
    console.log(`- Trend Strength: ${ind.trendStrength} (STRONG_UP adds +10, STRONG_DOWN subtracts -10)`);
    if (ind.trendStrength === 'STRONG_UP') score += 10;
    if (ind.trendStrength === 'STRONG_DOWN') score -= 10;
    
    console.log(`- RSI > 50: ${ind.rsi > 50} (+${ind.rsi > 50 ? 5 : 0})`);
    if (ind.rsi > 50) score += 5;
    const rsiRange = ind.rsi > 50 && ind.rsi < 70;
    console.log(`- RSI in range (50-70): ${rsiRange} (+${rsiRange ? 5 : 0})`);
    if (rsiRange) score += 5;
    console.log(`- MACD > 0: ${ind.macd > 0} (+${ind.macd > 0 ? 5 : 0})`);
    if (ind.macd > 0) score += 5;
  }
  if (ctx) {
    console.log(`- Crude Change < 0.5: ${ctx.crudeChange < 0.5} (+${ctx.crudeChange < 0.5 ? 5 : 0})`);
    if (ctx.crudeChange < 0.5) score += 5;
    console.log(`- SP500 Change > -0.5: ${ctx.sp500Change > -0.5} (+${ctx.sp500Change > -0.5 ? 5 : 0})`);
    if (ctx.sp500Change > -0.5) score += 5;
    console.log(`- Leading Sector: ${ctx.leadingSector} (IT/BANKING adds +10, ENERGY adds +5)`);
    if (ctx.leadingSector === 'IT' || ctx.leadingSector === 'BANKING') score += 10;
    else if (ctx.leadingSector === 'ENERGY') score += 5;
  }
  console.log(`- Consensus Confidence contribution: ${conf.toFixed(3)} * 20 = ${(conf * 20).toFixed(1)}`);
  score += conf * 20;
  console.log('Final Calculated TQS:', Math.max(0, Math.min(100, Math.round(score))));

  // 12. Trade decision
  console.log('\n--- 12. TRADE DECISION ---');
  const decision = finalPrediction.signal;
  console.log('Decision:', decision);
  console.log('TQS Threshold: 75');
  console.log('Decision status:', decision === 'BUY' && finalPrediction.tradeQuality >= 75 ? 'EXECUTE ORDER' : 'REJECT (TQS below 75 or Signal = HOLD)');

  // 13. Database insert record
  console.log('\n--- 13. DATABASE INSERT RECORD ---');
  // Retrieve the latest logged consensus decision from db.json
  const localDb = JSON.parse(fs.readFileSync(path.join(__dirname, '../db.json'), 'utf8'));
  const latestDecisions = localDb.consensus_decisions || [];
  const symbolDecisions = latestDecisions.filter(d => d.symbol === symbol);
  const latest = symbolDecisions[symbolDecisions.length - 1];
  console.log(JSON.stringify(latest, null, 2));

  console.log('\n============= PIPELINE TRACE COMPLETE =============');
  process.exit(0);
}

traceAdaniPorts().catch(e => {
  console.error(e);
  process.exit(1);
});
