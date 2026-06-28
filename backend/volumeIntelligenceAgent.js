/**
 * Volume Intelligence Agent (Phase 18)
 * Implements relative volume (RVOL), volume delta, exhaustion, absorption, and climax/dry-up dynamics.
 */

function analyzeVolume(candles) {
  if (!candles || candles.length < 20) {
    return {
      volumeState: 'ACCUMULATION',
      volumeScore: 50,
      rvol: 1.0,
      volumeDelta: 0,
      isClimax: false,
      isExhaustion: false,
      isAbsorption: false,
      isDryUp: false
    };
  }

  const vols = candles.map(c => c.volume || 1);
  const closes = candles.map(c => c.close);
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  const opens = candles.map(c => c.open);
  const len = candles.length;
  
  const currentCandle = candles[len - 1];
  const currentVol = currentCandle.volume || 1;
  const avgVol = vols.slice(-20).reduce((sum, v) => sum + v, 0) / 20;
  
  // 1. Relative Volume (RVOL)
  const rvol = currentVol / avgVol;
  
  // 2. Volume Delta Proxy
  // Close position in high-low range determines buying/selling pressure fraction
  const range = currentCandle.high - currentCandle.low;
  const closeLoc = range > 0 ? (currentCandle.close - currentCandle.low) / range : 0.5;
  // Net delta: positive for buying pressure, negative for selling pressure (ranges from -currentVol to +currentVol)
  const volumeDelta = currentVol * (2 * closeLoc - 1);
  
  // 3. Price changes & volatility
  const priceChange5 = (closes[len - 1] - closes[len - 5]) / closes[len - 5] * 100;
  const avgRange = candles.slice(-20).reduce((sum, c) => sum + (c.high - c.low), 0) / 20;
  const currentRange = currentCandle.high - currentCandle.low;
  
  // 4. Volume State Flags
  const isClimax = rvol > 2.5;
  const isDryUp = rvol < 0.5;
  
  // Absorption: High volume (RVOL > 1.5) with narrow price range (current range < 0.8 * avgRange)
  const isAbsorption = rvol > 1.5 && currentRange < avgRange * 0.8;
  
  // Exhaustion: Declining volume on correction/pullback (RVOL < 0.8 and declining trend)
  const recentVolTrend = vols.slice(-3).reduce((sum, v, i, arr) => sum + (i > 0 ? v - arr[i-1] : 0), 0);
  const isExhaustion = rvol < 0.8 && recentVolTrend < 0 && Math.abs(priceChange5) > 1.0;

  // 5. Compute Volume Score (0-100)
  let state = 'ACCUMULATION';
  let score = 50;

  if (isClimax) {
    state = 'VOLUME_CLIMAX';
    score = volumeDelta > 0 ? 95 : 35;
  } else if (isAbsorption) {
    state = 'ABSORPTION';
    score = volumeDelta > 0 ? 85 : 45; // Bullish absorption if buying delta
  } else if (isExhaustion) {
    state = 'EXHAUSTION';
    score = priceChange5 < 0 ? 70 : 30; // Bullish if volume exhausted on a downward pullback
  } else if (rvol > 1.5) {
    state = 'EXPANSION';
    score = volumeDelta > 0 ? 80 : 30;
  } else if (isDryUp) {
    state = 'COMPRESSION';
    score = 40;
  } else {
    // Standard accumulation vs distribution
    if (priceChange5 >= -0.5 && priceChange5 <= 0.5 && volumeDelta > 0) {
      state = 'ACCUMULATION';
      score = 75;
    } else if (priceChange5 < -1.0 && volumeDelta < 0) {
      state = 'DISTRIBUTION';
      score = 30;
    } else {
      state = 'ACCUMULATION';
      score = 60;
    }
  }

  return {
    volumeState: state,
    volumeScore: Math.round(score),
    rvol,
    volumeDelta,
    isClimax,
    isExhaustion,
    isAbsorption,
    isDryUp
  };
}

module.exports = {
  analyzeVolume
};
