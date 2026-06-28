// Market Regime Detection Agent
function computeEma(prices, period) {
  if (prices.length < period) return prices[prices.length - 1] || 0;
  const k = 2 / (period + 1);
  let ema = prices[0];
  for (let i = 1; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }
  return ema;
}

function calculateATR(candles, period = 14) {
  if (candles.length <= period) return 1.0;
  let trSum = 0;
  for (let i = 1; i < candles.length; i++) {
    const hl = candles[i].high - candles[i].low;
    const hpc = Math.abs(candles[i].high - candles[i - 1].close);
    const lpc = Math.abs(candles[i].low - candles[i - 1].close);
    trSum += Math.max(hl, hpc, lpc);
  }
  return trSum / (candles.length - 1);
}

function detectRegime(candles) {
  if (!candles || candles.length < 20) {
    return { marketRegime: 'RANGING', regimeConfidence: 0.50 };
  }

  const closes = candles.map(c => c.close);
  const currentPrice = closes[closes.length - 1];
  
  // Calculate EMAs
  const ema9 = computeEma(closes, 9);
  const ema21 = computeEma(closes, 21);
  const ema50 = computeEma(closes, 50);

  // Volatility and ATR
  const atr = calculateATR(candles, 14);
  const atrPct = (atr / currentPrice) * 100;

  // Volume averages
  const vols = candles.map(c => c.volume || 1);
  const currentVol = vols[vols.length - 1];
  const avgVol = vols.slice(-20).reduce((a, b) => a + b, 0) / 20;

  // Trend strength (using price slope over 15 bars)
  const priceSlope = (currentPrice - closes[closes.length - 15]) / closes[closes.length - 15] * 100;

  let regime = 'RANGING';
  let confidence = 0.60;

  if (atrPct > 4.5) {
    regime = 'VOLATILE';
    confidence = 0.75;
  } else if (currentVol < avgVol * 0.5) {
    regime = 'LOW_VOLUME';
    confidence = 0.70;
  } else if (currentPrice > Math.max(...closes.slice(-21, -1)) && currentVol > avgVol * 1.5) {
    regime = 'BREAKOUT';
    confidence = 0.85;
  } else if (ema9 > ema21 && ema21 > ema50 && priceSlope > 2.0) {
    regime = 'TRENDING_UP';
    confidence = 0.88;
  } else if (ema9 < ema21 && ema21 < ema50 && priceSlope < -2.0) {
    regime = 'TRENDING_DOWN';
    confidence = 0.88;
  } else if (Math.abs(priceSlope) < 0.8) {
    regime = 'RANGING';
    confidence = 0.75;
  } else {
    // Default fallback to RANGING with moderate confidence
    regime = 'RANGING';
    confidence = 0.55;
  }

  return {
    marketRegime: regime,
    regimeConfidence: parseFloat(confidence.toFixed(2))
  };
}

module.exports = {
  detectRegime
};
