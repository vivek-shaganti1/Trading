const weights = {
  w1: [
    [0.15, -0.25, 0.35, -0.30, 0.20, 0.10, -0.05, 0.15],
    [0.25, -0.15, 0.40, -0.25, 0.30, 0.05, -0.10, 0.20],
    [0.20, -0.10, 0.30, -0.20, 0.25, 0.05, -0.05, 0.15],
    [-0.15, 0.10, -0.20, 0.25, -0.10, -0.05, 0.08, -0.10],
    [0.10, -0.05, 0.15, -0.10, 0.08, 0.02, -0.02, 0.05],
    [0.30, -0.20, 0.35, -0.30, 0.25, 0.10, -0.05, 0.20]
  ],
  b1: [0.05, -0.02, 0.08, -0.05, 0.03, 0.01, -0.01, 0.02],
  w2: [
    [0.35, -0.30, -0.05],
    [0.20, -0.25, 0.05],
    [0.40, -0.35, -0.05],
    [-0.30, 0.35, -0.05],
    [0.25, -0.20, -0.05],
    [0.10, -0.15, 0.05],
    [-0.15, 0.20, -0.05],
    [0.30, -0.25, -0.05]
  ],
  b2: [0.01, -0.01, 0.0]
};

function runAgent1() {
  const inputs = [7, -3, -2, 10, 2, -0.7];
  const hidden = new Array(8).fill(0);
  for (let j = 0; j < 8; j++) {
    let sum = weights.b1[j];
    for (let i = 0; i < 6; i++) {
      sum += inputs[i] * weights.w1[i][j];
    }
    hidden[j] = Math.max(0, sum);
  }

  const outputs = new Array(3).fill(0);
  for (let k = 0; k < 3; k++) {
    let sum = weights.b2[k];
    for (let j = 0; j < 8; j++) {
      sum += hidden[j] * weights.w2[j][k];
    }
    outputs[k] = sum;
  }

  const max = Math.max(...outputs);
  const exps = outputs.map(x => Math.exp(x - max));
  const sumExps = exps.reduce((a, b) => a + b, 0);
  const probs = exps.map(x => x / sumExps);

  let signal = 'HOLD';
  let confidence = probs[2];
  if (probs[0] > probs[1] && probs[0] > probs[2] && probs[0] >= 0.35) {
    signal = 'BUY';
    confidence = probs[0];
  } else if (probs[1] > probs[0] && probs[1] > probs[2] && probs[1] >= 0.35) {
    signal = 'SELL';
    confidence = probs[1];
  }

  return { signal, confidence, probs, hidden };
}

function runAgent3() {
  // ema9 = 790, ema21 = 785, rsi = 60, macd = 2, price = 800, stock_momentum = 7
  const emaSignal = 790 > 785 ? 1 : -1; // +1
  
  const rsi = 60;
  let rsiSignal = 0;
  if (rsi < 30) rsiSignal = 1;
  else if (rsi > 70) rsiSignal = -1;
  else rsiSignal = emaSignal; // +1

  const macdLine = 2;
  const macdSignal = macdLine > 0 ? 1 : -1; // +1

  const currentPrice = 800;
  // VWAP is likely around 792 based on rising stock, so price > VWAP
  const vwapSignal = 1;

  const roc = 7;
  const rocSignal = roc > 0 ? 1 : -1; // +1

  const trendStrength = 'STRONG_UP';
  const strengthScore = 0.85;

  const totalScore = emaSignal + rsiSignal + macdSignal + vwapSignal + rocSignal; // 5
  const confidence = parseFloat(((Math.abs(totalScore) / 5) * 0.4 + strengthScore * 0.6).toFixed(2));

  let signal = 'HOLD';
  if (totalScore >= 2) {
    signal = 'BUY';
  } else if (totalScore <= -2) {
    signal = 'SELL';
  }

  return {
    signal,
    confidence,
    totalScore,
    reasoning: `EMA9/21: BULLISH, RSI: ${rsi} (Trend follower: BUY), MACD: ${macdLine}, VWAP: Bullish, Momentum: ${roc}%, Trend: ${trendStrength}. Total score: ${totalScore}/5.`
  };
}

function runAgent4() {
  // nifty_momentum = -3, banknifty_momentum = -2, vix_return = 10
  const niftyChange = -3;
  const bankNiftyChange = -2;
  const vixChange = 10;
  
  const avgGlobalChange = -1.2; // global indices down
  const globalSignal = -1; // avgGlobalChange < -0.3
  
  const usdinrChange = 0.4;
  const crudeChange = 0.6;
  
  const currencyDrag = usdinrChange > 0.2 ? -1 : (usdinrChange < -0.2 ? 1 : 0); // -1
  const crudeDrag = crudeChange > 0.5 ? -1 : (crudeChange < -0.5 ? 1 : 0); // -1

  const sectorPerformance = {
    ENERGY: -1.0,
    IT: -1.5,
    BANKING: 7 // SBIN is BANKING (surging +7.0% despite banknifty index down)
  };

  let leadingSector = 'BANKING';
  let maxChange = 7;

  let sectorSignal = 0;
  if (maxChange > 0.5) {
    sectorSignal = (leadingSector === 'BANKING' || leadingSector === 'ENERGY') ? 1.2 : 0.8; // BANKING leads -> 1.2
  } else if (maxChange < -0.5) {
    sectorSignal = -1.0;
  }

  const totalScore = globalSignal + currencyDrag + crudeDrag + sectorSignal; // -1 - 1 - 1 + 1.2 = -1.8
  const confidence = parseFloat((Math.min(1.0, Math.max(0.3, 0.5 + Math.abs(totalScore) * 0.15))).toFixed(2));

  let signal = 'HOLD';
  if (totalScore >= 1.0) {
    signal = 'BUY';
  } else if (totalScore <= -1.0) {
    signal = 'SELL';
  }

  return {
    signal,
    confidence,
    totalScore,
    reasoning: `Market Context: Global avg: ${avgGlobalChange.toFixed(2)}% (BEAR), USD/INR: ${usdinrChange.toFixed(2)}%, Crude: ${crudeChange.toFixed(2)}%, Sector leader: ${leadingSector} (${maxChange.toFixed(2)}%). Total score: ${totalScore.toFixed(2)}.`
  };
}

console.log('AGENT 1:', runAgent1());
console.log('AGENT 3:', runAgent3());
console.log('AGENT 4:', runAgent4());
