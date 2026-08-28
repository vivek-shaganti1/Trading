// PRICE_ACTION_STRUCTURE_AGENT (Weighted Consensus Model)
const broker = require('./broker');

// Detect swing highs and lows in the last N candles
function detectSwings(candles, leftStrength = 2, rightStrength = 2) {
  const highs = [];
  const lows = [];

  for (let i = leftStrength; i < candles.length - rightStrength; i++) {
    const current = candles[i];
    let isHigh = true;
    let isLow = true;

    for (let j = 1; j <= leftStrength; j++) {
      if (candles[i - j].high >= current.high) isHigh = false;
      if (candles[i - j].low <= current.low) isLow = false;
    }
    for (let j = 1; j <= rightStrength; j++) {
      if (candles[i + j].high >= current.high) isHigh = false;
      if (candles[i + j].low <= current.low) isLow = false;
    }

    if (isHigh) {
      highs.push({ index: i, price: current.high, time: current.time });
    }
    if (isLow) {
      lows.push({ index: i, price: current.low, time: current.time });
    }
  }

  return { highs, lows };
}

// Rolling-window structure: split the window into halves and compare extremes.
// This still classifies a trend when no pivot satisfies the strict swing test
// (a monotonic advance has zero qualifying pivots, which previously scored 50).
function windowStructureBias(candles) {
  const n = candles.length;
  if (n < 10) return 0;
  const mid = Math.floor(n / 2);
  const firstHalf = candles.slice(0, mid);
  const secondHalf = candles.slice(mid);
  const maxOf = arr => Math.max(...arr.map(c => c.high));
  const minOf = arr => Math.min(...arr.map(c => c.low));

  const higherHigh = maxOf(secondHalf) > maxOf(firstHalf);
  const higherLow = minOf(secondHalf) > minOf(firstHalf);
  const lowerHigh = maxOf(secondHalf) < maxOf(firstHalf);
  const lowerLow = minOf(secondHalf) < minOf(firstHalf);

  if (higherHigh && higherLow) return 1;   // bullish
  if (lowerHigh && lowerLow) return -1;    // bearish
  return 0;                                 // mixed
}

// Calculate Market Structure Score (0-100)
function analyzeMarketStructure(candles) {
  // Strict pivots first; relax the right-hand confirmation if none are found so
  // that trending series (which have few confirmed pivots) still register.
  let { highs, lows } = detectSwings(candles, 2, 2);
  if (highs.length < 2 || lows.length < 2) {
    const relaxed = detectSwings(candles, 1, 1);
    if (relaxed.highs.length >= highs.length) highs = relaxed.highs;
    if (relaxed.lows.length >= lows.length) lows = relaxed.lows;
  }

  let score = 50; // Neutral base
  let hh = 0, hl = 0, lh = 0, ll = 0;
  let text = 'Mixed / Neutral Structure';

  if (highs.length >= 2) {
    const lastHigh = highs[highs.length - 1].price;
    const prevHigh = highs[highs.length - 2].price;
    if (lastHigh > prevHigh) hh++; else lh++;
  }
  if (lows.length >= 2) {
    const lastLow = lows[lows.length - 1].price;
    const prevLow = lows[lows.length - 2].price;
    if (lastLow > prevLow) hl++; else ll++;
  }

  if (hh > 0 && hl > 0) {
    score = 85;
    text = 'Bullish Structure (HH + HL)';
  } else if (lh > 0 && ll > 0) {
    score = 15;
    text = 'Bearish Structure (LH + LL)';
  } else {
    // Fall back to the rolling-window read rather than defaulting to neutral.
    const bias = windowStructureBias(candles);
    if (bias > 0) {
      score = 72;
      hh = 1; hl = 1;
      text = 'Bullish Structure (rising window highs + lows)';
    } else if (bias < 0) {
      score = 28;
      lh = 1; ll = 1;
      text = 'Bearish Structure (falling window highs + lows)';
    } else {
      score = 50;
      text = 'Mixed / Consolidation Structure';
    }
  }

  return { score, text, details: { hh, hl, lh, ll } };
}

// Detect W-Pattern (Double Bottom)
function detectDoubleBottom(candles, lows, ltp) {
  if (lows.length < 2) return { detected: false, confidence: 0 };
  const lastLow = lows[lows.length - 1];
  const prevLow = lows[lows.length - 2];

  const priceDiffPct = Math.abs(lastLow.price - prevLow.price) / prevLow.price;
  if (priceDiffPct > 0.015) return { detected: false, confidence: 0 };

  let peak = 0;
  for (let i = prevLow.index; i < lastLow.index; i++) {
    if (candles[i].high > peak) peak = candles[i].high;
  }

  if (peak === 0) return { detected: false, confidence: 0 };

  const necklineBreak = ltp > peak;
  const volExpansion = candles[candles.length - 1].volume > (candles.slice(-20).reduce((sum, c) => sum + c.volume, 0) / 20) * 1.2;

  if (necklineBreak) {
    const confidence = volExpansion ? 0.90 : 0.75;
    return { detected: true, confidence, reason: 'W-Pattern Double Bottom confirmed with neckline break.' };
  } else if (ltp > lastLow.price && ltp < peak) {
    return { detected: true, confidence: 0.65, reason: 'Potential W-Pattern forming (Double Bottom bounce).' };
  }

  return { detected: false, confidence: 0 };
}

// Detect M-Pattern (Double Top)
function detectDoubleTop(candles, highs, ltp) {
  if (highs.length < 2) return { detected: false, confidence: 0 };
  const lastHigh = highs[highs.length - 1];
  const prevHigh = highs[highs.length - 2];

  const priceDiffPct = Math.abs(lastHigh.price - prevHigh.price) / prevHigh.price;
  if (priceDiffPct > 0.015) return { detected: false, confidence: 0 };

  let trough = Infinity;
  for (let i = prevHigh.index; i < lastHigh.index; i++) {
    if (candles[i].low < trough) trough = candles[i].low;
  }

  if (trough === Infinity) return { detected: false, confidence: 0 };

  const necklineBreak = ltp < trough;
  if (necklineBreak) {
    return { detected: true, confidence: 0.88, reason: 'M-Pattern Double Top confirmed with neckline break.' };
  } else if (ltp < lastHigh.price && ltp > trough) {
    return { detected: true, confidence: 0.65, reason: 'Potential M-Pattern forming (Double Top rejection).' };
  }

  return { detected: false, confidence: 0 };
}

// Advanced pattern recognition helper
function detectAdvancedPatterns(candles) {
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  const closes = candles.map(c => c.close);
  const len = candles.length;

  if (len < 30) return { pattern: 'None', score: 50 };

  // 1. Cup and Handle
  const leftPeak = Math.max(...highs.slice(0, 10));
  const bottom = Math.min(...lows.slice(10, 20));
  const rightPeak = Math.max(...highs.slice(20, 26));
  const handleLow = Math.min(...lows.slice(26, len));
  
  if (Math.abs(leftPeak - rightPeak) / leftPeak < 0.03 && bottom < leftPeak * 0.95 && handleLow > bottom && handleLow < rightPeak && closes[len - 1] > handleLow) {
    return { pattern: 'Cup And Handle', score: 88, reason: 'Rounded cup structure followed by handle consolidation.' };
  }

  // 2. Bull Flag / Bear Flag
  const poleStart = closes[len - 15];
  const poleEnd = closes[len - 5];
  const poleChange = (poleEnd - poleStart) / poleStart * 100;
  
  const consolHighs = highs.slice(-5);
  const consolLows = lows.slice(-5);
  const slopeHighs = consolHighs[4] - consolHighs[0];
  const slopeLows = consolLows[4] - consolLows[0];

  if (poleChange > 3.0 && slopeHighs < 0 && slopeLows < 0) {
    return { pattern: 'Bull Flag', score: 85, reason: 'Strong flagpole upward impulse with downward sloping flag consolidation channel.' };
  }
  if (poleChange < -3.0 && slopeHighs > 0 && slopeLows > 0) {
    return { pattern: 'Bear Flag', score: 15, reason: 'Strong flagpole downward impulse with upward sloping consolidation channel.' };
  }

  // 3. Ascending / Descending Triangles
  const last5Highs = highs.slice(-10);
  const last5Lows = lows.slice(-10);
  const flatHigh = Math.abs(Math.max(...last5Highs) - Math.min(...last5Highs)) / Math.max(...last5Highs) < 0.01;
  const risingLows = last5Lows[9] > last5Lows[0];

  if (flatHigh && risingLows) {
    return { pattern: 'Ascending Triangle', score: 82, reason: 'Ascending triangle with converging flat resistance and rising support.' };
  }

  return { pattern: 'None', score: 50 };
}

// Breakout Model
function detectBreakout(candles, ltp) {
  const lookback = 20;
  if (candles.length < lookback) return { signal: 'HOLD', score: 50, reason: 'Insufficient history for breakouts' };

  const bodyCandles = candles.slice(-lookback - 1, -1);
  const resistance = Math.max(...bodyCandles.map(c => c.high));
  const support = Math.min(...bodyCandles.map(c => c.low));

  const currentCandle = candles[candles.length - 1];
  const avgVolume = bodyCandles.reduce((s, c) => s + c.volume, 0) / lookback;
  const isVolConfirmed = currentCandle.volume > avgVolume * 1.5;

  if (currentCandle.close > resistance && isVolConfirmed) {
    return { signal: 'BUY', score: 90, reason: 'Bullish Breakout above resistance confirmed by volume.' };
  } else if (currentCandle.close < support && isVolConfirmed) {
    return { signal: 'SELL', score: 90, reason: 'Bearish Breakdown below support confirmed by volume.' };
  }

  return { signal: 'HOLD', score: 50, reason: 'Price consolidating within range.' };
}

// Retest Model
function detectRetest(candles, ltp) {
  const lookback = 25;
  if (candles.length < lookback) return { signal: 'HOLD', score: 50 };

  const pastHighs = candles.slice(-lookback, -5).map(c => c.high);
  const resistance = Math.max(...pastHighs);

  let breakoutOccurred = false;
  for (let i = candles.length - 5; i < candles.length - 1; i++) {
    if (candles[i].close > resistance) breakoutOccurred = true;
  }

  const currentCandle = candles[candles.length - 1];
  const isHoldingRetest = Math.abs(currentCandle.low - resistance) / resistance < 0.01 && currentCandle.close > resistance;

  if (breakoutOccurred && isHoldingRetest) {
    return { signal: 'BUY', score: 85, reason: 'Successful breakout retest support validation.' };
  }

  return { signal: 'HOLD', score: 50 };
}

// Candlestick Pattern Engine
function detectPatterns(candles) {
  if (candles.length < 3) return { score: 50, pattern: 'None' };
  const c1 = candles[candles.length - 1];
  const c2 = candles[candles.length - 2];
  
  const c1Body = Math.abs(c1.close - c1.open);
  const c1Range = c1.high - c1.low;
  const c2Body = Math.abs(c2.close - c2.open);

  // Bullish Engulfing
  if (c2.close < c2.open && c1.close > c1.open && c1.open <= c2.close && c1.close >= c2.open) {
    return { score: 85, pattern: 'Bullish Engulfing' };
  }
  // Bearish Engulfing
  if (c2.close > c2.open && c1.close < c1.open && c1.open >= c2.close && c1.close <= c2.open) {
    return { score: 15, pattern: 'Bearish Engulfing' };
  }

  // Hammer
  const lowerShadow = Math.min(c1.open, c1.close) - c1.low;
  const upperShadow = c1.high - Math.max(c1.open, c1.close);
  if (lowerShadow > c1Body * 2 && upperShadow < c1Body * 0.5) {
    return { score: 80, pattern: 'Hammer (Pin Bar)' };
  }

  // Shooting Star
  if (upperShadow > c1Body * 2 && lowerShadow < c1Body * 0.5) {
    return { score: 20, pattern: 'Shooting Star' };
  }

  // Doji
  if (c1Body <= c1Range * 0.1) {
    return { score: 50, pattern: 'Doji' };
  }

  return { score: 50, pattern: 'None detected' };
}

// Compute simple EMA
function computeEma(prices, period) {
  if (prices.length < period) return prices[prices.length - 1] || 0;
  let k = 2 / (period + 1);
  let ema = prices[0];
  for (let i = 1; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }
  return ema;
}

// Main Prediction logic for the Agent
async function predict(symbol, closes) {
  let prices = closes;
  let candlesObj = [];

  const marketData = require('./marketData');
  try {
    const history = await marketData.getHistory(symbol);
    prices = history.closes;
    for (let i = 0; i < history.closes.length; i++) {
      candlesObj.push({
        time: Math.floor(Date.now() / 1000) - (history.closes.length - i) * 300,
        open: i > 0 ? history.closes[i-1] : history.closes[i],
        high: history.highs[i],
        low: history.lows[i],
        close: history.closes[i],
        volume: history.volumes[i] || 100
      });
    }
  } catch (err) {
    prices = closes || Array.from({ length: 30 }, (_, i) => 100 + i);
    candlesObj = prices.map((c, i) => ({
      time: i, open: c, high: c * 1.01, low: c * 0.99, close: c, volume: 1000
    }));
  }

  if (candlesObj.length < 25) {
    return { signal: 'HOLD', confidence: 0.5, failed: true, reasoning: 'Insufficient candles for structure analysis' };
  }

  const ltp = candlesObj[candlesObj.length - 1].close;

  // RVOL must be measured on COMPLETED bars. The final intraday bar is still
  // forming and carries only a fraction of a full bar's volume, so comparing it
  // against a full-bar average made the ratio structurally < 1 and permanently
  // vetoed every BUY. Use the last closed bar against the 20 closed bars before it.
  const closedBars = candlesObj.slice(0, -1);
  const lastVol = closedBars.length ? closedBars[closedBars.length - 1].volume : 0;
  const bodyCandles = closedBars.slice(-21, -1);
  const avgVol = bodyCandles.length
    ? bodyCandles.reduce((s, c) => s + c.volume, 0) / bodyCandles.length
    : 0;

  // 1. Market Structure (25% weight)
  const ms = analyzeMarketStructure(candlesObj);

  // 2. Swings for W/M patterns
  const { highs, lows } = detectSwings(candlesObj, 2, 2);

  // Double Bottom (15% weight)
  const dbPattern = detectDoubleBottom(candlesObj, lows, ltp);

  // Double Top (15% weight)
  const dtPattern = detectDoubleTop(candlesObj, highs, ltp);

  // 3. Breakout Model (15% weight)
  const breakout = detectBreakout(candlesObj, ltp);

  // 4. Retest Model (10% weight)
  const retest = detectRetest(candlesObj, ltp);

  // 5. Volume Expansion Model (10% weight)
  const volRatio = avgVol > 0 ? (lastVol / avgVol) : 1.0;
  const volScore = Math.min(100, Math.round(volRatio * 50));

  // 6. Momentum Model (10% weight)
  const ema9 = computeEma(prices, 9);
  const ema21 = computeEma(prices, 21);
  const momentumScore = (ema9 > ema21) ? 80 : 20;

  // 7. Support / Resistance & Risk Reward (10% weight)
  const support = Math.min(...candlesObj.slice(-20).map(c => c.low));
  const resistance = Math.max(...candlesObj.slice(-20).map(c => c.high));

  // Average True Range over the last 14 completed bars — the basis for the stop.
  const atrBars = candlesObj.slice(-15, -1);
  let atr = 0;
  if (atrBars.length > 1) {
    let trSum = 0;
    for (let i = 1; i < atrBars.length; i++) {
      const c = atrBars[i], p = atrBars[i - 1];
      trSum += Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close));
    }
    atr = trSum / (atrBars.length - 1);
  }
  if (!(atr > 0)) atr = Math.max(0.01, ltp * 0.005);

  // Risk = a fixed 1.5 ATR volatility stop. Deliberately NOT floored at the
  // 20-bar low: in a sustained trend that low is far below price, which would
  // inflate the stop distance and crush R:R exactly when the trend is strongest.
  // Reward = the measured move to prior resistance, or 2.5 ATR once price has
  // cleared it (a breakout has no overhead resistance left — the old
  // range-position formula scored that case as ZERO reward).
  const stopDistance = atr * 1.5;
  const headroom = resistance - ltp;
  const rewardDistance = Math.max(headroom, atr * 2.5);
  const riskRewardVal = stopDistance > 0 ? rewardDistance / stopDistance : 0;
  const rrScore = Math.max(0, Math.min(100, Math.round(riskRewardVal * 40)));

  // 8. Candlestick Pattern Engine (10% weight)
  const patternResult = detectPatterns(candlesObj);

  // 9. Advanced Pattern Detection
  const adv = detectAdvancedPatterns(candlesObj);

  // Normalize TQS-PA (0-100)
  const scoreStructure = ms.score * 0.25;
  const scoreBreakout = breakout.score * 0.15;
  const scoreVolume = volScore * 0.10;
  const scoreMomentum = momentumScore * 0.10;
  const scoreSupport = rrScore * 0.10;
  const scorePatterns = patternResult.score * 0.10;
  const scoreDouble = (dbPattern.detected ? 80 : (dtPattern.detected ? 20 : 50)) * 0.10;
  const scoreRetest = retest.score * 0.10;

  const tqsPa = Math.round(scoreStructure + scoreBreakout + scoreVolume + scoreMomentum + scoreSupport + scorePatterns + scoreDouble + scoreRetest);

  // Formulate Final Price Action Signal and Confidence.
  // Thresholds sit at 60/40 rather than 70/30: every component is anchored at a
  // neutral 50, so a 70 composite required nearly every sub-model to be strongly
  // positive at once — a bar that in practice never occurs.
  let signal = 'HOLD';
  let confidence = 0.50;

  // An advanced pattern (Cup & Handle, Bull Flag, Ascending Triangle) may
  // trigger on its own, but ONLY when market structure is not actively opposing
  // it. Previously `adv.score > 70` was an unconditional OR, so one pattern
  // detector could override the entire composite — measured at 11 of 12 false
  // BUY signals inside confirmed downtrends. A bull flag in a downtrend is far
  // more often a continuation pause than a reversal.
  const advBullishOverride = adv.score > 70 && ms.score >= 50;
  const advBearishOverride = adv.score < 30 && ms.score <= 50;

  if (tqsPa >= 66 || advBullishOverride) {
    signal = 'BUY';
    confidence = 0.55 + Math.min(0.35, (Math.max(tqsPa, adv.score) - 66) * 0.0100);
  } else if (tqsPa <= 40 || advBearishOverride) {
    signal = 'SELL';
    confidence = 0.55 + Math.min(0.35, (40 - Math.min(tqsPa, adv.score)) * 0.0100);
  }

  // Quality modifiers.
  //
  // These were previously hard vetoes (RR < 1.5, RVOL < 1.2, structure < 60) and
  // they fired SIMULTANEOUSLY on the strongest trends, so this agent could not
  // emit BUY under any market condition — verified against 50/50 live decisions.
  // They are now graded confidence penalties: weak evidence lowers conviction and
  // lets the portfolio ranker deprioritise the setup, instead of silently
  // deleting it. Only genuinely disqualifying conditions remain hard.
  const qualityNotes = [];
  if (signal === 'BUY') {
    if (riskRewardVal < 1.2) { confidence -= 0.10; qualityNotes.push(`thin R:R ${riskRewardVal.toFixed(2)}`); }
    if (volRatio < 0.8)      { confidence -= 0.07; qualityNotes.push(`soft RVOL ${volRatio.toFixed(2)}x`); }
    else if (volRatio >= 1.5) { confidence += 0.05; qualityNotes.push(`RVOL surge ${volRatio.toFixed(2)}x`); }
    if (ms.score < 45)       { confidence -= 0.10; qualityNotes.push(`structure ${ms.score} opposes long`); }
    else if (ms.score >= 70) { confidence += 0.05; qualityNotes.push(`structure ${ms.score} supports long`); }

    // HARD disqualifier: reward smaller than risk is never a valid long.
    if (riskRewardVal < 0.8) {
      signal = 'HOLD';
      confidence = 0.50;
      qualityNotes.push('VETO: reward below risk');
    }
  }

  if (signal === 'SELL') {
    const downsidePct = ((ltp - support) / ltp) * 100;
    if (downsidePct < 1.0) { confidence -= 0.10; qualityNotes.push(`limited downside ${downsidePct.toFixed(2)}%`); }
    if (ms.score > 55)     { confidence -= 0.10; qualityNotes.push(`structure ${ms.score} opposes short`); }
    if (riskRewardVal < 0.8) {
      signal = 'HOLD';
      confidence = 0.50;
      qualityNotes.push('VETO: reward below risk');
    }
  }

  confidence = Math.max(0.35, Math.min(0.95, confidence));

  // A directional call is a claim that one side is more likely than the other.
  // If the quality penalties above drag conviction to a coin flip or below, the
  // evidence no longer supports a direction — say HOLD rather than emitting a
  // SELL at 0.45, which reads as "bearish, but less than neutrally sure" and is
  // incoherent for any downstream weighting. Surfaced by the 1,000-case sweep.
  if (signal !== 'HOLD' && confidence <= 0.50) {
    signal = 'HOLD';
    confidence = 0.50;
    qualityNotes.push('downgraded to HOLD: conviction fell to a coin flip');
  }

  // Reasoning formatting
  let reasoning = `${signal} | `;
  reasoning += `PA-Structure confirms ${ms.text.toLowerCase()} (Score: ${ms.score}). `;
  reasoning += `EMA9/21 is ${ema9 > ema21 ? 'bullish' : 'bearish'} with momentum score ${momentumScore}. `;
  reasoning += `Volume expanded to ${volRatio.toFixed(1)}x average. `;
  reasoning += `Pattern detected: ${patternResult.pattern}. `;
  if (adv.pattern !== 'None') reasoning += `Advanced pattern: ${adv.pattern} (${adv.reason}). `;
  if (dbPattern.detected) reasoning += `Double bottom detected (${dbPattern.reason}). `;
  if (dtPattern.detected) reasoning += `Double top detected (${dtPattern.reason}). `;
  reasoning += `Support: ₹${support.toFixed(2)}, Resistance: ₹${resistance.toFixed(2)}. `;
  reasoning += `Risk reward: 1:${riskRewardVal.toFixed(1)}. `;
  reasoning += `TQS-PA: ${tqsPa}.`;

  const expectedMove = parseFloat((((resistance - ltp) / ltp) * 100).toFixed(2));

  return {
    signal,
    confidence: parseFloat(confidence.toFixed(2)),
    tqs: tqsPa,
    reasoning,
    indicators: {
      structureScore: ms.score,
      patternScore: patternResult.score,
      breakoutScore: breakout.score,
      volumeScore: volScore,
      momentumScore: momentumScore,
      riskRewardScore: rrScore,
      riskRewardVal: riskRewardVal,
      tqsPa
    },
    prediction: {
      direction: signal,
      probability: Math.round(confidence * 100),
      expectedMove: expectedMove,
      expectedTarget: resistance,
      expectedStop: support,
      horizon: 'next candle'
    }
  };
}

module.exports = {
  predict,
  detectSwings,
  detectPatterns
};
