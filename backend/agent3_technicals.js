// Helper: Calculate EMA of an array
function calculateEMA(array, period) {
  if (!array || array.length < period) return array[array.length - 1] || 0;
  let ema = array[0];
  const k = 2 / (period + 1);
  for (let i = 1; i < array.length; i++) {
    ema = array[i] * k + ema * (1 - k);
  }
  return parseFloat(ema.toFixed(2));
}

// Helper: Calculate RSI
function calculateRSI(closes, period = 14) {
  if (!closes || closes.length <= period) return 50;
  let gains = 0;
  let losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) {
      gains += diff;
    } else {
      losses -= diff;
    }
  }
  if (losses === 0) return 100;
  const rs = gains / losses;
  return parseFloat((100 - (100 / (1 + rs))).toFixed(2));
}

// Helper: Calculate ATR
function calculateATR(highs, lows, closes, period = 14) {
  if (!highs || highs.length < period) return 1.0;
  const trs = [];
  for (let i = 1; i < highs.length; i++) {
    const hl = highs[i] - lows[i];
    const hc = Math.abs(highs[i] - closes[i - 1]);
    const lc = Math.abs(lows[i] - closes[i - 1]);
    trs.push(Math.max(hl, hc, lc));
  }
  const sum = trs.slice(-period).reduce((a, b) => a + b, 0);
  return parseFloat((sum / period).toFixed(2));
}

// Helper: Calculate VWAP
function calculateVWAP(prices, volumes) {
  if (!prices || prices.length === 0) return 0;
  let sumPriceVol = 0;
  let sumVol = 0;
  for (let i = 0; i < prices.length; i++) {
    sumPriceVol += prices[i] * (volumes[i] || 0);
    sumVol += (volumes[i] || 0);
  }
  return sumVol > 0 ? parseFloat((sumPriceVol / sumVol).toFixed(2)) : prices[prices.length - 1];
}

const agent3_technicals = {
  async predict(symbol, closesHistory) {
    let closes = closesHistory || [];
    let highs = [];
    let lows = [];
    let volumes = [];

    // Fetch detailed chart history via unified marketData service
    try {
      const marketData = require('./marketData');
      const history = await marketData.getHistory(symbol, closes);
      closes = history.closes;
      highs = history.highs;
      lows = history.lows;
      volumes = history.volumes;
    } catch (err) {
      console.error('[Agent 3] History fetch failed, falling back to closes history:', err.message);
    }

    if (!closes || closes.length < 26) {
      return {
        signal: 'HOLD',
        confidence: 0.50,
        reasoning: 'Technical Engine: Insufficient price history to compute technical metrics (need >= 26 close prices)',
        indicators: null
      };
    }

    const currentPrice = closes[closes.length - 1];

    // 1. EMA Crossovers
    const ema9 = calculateEMA(closes, 9);
    const ema21 = calculateEMA(closes, 21);
    const ema50 = calculateEMA(closes, Math.min(50, closes.length));
    const emaSignal = ema9 > ema21 ? 1 : -1;

    // 2. RSI (14)
    const rsi = calculateRSI(closes, 14);
    let rsiSignal = 0;
    if (rsi < 30) rsiSignal = 1;       // Oversold (BUY)
    else if (rsi > 70) rsiSignal = -1;  // Overbought (SELL)
    else rsiSignal = emaSignal;        // Trend follower

    // 3. MACD (12, 26, 9)
    const ema12 = calculateEMA(closes, 12);
    const ema26 = calculateEMA(closes, 26);
    const macdLine = parseFloat((ema12 - ema26).toFixed(2));
    const macdSignal = macdLine > 0 ? 1 : -1;

    // 4. VWAP
    const vwap = calculateVWAP(closes, volumes);
    const vwapSignal = currentPrice > vwap ? 1 : -1;

    // 5. ATR (for volatility band width)
    const atr = calculateATR(highs, lows, closes, 14);

    // 6. Momentum (Rate of Change)
    const roc = (((closes[closes.length - 1] - closes[closes.length - 5]) / closes[closes.length - 5]) * 100);
    const rocSignal = roc > 0 ? 1 : -1;

    // 7. Trend Strength (ADX proxy / Alignment of EMAs)
    let trendStrength = 'WEAK';
    let strengthScore = 0.5;
    if (ema9 > ema21 && ema21 > ema50) {
      trendStrength = 'STRONG_UP';
      strengthScore = 0.85;
    } else if (ema9 < ema21 && ema21 < ema50) {
      trendStrength = 'STRONG_DOWN';
      strengthScore = 0.85;
    }

    // 8. Support and Resistance Swing levels
    let support = parseFloat((currentPrice * 0.97).toFixed(2));
    let resistance = parseFloat((currentPrice * 1.03).toFixed(2));
    if (highs.length >= 20 && lows.length >= 20) {
      const sortedHighs = [...highs.slice(-20)].sort((a, b) => b - a);
      const sortedLows = [...lows.slice(-20)].sort((a, b) => a - b);
      resistance = parseFloat((sortedHighs.slice(0, 3).reduce((sum, h) => sum + h, 0) / 3).toFixed(2));
      support = parseFloat((sortedLows.slice(0, 3).reduce((sum, l) => sum + l, 0) / 3).toFixed(2));
    }

    // Summing signals (range: -5 to +5)
    const totalScore = emaSignal + rsiSignal + macdSignal + vwapSignal + rocSignal;
    const confidence = parseFloat(((Math.abs(totalScore) / 5) * 0.4 + strengthScore * 0.6).toFixed(2));

    let signal = 'HOLD';
    if (totalScore >= 2) {
      signal = 'BUY';
    } else if (totalScore <= -2) {
      signal = 'SELL';
    }

    const reasoning = `Technical Engine: EMA9/21: ${emaSignal > 0 ? 'BULLISH' : 'BEARISH'}, RSI: ${rsi.toFixed(1)} (${rsiSignal > 0 ? 'BUY' : rsiSignal < 0 ? 'SELL' : 'HOLD'}), MACD: ${macdLine.toFixed(2)}, VWAP: ₹${vwap} (price ${currentPrice > vwap ? '>' : '<'} VWAP), Momentum: ${roc.toFixed(2)}%, Trend: ${trendStrength}. Support: ₹${support}, Resistance: ₹${resistance}. Total score: ${totalScore}/5.`;

    return {
      signal,
      confidence,
      reasoning,
      indicators: {
        ema9,
        ema21,
        ema50,
        rsi,
        macd: macdLine,
        vwap,
        atr,
        roc: parseFloat(roc.toFixed(4)),
        trendStrength,
        support,
        resistance
      }
    };
  }
};

module.exports = agent3_technicals;
