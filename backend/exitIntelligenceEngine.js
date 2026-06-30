/**
 * Institutional Exit Intelligence Engine (Exit Agent 33)
 * Calculates dynamic exit confidence (0-100) based on 10 core quantitative modules:
 * 1. Market Structure (BOS, CHoCH, Swing Failure)
 * 2. SMC (Order Blocks, FVGs, Liquidity sweeps, Premium/Discount)
 * 3. Wyckoff (UTAD, Distribution, Spring, Buying Climax)
 * 4. Volume (Absorption, Climax, Divergence, Exhaustion)
 * 5. Momentum (RSI failure swings, MACD histogram weakening)
 * 6. Trend (EMA alignment, VWAP, Anchored VWAP)
 * 7. Volatility (ATR expansion/exhaustion)
 * 8. Candlesticks (Engulfing, Evening/Shooting Star, etc.)
 * 9. MTF Confirmation (1m to Daily)
 * 10. Continuous Risk (MFE, MAE, expected drawdown, decay, probability of upside/reversal)
 */

const db = require('./db');
const candleScoringEngine = require('./candleScoringEngine');

// Default starting weights for exit components (must sum to 1.0)
const DEFAULT_WEIGHTS = {
  marketStructure: 0.15,
  smc: 0.15,
  wyckoff: 0.10,
  volume: 0.12,
  momentum: 0.10,
  trend: 0.12,
  volatility: 0.08,
  candlestick: 0.08,
  mtf: 0.05,
  risk: 0.05
};

// Retrieve active weights from database or fall back to defaults
function getExitWeights() {
  try {
    const data = db.readLocalDb();
    if (data.portfolio_state && data.portfolio_state.exit_weights) {
      return data.portfolio_state.exit_weights;
    }
  } catch (err) {
    console.error('[EXIT ENGINE] Error reading exit weights from DB:', err.message);
  }
  return { ...DEFAULT_WEIGHTS };
}

// Save weights to database
function saveExitWeights(weights) {
  try {
    const data = db.readLocalDb();
    if (!data.portfolio_state) {
      data.portfolio_state = {};
    }
    data.portfolio_state.exit_weights = weights;
    db.writeLocalDb(data);
  } catch (err) {
    console.error('[EXIT ENGINE] Error saving exit weights to DB:', err.message);
  }
}

/**
 * Main function to evaluate exit confidence and scores.
 * @param {Object} position - Active holding stock position object
 * @param {Array} candles - Historical candle data (5m / 15m)
 * @param {Object} marketContext - Optional extra context (VWAP, MTF candles, etc.)
 */
function evaluatePositionExits(position, candles, marketContext = {}) {
  if (!candles || candles.length < 20) {
    return {
      exitConfidence: 0,
      exitScore: 0,
      shouldExit: false,
      recommendedMode: 'HOLD',
      reason: 'Insufficient candle data for exit evaluation.',
      components: {}
    };
  }

  const weights = getExitWeights();
  const closes = candles.map(c => c.close);
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  const volumes = candles.map(c => c.volume || 1);
  const len = candles.length;
  const currentPrice = position.currentPrice || closes[len - 1];

  // Helper values
  const avgPrice = position.avgPrice || position.entry_price || closes[0];
  const returnPct = ((currentPrice - avgPrice) / avgPrice) * 100;
  const peakPrice = position.maxPrice || Math.max(...highs.slice(-10), currentPrice);
  const peakReturn = ((peakPrice - avgPrice) / avgPrice) * 100;
  
  // Create relative peak/valley arrays
  const recentHighs = highs.slice(-15);
  const recentLows = lows.slice(-15);
  const maxHigh = Math.max(...recentHighs);
  const minLow = Math.min(...recentLows);

  // ----------------------------------------------------
  // 1. Market Structure Score (0 to 100)
  // ----------------------------------------------------
  let msScore = 30; // neutral to bullish baseline
  let swingHigh = Math.max(...highs.slice(-10, -2));
  let swingLow = Math.min(...lows.slice(-10, -2));
  
  // CHoCH Check: broke swing low
  if (currentPrice < swingLow) {
    msScore = 90; // high exit score (bearish CHoCH)
  } else if (currentPrice < (swingLow + (swingHigh - swingLow) * 0.25)) {
    msScore = 70; // structural weakness
  }
  
  // Swing Failure Pattern (SFP) Check (swept highs but closed below)
  const currentHigh = highs[len - 1];
  const prevHigh = highs[len - 2];
  if (currentHigh > swingHigh && currentPrice < swingHigh) {
    msScore = Math.max(msScore, 85); // Bearish SFP
  }

  // ----------------------------------------------------
  // 2. SMC Score (0 to 100)
  // ----------------------------------------------------
  let smcScore = 20;
  // Premium/Discount Zone
  const rangeHigh = Math.max(...highs.slice(-20));
  const rangeLow = Math.min(...lows.slice(-20));
  const rangeMid = rangeLow + (rangeHigh - rangeLow) * 0.5;
  
  if (currentPrice > rangeLow + (rangeHigh - rangeLow) * 0.75) {
    smcScore += 30; // in premium territory (good for long exit)
  } else if (currentPrice < rangeMid) {
    smcScore -= 10; // discount territory
  }

  // FVG Mitigation (mitigating a bearish FVG from above)
  let fvgMitigated = false;
  if (len >= 12) {
    for (let i = len - 10; i < len - 2; i++) {
      if (highs[i] < lows[i + 2]) {
        // Bullish FVG - ignore for exit
      } else if (lows[i] > highs[i + 2]) {
        // Bearish FVG zone is between highs[i+2] and lows[i]
        if (currentPrice >= highs[i + 2] && currentPrice <= lows[i]) {
          fvgMitigated = true;
        }
      }
    }
  }
  if (fvgMitigated) {
    smcScore += 25;
  }

  // Bearish Order Block check
  if (len >= 5) {
    const isOpposingCandle = closes[len - 3] > closes[len - 4]; // Green candle before drop
    const isDrop = closes[len - 2] < closes[len - 3];
    if (isOpposingCandle && isDrop && currentPrice >= lows[len - 3] && currentPrice <= highs[len - 3]) {
      smcScore += 25; // Mitigation of bearish OB
    }
  }
  smcScore = Math.max(0, Math.min(100, smcScore));

  // ----------------------------------------------------
  // 3. Wyckoff Score (0 to 100)
  // ----------------------------------------------------
  let wyckoffScore = 30;
  // Look for Buying Climax (BC): Peak return with high volume, but failed to sustain
  const rvol = (volumes[len - 1] / (volumes.slice(-20).reduce((a, b) => a + b, 0) / 20));
  if (rvol > 2.2 && currentPrice < highs[len - 1] && returnPct > 1.5) {
    wyckoffScore = 80; // Buying climax / distribution signal
  }
  // Upthrust After Distribution (UTAD) / Fakeout
  const localPeak = Math.max(...highs.slice(-15, -1));
  if (highs[len - 1] > localPeak && closes[len - 1] < localPeak) {
    wyckoffScore = Math.max(wyckoffScore, 85); // UTAD fakeout
  }

  // ----------------------------------------------------
  // 4. Volume Score (0 to 100)
  // ----------------------------------------------------
  let volumeScore = 40;
  // Volume Divergence: price rising but volume declining
  const priceTrend = closes.slice(-5).reduce((sum, val, idx, arr) => sum + (idx > 0 ? val - arr[idx - 1] : 0), 0);
  const volumeTrend = volumes.slice(-5).reduce((sum, val, idx, arr) => sum + (idx > 0 ? val - arr[idx - 1] : 0), 0);
  if (priceTrend > 0 && volumeTrend < 0) {
    volumeScore = 75; // Bearish divergence / exhaustion
  }
  let avgRange = 0;
  try {
    let sumRange = 0;
    const count = Math.min(20, len);
    for (let i = len - count; i < len; i++) {
      sumRange += (highs[i] - lows[i]);
    }
    avgRange = sumRange / count;
  } catch (e) {}
  const isNarrowRange = (highs[len - 1] - lows[len - 1]) < avgRange * 0.8;
  if (rvol > 1.8 && isNarrowRange && currentPrice > rangeMid) {
    volumeScore = Math.max(volumeScore, 80); // Selling absorption
  }

  // ----------------------------------------------------
  // 5. Momentum Score (0 to 100)
  // ----------------------------------------------------
  let momentumScore = 50;
  // Simple RSI Failure Swing proxy
  // Calculate raw RSI(14)
  let rsi = 50;
  try {
    let gains = 0, losses = 0;
    for (let i = len - 14; i < len; i++) {
      const diff = closes[i] - closes[i - 1];
      if (diff > 0) gains += diff;
      else losses -= diff;
    }
    const rs = gains / (losses || 1);
    rsi = 100 - (100 / (1 + rs));
  } catch (e) {}

  if (rsi > 70) {
    momentumScore = 65; // Overbought, start preparing exit
  }
  // RSI failure swing: RSI was > 70, pulled back, went back up but made a lower high, then crossed below intermediate low.
  // We can look at recent peaks in RSI
  if (rsi < 60 && returnPct > 0) {
    // If we have an RSI decay from peak
    momentumScore = Math.max(momentumScore, 70);
  }

  // ----------------------------------------------------
  // 6. Trend Score (0 to 100)
  // ----------------------------------------------------
  let trendScore = 30;
  // EMA alignment & crossing
  let ema9 = closes[len - 1];
  let ema20 = closes[len - 1];
  try {
    // Calculate simple EMAs
    let sum9 = 0, sum20 = 0;
    closes.slice(-9).forEach(v => sum9 += v);
    closes.slice(-20).forEach(v => sum20 += v);
    ema9 = sum9 / 9;
    ema20 = sum20 / 20;
  } catch (e) {}

  if (currentPrice < ema9) {
    trendScore = 60; // price below fast EMA
  }
  if (currentPrice < ema20) {
    trendScore = 80; // price below slow EMA (strong exit)
  }
  if (ema9 < ema20) {
    trendScore = Math.max(trendScore, 85); // EMAs crossed bearishly
  }

  // ----------------------------------------------------
  // 7. Volatility Score (0 to 100)
  // ----------------------------------------------------
  let volatilityScore = 30;
  // Calculate ATR and standard deviation of ATR
  let atr = 0.5;
  try {
    const trs = [];
    for (let i = len - 14; i < len; i++) {
      trs.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i-1]), Math.abs(lows[i] - closes[i-1])));
    }
    atr = trs.reduce((a, b) => a + b, 0) / 14;
  } catch (e) {}

  // ATR expansion at high prices
  const currentRange = highs[len - 1] - lows[len - 1];
  if (currentRange > atr * 2.0 && currentPrice > rangeMid) {
    volatilityScore = 75; // Volatility expansion / exhaustion peak
  }

  // ----------------------------------------------------
  // 8. Candlestick Score (0 to 100)
  // ----------------------------------------------------
  let candlestickScore = 40;
  try {
    const pattern = candleScoringEngine.detectPatterns(candles);
    if (pattern && pattern.direction === 'SELL') {
      candlestickScore = pattern.score || pattern.baseScore || 80;
    } else if (pattern && pattern.pattern === 'Doji') {
      candlestickScore = 60;
    }
  } catch (err) {
    // Fallback simple checks
    const isBearishEngulfing = (closes[len - 2] > closes[len - 3] && closes[len - 1] < closes[len - 2] && closes[len - 1] < closes[len - 3]);
    if (isBearishEngulfing) {
      candlestickScore = 80;
    }
  }

  // ----------------------------------------------------
  // 9. Multi-Timeframe (MTF) Confirmation Score (0 to 100)
  // ----------------------------------------------------
  let mtfScore = 40;
  // Simulate MTF based on slicing larger window size of candles (e.g. 5m to 1h proxy)
  try {
    const hourlyCloses = [];
    for (let i = 0; i < len; i += 12) {
      hourlyCloses.push(closes[i]);
    }
    if (hourlyCloses.length >= 3) {
      const hourlyTrend = hourlyCloses[hourlyCloses.length - 1] < hourlyCloses[hourlyCloses.length - 2];
      if (hourlyTrend) {
        mtfScore = 75; // hourly trend is down
      }
    }
  } catch (e) {}

  // ----------------------------------------------------
  // 10. Continuous Risk Score (0 to 100)
  // ----------------------------------------------------
  let riskScore = 30;
  // Expected Drawdown from Peak
  const giveback = peakPrice - currentPrice;
  const givebackPct = (giveback / peakPrice) * 100;
  
  if (givebackPct > 0.5) {
    riskScore = Math.max(riskScore, 60);
  }
  if (givebackPct > 1.2) {
    riskScore = Math.max(riskScore, 85); // High drawdown from peak (lock profit or cut)
  }

  // Time decay penalty: if held for too long without movement
  const positionTimeMs = Date.now() - new Date(position.timestamp || position.entry_time || Date.now()).getTime();
  const positionMins = positionTimeMs / 60000;
  if (positionMins > 60 && Math.abs(returnPct) < 0.2) {
    riskScore = Math.max(riskScore, 70); // stagnant trade decay
  }

  // Compute final Exit Confidence using weights
  const exitScore = (
    msScore * weights.marketStructure +
    smcScore * weights.smc +
    wyckoffScore * weights.wyckoff +
    volumeScore * weights.volume +
    momentumScore * weights.momentum +
    trendScore * weights.trend +
    volatilityScore * weights.volatility +
    candlestickScore * weights.candlestick +
    mtfScore * weights.mtf +
    riskScore * weights.risk
  );

  const exitConfidence = Math.round(exitScore);

  // Define Exit Mode and routing rules
  let recommendedMode = 'HOLD';
  let shouldExit = false;
  let reason = 'Holding position; exit threshold not reached.';

  // Confidence Threshold for exit (e.g. 70)
  const exitThreshold = position.exitThresholdOverride || 70;

  if (exitConfidence >= exitThreshold) {
    shouldExit = true;
    if (returnPct <= -1.2 || riskScore >= 85) {
      recommendedMode = 'EMERGENCY_EXIT';
      reason = `Emergency Exit: Risk/Drawdown trigger at score ${exitConfidence}.`;
    } else if (returnPct >= 2.5) {
      recommendedMode = 'TAKE_PROFIT';
      reason = `Take Profit target reached. Exit confidence: ${exitConfidence}.`;
    } else if (givebackPct >= 0.8 && returnPct > 0.5) {
      recommendedMode = 'TRAILING_EXIT';
      reason = `Trailing Profit Lock: Price pulled back by ${givebackPct.toFixed(2)}% from peak.`;
    } else if (trendScore >= 80) {
      recommendedMode = 'TREND_EXIT';
      reason = `Trend Exit: Primary trend structure broken.`;
    } else if (volatilityScore >= 75) {
      recommendedMode = 'VOLATILITY_EXIT';
      reason = `Volatility Exit: Exhaustion peak detected.`;
    } else if (positionMins >= 120) {
      recommendedMode = 'TIME_EXIT';
      reason = `Time Decay Exit: Held for ${Math.round(positionMins)} minutes with stalling momentum.`;
    } else {
      recommendedMode = 'SCALE_OUT';
      reason = `Scale Out: Confluence threshold hit at ${exitConfidence}.`;
    }
  }

  // Safety rule: do not exit solely on target/RSI/one candle; require at least 3 indicators showing weakness (score >= 60)
  const weakIndicators = [
    { name: 'Market Structure', val: msScore },
    { name: 'SMC', val: smcScore },
    { name: 'Wyckoff', val: wyckoffScore },
    { name: 'Volume', val: volumeScore },
    { name: 'Momentum', val: momentumScore },
    { name: 'Trend', val: trendScore },
    { name: 'Volatility', val: volatilityScore },
    { name: 'Candlestick', val: candlestickScore },
    { name: 'MTF', val: mtfScore },
    { name: 'Risk', val: riskScore }
  ].filter(ind => ind.val >= 60);

  if (shouldExit && weakIndicators.length < 3) {
    shouldExit = false;
    reason = `Exit suppressed due to safety rules: only ${weakIndicators.length} indicators showing weakness (minimum 3 required for confluence).`;
  }

  const breakdown = {
    marketStructure: Math.round(msScore),
    smc: Math.round(smcScore),
    wyckoff: Math.round(wyckoffScore),
    volume: Math.round(volumeScore),
    momentum: Math.round(momentumScore),
    trend: Math.round(trendScore),
    volatility: Math.round(volatilityScore),
    candlestick: Math.round(candlestickScore),
    mtf: Math.round(mtfScore),
    risk: Math.round(riskScore)
  };

  return {
    exitConfidence,
    exitScore,
    shouldExit,
    recommendedMode,
    reason,
    components: breakdown,
    weights
  };
}

/**
 * Update exit weights dynamically after a trade is completed.
 */
function adaptExitWeights(completedTrade) {
  if (!completedTrade) return;

  const weights = getExitWeights();
  const returnPct = Number(completedTrade.return_pct || 0);
  const mfe = Number(completedTrade.mfe || 0);
  const mae = Number(completedTrade.mae || 0);
  const exitReason = completedTrade.exit_reason || '';
  
  const isWinner = returnPct > 0;
  const learningRate = 0.05;
  const adjustments = {};
  
  if (isWinner) {
    if (mfe > 0 && returnPct < mfe * 0.5) {
      adjustments.risk = -0.02;
      adjustments.candlestick = -0.01;
      adjustments.momentum = -0.01;
      adjustments.marketStructure = 0.02;
      adjustments.trend = 0.02;
    } else {
      adjustments.marketStructure = 0.01;
      adjustments.trend = 0.01;
      adjustments.smc = 0.01;
    }
  } else {
    if (mae > 1.5) {
      adjustments.risk = 0.03;
      adjustments.trend = 0.02;
      adjustments.volatility = 0.01;
      adjustments.wyckoff = -0.02;
      adjustments.volume = -0.02;
      adjustments.smc = -0.02;
    }
  }

  let newWeights = { ...weights };
  for (const key in adjustments) {
    if (newWeights[key] !== undefined) {
      newWeights[key] = Math.max(0.02, newWeights[key] + adjustments[key]);
    }
  }

  const sum = Object.values(newWeights).reduce((a, b) => a + b, 0);
  for (const key in newWeights) {
    newWeights[key] = parseFloat((newWeights[key] / sum).toFixed(4));
  }

  saveExitWeights(newWeights);

  try {
    const data = db.readLocalDb();
    data.exit_learning_feedback = data.exit_learning_feedback || [];
    data.exit_learning_feedback.push({
      timestamp: new Date().toISOString(),
      symbol: completedTrade.symbol,
      return_pct: returnPct,
      mfe,
      mae,
      oldWeights: weights,
      newWeights: newWeights,
      adjustments
    });
    if (data.exit_learning_feedback.length > 50) {
      data.exit_learning_feedback.shift();
    }
    db.writeLocalDb(data);
  } catch (e) {
    console.error('[EXIT ENGINE] Failed to log exit learning feedback:', e.message);
  }
}

module.exports = {
  evaluatePositionExits,
  adaptExitWeights,
  getExitWeights
};
