/**
 * Market Structure Hierarchy Module for AGY-Trader (Phase 21 Rebuild)
 * Computes External/Internal Trends, Swings, BOS/CHOCH, and detects advanced price action patterns.
 */

function detectDoubleTopBottom(candles, swings) {
  const highs = swings.highs;
  const lows = swings.lows;
  
  let pattern = 'None';
  let score = 50;
  let reliability = 50;
  let successPct = 50;

  if (highs.length >= 2) {
    const h1 = highs[highs.length - 1].price;
    const h2 = highs[highs.length - 2].price;
    const diffPct = Math.abs(h1 - h2) / h1;
    if (diffPct <= 0.003) { // Double top
      pattern = 'Double Top';
      score = 85;
      reliability = 80;
      successPct = 68.5;
    }
  }

  if (lows.length >= 2) {
    const l1 = lows[lows.length - 1].price;
    const l2 = lows[lows.length - 2].price;
    const diffPct = Math.abs(l1 - l2) / l1;
    if (diffPct <= 0.003) { // Double bottom
      pattern = 'Double Bottom';
      score = 88;
      reliability = 82;
      successPct = 71.0;
    }
  }

  return { pattern, score, reliability, successPct };
}

function detectBreakoutRetest(candles, swings) {
  if (swings.highs.length === 0 || swings.lows.length === 0 || candles.length < 5) return { pattern: 'None', score: 50, reliability: 50, successPct: 50 };

  const lastHigh = swings.highs[swings.highs.length - 1].price;
  const lastLow = swings.lows[swings.lows.length - 1].price;
  const c = candles[candles.length - 1];
  const prev = candles[candles.length - 2];

  // Range Breakout
  if (c.close > lastHigh && prev.close <= lastHigh) {
    return { pattern: 'Range Breakout (Bullish)', score: 82, reliability: 78, successPct: 65.5 };
  } else if (c.close < lastLow && prev.close >= lastLow) {
    return { pattern: 'Range Breakout (Bearish)', score: 80, reliability: 76, successPct: 63.0 };
  }

  // False Breakout (Wick above/below level and reversal)
  if (c.high > lastHigh && c.close < lastHigh && c.close < c.open) {
    return { pattern: 'False Breakout (Bearish)', score: 86, reliability: 80, successPct: 69.0 };
  } else if (c.low < lastLow && c.close > lastLow && c.close > c.open) {
    return { pattern: 'False Breakout (Bullish)', score: 85, reliability: 81, successPct: 70.0 };
  }

  return { pattern: 'None', score: 50, reliability: 50, successPct: 50 };
}

function computeHierarchy(candles) {
  if (!candles || candles.length < 20) {
    return {
      externalTrend: 'NEUTRAL',
      internalTrend: 'NEUTRAL',
      legType: 'CONSOLIDATION',
      swings: { highs: [], lows: [] },
      structureScore: 50,
      bosType: 'None',
      bosScore: 50,
      chochType: 'None',
      chochScore: 50,
      liquidityPools: [],
      pattern: 'None',
      patternScore: 50,
      patternReliability: 50,
      patternSuccessPct: 50
    };
  }

  const closes = candles.map(c => c.close);
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  const len = candles.length;
  const ltp = closes[len - 1];

  const calculateEMA = (data, period) => {
    let ema = data[0];
    const k = 2 / (period + 1);
    for (let i = 1; i < data.length; i++) {
      ema = data[i] * k + ema * (1 - k);
    }
    return ema;
  };

  const ema9 = calculateEMA(closes, 9);
  const ema21 = calculateEMA(closes, 21);
  const ema50 = calculateEMA(closes, Math.min(50, len));

  const externalTrend = ema21 > ema50 ? 'BULLISH' : 'BEARISH';
  const internalTrend = ema9 > ema21 ? 'BULLISH' : 'BEARISH';

  // Swing High / Low Detection
  const swingHighs = [];
  const swingLows = [];
  const strength = 2;

  for (let i = strength; i < len - strength; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = 1; j <= strength; j++) {
      if (highs[i - j] >= highs[i] || highs[i + j] > highs[i]) isHigh = false;
      if (lows[i - j] <= lows[i] || lows[i + j] < lows[i]) isLow = false;
    }
    if (isHigh) swingHighs.push({ index: i, price: highs[i], time: candles[i].time });
    if (isLow) swingLows.push({ index: i, price: lows[i], time: candles[i].time });
  }

  let hh = 0, hl = 0, lh = 0, ll = 0;
  if (swingHighs.length >= 2) {
    if (swingHighs[swingHighs.length - 1].price > swingHighs[swingHighs.length - 2].price) hh++; else lh++;
  }
  if (swingLows.length >= 2) {
    if (swingLows[swingLows.length - 1].price > swingLows[swingLows.length - 2].price) hl++; else ll++;
  }

  let legType = 'CONSOLIDATION';
  const priceChange = closes[len - 1] - closes[len - 5];
  if (internalTrend === 'BULLISH') {
    legType = priceChange > 0 ? 'IMPULSE' : 'CORRECTION';
  } else {
    legType = priceChange < 0 ? 'IMPULSE' : 'CORRECTION';
  }

  const liquidityPools = [];
  if (swingHighs.length > 0) {
    const lastHigh = swingHighs[swingHighs.length - 1].price;
    liquidityPools.push({ type: 'BUY_SIDE', price: lastHigh, range: [lastHigh * 0.998, lastHigh * 1.002] });
  }
  if (swingLows.length > 0) {
    const lastLow = swingLows[swingLows.length - 1].price;
    liquidityPools.push({ type: 'SELL_SIDE', price: lastLow, range: [lastLow * 0.998, lastLow * 1.002] });
  }

  let bosType = 'None';
  let bosScore = 50;
  let chochType = 'None';
  let chochScore = 50;

  if (swingHighs.length > 0 && ltp > swingHighs[swingHighs.length - 1].price) {
    bosType = 'BULLISH_BOS';
    bosScore = 85;
    chochType = 'BULLISH_CHOCH';
    chochScore = 80;
  } else if (swingLows.length > 0 && ltp < swingLows[swingLows.length - 1].price) {
    bosType = 'BEARISH_BOS';
    bosScore = 15;
    chochType = 'BEARISH_CHOCH';
    chochScore = 20;
  }

  let structureScore = 50;
  if (hh > 0 && hl > 0) {
    structureScore = 85;
  } else if (lh > 0 && ll > 0) {
    structureScore = 15;
  }

  // Detect advanced patterns
  const doubleResult = detectDoubleTopBottom(candles, { highs: swingHighs, lows: swingLows });
  const breakoutResult = detectBreakoutRetest(candles, { highs: swingHighs, lows: swingLows });

  let finalPattern = 'None';
  let finalPatternScore = 50;
  let finalPatternReliability = 50;
  let finalPatternSuccessPct = 50;

  if (doubleResult.pattern !== 'None') {
    finalPattern = doubleResult.pattern;
    finalPatternScore = doubleResult.score;
    finalPatternReliability = doubleResult.reliability;
    finalPatternSuccessPct = doubleResult.successPct;
  } else if (breakoutResult.pattern !== 'None') {
    finalPattern = breakoutResult.pattern;
    finalPatternScore = breakoutResult.score;
    finalPatternReliability = breakoutResult.reliability;
    finalPatternSuccessPct = breakoutResult.successPct;
  }

  return {
    externalTrend,
    internalTrend,
    legType,
    swings: { highs: swingHighs, lows: swingLows },
    structureScore,
    bosType,
    bosScore,
    chochType,
    chochScore,
    liquidityPools,
    details: { hh, hl, lh, ll },
    pattern: finalPattern,
    patternScore: finalPatternScore,
    patternReliability: finalPatternReliability,
    patternSuccessPct: finalPatternSuccessPct
  };
}

module.exports = {
  computeHierarchy
};
