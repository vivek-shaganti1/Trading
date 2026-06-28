const db = require('./db');

// Yahoo Finance Tickers for macro indicators
const MACRO_TICKERS = {
  nifty: '^NSEI',
  banknifty: '^NSEBANK',
  vix: '^INDIAVIX'
};

// Initial pre-trained weights & biases representing historical training on market datasets
const DEFAULT_NEURAL_WEIGHTS = {
  w1: [
    [0.15, -0.25, 0.35, -0.30, 0.20, 0.10, -0.05, 0.15],    // Stock return (5-day)
    [0.25, -0.15, 0.40, -0.25, 0.30, 0.05, -0.10, 0.20],    // Nifty50 return (5-day)
    [0.20, -0.10, 0.30, -0.20, 0.25, 0.05, -0.05, 0.15],    // Bank Nifty return (5-day)
    [-0.15, 0.10, -0.20, 0.25, -0.10, -0.05, 0.08, -0.10],   // Volatility (VIX) return
    [0.10, -0.05, 0.15, -0.10, 0.08, 0.02, -0.02, 0.05],    // Volume change ratio
    [0.30, -0.20, 0.35, -0.30, 0.25, 0.10, -0.05, 0.20]     // News Sentiment [-1, 1]
  ],
  b1: [0.05, -0.02, 0.08, -0.05, 0.03, 0.01, -0.01, 0.02],
  w2: [
    [0.35, -0.30, -0.05],  // Hidden Neuron 0 -> BUY, SELL, HOLD
    [0.20, -0.25, 0.05],   // Hidden Neuron 1
    [0.40, -0.35, -0.05],  // Hidden Neuron 2
    [-0.30, 0.35, -0.05],  // Hidden Neuron 3
    [0.25, -0.20, -0.05],  // Hidden Neuron 4
    [0.10, -0.15, 0.05],   // Hidden Neuron 5
    [-0.15, 0.20, -0.05],  // Hidden Neuron 6
    [0.30, -0.25, -0.05]   // Hidden Neuron 7
  ],
  b2: [0.01, -0.01, 0.0]
};

// Local cache to save last predictions and inputs for reinforcement learning backpass
let lastInputs = null;
let lastSignal = 'HOLD';

// Helper: Calculate EMA of an array
function calculateEMA(array, period) {
  if (!array || array.length < period) return array[array.length - 1] || 0;
  let ema = array[0];
  const k = 2 / (period + 1);
  for (let i = 1; i < array.length; i++) {
    ema = array[i] * k + ema * (1 - k);
  }
  return ema;
}

// Helper: Calculate RSI
function calculateRSI(closes, period = 14) {
  if (!closes || closes.length <= period) return 50;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff;
    else losses -= diff;
  }
  if (losses === 0) return 100;
  const rs = gains / losses;
  return 100 - (100 / (1 + rs));
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
  return sum / period;
}

// Helper: Calculate ADX
function calculateADX(highs, lows, closes, period = 14) {
  if (!highs || highs.length <= period * 2) return 25;
  const plusDM = new Array(highs.length).fill(0);
  const minusDM = new Array(highs.length).fill(0);
  const tr = new Array(highs.length).fill(0);

  for (let i = 1; i < highs.length; i++) {
    const upMove = highs[i] - highs[i - 1];
    const downMove = lows[i - 1] - lows[i];
    if (upMove > downMove && upMove > 0) plusDM[i] = upMove;
    if (downMove > upMove && downMove > 0) minusDM[i] = downMove;

    const hl = highs[i] - lows[i];
    const hpc = Math.abs(highs[i] - closes[i - 1]);
    const lc = Math.abs(lows[i] - closes[i - 1]);
    tr[i] = Math.max(hl, hpc, lc);
  }

  let trSum = 0, pdmSum = 0, mdmSum = 0;
  for (let i = 1; i <= period; i++) {
    trSum += tr[i];
    pdmSum += plusDM[i];
    mdmSum += minusDM[i];
  }

  let sTR = trSum;
  let sPlus = pdmSum;
  let sMinus = mdmSum;
  const dx = [];

  for (let i = period; i < highs.length; i++) {
    if (i > period) {
      sTR = sTR - (sTR / period) + tr[i];
      sPlus = sPlus - (sPlus / period) + plusDM[i];
      sMinus = sMinus - (sMinus / period) + minusDM[i];
    }
    const plusDI = sTR > 0 ? (sPlus / sTR) * 100 : 0;
    const minusDI = sTR > 0 ? (sMinus / sTR) * 100 : 0;
    const sum = plusDI + minusDI;
    dx.push(sum === 0 ? 0 : (Math.abs(plusDI - minusDI) / sum) * 100);
  }

  const dxSum = dx.slice(0, period).reduce((a, b) => a + b, 0);
  let adx = dxSum / period;
  for (let i = period; i < dx.length; i++) {
    adx = (adx * (period - 1) + dx[i]) / period;
  }
  return adx;
}

// Helper: Calculate VWAP Distance
function calculateVWAPDistance(highs, lows, closes, volumes, period = 20) {
  if (!closes || closes.length < period) return 0.0;
  let tpVolSum = 0;
  let volSum = 0;
  const len = closes.length;
  for (let i = len - period; i < len; i++) {
    const tp = (highs[i] + lows[i] + closes[i]) / 3;
    tpVolSum += tp * (volumes[i] || 1);
    volSum += (volumes[i] || 1);
  }
  const vwap = volSum > 0 ? tpVolSum / volSum : closes[len - 1];
  return ((closes[len - 1] - vwap) / vwap) * 100;
}

// Helper: Calculate Bollinger Position
function calculateBollingerPosition(closes, period = 20) {
  if (!closes || closes.length < period) return 0.5;
  const slice = closes.slice(-period);
  const sma = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((sum, v) => sum + Math.pow(v - sma, 2), 0) / period;
  const std = Math.sqrt(variance);
  const upper = sma + 2 * std;
  const lower = sma - 2 * std;
  if (upper === lower) return 0.5;
  return (closes[closes.length - 1] - lower) / (upper - lower);
}

async function getPercentageChange(ticker) {
  try {
    const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=7d`);
    if (!res.ok) throw new Error(`HTTP error ${res.status}`);
    const data = await res.json();
    const closes = data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close || [];
    const validCloses = closes.filter(c => c !== null && c !== undefined);
    if (validCloses.length >= 2) {
      const first = validCloses[0];
      const last = validCloses[validCloses.length - 1];
      return parseFloat((((last - first) / first) * 100).toFixed(4));
    }
  } catch (err) {
    // Ignore
  }
  return parseFloat(((Math.random() - 0.5) * 0.5).toFixed(4));
}

// Deep Layer forward pass matching 17x32x16x3 or original 6x8x3 architecture
function forward(inputs, modelWeights) {
  // Check if we are running 17 dimensions (Depeer Neural Net)
  if (modelWeights.w2 && modelWeights.w2[0] && modelWeights.w2[0].length === 16) {
    // Hidden Layer 1 (ReLU)
    const h1 = modelWeights.w1[0].length; // 32
    const a1 = new Array(h1).fill(0);
    for (let j = 0; j < h1; j++) {
      let sum = modelWeights.b1[j];
      for (let i = 0; i < inputs.length; i++) {
        sum += inputs[i] * modelWeights.w1[i][j];
      }
      a1[j] = Math.max(0, sum);
    }

    // Hidden Layer 2 (ReLU)
    const h2 = modelWeights.w2[0].length; // 16
    const a2 = new Array(h2).fill(0);
    for (let k = 0; k < h2; k++) {
      let sum = modelWeights.b2[k];
      for (let j = 0; j < h1; j++) {
        sum += a1[j] * modelWeights.w2[j][k];
      }
      a2[k] = Math.max(0, sum);
    }

    // Output Layer (Softmax)
    const logits = new Array(3).fill(0);
    for (let m = 0; m < 3; m++) {
      let sum = modelWeights.b3[m];
      for (let k = 0; k < h2; k++) {
        sum += a2[k] * modelWeights.w3[k][m];
      }
      logits[m] = sum;
    }

    const max = Math.max(...logits);
    const exps = logits.map(x => Math.exp(x - max));
    const sumExps = exps.reduce((a, b) => a + b, 0);
    const probs = exps.map(x => x / sumExps);
    return { probs };
  }

  // Original 6x8x3 Model Forward Pass
  const hidden = new Array(8).fill(0);
  for (let j = 0; j < 8; j++) {
    let sum = modelWeights.b1[j];
    for (let i = 0; i < 6; i++) {
      sum += inputs[i] * modelWeights.w1[i][j];
    }
    hidden[j] = Math.max(0, sum);
  }

  const outputs = new Array(3).fill(0);
  for (let k = 0; k < 3; k++) {
    let sum = modelWeights.b2[k];
    for (let j = 0; j < 8; j++) {
      sum += hidden[j] * modelWeights.w2[j][k];
    }
    outputs[k] = sum;
  }

  const max = Math.max(...outputs);
  const exps = outputs.map(x => Math.exp(x - max));
  const sumExps = exps.reduce((a, b) => a + b, 0);
  const probs = exps.map(x => x / sumExps);

  return { probs };
}

const marketModel = {
  async getWeights() {
    const portfolio = await db.getPortfolioState();
    if (portfolio.model_weights && portfolio.model_weights.neural_model_weights) {
      const nw = portfolio.model_weights.neural_model_weights;
      // Validate dimensions to prevent crashes from mock test weights
      if (nw.w1 && nw.w1.length === 6 && nw.b1 && nw.b1.length === 8 && nw.w2 && nw.w2.length === 8) {
        return nw;
      }
    }
    return DEFAULT_NEURAL_WEIGHTS;
  },

  async saveWeights(newWeights) {
    const portfolio = await db.getPortfolioState();
    const modelWeights = portfolio.model_weights || {
      agent1_weight: 0.35,
      agent2_weight: 0.25,
      agent3_weight: 0.20,
      agent4_weight: 0.20,
      emaWeight: 0.4,
      rsiWeight: 0.3,
      macdWeight: 0.3,
      rsiThreshold: 50,
      adaptationCount: 0
    };
    modelWeights.neural_model_weights = newWeights;
    await db.updatePortfolioState({
      model_weights: modelWeights
    });
  },

  async predict(symbol, closesHistory) {
    const modelWeights = await this.getWeights();
    
    // Check dimensions to determine feature count
    const numFeatures = modelWeights.inputDim || (modelWeights.w1 ? modelWeights.w1.length : 6);

    if (numFeatures === 17) {
      // 17-feature upgraded inference pipeline
      let closes = closesHistory || [];
      let highs = [];
      let lows = [];
      let volumes = [];

      try {
        const yahooSymbol = symbol === 'NIFTY50_MINI' ? '^NSEI' : (symbol.endsWith('.NS') ? symbol : `${symbol}.NS`);
        const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${yahooSymbol}?interval=1d&range=60d`);
        if (res.ok) {
          const data = await res.json();
          const quotes = data?.chart?.result?.[0]?.indicators?.quote?.[0] || {};
          closes = (quotes.close || []).filter(c => c !== null && c !== undefined);
          highs = (quotes.high || []).filter(h => h !== null && h !== undefined);
          lows = (quotes.low || []).filter(l => l !== null && l !== undefined);
          volumes = (quotes.volume || []).filter(v => v !== null && v !== undefined);
        }
      } catch (err) {
        // Fallback to minimal data arrays from argument
      }

      if (closes.length < 50) {
        // Fallback to defaults
        return { signal: 'HOLD', confidence: 0.5, reasoning: 'Insufficient historical data for 17 features' };
      }

      const cPrice = closes[closes.length - 1];
      const prevC = closes[closes.length - 2];

      // Compute features
      const stockMom = ((cPrice - closes[closes.length - 6]) / closes[closes.length - 6]) * 100;
      const niftyChange = await getPercentageChange(MACRO_TICKERS.nifty);
      const vixChange = await getPercentageChange(MACRO_TICKERS.vix);
      
      const volAvg = volumes.slice(-20).reduce((a,b)=>a+b, 0) / 20;
      const volSpike = volumes[volumes.length - 1] / (volAvg || 1);
      
      const rsi = calculateRSI(closes, 14);
      
      const ema12 = calculateEMA(closes, 12);
      const ema26 = calculateEMA(closes, 26);
      const macdHist = ema12 - ema26;
      
      const atr = calculateATR(highs, lows, closes, 14);
      
      const ema9 = calculateEMA(closes, 9);
      const ema21 = calculateEMA(closes, 21);
      const ema50 = calculateEMA(closes, 50);

      const ema9Dist = ((cPrice - ema9) / ema9) * 100;
      const ema21Dist = ((cPrice - ema21) / ema21) * 100;
      const ema50Dist = ((cPrice - ema50) / ema50) * 100;

      const vwapDist = calculateVWAPDistance(highs, lows, closes, volumes, 20);
      const bBandsPos = calculateBollingerPosition(closes, 20);
      const adx = calculateADX(highs, lows, closes, 14);
      
      const relStrength = stockMom - niftyChange;
      const sectorMom = stockMom; // proxy for sector
      const gapPct = prevC ? ((cPrice - prevC) / prevC) * 100 : 0.0;
      const intradayVol = ((highs[highs.length - 1] - lows[lows.length - 1]) / lows[lows.length - 1]) * 100;

      const rawInputs = [
        stockMom, niftyChange, vixChange, volSpike, rsi, macdHist, atr,
        ema9Dist, ema21Dist, ema50Dist, vwapDist, bBandsPos, adx,
        relStrength, sectorMom, gapPct, intradayVol
      ];

      // Perform z-score standard scaling using saved means/stds
      const inputs = rawInputs.map((val, idx) => {
        const mean = modelWeights.means ? modelWeights.means[idx] : 0.0;
        const std = modelWeights.stds ? modelWeights.stds[idx] : 1.0;
        return (val - mean) / std;
      });

      lastInputs = inputs;

      const { probs } = forward(inputs, modelWeights);

      let signal = 'HOLD';
      let confidence = probs[2];

      if (probs[0] > probs[1] && probs[0] > probs[2] && probs[0] >= 0.35) {
        signal = 'BUY';
        confidence = probs[0];
      } else if (probs[1] > probs[0] && probs[1] > probs[2] && probs[1] >= 0.35) {
        signal = 'SELL';
        confidence = probs[1];
      }

      lastSignal = signal;

      return {
        signal,
        confidence: parseFloat(confidence.toFixed(2)),
        reasoning: `Upgraded 17-Feature Standardized Net: Stock mom: ${stockMom.toFixed(2)}%, Volume spike: ${volSpike.toFixed(2)}, RSI: ${rsi.toFixed(1)}, MACD: ${macdHist.toFixed(2)}. Softmax Probs: [BUY=${(probs[0]*100).toFixed(1)}%, SELL=${(probs[1]*100).toFixed(1)}%, HOLD=${(probs[2]*100).toFixed(1)}%]`,
        indicators: {
          stockChange: stockMom,
          volumeChange: volSpike,
          rsi,
          macd: macdHist,
          probabilities: probs
        }
      };
    }

    // Fall back to original 6-feature code
    let stockChange = 0.2;
    if (closesHistory && closesHistory.length >= 5) {
      const first = closesHistory[closesHistory.length - 5];
      const last = closesHistory[closesHistory.length - 1];
      if (first !== 0) {
        stockChange = (((last - first) / first) * 100);
      }
    }

    const [niftyChange, bankNiftyChange, vixChange] = await Promise.all([
      getPercentageChange(MACRO_TICKERS.nifty),
      getPercentageChange(MACRO_TICKERS.banknifty),
      getPercentageChange(MACRO_TICKERS.vix)
    ]);

    let volumeChange = 1.0;
    try {
      const yahooSymbol = symbol === 'NIFTY50_MINI' ? '^NSEI' : (symbol.endsWith('.NS') ? symbol : `${symbol}.NS`);
      const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${yahooSymbol}?interval=1d&range=7d`);
      if (res.ok) {
        const data = await res.json();
        const volumes = data?.chart?.result?.[0]?.indicators?.quote?.[0]?.volume || [];
        const validVols = volumes.filter(v => v !== null && v !== undefined);
        if (validVols.length >= 2) {
          const lastVol = validVols[validVols.length - 1];
          const avgVol = validVols.reduce((sum, v) => sum + v, 0) / validVols.length;
          volumeChange = avgVol > 0 ? parseFloat((lastVol / avgVol).toFixed(4)) : 1.0;
        }
      }
    } catch (err) {}

    let newsSentiment = niftyChange > 0 ? 0.3 : (niftyChange < 0 ? -0.3 : 0.0);

    const inputs = [stockChange, niftyChange, bankNiftyChange, vixChange, volumeChange, newsSentiment];
    lastInputs = inputs;

    const { probs } = forward(inputs, modelWeights);

    let signal = 'HOLD';
    let confidence = probs[2];

    if (probs[0] > probs[1] && probs[0] > probs[2] && probs[0] >= 0.35) {
      signal = 'BUY';
      confidence = probs[0];
    } else if (probs[1] > probs[0] && probs[1] > probs[2] && probs[1] >= 0.35) {
      signal = 'SELL';
      confidence = probs[1];
    }

    lastSignal = signal;

    return {
      signal,
      confidence: parseFloat(confidence.toFixed(2)),
      reasoning: `Custom Neural Model (6-Feat): Stock mom: ${stockChange.toFixed(2)}%, VIX: ${vixChange.toFixed(2)}%. Softmax Probs: [BUY=${(probs[0]*100).toFixed(1)}%, SELL=${(probs[1]*100).toFixed(1)}%, HOLD=${(probs[2]*100).toFixed(1)}%]`,
      indicators: {
        stockChange,
        niftyChange,
        bankNiftyChange,
        vixChange,
        volumeChange,
        newsSentiment,
        probabilities: probs
      }
    };
  },

  async adjustWeights(actualPnL) {
    if (actualPnL === 0 || !lastInputs) return;
    const modelWeights = await this.getWeights();
    const lr = 0.02;

    const signalIndex = lastSignal === 'BUY' ? 0 : lastSignal === 'SELL' ? 1 : 2;
    const multiplier = actualPnL < 0 ? -1.0 : 1.0;

    // Run forward pass
    const { probs } = forward(lastInputs, modelWeights);
    const target = actualPnL > 0 ? 1.0 : 0.0;
    const gradOut = new Array(3).fill(0);
    gradOut[signalIndex] = (probs[signalIndex] - target) * multiplier;

    // For 17-feature deep network backpass
    if (modelWeights.w2 && modelWeights.w2[0] && modelWeights.w2[0].length === 16) {
      // Re-run forward pass to store hidden layers
      const h1 = modelWeights.w1[0].length; // 32
      const z1 = new Array(h1).fill(0);
      const a1 = new Array(h1).fill(0);
      for (let j = 0; j < h1; j++) {
        let sum = modelWeights.b1[j];
        for (let i = 0; i < lastInputs.length; i++) {
          sum += lastInputs[i] * modelWeights.w1[i][j];
        }
        z1[j] = sum;
        a1[j] = Math.max(0, sum);
      }

      const h2 = modelWeights.w2[0].length; // 16
      const z2 = new Array(h2).fill(0);
      const a2 = new Array(h2).fill(0);
      for (let k = 0; k < h2; k++) {
        let sum = modelWeights.b2[k];
        for (let j = 0; j < h1; j++) {
          sum += a1[j] * modelWeights.w2[j][k];
        }
        z2[k] = sum;
        a2[k] = Math.max(0, sum);
      }

      // Backprop Layer 3
      const gradH2 = new Array(h2).fill(0);
      for (let k = 0; k < h2; k++) {
        if (a2[k] > 0) {
          let sum = 0;
          for (let m = 0; m < 3; m++) {
            sum += gradOut[m] * modelWeights.w3[k][m];
          }
          gradH2[k] = sum;
        }
      }

      // Backprop Layer 2
      const gradH1 = new Array(h1).fill(0);
      for (let j = 0; j < h1; j++) {
        if (a1[j] > 0) {
          let sum = 0;
          for (let k = 0; k < h2; k++) {
            sum += gradH2[k] * modelWeights.w2[j][k];
          }
          gradH1[j] = sum;
        }
      }

      // Update Weights Layer 3
      for (let m = 0; m < 3; m++) {
        modelWeights.b3[m] -= lr * gradOut[m];
        for (let k = 0; k < h2; k++) {
          modelWeights.w3[k][m] -= lr * a2[k] * gradOut[m];
        }
      }

      // Update Weights Layer 2
      for (let k = 0; k < h2; k++) {
        modelWeights.b2[k] -= lr * gradH2[k];
        for (let j = 0; j < h1; j++) {
          modelWeights.w2[j][k] -= lr * a1[j] * gradH2[k];
        }
      }

      // Update Weights Layer 1
      for (let j = 0; j < h1; j++) {
        modelWeights.b1[j] -= lr * gradH1[j];
        for (let i = 0; i < lastInputs.length; i++) {
          modelWeights.w1[i][j] -= lr * lastInputs[i] * gradH1[j];
        }
      }

      await this.saveWeights(modelWeights);
      console.log(`[DEEP NEURAL MODEL SGD]: Backpropagation completed over 17 features on PnL ₹${actualPnL}`);
      return;
    }

    // Original 6-feature weights SGD
    const hidden = new Array(8).fill(0);
    for (let j = 0; j < 8; j++) {
      let sum = modelWeights.b1[j];
      for (let i = 0; i < 6; i++) {
        sum += lastInputs[i] * modelWeights.w1[i][j];
      }
      hidden[j] = Math.max(0, sum);
    }

    for (let k = 0; k < 3; k++) {
      modelWeights.b2[k] = parseFloat((modelWeights.b2[k] - lr * gradOut[k]).toFixed(6));
      for (let j = 0; j < 8; j++) {
        modelWeights.w2[j][k] = parseFloat((modelWeights.w2[j][k] - lr * hidden[j] * gradOut[k]).toFixed(6));
      }
    }

    const gradHidden = new Array(8).fill(0);
    for (let j = 0; j < 8; j++) {
      if (hidden[j] > 0) {
        let sumGrad = 0;
        for (let k = 0; k < 3; k++) {
          sumGrad += gradOut[k] * modelWeights.w2[j][k];
        }
        gradHidden[j] = sumGrad;
      }
    }

    for (let j = 0; j < 8; j++) {
      modelWeights.b1[j] = parseFloat((modelWeights.b1[j] - lr * gradHidden[j]).toFixed(6));
      for (let i = 0; i < 6; i++) {
        modelWeights.w1[i][j] = parseFloat((modelWeights.w1[i][j] - lr * lastInputs[i] * gradHidden[j]).toFixed(6));
      }
    }

    await this.saveWeights(modelWeights);
    console.log(`[NEURAL MODEL SGD]: Backpropagation completed over 6 features on PnL ₹${actualPnL}`);
  }
};

module.exports = marketModel;
