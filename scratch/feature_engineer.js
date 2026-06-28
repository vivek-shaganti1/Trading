// Feature Engineering Module for Agent 1 Neural Net & Classical Baselines
// Computes technical indicators over array of daily candles (sorted ascending by time)

function computeSMA(closes, period) {
  const sma = new Array(closes.length).fill(null);
  let sum = 0;
  for (let i = 0; i < closes.length; i++) {
    sum += closes[i];
    if (i >= period - 1) {
      if (i >= period) {
        sum -= closes[i - period];
      }
      sma[i] = sum / period;
    }
  }
  return sma;
}

function computeEMA(closes, period) {
  const ema = new Array(closes.length).fill(null);
  if (closes.length < period) return ema;
  
  // Initialize first EMA value as SMA
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += closes[i];
  }
  const k = 2 / (period + 1);
  ema[period - 1] = sum / period;
  
  for (let i = period; i < closes.length; i++) {
    ema[i] = closes[i] * k + ema[i - 1] * (1 - k);
  }
  return ema;
}

function computeRSI(closes, period = 14) {
  const rsi = new Array(closes.length).fill(null);
  if (closes.length <= period) return rsi;
  
  let gains = 0;
  let losses = 0;
  
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff;
    else losses -= diff;
  }
  
  let avgGain = gains / period;
  let avgLoss = losses / period;
  rsi[period] = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
  
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain = ((avgGain * (period - 1)) + (diff > 0 ? diff : 0)) / period;
    avgLoss = ((avgLoss * (period - 1)) + (diff < 0 ? -diff : 0)) / period;
    rsi[i] = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
  }
  return rsi;
}

function computeMACD(closes, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
  const fastEMA = computeEMA(closes, fastPeriod);
  const slowEMA = computeEMA(closes, slowPeriod);
  const macdLine = new Array(closes.length).fill(null);
  
  for (let i = 0; i < closes.length; i++) {
    if (fastEMA[i] !== null && slowEMA[i] !== null) {
      macdLine[i] = fastEMA[i] - slowEMA[i];
    }
  }
  
  // Signal Line is EMA of MACD Line
  const validMacds = macdLine.filter(m => m !== null);
  const signalEMA = computeEMA(validMacds, signalPeriod);
  const signalLine = new Array(closes.length).fill(null);
  const histogram = new Array(closes.length).fill(null);
  
  let sigIdx = 0;
  const offset = closes.length - validMacds.length;
  for (let i = offset; i < closes.length; i++) {
    if (signalEMA[sigIdx] !== null) {
      signalLine[i] = signalEMA[sigIdx];
      histogram[i] = macdLine[i] - signalLine[i];
    }
    sigIdx++;
  }
  
  return { macdLine, signalLine, histogram };
}

function computeATR(candles, period = 14) {
  const atr = new Array(candles.length).fill(null);
  if (candles.length <= period) return atr;
  
  const tr = new Array(candles.length).fill(0);
  tr[0] = candles[0].high - candles[0].low;
  
  for (let i = 1; i < candles.length; i++) {
    const hl = candles[i].high - candles[i].low;
    const hpc = Math.abs(candles[i].high - candles[i - 1].close);
    const lpc = Math.abs(candles[i].low - candles[i - 1].close);
    tr[i] = Math.max(hl, hpc, lpc);
  }
  
  let sum = 0;
  for (let i = 1; i <= period; i++) {
    sum += tr[i];
  }
  atr[period] = sum / period;
  
  for (let i = period + 1; i < candles.length; i++) {
    atr[i] = (atr[i - 1] * (period - 1) + tr[i]) / period;
  }
  return atr;
}

function computeBollingerBands(closes, period = 20, multiplier = 2) {
  const upper = new Array(closes.length).fill(null);
  const lower = new Array(closes.length).fill(null);
  const sma = computeSMA(closes, period);
  
  for (let i = period - 1; i < closes.length; i++) {
    let variance = 0;
    for (let j = i - period + 1; j <= i; j++) {
      variance += Math.pow(closes[j] - sma[i], 2);
    }
    const stdDev = Math.sqrt(variance / period);
    upper[i] = sma[i] + multiplier * stdDev;
    lower[i] = sma[i] - multiplier * stdDev;
  }
  return { upper, lower, basis: sma };
}

function computeADX(candles, period = 14) {
  const adx = new Array(candles.length).fill(null);
  if (candles.length <= period * 2) return adx;

  const plusDM = new Array(candles.length).fill(0);
  const minusDM = new Array(candles.length).fill(0);
  const tr = new Array(candles.length).fill(0);

  for (let i = 1; i < candles.length; i++) {
    const upMove = candles[i].high - candles[i - 1].high;
    const downMove = candles[i - 1].low - candles[i].low;
    
    if (upMove > downMove && upMove > 0) plusDM[i] = upMove;
    if (downMove > upMove && downMove > 0) minusDM[i] = downMove;

    const hl = candles[i].high - candles[i].low;
    const hpc = Math.abs(candles[i].high - candles[i - 1].close);
    const lpc = Math.abs(candles[i].low - candles[i - 1].close);
    tr[i] = Math.max(hl, hpc, lpc);
  }

  const smoothedTR = new Array(candles.length).fill(0);
  const smoothedPlusDM = new Array(candles.length).fill(0);
  const smoothedMinusDM = new Array(candles.length).fill(0);

  let trSum = 0, pdmSum = 0, mdmSum = 0;
  for (let i = 1; i <= period; i++) {
    trSum += tr[i];
    pdmSum += plusDM[i];
    mdmSum += minusDM[i];
  }

  smoothedTR[period] = trSum;
  smoothedPlusDM[period] = pdmSum;
  smoothedMinusDM[period] = mdmSum;

  for (let i = period + 1; i < candles.length; i++) {
    smoothedTR[i] = smoothedTR[i - 1] - (smoothedTR[i - 1] / period) + tr[i];
    smoothedPlusDM[i] = smoothedPlusDM[i - 1] - (smoothedPlusDM[i - 1] / period) + plusDM[i];
    smoothedMinusDM[i] = smoothedMinusDM[i - 1] - (smoothedMinusDM[i - 1] / period) + minusDM[i];
  }

  const dx = new Array(candles.length).fill(null);
  for (let i = period; i < candles.length; i++) {
    const plusDI = (smoothedPlusDM[i] / smoothedTR[i]) * 100;
    const minusDI = (smoothedMinusDM[i] / smoothedTR[i]) * 100;
    const sum = plusDI + minusDI;
    dx[i] = sum === 0 ? 0 : (Math.abs(plusDI - minusDI) / sum) * 100;
  }

  let dxSum = 0;
  for (let i = period; i < period * 2; i++) {
    dxSum += dx[i];
  }
  adx[period * 2 - 1] = dxSum / period;

  for (let i = period * 2; i < candles.length; i++) {
    adx[i] = (adx[i - 1] * (period - 1) + dx[i]) / period;
  }
  return adx;
}

// Compute 20-day Rolling VWAP and Distance
function computeVWAP(candles, period = 20) {
  const vwapDistance = new Array(candles.length).fill(null);
  for (let i = period - 1; i < candles.length; i++) {
    let tpVolSum = 0;
    let volSum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const typicalPrice = (candles[j].high + candles[j].low + candles[j].close) / 3;
      tpVolSum += typicalPrice * candles[j].volume;
      volSum += candles[j].volume;
    }
    const vwap = volSum > 0 ? tpVolSum / volSum : candles[i].close;
    vwapDistance[i] = ((candles[i].close - vwap) / vwap) * 100;
  }
  return vwapDistance;
}

// Returns indicators matrix for a given symbol dataset
function constructFeatures(symbol, tickerCandles, niftyCandles, allData) {
  const closes = tickerCandles.map(c => c.close);
  const volumes = tickerCandles.map(c => c.volume);
  
  // Pre-calculate technical indicators
  const rsi = computeRSI(closes, 14);
  const { histogram: macdHist } = computeMACD(closes);
  const atr = computeATR(tickerCandles, 14);
  const ema9 = computeEMA(closes, 9);
  const ema21 = computeEMA(closes, 21);
  const ema50 = computeEMA(closes, 50);
  const vwapDist = computeVWAP(tickerCandles, 20);
  const { upper, lower } = computeBollingerBands(closes, 20, 2);
  const adx = computeADX(tickerCandles, 14);
  
  const volSMA20 = computeSMA(volumes, 20);

  // Sector classification mapping
  const sectorMap = {
    HDFCBANK: ['HDFCBANK', 'ICICIBANK', 'SBIN', 'AXISBANK'],
    ICICIBANK: ['HDFCBANK', 'ICICIBANK', 'SBIN', 'AXISBANK'],
    SBIN: ['HDFCBANK', 'ICICIBANK', 'SBIN', 'AXISBANK'],
    AXISBANK: ['HDFCBANK', 'ICICIBANK', 'SBIN', 'AXISBANK'],
    INFY: ['INFY', 'TCS'],
    TCS: ['INFY', 'TCS'],
    RELIANCE: ['RELIANCE'],
    ITC: ['ITC'],
    BHARTIARTL: ['BHARTIARTL'],
    LT: ['LT']
  };

  const featureRows = [];
  
  // Align time steps
  for (let i = 50; i < tickerCandles.length; i++) {
    const c = tickerCandles[i];
    const prevC = tickerCandles[i - 1];
    
    // 1. Stock Momentum (5-day return)
    const stockMom = ((c.close - tickerCandles[i - 5].close) / tickerCandles[i - 5].close) * 100;
    
    // 2. Nifty Momentum (5-day return)
    const niftyCandle = niftyCandles.find(nc => nc.time === c.time);
    let niftyMom = 0;
    if (niftyCandle) {
      const idxNifty = niftyCandles.indexOf(niftyCandle);
      if (idxNifty >= 5) {
        niftyMom = ((niftyCandle.close - niftyCandles[idxNifty - 5].close) / niftyCandles[idxNifty - 5].close) * 100;
      }
    }
    
    // 3. Volatility Proxy (Daily high-low range of Nifty as VIX proxy, since we might generate dummy vix values)
    const vixRet = niftyCandle ? ((niftyCandle.high - niftyCandle.low) / niftyCandle.low) * 100 : 1.0;

    // 4. Volume Spike Score
    const volAvg = volSMA20[i] || 1;
    const volSpike = c.volume / volAvg;

    // 5. Bollinger Band Position
    let bBandsPos = 0.5;
    if (upper[i] !== null && lower[i] !== null && upper[i] !== lower[i]) {
      bBandsPos = (c.close - lower[i]) / (upper[i] - lower[i]);
    }

    // 6. Relative Strength vs NIFTY
    const relStrength = stockMom - niftyMom;

    // 7. Sector Momentum
    const sectorPeers = sectorMap[symbol] || [symbol];
    let sectorSum = 0;
    sectorPeers.forEach(p => {
      const peerData = allData[p];
      if (peerData) {
        const pCandle = peerData.find(pc => pc.time === c.time);
        if (pCandle) {
          const idxP = peerData.indexOf(pCandle);
          if (idxP >= 5) {
            sectorSum += ((pCandle.close - peerData[idxP - 5].close) / peerData[idxP - 5].close) * 100;
          }
        }
      }
    });
    const sectorMom = sectorSum / sectorPeers.length;

    // 8. Gap %
    const gapPct = prevC ? ((c.open - prevC.close) / prevC.close) * 100 : 0.0;

    // 9. Intraday Volatility
    const intradayVol = ((c.high - c.low) / c.low) * 100;

    // Determine target labels for supervised training (simulated outcome 5 days ahead)
    // BUY if next 5-day return is > 1.5%, SELL if next 5-day return is < -1.5%, else HOLD
    let targetLabel = 2; // HOLD
    if (i < tickerCandles.length - 5) {
      const futureReturn = ((tickerCandles[i + 5].close - c.close) / c.close) * 100;
      if (futureReturn > 1.5) targetLabel = 0; // BUY
      else if (futureReturn < -1.5) targetLabel = 1; // SELL
    }

    // Features Vector matching the expanded set:
    // [ stockMom, niftyMom, vixRet, volSpike, rsi, macdHist, atr, ema9, ema21, ema50, vwapDist, bBandsPos, adx, relStrength, sectorMom, gapPct, intradayVol ]
    featureRows.push({
      time: c.time,
      close: c.close,
      high: c.high,
      low: c.low,
      volume: c.volume,
      inputs: [
        stockMom, // 0
        niftyMom, // 1
        vixRet,   // 2
        volSpike, // 3
        rsi[i] || 50, // 4
        macdHist[i] || 0.0, // 5
        atr[i] || 0.0, // 6
        ema9[i] ? ((c.close - ema9[i]) / ema9[i]) * 100 : 0.0, // 7
        ema21[i] ? ((c.close - ema21[i]) / ema21[i]) * 100 : 0.0, // 8
        ema50[i] ? ((c.close - ema50[i]) / ema50[i]) * 100 : 0.0, // 9
        vwapDist[i] || 0.0, // 10
        bBandsPos, // 11
        adx[i] || 25, // 12
        relStrength, // 13
        sectorMom, // 14
        gapPct, // 15
        intradayVol // 16
      ],
      target: targetLabel
    });
  }

  return featureRows;
}

module.exports = {
  constructFeatures
};
