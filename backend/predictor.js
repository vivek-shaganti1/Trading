const db = require('./db');
const { withResilience } = require('./resilience');
const config = require('../shared/config');
const broker = require('./broker');
const marketModel = require('./marketModel');
const agent3_technicals = require('./agent3_technicals');
const agent4_context = require('./agent4_context');
const dynamicThreshold = require('./dynamicThreshold');
const runtimeState = require('./runtimeState');
const priceActionAgent = require('./priceActionStructureAgent');
const confidenceEngine = require('./confidenceEngine');
const institutionalConfluenceEngine = require('./institutionalConfluenceEngine');
const marketRegimeAgent = require('./marketRegimeAgent');
const volumeIntelligenceAgent = require('./volumeIntelligenceAgent');
const smcAgent = require('./smcAgent');
const marketData = require('./marketData');
const candleScoringEngine = require('./candleScoringEngine');
const setupPerformanceEngine = require('./setupPerformanceEngine');
const adaptiveDecisionEngine = require('./adaptiveDecisionEngine');
const marketStateClassifier = require('./marketStateClassifier');
const marketStructureHierarchy = require('./marketStructureHierarchy');
const bayesianConfidenceEngine = require('./bayesianConfidenceEngine');
const stopTargetEngine = require('./stopTargetEngine');



let lastPredictionState = null;

// Leaderboard and accountability scores updated to target weights (Section 2)
let agentLeaderboard = {
  1: { name: 'Agent 1: ML Ensemble', profitContribution: 0.0, lossContribution: 0.0, actualProfitContribution: 0.0, actualLossContribution: 0.0, todayProfitContribution: 0.0, todayLossContribution: 0.0, sharpeContribution: 0.0, drawdownContribution: 0.0, weight: 0.15 },
  2: { name: 'Agent 2: Historical Analog', profitContribution: 0.0, lossContribution: 0.0, actualProfitContribution: 0.0, actualLossContribution: 0.0, todayProfitContribution: 0.0, todayLossContribution: 0.0, sharpeContribution: 0.0, drawdownContribution: 0.0, weight: 0.08 }, // Historical Analog / Gemini (LLM combined fallback)
  3: { name: 'Agent 3: Groq LLM Fallback', profitContribution: 0.0, lossContribution: 0.0, actualProfitContribution: 0.0, actualLossContribution: 0.0, todayProfitContribution: 0.0, todayLossContribution: 0.0, sharpeContribution: 0.0, drawdownContribution: 0.0, weight: 0.00 }, // Groq (0% weight)
  4: { name: 'Agent 4: Technical indicators', profitContribution: 0.0, lossContribution: 0.0, actualProfitContribution: 0.0, actualLossContribution: 0.0, todayProfitContribution: 0.0, todayLossContribution: 0.0, sharpeContribution: 0.0, drawdownContribution: 0.0, weight: 0.00 }, // Technical indicators (0% weight)
  5: { name: 'Agent 5: Context Engine', profitContribution: 0.0, lossContribution: 0.0, actualProfitContribution: 0.0, actualLossContribution: 0.0, todayProfitContribution: 0.0, todayLossContribution: 0.0, sharpeContribution: 0.0, drawdownContribution: 0.0, weight: 0.10 }, // Context Engine (10%)
  6: { name: 'Agent 6: Regime Agent', profitContribution: 0.0, lossContribution: 0.0, actualProfitContribution: 0.0, actualLossContribution: 0.0, todayProfitContribution: 0.0, todayLossContribution: 0.0, sharpeContribution: 0.0, drawdownContribution: 0.0, weight: 0.12 }, // Market Regime (12%)
  7: { name: 'Agent 7: Risk Manager', profitContribution: 0.0, lossContribution: 0.0, actualProfitContribution: 0.0, actualLossContribution: 0.0, todayProfitContribution: 0.0, todayLossContribution: 0.0, sharpeContribution: 0.0, drawdownContribution: 0.0, weight: 0.15 }, // Risk Manager (15%)
  9: { name: 'Agent 9: Breadth Engine', profitContribution: 0.0, lossContribution: 0.0, actualProfitContribution: 0.0, actualLossContribution: 0.0, todayProfitContribution: 0.0, todayLossContribution: 0.0, sharpeContribution: 0.0, drawdownContribution: 0.0, weight: 0.08 }, // Breadth Engine (8%)
  10: { name: 'Agent 10: Volume Intelligence', profitContribution: 0.0, lossContribution: 0.0, actualProfitContribution: 0.0, actualLossContribution: 0.0, todayProfitContribution: 0.0, todayLossContribution: 0.0, sharpeContribution: 0.0, drawdownContribution: 0.0, weight: 0.10 }, // Volume Intelligence (10%)
  11: { name: 'Agent 11: Price Action Structure', profitContribution: 0.0, lossContribution: 0.0, actualProfitContribution: 0.0, actualLossContribution: 0.0, todayProfitContribution: 0.0, todayLossContribution: 0.0, sharpeContribution: 0.0, drawdownContribution: 0.0, weight: 0.10 }, // Price Action Structure (10%)
  12: { name: 'Agent 12: Smart Money Agent', profitContribution: 0.0, lossContribution: 0.0, actualProfitContribution: 0.0, actualLossContribution: 0.0, todayProfitContribution: 0.0, todayLossContribution: 0.0, sharpeContribution: 0.0, drawdownContribution: 0.0, weight: 0.12 } // SMC Agent (12%)
};

async function callGemini(symbol, ltp, pred1, pred4, pred5) {
  if (!config.GEMINI_API_KEY) {
    return runGeminiFallback(symbol, pred4?.indicators);
  }
  const model = 'gemini-2.0-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.GEMINI_API_KEY}`;
  
  const prompt = `
    You are the External AI Analysis Layer (Agent 2) of a quant trading platform.
    Analyze the trade signals and reasoning from three other specialized agents for ${symbol} at current price Rs ${ltp}:
    
    Agent 1 (Custom Internal Model):
    - Recommended Signal: ${pred1.signal}
    - Reasoning: ${pred1.reasoning || ''}
    
    Agent 4 (Technical Analysis Engine):
    - Recommended Signal: ${pred4.signal}
    - Reasoning: ${pred4.reasoning || ''}
    
    Agent 5 (Market Context Engine):
    - Recommended Signal: ${pred5.signal}
    - Reasoning: ${pred5.reasoning || ''}
    
    Your role:
    1. Provide an independent External AI trading decision (BUY, SELL, or HOLD) based on their signals, index direction, volatility, and global macro trends.
    2. Act as the Debate Moderator. Debate their outputs, challenge any weak logic, and output a debate summary explaining which signals were discarded and why.
    
    Respond strictly in JSON format matching this schema:
    {
      "signal": "BUY" | "SELL" | "HOLD",
      "confidence": float (0.0 to 1.0),
      "debate_summary": "detailed explanation of signal challenge and resolution"
    }
  `;

  const startTime = Date.now();
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000); // 8 second timeout
    const response = await withResilience('gemini', async () => await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }]
      }),
      signal: controller.signal
    }), 3, 1000);
    clearTimeout(timeoutId);

    if (response.ok) {
      const latencyMs = Date.now() - startTime;
      runtimeState.updateProviderHealth('Gemini', startTime, true, '200 OK');
      runtimeState.updateProviderHealth('gemini', latencyMs, true);
      const resData = await response.json();
      const text = resData?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const cleanJson = text.replace(/```json/g, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(cleanJson);
      return {
        signal: parsed.signal || 'HOLD',
        confidence: Number(parsed.confidence) || 0.5,
        reasoning: parsed.debate_summary || 'Gemini dynamic analysis'
      };
    } else {
      const latencyMs = Date.now() - startTime;
      runtimeState.updateProviderHealth('Gemini', startTime, false, `Status ${response.status}`);
      runtimeState.updateProviderHealth('gemini', latencyMs, false);
    }
  } catch (err) {
    const latencyMs = Date.now() - startTime;
    runtimeState.updateProviderHealth('Gemini', startTime, false, err.message);
    runtimeState.updateProviderHealth('gemini', latencyMs, false);
    console.warn(`[GEMINI API] Failed: ${err.message}. Running fallback...`);
  }
  return runGeminiFallback(symbol, pred4?.indicators);
}

function runGeminiFallback(symbol, indicators) {
  let signal = 'HOLD';
  let confidence = 0.5;
  let reason = 'Gemini offline - Technical fallback applied.';
  if (indicators) {
    if (indicators.rsi > 53 && indicators.ema9 > indicators.ema21) {
      signal = 'BUY';
      confidence = 0.72;
      reason += ' Momentum positive (RSI > 53, EMA Bullish crossover).';
    } else if (indicators.rsi < 47 && indicators.ema9 < indicators.ema21) {
      signal = 'SELL';
      confidence = 0.72;
      reason += ' Momentum negative (RSI < 47, EMA Bearish crossover).';
    } else {
      reason += ' Volatility ranging, maintaining neutral stance.';
    }
  }
  return { signal, confidence, reasoning: reason };
}

async function callGroq(symbol, ltp, pred1, pred4, pred5) {
  if (!config.GROQ_API_KEY) {
    return runGroqFallback(symbol, pred4?.indicators);
  }
  const model = 'llama-3.3-70b-versatile';
  const url = 'https://api.groq.com/openai/v1/chat/completions';
  
  const prompt = `
    You are the External AI Analysis Layer (Agent 3) of a quant trading platform.
    Analyze the trade signals and reasoning from three other specialized agents for ${symbol} at current price Rs ${ltp}:
    
    Agent 1 (Custom Internal Model):
    - Recommended Signal: ${pred1.signal}
    - Reasoning: ${pred1.reasoning || ''}
    
    Agent 4 (Technical Analysis Engine):
    - Recommended Signal: ${pred4.signal}
    - Reasoning: ${pred4.reasoning || ''}
    
    Agent 5 (Market Context Engine):
    - Recommended Signal: ${pred5.signal}
    - Reasoning: ${pred5.reasoning || ''}
    
    Your role:
    1. Provide an independent External AI trading decision (BUY, SELL, or HOLD) based on technical setup, macroeconomic context, and volume/momentum.
    2. Respond strictly in JSON format matching this schema:
    {
      "signal": "BUY" | "SELL" | "HOLD",
      "confidence": float (0.0 to 1.0),
      "debate_summary": "detailed explanation of decision"
    }
  `;

  const startTime = Date.now();
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000); // 8 second timeout
    const response = await withResilience('groq', async () => await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: model,
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        temperature: 0.1
      }),
      signal: controller.signal
    }), 3, 1000);
    clearTimeout(timeoutId);

    if (response.ok) {
      runtimeState.updateProviderHealth('Groq', startTime, true, '200 OK');
      const resData = await response.json();
      const text = resData?.choices?.[0]?.message?.content || '';
      const parsed = JSON.parse(text);
      return {
        signal: parsed.signal || 'HOLD',
        confidence: Number(parsed.confidence) || 0.5,
        reasoning: parsed.debate_summary || 'Groq dynamic analysis'
      };
    } else {
      runtimeState.updateProviderHealth('Groq', startTime, false, `Status ${response.status}`);
    }
  } catch (err) {
    runtimeState.updateProviderHealth('Groq', startTime, false, err.message);
    console.warn(`[GROQ API] Failed: ${err.message}. Running fallback...`);
  }
  return runGroqFallback(symbol, pred4?.indicators);
}

function runGroqFallback(symbol, indicators) {
  let signal = 'HOLD';
  let confidence = 0.5;
  let reason = 'Groq offline - Technical fallback applied.';
  if (indicators) {
    if (indicators.macd > 0 && indicators.rsi > 50) {
      signal = 'BUY';
      confidence = 0.75;
      reason += ' Trend bullish (MACD positive, RSI > 50).';
    } else if (indicators.macd < 0 && indicators.rsi < 50) {
      signal = 'SELL';
      confidence = 0.75;
      reason += ' Trend bearish (MACD negative, RSI < 50).';
    } else {
      reason += ' Ranging/unclear trend, neutral stance.';
    }
  }
  return { signal, confidence, reasoning: reason };
}

function calculateEMA(array, period) {
  if (!array || array.length < period) return array[array.length - 1] || 0;
  let ema = array[0];
  const k = 2 / (period + 1);
  for (let i = 1; i < array.length; i++) {
    ema = array[i] * k + ema * (1 - k);
  }
  return ema;
}

const predictor = {
  getLeaderboard() {
    return agentLeaderboard;
  },

  async loadLeaderboardFromDb() {
    console.log('[PREDICTOR] Checking for persistent trust weights in database...');
    const portfolio = await db.getPortfolioState();
    if (portfolio && portfolio.model_weights && portfolio.model_weights.neural_model_weights && portfolio.model_weights.neural_model_weights.leaderboard_state) {
      const saved = portfolio.model_weights.neural_model_weights.leaderboard_state;
      Object.keys(agentLeaderboard).forEach(id => {
        if (saved[id]) {
          agentLeaderboard[id].profitContribution = Number(saved[id].profitContribution || 0);
          agentLeaderboard[id].lossContribution = Number(saved[id].lossContribution || 0);
          agentLeaderboard[id].actualProfitContribution = Number(saved[id].actualProfitContribution || 0);
          agentLeaderboard[id].actualLossContribution = Number(saved[id].actualLossContribution || 0);
          agentLeaderboard[id].todayProfitContribution = Number(saved[id].todayProfitContribution || 0);
          agentLeaderboard[id].todayLossContribution = Number(saved[id].todayLossContribution || 0);
          agentLeaderboard[id].sharpeContribution = Number(saved[id].sharpeContribution || 0);
          agentLeaderboard[id].drawdownContribution = Number(saved[id].drawdownContribution || 0);
          agentLeaderboard[id].weight = Number(saved[id].weight || 0.1);
        }
      });
      console.log('[PREDICTOR] Persistent trust weights loaded from database.');
    }
    
    // Dynamically calculate actual agent performance metrics from Neon DB completed trades
    console.log('[PREDICTOR] Re-calculating database-driven real agent attribution...');
    await this.recalculateRealAttribution();
  },

  async getModelWeights() {
    const portfolio = await db.getPortfolioState();
    const activeWeights = {};
    Object.keys(agentLeaderboard).forEach(id => {
      activeWeights[`agent${id}_weight`] = agentLeaderboard[id].weight;
    });
    
    // Force active weights to strictly follow the Section 2 distribution and override any DB states
    activeWeights.agent1_weight = 0.15;
    activeWeights.agent2_weight = 0.08;
    activeWeights.agent3_weight = 0.00;
    activeWeights.agent4_weight = 0.00;
    activeWeights.agent5_weight = 0.10;
    activeWeights.agent6_weight = 0.12;
    activeWeights.agent7_weight = 0.15;
    activeWeights.agent9_weight = 0.08;
    activeWeights.agent10_weight = 0.10;
    activeWeights.agent11_weight = 0.10;
    activeWeights.agent12_weight = 0.12;

    if (portfolio.model_weights) {
      activeWeights.emaWeight = portfolio.model_weights.emaWeight || 0.40;
      activeWeights.rsiWeight = portfolio.model_weights.rsiWeight || 0.30;
      activeWeights.macdWeight = portfolio.model_weights.macdWeight || 0.30;
      activeWeights.rsiThreshold = portfolio.model_weights.rsiThreshold || 50;
      activeWeights.adaptationCount = portfolio.model_weights.adaptationCount || 0;
    } else {
      activeWeights.emaWeight = 0.40;
      activeWeights.rsiWeight = 0.30;
      activeWeights.macdWeight = 0.30;
      activeWeights.rsiThreshold = 50;
      activeWeights.adaptationCount = 0;
    }
    return activeWeights;
  },

  // Calculate Trade Quality Score (0-100) based on all dimensions
  calculateTradeQualityScore(indicators, context, consensusConfidence) {
    let score = 40; // Base score

    if (indicators) {
      // 1. Trend alignment (Max +15)
      if (indicators.ema9 > indicators.ema21) score += 5;
      if (indicators.trendStrength === 'STRONG_UP') score += 10;
      if (indicators.trendStrength === 'STRONG_DOWN') score -= 10;

      // 2. Momentum strength (Max +15)
      if (indicators.rsi > 50) score += 5;
      if (indicators.rsi > 50 && indicators.rsi < 70) score += 5;
      if (indicators.macd > 0) score += 5;
    }

    if (context) {
      // 3. Volatility / Macro (Max +10)
      if (context.crudeChange < 0.5) score += 5;
      if (context.sp500Change > -0.5) score += 5;

      // 4. Sector Rotation (Max +10)
      if (context.leadingSector === 'IT' || context.leadingSector === 'BANKING') {
        score += 10;
      } else if (context.leadingSector === 'ENERGY') {
        score += 5;
      }
    }

    // 5. Consensus Agreement (Max +20)
    score += (consensusConfidence || 0.5) * 20;

    return Math.max(0, Math.min(100, Math.round(score)));
  },

  // Calculate pre-trade expected return and risk vector
  calculateExpectancy(winRate, avgWin, lossRate, avgLoss) {
    return (winRate * avgWin) - (lossRate * avgLoss);
  },

  async getPrediction(symbol, closes) {
    let ltp = 0;
    try {
      ltp = closes && closes.length > 0 ? closes[closes.length - 1] : broker.getLTP(symbol);
    } catch (e) {}
    if (!ltp || ltp <= 0) {
      ltp = (symbol.charCodeAt(0) * 10) % 1500 + 100;
    }
    const weights = await this.getModelWeights();

    // 1. Fetch MTF histories for Multi-Timeframe Confluence (Section 4)
    let d1History, h1History, m15History, m5History, m1History;
    try {
      [d1History, h1History, m15History, m5History, m1History] = await Promise.all([
        marketData.getHistory(symbol, [], '1d', '3mo'),
        marketData.getHistory(symbol, [], '1h', '5d'),
        marketData.getHistory(symbol, [], '15m', '5d'),
        marketData.getHistory(symbol, [], '5m', '5d'),
        marketData.getHistory(symbol, [], '1m', '1d')
      ]);
    } catch (err) {
      // Do NOT generate mock/random candles — random candles corrupt AI signals.
      // Rethrow so the calling pipeline can log the rejection and skip this symbol.
      console.warn(`[PREDICTOR] Market data unavailable for ${symbol}: ${err.message}. Skipping symbol.`);
      throw new Error(`Market data unavailable for ${symbol}: ${err.message}`);
    }

    // Helper: Map closes to candles
    function mapToCandles(history) {
      return history.closes.map((close, i) => ({
        open: i > 0 ? history.closes[i-1] : close,
        close,
        high: history.highs[i] || close,
        low: history.lows[i] || close,
        volume: history.volumes[i] || 1000
      }));
    }

    const candles1D = mapToCandles(d1History);
    const candles1H = mapToCandles(h1History);
    const candles15M = mapToCandles(m15History);
    const candles5M = mapToCandles(m5History);
    const candles1M = mapToCandles(m1History);

    // Compute Daily (1D) Trend Bias (50 EMA on daily closes)
    const ema50_1D = calculateEMA(d1History.closes, Math.min(50, d1History.closes.length));
    const trend1D = d1History.closes[d1History.closes.length - 1] > ema50_1D ? 'BUY' : 'SELL';

    // Compute Hourly (1H) Swing Structure Trend (EMA 9 vs EMA 21 on 1H closes)
    const ema9_1H = calculateEMA(h1History.closes, 9);
    const ema21_1H = calculateEMA(h1History.closes, 21);
    const trend1H = ema9_1H > ema21_1H ? 'BUY' : 'SELL';

    // Compute 15 Min Direction Trend (EMA 9 vs EMA 21 on 15M closes)
    const ema9_15M = calculateEMA(m15History.closes, 9);
    const ema21_15M = calculateEMA(m15History.closes, 21);
    const trend15M = ema9_15M > ema21_15M ? 'BUY' : 'SELL';

    // Compute 5 Min Entry Trend
    const ema9_5M = calculateEMA(m5History.closes, 9);
    const ema21_5M = calculateEMA(m5History.closes, 21);
    const trend5M = ema9_5M > ema21_5M ? 'BUY' : 'SELL';

    // Compute 1 Min Fine Execution Trend
    const ema9_1M = calculateEMA(m1History.closes, 9);
    const ema21_1M = calculateEMA(m1History.closes, 21);
    const trend1M = ema9_1M > ema21_1M ? 'BUY' : 'SELL';

    // Multi-Timeframe Alignment: majority voting across 5 timeframes
    // If 3+ timeframes agree on a direction, we have alignment
    const trendVotes = { BUY: 0, SELL: 0 };
    [trend1D, trend1H, trend15M, trend5M, trend1M].forEach(t => {
      if (t === 'BUY') trendVotes.BUY++;
      else if (t === 'SELL') trendVotes.SELL++;
    });
    const alignedMTF = trendVotes.BUY >= 3 ? 'BUY' : (trendVotes.SELL >= 3 ? 'SELL' : 'HOLD');

    // 2. Run core models in parallel for voting consensus
    const [pred1, pred4, pred5, pred11] = await Promise.all([
      marketModel.predict(symbol, m5History.closes),
      agent3_technicals.predict(symbol, m5History.closes),
      agent4_context.predict(),
      priceActionAgent.predict(symbol, m5History.closes)
    ]);

    const pred12 = smcAgent.predict(symbol, candles5M);

    const [pred2, pred3] = await Promise.all([
      callGemini(symbol, ltp, pred1, pred4, pred5),
      callGroq(symbol, ltp, pred1, pred4, pred5)
    ]);

    const adx = pred4.indicators?.trendStrength === 'STRONG_UP' || pred4.indicators?.trendStrength === 'STRONG_DOWN' ? 28 : 18;
    const regimeSignal = adx > 25 ? (pred4.indicators?.ema9 > pred4.indicators?.ema21 ? 'BUY' : 'SELL') : 'HOLD';
    const pred6 = { signal: regimeSignal, confidence: adx > 25 ? 0.82 : 0.60 };

    const isVixHigh = pred5.indicators?.sp500Change < -1.0;
    const riskSignal = isVixHigh ? 'SELL' : 'BUY';
    const riskConfidence = Math.min(0.95, Math.max(0.40, 0.85 - Math.abs(pred5.indicators?.sp500Change || 0) * 0.1));
    const pred7 = { signal: riskSignal, confidence: riskConfidence };

    const usdChangeAbs = Math.abs(pred5.indicators?.usdinrChange || 0);
    const breadthSignal = pred5.indicators?.usdinrChange < 0.2 ? 'BUY' : 'SELL';
    const breadthConfidence = Math.min(0.95, Math.max(0.40, 0.75 + (usdChangeAbs < 0.1 ? 0.15 : -0.1)));
    const pred9 = { signal: breadthSignal, confidence: breadthConfidence };

    const volumeStateData = volumeIntelligenceAgent.analyzeVolume(candles5M);
    const pred10 = { signal: volumeStateData.volumeState === 'VOLUME_CLIMAX' || volumeStateData.volumeState === 'EXPANSION' ? 'BUY' : (volumeStateData.volumeState === 'DISTRIBUTION' ? 'SELL' : 'HOLD'), confidence: volumeStateData.volumeScore / 100 };

    const allSignals = {
      1: pred1,
      2: pred2,
      3: pred3,
      4: pred4,
      5: pred5,
      6: pred6,
      7: pred7,
      9: pred9,
      10: pred10,
      11: pred11,
      12: pred12
    };

    // 3. Compute Hierarchical Market Structure & Swings
    const structureHierarchy = marketStructureHierarchy.computeHierarchy(candles5M);
    const lastPrice = m5History.closes[m5History.closes.length - 1];
    
    // 4. Advanced Market State Classifier
    const marketState = marketStateClassifier.classifyMarketState(candles5M, pred4.indicators, pred12);
    const mRegime = marketState.state.includes('TRENDING') ? 'TRENDING' : (marketState.state === 'MEAN_REVERSION' || marketState.state === 'RANGING' ? 'RANGING' : 'VOLATILE');
    const rConfidence = marketState.confidence;

    const swings5M = structureHierarchy.swings;
    const lastLow = swings5M.lows.length > 0 ? swings5M.lows[swings5M.lows.length - 1].price : lastPrice * 0.98;
    const isNearSwingLow = Math.abs(lastPrice - lastLow) / lastLow <= 0.005;

    const lastHigh = swings5M.highs.length > 0 ? swings5M.highs[swings5M.highs.length - 1].price : lastPrice * 1.02;
    const isNearSwingHigh = Math.abs(lastPrice - lastHigh) / lastHigh <= 0.005;

    // Get active session timing info
    let currentMins = 600; // default 10:00 AM IST
    try {
      const timeInfo = db.getSystemTime ? db.getSystemTime() : { hours: new Date().getHours(), minutes: new Date().getMinutes() };
      currentMins = timeInfo.hours * 60 + timeInfo.minutes;
    } catch (e) {}
    const isHighLiquiditySession = (currentMins >= 555 && currentMins <= 615) || (currentMins >= 870 && currentMins <= 930);

    // Compute EMA 21 and 50 on closes
    const closesM5 = candles5M.map(k => k.close);
    const ema50_5M = calculateEMA(closesM5, Math.min(50, closesM5.length));
    const avgVol = candles5M.slice(-20).reduce((sum, k) => sum + k.volume, 0) / 20;

    // Compute VWAP of current session
    let vwapValue = lastPrice;
    let sumPriceVol = 0;
    let sumVol = 0;
    const sessionCandles = candles5M.slice(-75);
    sessionCandles.forEach(k => {
      sumPriceVol += ((k.high + k.low + k.close) / 3) * k.volume;
      sumVol += k.volume;
    });
    if (sumVol > 0) vwapValue = sumPriceVol / sumVol;

    // Distances (percent format)
    const distVWAP = (lastPrice - vwapValue) / vwapValue * 100;
    const distEMA21 = (lastPrice - ema21_5M) / ema21_5M * 100;
    const distEMA50 = (lastPrice - ema50_5M) / ema50_5M * 100;

    // Calculate nearest Order Block (OB) and Fair Value Gap (FVG) from SMC data
    let closestOBPrice = lastPrice;
    let closestFVGPrice = lastPrice;

    const firstCandleColor = candles5M[candles5M.length - 3].close > candles5M[candles5M.length - 4].close ? 'GREEN' : 'RED';
    const secondCandleColor = candles5M[candles5M.length - 2].close > candles5M[candles5M.length - 3].close ? 'GREEN' : 'RED';
    if (firstCandleColor === 'RED' && secondCandleColor === 'GREEN') {
      closestOBPrice = candles5M[candles5M.length - 3].low;
    } else if (firstCandleColor === 'GREEN' && secondCandleColor === 'RED') {
      closestOBPrice = candles5M[candles5M.length - 3].high;
    }

    const lowsM5 = candles5M.map(k => k.low);
    const highsM5 = candles5M.map(k => k.high);
    if (lowsM5[candles5M.length - 1] > highsM5[candles5M.length - 3]) {
      closestFVGPrice = (lowsM5[candles5M.length - 1] + highsM5[candles5M.length - 3]) / 2;
    } else if (highsM5[candles5M.length - 1] < lowsM5[candles5M.length - 3]) {
      closestFVGPrice = (highsM5[candles5M.length - 1] + lowsM5[candles5M.length - 3]) / 2;
    }

    const distOB = (lastPrice - closestOBPrice) / closestOBPrice * 100;
    const distFVG = (lastPrice - closestFVGPrice) / closestFVGPrice * 100;

    // 5. Candle Context Assembly
    const candleContext = {
      trend: trend1H,
      isNearSwingLow,
      isNearSwingHigh,
      isNearLiquidityGrab: pred12.liquidityScore > 70,
      premiumDiscount: pred12.premiumDiscountScore > 60 ? 'PREMIUM' : (pred12.premiumDiscountScore < 40 ? 'DISCOUNT' : 'EQUILIBRIUM'),
      rvol: volumeStateData.rvol,
      isHighLiquiditySession,
      atr: candles5M.slice(-20).reduce((sum, k) => sum + (k.high - k.low), 0) / 20,
      distVWAP,
      distEMA21,
      distEMA50,
      distOB,
      distFVG
    };

    // 6. Candle pattern entry trigger on 5M (Context-Aware)
    const candleScoreDetails = candleScoringEngine.scoreSetup(candles5M, candleContext);
    const candlePattern = candleScoreDetails.pattern;
    const candleScore = candleScoreDetails.score;
    const candleCategory = candleScoreDetails.category;

    let triggerSignal = 'HOLD';
    const lastCandle = candles5M[candles5M.length - 1];
    const isBullishClose = lastCandle.close > lastCandle.open;
    const isBearishClose = lastCandle.close < lastCandle.open;

    if (['Morning Star', 'Bullish Engulfing', 'Hammer', 'Marubozu'].includes(candlePattern) || 
        (candlePattern === 'Pin Bar' && candleScoreDetails.reasoning.toLowerCase().includes('bullish')) ||
        (candlePattern === 'Outside Bar' && isBullishClose) ||
        (candlePattern === 'None' && candleCategory === 'Breakout' && isBullishClose)) {
      triggerSignal = 'BUY';
    } else if (['Evening Star', 'Bearish Engulfing', 'Shooting Star', 'Marubozu'].includes(candlePattern) || 
               (candlePattern === 'Pin Bar' && candleScoreDetails.reasoning.toLowerCase().includes('bearish')) ||
               (candlePattern === 'Outside Bar' && isBearishClose) ||
               (candlePattern === 'None' && candleCategory === 'Breakout' && isBearishClose)) {
      triggerSignal = 'SELL';
    } else if (candlePattern === 'None' && candleScore >= 55) {
      // No named pattern but a decent candle score — use close direction as trigger
      triggerSignal = isBullishClose ? 'BUY' : (isBearishClose ? 'SELL' : 'HOLD');
    }

    // Primary signal: price action trigger must align with MTF direction
    // If trigger is HOLD but MTF is aligned AND candle score is strong, use MTF direction
    let primarySignal = 'HOLD';
    if (alignedMTF === 'BUY' && (triggerSignal === 'BUY' || (triggerSignal === 'HOLD' && candleScore >= 60 && isBullishClose))) {
      primarySignal = 'BUY';
    } else if (alignedMTF === 'SELL' && (triggerSignal === 'SELL' || (triggerSignal === 'HOLD' && candleScore >= 60 && isBearishClose))) {
      primarySignal = 'SELL';
    } else if (triggerSignal !== 'HOLD' && trendVotes[triggerSignal] >= 2) {
      // Even without full MTF alignment, if the trigger matches 2+ timeframes, consider it
      primarySignal = triggerSignal;
    }

    let activeWeightSum = 0;
    Object.keys(allSignals).forEach(id => {
      const p = allSignals[id];
      if (!p.failed) activeWeightSum += weights[`agent${id}_weight`] || 0.1;
    });

    let buyWeight = 0, sellWeight = 0;
    let buyConfidenceSum = 0, sellConfidenceSum = 0;
    let buyWeightSum = 0, sellWeightSum = 0;
    let totalWeightedConfidence = 0;

    Object.keys(allSignals).forEach(id => {
      const p = allSignals[id];
      if (p.failed) return;
      const w = (weights[`agent${id}_weight`] || 0.1) / activeWeightSum;
      totalWeightedConfidence += p.confidence * w;

      if (p.signal === 'BUY') {
        buyWeight += w;
        buyConfidenceSum += p.confidence * w;
        buyWeightSum += w;
      } else if (p.signal === 'SELL') {
        sellWeight += w;
        sellConfidenceSum += p.confidence * w;
        sellWeightSum += w;
      }
    });

    let minConfidenceThresh = 0.55;
    let minConsensusWeight = 0.45;

    if (config.HIGH_OPPORTUNITY_MODE) {
      minConfidenceThresh = 0.50;
      minConsensusWeight = 0.40;
    }

    if (typeof global.tqsThresholdOffset !== 'undefined' && global.tqsThresholdOffset < 0) {
      minConfidenceThresh = Math.max(0.48, minConfidenceThresh - 0.05);
    }

    let weightedConfidence = totalWeightedConfidence;

    const buyConfidence = buyWeightSum > 0 ? buyConfidenceSum / buyWeightSum : 0;
    const sellConfidence = sellWeightSum > 0 ? sellConfidenceSum / sellWeightSum : 0;

    const smcState = pred12.bosType || 'None';

    // Calculate Dynamic stops and targets
    const stopsAndTargets = stopTargetEngine.calculateStopsAndTargets({
      direction: primarySignal !== 'HOLD' ? primarySignal : 'BUY',
      entryPrice: lastPrice,
      structure: structureHierarchy,
      smcData: pred12,
      atr: candleContext.atr
    });
    const rrVal = stopsAndTargets.riskReward;

    // Calculate Component Scores for Adaptive Decision
    const smcScore = (pred12.structureScore + pred12.bosScore + pred12.chochScore + pred12.liquidityScore + pred12.orderBlockScore + pred12.fvgScore + pred12.premiumDiscountScore) / 7;
    const volumeScore = volumeStateData.volumeScore;
    const structureScore = structureHierarchy.structureScore || 50;
    const regimeScore = mRegime === 'TRENDING' || mRegime === 'BULLISH' ? 100 : (mRegime === 'RANGING' ? 60 : 40);
    const rrScore = rrVal >= 2.0 ? 100 : (rrVal >= 1.5 ? 75 : (rrVal >= 1.0 ? 50 : 0));
    
    // Evaluate Setup performance expectations
    const expectancyEval = setupPerformanceEngine.evaluateSetup(candlePattern, mRegime, volumeStateData.volumeState, smcState);
    const expectancyScore = expectancyEval.expectancy > 0 ? 100 : 20;

    // Retrieve Setup memory statistics
    let setupConviction = 0.5;
    let setupStats = { conviction: 0.5, match_count: 0, reasoning: 'Default (no history)' };
    const dtResult = dynamicThreshold.getCurrentThreshold();
    const featureVector = {
      rsi: pred4.indicators?.rsi || 50,
      macd: pred4.indicators?.macd || 0,
      ema_dist: pred4.indicators ? (pred4.indicators.ema9 - pred4.indicators.ema21) : 0,
      sp500Change: pred5.indicators?.sp500Change || 0,
      usdinrChange: pred5.indicators?.usdinrChange || 0,
      crudeChange: pred5.indicators?.crudeChange || 0,
      leadingSector: pred5.indicators?.leadingSector || 'OTHER',
      regime: mRegime,
      volatility: dtResult.components?.volatility?.level || 'CALM'
    };

    try {
      const agentResearch = require('./agentResearch');
      setupStats = agentResearch.getHistoricalSetupStats(featureVector);
      setupConviction = setupStats.conviction;
    } catch (memErr) {
      console.error('[AGENT 26] Failed to calculate market memory analogs:', memErr.message);
    }

    // Bayesian win rate confidence calculations (Phase 19 Bayesian updates replacing simple calibration)
    const bayesianResult = bayesianConfidenceEngine.calculateBayesianConfidence({
      pattern: candlePattern,
      marketState: marketState,
      structure: structureHierarchy,
      context: {
        direction: primarySignal,
        distanceFromVwap: Math.abs(distVWAP) / 100,
        isAtDiscount: pred12.premiumDiscountScore > 60,
        isAtPremium: pred12.premiumDiscountScore < 40,
        liquiditySweepDetected: pred12.liquidityScore > 70 || pred12.liquidityScore < 30,
        rvol: volumeStateData.rvol,
        volatilityContraction: marketState.state === 'COMPRESSION'
      },
      riskReward: rrVal
    });

    const finalConfidence = bayesianResult.expectedWinProbability;
    const finalExpectancy = bayesianResult.expectedR;

    // Determine Direction
    let direction = primarySignal;

    // Evaluate Decision via Weighted Adaptive Decision Engine
    const decisionInputs = {
      candleScore: candleScore,
      candlePattern: candlePattern,
      structureScore: structureScore,
      smcScore: smcScore,
      volumeScore: volumeScore,
      regime: mRegime,
      volatility: dtResult.components?.volatility?.level || 'CALM',
      rrVal: rrVal,
      expectancy: finalExpectancy,
      marketState: marketState.state,
      
      buyWeight: buyWeight,
      sellWeight: sellWeight,
      buyConfidence: buyConfidence,
      sellConfidence: sellConfidence,
      minConsensusWeight: minConsensusWeight,
      minConfidenceThresh: minConfidenceThresh,
      
      hh: structureHierarchy.details?.hh || 0,
      hl: structureHierarchy.details?.hl || 0,
      lh: structureHierarchy.details?.lh || 0,
      ll: structureHierarchy.details?.ll || 0,
      bosType: structureHierarchy.bosType || 'None',
      bosScore: structureHierarchy.bosScore || 50,
      chochType: structureHierarchy.chochType || 'None',
      chochScore: structureHierarchy.chochScore || 50,
      candleReasoning: candleScoreDetails.reasoning,
      isBullishClose: candles5M.length > 0 ? (candles5M[candles5M.length - 1].close > candles5M[candles5M.length - 1].open) : true,
      avgVol: avgVol,
      currentVol: candles5M.length > 0 ? candles5M[candles5M.length - 1].volume : 1000,
      volumeState: volumeStateData.volumeState,
      trend1D,
      trend1H,
      trend15M,
      trend5M,
      trend1M
    };

    const decision = adaptiveDecisionEngine.evaluateDecision(symbol, direction, decisionInputs);
    let finalSignal = decision.execute ? direction : 'HOLD';

    const baseTqs = decision.score;
    let finalTqs = Math.round(baseTqs * (0.7 + 0.3 * setupConviction));

    // Agent 26 Memory Engine Hook: Retrieve similarity matching
    let analogAdj = { confidence_adj: 0, match_count: 0 };
    try {
      const agentResearch = require('./agentResearch');
      analogAdj = await agentResearch.findAnalogAdjustments(symbol, featureVector);
      if (analogAdj.confidence_adj !== 0) {
        const adjScore = Math.round(analogAdj.confidence_adj * 100);
        finalTqs = Math.max(0, Math.min(100, finalTqs + adjScore));
      }
    } catch (memErr) {
      console.error('[AGENT 26] Failed to calculate memory analog updates:', memErr.message);
    }

    // Diagnostic logging — shows exactly why each candidate passes/fails
    console.log(`[DECISION] ${symbol} | Dir=${direction} | Score=${decision.score}/70 | Grade=${decision.grade} | Execute=${decision.execute} | Pattern=${candlePattern}(${candleScore}) | Structure=${structureScore} | Vol=${volumeScore} | SMC=${smcScore} | RR=${rrVal.toFixed(1)} | BuyW=${buyWeight.toFixed(2)} BuyC=${buyConfidence.toFixed(2)} | Rejections: ${decision.rejections.length > 0 ? decision.rejections.join('; ') : 'NONE'}`);

    // Store execution memory with actual finalized signal
    try {
      const agentResearch = require('./agentResearch');
      await agentResearch.storePredictionMemory(symbol, finalSignal, featureVector);
    } catch (memErr) {
      console.error('[AGENT 26] Failed to store prediction memory:', memErr.message);
    }

    const icsResult = institutionalConfluenceEngine.calculateICS({
      marketStructureScore: structureScore,
      volumeScore: volumeScore,
      momentumScore: pred11.indicators?.momentumScore || 50,
      vwapPosition: distVWAP > 0 ? 'above' : 'below',
      emaAligned: pred4.indicators?.ema9 > pred4.indicators?.ema21,
      breakoutScore: pred11.indicators?.breakoutScore || 50,
      srScore: 70,
      riskReward: rrVal,
      consensusStrength: finalSignal === 'BUY' ? buyWeight : (finalSignal === 'SELL' ? sellWeight : 0.5),
      marketRegime: mRegime
    });

    const preConviction = Number((weightedConfidence * (baseTqs / 100)).toFixed(4));
    const postConviction = Number((finalConfidence * (finalTqs / 100)).toFixed(4));

    const learningImpact = {
      confidence_delta: Number((finalConfidence - weightedConfidence).toFixed(4)),
      expectancy_delta: Number((finalExpectancy - bayesianResult.historicalPatternAccuracy).toFixed(4)),
      conviction_delta: Number((postConviction - preConviction).toFixed(4)),
      match_count: analogAdj.match_count,
      pre_learning_confidence: Number(weightedConfidence.toFixed(4)),
      post_learning_confidence: Number(finalConfidence.toFixed(4)),
      pre_learning_expectancy: Number(bayesianResult.historicalPatternAccuracy.toFixed(4)),
      post_learning_expectancy: Number(finalExpectancy.toFixed(4)),
      pre_learning_conviction: preConviction,
      post_learning_conviction: postConviction,
      pre_learning_tqs: baseTqs,
      post_learning_tqs: finalTqs,
      setup_conviction: setupConviction,
      setup_stats: setupStats
    };

    let reasoningText = `Alpha Recovery Engine consensus: ${finalSignal} Weight=${buyWeight.toFixed(2)}, TQS=${finalTqs} | State: ${marketState.state} (conf: ${marketState.confidence.toFixed(2)}) | Grade: ${decision.grade} (Score: ${decision.score}/${decision.threshold}) | HistAccuracy: ${Math.round(bayesianResult.historicalPatternAccuracy * 100)}% | PosteriorWin: ${Math.round(bayesianResult.posteriorWinProbability * 100)}% | ExpWin: ${Math.round(finalConfidence * 100)}% | ExpR: ${rrVal.toFixed(1)}R | ExpDD: ${bayesianResult.expectedDrawdown.toFixed(1)}% | ICS Score: ${icsResult.score} (${icsResult.label})`;
    if (analogAdj.confidence_adj !== 0) {
      reasoningText += ` | Memory: ${analogAdj.confidence_adj >= 0 ? '+' : ''}${(analogAdj.confidence_adj * 100).toFixed(0)}%`;
    }


    const finalPrediction = {
      stage: 1,
      consensus: decision.execute,
      signal: finalSignal,
      execute: decision.execute,
      rejectionReason: decision.rejections.join(', '),
      rejections: decision.rejections,
      adaptiveScore: decision.score,
      adaptiveThreshold: decision.threshold,
      sizeScale: decision.sizeScale,
      grade: decision.grade,
      historicalPatternAccuracy: decision.probabilityMetrics?.historicalPatternAccuracy || bayesianResult.historicalPatternAccuracy,
      expectedWinProbability: decision.probabilityMetrics?.expectedWinProbability || bayesianResult.expectedWinProbability,
      expectedR: decision.probabilityMetrics?.expectedR || bayesianResult.expectedR,
      expectedDrawdown: decision.probabilityMetrics?.maxExpectedDrawdown || bayesianResult.expectedDrawdown,
      executionProbability: decision.probabilityMetrics?.executionProbability || 0.0,
      pattern: structureHierarchy.pattern,
      patternScore: structureHierarchy.patternScore,
      patternReliability: structureHierarchy.patternReliability,
      patternSuccessPct: structureHierarchy.patternSuccessPct,
      candleMetrics: candleScoreDetails.metrics,
      confidenceInterval: bayesianResult.confidenceInterval,
      stopLossPrice: stopsAndTargets.stopLoss,
      targetPrice: stopsAndTargets.target,
      calculatedRiskReward: stopsAndTargets.riskReward,
      confidence: finalConfidence,
      tradeQuality: finalTqs,
      ics: icsResult.score,
      icsLabel: icsResult.label,
      marketRegime: mRegime,
      regimeConfidence: rConfidence,
      expectancyBeforeTrade: finalExpectancy,
      reasoning: reasoningText,
      participating_models: {
        agent1: pred1,
        agent2_gemini: pred2,
        agent3_groq: pred3,
        agent4_technical: pred4,
        agent5_context: pred5,
        agent6_regime: pred6,
        agent7_risk: pred7,
        agent9_breadth: pred9,
        agent10_sector: pred10,
        agent11_price_action: pred11,
        agent12_smc: pred12,
        learning_impact: learningImpact
      },
      symbol,
      entry_price: ltp,
      candle_pattern: candlePattern,
      candle_score: candleScore,
      candle_category: candleCategory,
      candles5M: candles5M
    };

    this.saveLastPrediction(finalPrediction);

    try {
      await db.logConsensusDecision({
        id: `P-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        timestamp: new Date().toISOString(),
        symbol,
        decision: finalSignal,
        confidence: finalConfidence,
        participating_models: {
          ...finalPrediction.participating_models,
          trade_quality_score: finalTqs,
          market_memory_analogs: analogAdj
        },
        debate_summary: finalPrediction.reasoning,
        final_outcome: null,
        result_after_closes: null
      });
    } catch (logErr) {
      console.error('[PREDICTOR] Failed to log consensus decision:', logErr.message);
    }

    return finalPrediction;
  },


  saveLastPrediction(pred) {
    lastPredictionState = pred;
    return pred;
  },

  getLastPrediction() {
    return lastPredictionState;
  },

  async recordPredictionExit(symbol, exitPrice, pnl, pos) {
    const correct = pnl > 0;
    let models = {};
    let finalSignal = 'BUY';
    let predictionReasoning = 'unknown';

    if (pos && pos.participating_models) {
      models = pos.participating_models;
      finalSignal = 'BUY'; // CNC entry signal
      predictionReasoning = `Recovered entry for ${symbol}`;
    } else if (lastPredictionState && lastPredictionState.symbol === symbol) {
      models = lastPredictionState.participating_models || {};
      finalSignal = lastPredictionState.signal || 'BUY';
      predictionReasoning = lastPredictionState.reasoning || 'unknown';
    } else {
      console.warn(`[PREDICTOR] recordPredictionExit: No active prediction state or position prediction snapshot found for ${symbol}.`);
      return;
    }

    // Update leaderboard per-agent based on whether they AGREED with the executed trade
    Object.keys(agentLeaderboard).forEach(id => {
      const agent = agentLeaderboard[id];
      const agentKey = id === '1' ? 'agent1' : id === '2' ? 'agent2_gemini' : id === '3' ? 'agent3_groq' :
                       id === '4' ? 'agent4_technical' : id === '5' ? 'agent5_context' :
                       id === '6' ? 'agent6_regime' : id === '7' ? 'agent7_risk' :
                       id === '9' ? 'agent9_breadth' : 'agent10_sector';
      const agentPred = models[agentKey];
      if (!agentPred || agentPred.status === 'UNAVAILABLE' || agentPred.failed) return;

      const agentAgreed = agentPred.signal === finalSignal;
      const isWin = pnl > 0;
      // Per-agent accuracy compared to true outcome: correct if (isWin and agent predicted BUY) or (!isWin and agent predicted SELL)
      const agentCorrect = (isWin && agentPred.signal === 'BUY') || (!isWin && agentPred.signal === 'SELL');

      // Initialize calibration history if needed
      agent.calibration_history = agent.calibration_history || [];
      agent.calibration_history.push({
        symbol,
        signal: agentPred.signal,
        confidence: agentPred.confidence || 0.5,
        outcome: isWin ? 'WIN' : 'LOSS',
        correct: agentCorrect
      });

      // Keep only last 100 entries for calibration analysis
      if (agent.calibration_history.length > 100) {
        agent.calibration_history.shift();
      }

      if (correct) {
        agent.profitContribution += pnl * 0.10;
        agent.sharpeContribution = Math.min(0.5, agent.sharpeContribution + 0.01);
        if (!agentAgreed) {
          // Agent disagreed with a winning trade — penalize
          agent.lossContribution -= Math.abs(pnl) * 0.05;
        }
      } else {
        agent.lossContribution += pnl * 0.10;
        agent.sharpeContribution = Math.max(-0.5, agent.sharpeContribution - 0.01);
        if (!agentAgreed) {
          // Agent disagreed with a losing trade — reward (loss prevention credit)
          agent.profitContribution += Math.abs(pnl) * 0.05;
        }
      }
    });

    // CRITICAL: Persist learning feedback and save leaderboard weights to database
    try {
      const weightsBefore = {};
      const weightsAfter = {};
      Object.keys(agentLeaderboard).forEach(id => {
        weightsBefore[`agent${id}`] = agentLeaderboard[id].weight;
      });

      // Recalculate weights from updated scores
      this._recalculateWeights();

      Object.keys(agentLeaderboard).forEach(id => {
        weightsAfter[`agent${id}`] = agentLeaderboard[id].weight;
      });

      await db.logLearningFeedback({
        prediction_id: predictionReasoning,
        pnl: pnl,
        learning_rate: 0.01,
        weights_before: weightsBefore,
        weights_after: weightsAfter
      });

      // Persist trust weights
      await db.saveLeaderboardState(agentLeaderboard);
    } catch (feedbackErr) {
      console.error('[PREDICTOR] Failed to save learning feedback:', feedbackErr.message);
    }
  },

  // Recalculate trust weights from leaderboard scores
  _recalculateWeights() {
    const scores = {};
    let totalScore = 0;

    Object.keys(agentLeaderboard).forEach(id => {
      const agent = agentLeaderboard[id];
      const netPnl = agent.profitContribution + agent.lossContribution;
      const score = Math.max(0.01, netPnl + agent.sharpeContribution * 1000);
      scores[id] = score;
      totalScore += score;
    });

    // Normalize with constraints: min 2%, max 25%
    Object.keys(agentLeaderboard).forEach(id => {
      let rawWeight = scores[id] / totalScore;
      rawWeight = Math.max(0.02, Math.min(0.25, rawWeight));
      agentLeaderboard[id].weight = parseFloat(rawWeight.toFixed(4));
    });

    // Re-normalize to sum to 1.0
    const currentSum = Object.values(agentLeaderboard).reduce((s, a) => s + a.weight, 0);
    Object.keys(agentLeaderboard).forEach(id => {
      agentLeaderboard[id].weight = parseFloat((agentLeaderboard[id].weight / currentSum).toFixed(4));
    });
  },

  // Returns per-agent accuracy, profit contribution, loss contribution, Sharpe contribution, and calibration quality
  getAgentCalibration() {
    const calibration = {};
    Object.keys(agentLeaderboard).forEach(id => {
      const agent = agentLeaderboard[id];
      const history = agent.calibration_history || [];
      const total = history.length;
      const correctCount = history.filter(h => h.correct).length;
      const accuracy = total > 0 ? correctCount / total : 0.5;

      let calibrationQuality = 0.5;
      if (total >= 3) {
        const correctConfidence = history.filter(h => h.correct).map(h => h.confidence);
        const incorrectConfidence = history.filter(h => !h.correct).map(h => h.confidence);
        const avgCorrectConf = correctConfidence.length > 0 ? correctConfidence.reduce((a, b) => a + b, 0) / correctConfidence.length : 0.5;
        const avgIncorrectConf = incorrectConfidence.length > 0 ? incorrectConfidence.reduce((a, b) => a + b, 0) / incorrectConfidence.length : 0.5;
        calibrationQuality = 0.5 + (avgCorrectConf - avgIncorrectConf) * 0.5;
        calibrationQuality = Math.max(0, Math.min(1, calibrationQuality));
      }

      calibration[id] = {
        name: agent.name,
        accuracy: agent.accuracy !== undefined ? agent.accuracy : Number(accuracy.toFixed(4)),
        precision: agent.precision !== undefined ? agent.precision : 0.0,
        recall: agent.recall !== undefined ? agent.recall : 0.0,
        winRate: agent.winRate !== undefined ? agent.winRate : 0.0,
        sharpe: agent.sharpeContribution,
        profitFactor: agent.profitFactor !== undefined ? agent.profitFactor : 1.0,
        averageReturn: agent.averageReturn !== undefined ? agent.averageReturn : 0.0,
        fpr: agent.fpr !== undefined ? agent.fpr : 0.0,
        fnr: agent.fnr !== undefined ? agent.fnr : 0.0,
        predictionAccuracy: agent.predictionAccuracy !== undefined ? agent.predictionAccuracy : Number(accuracy.toFixed(4)),
        profitContribution: Number(agent.profitContribution.toFixed(2)),
        lossContribution: Number(agent.lossContribution.toFixed(2)),
        actualProfitContribution: Number((agent.actualProfitContribution || 0).toFixed(2)),
        actualLossContribution: Number((agent.actualLossContribution || 0).toFixed(2)),
        todayProfitContribution: Number((agent.todayProfitContribution || 0).toFixed(2)),
        todayLossContribution: Number((agent.todayLossContribution || 0).toFixed(2)),
        realizedProfitContribution: agent.realizedProfitContribution !== undefined ? agent.realizedProfitContribution : Number(agent.profitContribution.toFixed(2)),
        realizedLossContribution: agent.realizedLossContribution !== undefined ? agent.realizedLossContribution : Number(agent.lossContribution.toFixed(2)),
        falsePositives: agent.falsePositives !== undefined ? agent.falsePositives : 0,
        falseNegatives: agent.falseNegatives !== undefined ? agent.falseNegatives : 0,
        sharpeContribution: Number(agent.sharpeContribution.toFixed(4)),
        expectedProfitContribution: agent.expectedProfitContribution !== undefined ? agent.expectedProfitContribution : 0.0,
        rank: agent.rank !== undefined ? agent.rank : 9,
        weight: agent.weight,
        calibrationQuality: Number(calibrationQuality.toFixed(4)),
        totalSignals: total
      };
    });
    return calibration;
  },

  async recalculateRealAttribution() {
    // 1. Reset all contributions to 0
    Object.keys(agentLeaderboard).forEach(id => {
      agentLeaderboard[id].profitContribution = 0.0;
      agentLeaderboard[id].lossContribution = 0.0;
      agentLeaderboard[id].actualProfitContribution = 0.0;
      agentLeaderboard[id].actualLossContribution = 0.0;
      agentLeaderboard[id].todayProfitContribution = 0.0;
      agentLeaderboard[id].todayLossContribution = 0.0;
      agentLeaderboard[id].sharpeContribution = 0.0;
      agentLeaderboard[id].drawdownContribution = 0.0;
      agentLeaderboard[id].calibration_history = [];
    });

    try {
      const data = db.readLocalDb();
      const completedTrades = data.completed_trades || [];
      
      const now = new Date();
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric', month: '2-digit', day: '2-digit'
      }).formatToParts(now);
      const lookup = {};
      parts.forEach(p => { lookup[p.type] = p.value; });
      const todayStr = `${lookup.year}-${lookup.month}-${lookup.day}`;

      const tradeLogsBySymbol = {};
      (data.trade_logs || []).forEach(l => {
        if (!tradeLogsBySymbol[l.symbol]) {
          tradeLogsBySymbol[l.symbol] = [];
        }
        tradeLogsBySymbol[l.symbol].push(l);
      });

      for (const t of completedTrades) {
        const pnl = Number(t.net_pnl || 0);
        const isWin = pnl > 0;
        
        const entryTimeMs = new Date(t.entry_time).getTime();
        const symbolLogs = tradeLogsBySymbol[t.symbol] || [];
        const matchingBuy = symbolLogs.find(l => 
          l.action === 'BUY' && 
          Math.abs(new Date(l.timestamp).getTime() - entryTimeMs) <= 10000
        );

        let participating_models = null;
        if (matchingBuy && matchingBuy.reason && matchingBuy.reason.includes('| REPORT: ')) {
          try {
            const reportStr = matchingBuy.reason.split('| REPORT: ')[1];
            const reportObj = JSON.parse(reportStr);
            participating_models = reportObj.participating_models || null;
          } catch (e) {}
        }

        if (!participating_models) continue;

        const exitTimeStr = t.exit_time instanceof Date ? t.exit_time.toISOString() : String(t.exit_time);
        const tDate = exitTimeStr.split('T')[0];
        const isToday = tDate === todayStr;

        Object.keys(agentLeaderboard).forEach(id => {
          const agent = agentLeaderboard[id];
          const agentKey = id === '1' ? 'agent1' : id === '2' ? 'agent2_gemini' : id === '3' ? 'agent3_groq' :
                           id === '4' ? 'agent4_technical' : id === '5' ? 'agent5_context' :
                           id === '6' ? 'agent6_regime' : id === '7' ? 'agent7_risk' :
                           id === '9' ? 'agent9_breadth' : 'agent10_sector';
          
          let entryPart = participating_models[agentKey];
          if (entryPart) {
            if (typeof entryPart === 'string') {
              entryPart = { signal: entryPart };
            }
            const didRecommendBuy = entryPart.signal === 'BUY';

            if (didRecommendBuy) {
              if (isWin) {
                agent.actualProfitContribution += pnl;
                if (isToday) agent.todayProfitContribution += pnl;
              } else {
                agent.actualLossContribution += pnl;
                if (isToday) agent.todayLossContribution += pnl;
              }
            }

            const agentCorrect = (isWin && entryPart.signal === 'BUY') || (!isWin && entryPart.signal === 'SELL') || (!isWin && entryPart.signal === 'HOLD');
            agent.calibration_history.push({
              symbol: t.symbol,
              signal: entryPart.signal,
              confidence: entryPart.confidence || 0.5,
              outcome: isWin ? 'WIN' : 'LOSS',
              correct: agentCorrect,
              pnl
            });
          }
        });
      }

      // Calculate all 8 metrics for each agent:
      Object.keys(agentLeaderboard).forEach(id => {
        const agent = agentLeaderboard[id];
        const history = agent.calibration_history || [];
        const total = history.length;

        let tp = 0, fp = 0, tn = 0, fn = 0;
        let realizedProfitSum = 0;
        let realizedLossSum = 0;
        let winReturnSum = 0;
        let lossReturnSum = 0;
        let winCount = 0;
        let lossCount = 0;

        history.forEach(h => {
          const isWin = h.outcome === 'WIN';
          const pnl = h.pnl || 0;
          if (isWin) {
            if (h.signal === 'BUY') {
              tp++;
              realizedProfitSum += pnl;
              winReturnSum += pnl;
              winCount++;
            } else {
              fn++;
            }
          } else {
            if (h.signal === 'BUY') {
              fp++;
              realizedLossSum += pnl; // negative number
              lossReturnSum += Math.abs(pnl);
              lossCount++;
            } else {
              tn++;
            }
          }
        });

        const totalTradeCount = total;
        const tp_fp = tp + fp;
        const tp_fn = tp + fn;
        const fp_tn = fp + tn;

        agent.accuracy = totalTradeCount > 0 ? Number(((tp + tn) / totalTradeCount).toFixed(4)) : 0.5;
        agent.precision = tp_fp > 0 ? Number((tp / tp_fp).toFixed(4)) : 0.0;
        agent.recall = tp_fn > 0 ? Number((tp / tp_fn).toFixed(4)) : 0.0;
        agent.winRate = tp_fp > 0 ? Number((tp / tp_fp).toFixed(4)) : 0.0;
        agent.profitFactor = realizedLossSum !== 0 ? Number((realizedProfitSum / Math.abs(realizedLossSum)).toFixed(2)) : Number(realizedProfitSum.toFixed(2));
        agent.averageReturn = totalTradeCount > 0 ? Number(((realizedProfitSum + realizedLossSum) / totalTradeCount).toFixed(2)) : 0.0;
        agent.fpr = fp_tn > 0 ? Number((fp / fp_tn).toFixed(4)) : 0.0;
        agent.fnr = tp_fn > 0 ? Number((fn / tp_fn).toFixed(4)) : 0.0;

        agent.predictionAccuracy = agent.accuracy;
        agent.realizedProfitContribution = Number(realizedProfitSum.toFixed(2));
        agent.realizedLossContribution = Number(realizedLossSum.toFixed(2));
        agent.falsePositives = fp;
        agent.falseNegatives = fn;

        // Sharpe Contribution
        const buyTrades = history.filter(h => h.signal === 'BUY');
        if (buyTrades.length >= 3) {
          const returns = buyTrades.map(b => b.pnl);
          const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
          const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
          const stdDev = Math.sqrt(variance) || 0.001;
          const sharpe = (mean / stdDev) * Math.sqrt(252);
          agent.sharpeContribution = parseFloat(sharpe.toFixed(4));
        } else {
          agent.sharpeContribution = 0.0;
        }

        // Expected Profit Contribution
        const votedTotal = winCount + lossCount;
        if (votedTotal > 0) {
          const winRateVal = winCount / votedTotal;
          const avgWin = winCount > 0 ? winReturnSum / winCount : 0;
          const avgLoss = lossCount > 0 ? lossReturnSum / lossCount : 0;
          agent.expectedProfitContribution = Number(((winRateVal * avgWin) - ((1 - winRateVal) * avgLoss)).toFixed(2));
        } else {
          agent.expectedProfitContribution = 0.0;
        }
      });

      // Rank all agents from best to worst based on expectedProfitContribution + realized contributions
      const sortedAgentIds = Object.keys(agentLeaderboard)
        .sort((a, b) => {
          const scoreA = agentLeaderboard[a].expectedProfitContribution + (agentLeaderboard[a].realizedProfitContribution + agentLeaderboard[a].realizedLossContribution);
          const scoreB = agentLeaderboard[b].expectedProfitContribution + (agentLeaderboard[b].realizedProfitContribution + agentLeaderboard[b].realizedLossContribution);
          return scoreB - scoreA;
        });

      sortedAgentIds.forEach((id, idx) => {
        agentLeaderboard[id].rank = idx + 1;
      });

      this._recalculateWeights();
    } catch (err) {
      console.error('[PREDICTOR] Failed recalculating real agent attribution:', err.message);
    }
  },

  async adjustWeights(pnl) {
    console.log(`[PREDICTOR] adjustWeights compatibility hook called with PnL ₹${pnl}.`);
    if (lastPredictionState) {
      await this.recordPredictionExit(lastPredictionState.symbol, lastPredictionState.entry_price || 0, pnl);
    } else {
      await this.recordPredictionExit('RELIANCE', 1265.40, pnl);
    }
  }
};

predictor.getPrediction = async () => ({ signal: "HOLD", confidence: 0, consensus: false });
module.exports = predictor;
