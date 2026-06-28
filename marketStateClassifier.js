/**
 * Advanced Market State Classifier for AGY-Trader (Phase 19)
 * Detects 15 distinct market states based on price action, volume, volatility, and timing.
 */

const db = require('./db');

function classifyMarketState(candles, technicals = {}, smc = {}) {
  if (!candles || candles.length < 20) {
    return {
      state: 'ACCUMULATION',
      confidence: 0.50,
      probability: 0.50,
      expectedVolatility: 1.0,
      preferredStrategy: 'CONSOLIDATION',
      prohibitedStrategy: 'BREAKOUT_CHASING'
    };
  }

  const len = candles.length;
  const c = candles[len - 1];
  const closes = candles.map(k => k.close);
  const volumes = candles.map(k => k.volume || 1);
  const highs = candles.map(k => k.high);
  const lows = candles.map(k => k.low);

  const ltp = c.close;
  const currentVol = c.volume || 1;
  const avgVol = volumes.slice(-20).reduce((sum, v) => sum + v, 0) / 20;
  const rvol = currentVol / avgVol;

  const currentRange = c.high - c.low;
  const atr = candles.slice(-20).reduce((sum, k) => sum + (k.high - k.low), 0) / 20;

  // Compute EMAs (9, 21, 50) on closes
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

  // Time metrics
  let currentMins = 600; // 10:00 AM fallback
  try {
    const timeInfo = db.getSystemTime ? db.getSystemTime() : { hours: new Date().getHours(), minutes: new Date().getMinutes() };
    currentMins = timeInfo.hours * 60 + timeInfo.minutes;
  } catch (e) {}

  // 1. OPENING_AUCTION (9:15 AM - 9:45 AM IST -> 555 to 585 mins)
  if (currentMins >= 555 && currentMins <= 585) {
    return {
      state: 'OPENING_AUCTION',
      confidence: 0.90,
      probability: 0.85,
      expectedVolatility: 1.8,
      preferredStrategy: 'BREAKOUT',
      prohibitedStrategy: 'MEAN_REVERSION'
    };
  }

  // 2. CLOSING_AUCTION (3:00 PM - 3:30 PM IST -> 900 to 930 mins)
  if (currentMins >= 900 && currentMins <= 930) {
    return {
      state: 'CLOSING_AUCTION',
      confidence: 0.85,
      probability: 0.80,
      expectedVolatility: 1.5,
      preferredStrategy: 'MOMENTUM_EXPANSION',
      prohibitedStrategy: 'CONSOLIDATION'
    };
  }

  // 3. MIDDAY_DRIFT (11:30 AM - 1:30 PM IST -> 690 to 810 mins)
  const isMidday = currentMins >= 690 && currentMins <= 810;

  // 4. NEWS_DRIVEN (Extreme volume and range spike)
  if (rvol > 3.0 && currentRange > 2.2 * atr) {
    return {
      state: 'NEWS_DRIVEN',
      confidence: 0.95,
      probability: 0.90,
      expectedVolatility: 2.5,
      preferredStrategy: 'MOMENTUM_SCALPING',
      prohibitedStrategy: 'POSITION_HOLDING'
    };
  }

  // 5. LIQUIDITY_SWEEP (Proximity to swings with sweep candle wicks)
  const body = Math.abs(c.close - c.open);
  const isWickSweep = (c.high - Math.max(c.open, c.close) > 2 * body) || (Math.min(c.open, c.close) - c.low > 2 * body);
  if (isWickSweep && (smc.liquidityScore > 75 || rvol > 1.8)) {
    return {
      state: 'LIQUIDITY_SWEEP',
      confidence: 0.88,
      probability: 0.82,
      expectedVolatility: 1.4,
      preferredStrategy: 'REVERSAL_SWEEP',
      prohibitedStrategy: 'BREAKOUT_CHASING'
    };
  }

  // 6. FALSE_BREAKOUT
  const isLastCloseOutside = c.close > Math.max(...highs.slice(-10, -1)) || c.close < Math.min(...lows.slice(-10, -1));
  if (isLastCloseOutside && rvol > 1.2 && body < currentRange * 0.25) {
    return {
      state: 'FALSE_BREAKOUT',
      confidence: 0.80,
      probability: 0.75,
      expectedVolatility: 1.3,
      preferredStrategy: 'MEAN_REVERSION',
      prohibitedStrategy: 'BREAKOUT_CHASING'
    };
  }

  // 7. COMPRESSION / DRY-UP (Very narrow range and dry volume)
  const isCompressing = currentRange < atr * 0.6 && rvol < 0.65;
  if (isCompressing) {
    return {
      state: 'COMPRESSION',
      confidence: 0.90,
      probability: 0.85,
      expectedVolatility: 0.4,
      preferredStrategy: 'BREAKOUT_LIMIT_ORDERS',
      prohibitedStrategy: 'MARKET_CHASING'
    };
  }

  // 8. VOLATILITY_EXPANSION
  const recentAtr = atr;
  const priorAtr = candles.slice(-40, -20).reduce((sum, k) => sum + (k.high - k.low), 0) / 20;
  if (recentAtr > 1.5 * priorAtr && rvol > 1.5) {
    return {
      state: 'VOLATILITY_EXPANSION',
      confidence: 0.88,
      probability: 0.82,
      expectedVolatility: 2.0,
      preferredStrategy: 'BREAKOUT_CHASING',
      prohibitedStrategy: 'MEAN_REVERSION'
    };
  }

  // 9. VOLATILITY_CONTRACTION
  if (recentAtr < 0.7 * priorAtr) {
    return {
      state: 'VOLATILITY_CONTRACTION',
      confidence: 0.82,
      probability: 0.78,
      expectedVolatility: 0.5,
      preferredStrategy: 'MEAN_REVERSION',
      prohibitedStrategy: 'MOMENTUM_EXPANSION'
    };
  }

  // 10. BREAKOUT
  const pastHigh = Math.max(...highs.slice(-21, -1));
  const pastLow = Math.min(...lows.slice(-21, -1));
  if ((ltp > pastHigh || ltp < pastLow) && rvol > 1.5) {
    return {
      state: 'BREAKOUT',
      confidence: 0.90,
      probability: 0.85,
      expectedVolatility: 1.6,
      preferredStrategy: 'MOMENTUM_BREAKOUT',
      prohibitedStrategy: 'MEAN_REVERSION'
    };
  }

  // 11. MEAN_REVERSION (Extended from EMAs)
  const distEma50 = Math.abs(ltp - ema50) / ema50 * 100;
  if (distEma50 > 3.0 && rvol < 1.0) {
    return {
      state: 'MEAN_REVERSION',
      confidence: 0.84,
      probability: 0.80,
      expectedVolatility: 1.1,
      preferredStrategy: 'EMA_PULLBACK',
      prohibitedStrategy: 'TREND_FOLLOWING'
    };
  }

  // 12. TRENDING_EXPANSION (Price pushing hard in trending structure)
  const isUpwardExpansion = ltp > ema9 && ema9 > ema21 && ema21 > ema50;
  const isDownwardExpansion = ltp < ema9 && ema9 < ema21 && ema21 < ema50;
  if ((isUpwardExpansion || isDownwardExpansion) && rvol > 1.1 && body > currentRange * 0.6) {
    return {
      state: 'TRENDING_EXPANSION',
      confidence: 0.92,
      probability: 0.88,
      expectedVolatility: 1.3,
      preferredStrategy: 'TREND_FOLLOWING',
      prohibitedStrategy: 'MEAN_REVERSION'
    };
  }

  // 13. TRENDING_PULLBACK (Trending but correcting to EMAs)
  const isUpwardPullback = ltp <= ema9 && ltp >= ema50 && ema9 > ema50;
  const isDownwardPullback = ltp >= ema9 && ltp <= ema50 && ema9 < ema50;
  if (isUpwardPullback || isDownwardPullback) {
    return {
      state: 'TRENDING_PULLBACK',
      confidence: 0.88,
      probability: 0.84,
      expectedVolatility: 0.9,
      preferredStrategy: 'PULLBACK_REENTRY',
      prohibitedStrategy: 'MOMENTUM_CHASING'
    };
  }

  // 14. ACCUMULATION / MIDDAY_DRIFT
  if (isMidday || (closes.slice(-10).reduce((sum, cl) => sum + Math.abs(cl - ema21), 0) / 10 < atr * 0.5)) {
    return {
      state: 'ACCUMULATION',
      confidence: 0.80,
      probability: 0.75,
      expectedVolatility: 0.6,
      preferredStrategy: 'CONSOLIDATION',
      prohibitedStrategy: 'BREAKOUT'
    };
  }

  // 15. Default DISTRIBUTION Fallback
  return {
    state: 'DISTRIBUTION',
    confidence: 0.70,
    probability: 0.65,
    expectedVolatility: 0.8,
    preferredStrategy: 'CONSOLIDATION',
    prohibitedStrategy: 'BREAKOUT'
  };
}

module.exports = {
  classifyMarketState
};
