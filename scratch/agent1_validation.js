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

function forward(inputs) {
  // inputs: [stockChange, niftyChange, bankNiftyChange, vixChange, volumeChange, newsSentiment]
  
  // 1. Hidden Layer
  const hidden = new Array(8).fill(0);
  for (let j = 0; j < 8; j++) {
    let sum = weights.b1[j];
    for (let i = 0; i < 6; i++) {
      sum += inputs[i] * weights.w1[i][j];
    }
    hidden[j] = Math.max(0, sum);
  }

  // 2. Output Layer
  const outputs = new Array(3).fill(0);
  for (let k = 0; k < 3; k++) {
    let sum = weights.b2[k];
    for (let j = 0; j < 8; j++) {
      sum += hidden[j] * weights.w2[j][k];
    }
    outputs[k] = sum;
  }

  // 3. Softmax
  const max = Math.max(...outputs);
  const exps = outputs.map(x => Math.exp(x - max));
  const sumExps = exps.reduce((a, b) => a + b, 0);
  const probs = exps.map(x => x / sumExps);

  // probs index: 0 = BUY, 1 = SELL, 2 = HOLD
  let signal = 'HOLD';
  let confidence = probs[2];

  if (probs[0] > probs[1] && probs[0] > probs[2] && probs[0] >= 0.35) {
    signal = 'BUY';
    confidence = probs[0];
  } else if (probs[1] > probs[0] && probs[1] > probs[2] && probs[1] >= 0.35) {
    signal = 'SELL';
    confidence = probs[1];
  }

  return { signal, confidence, probs };
}

function randomRange(min, max) {
  return Math.random() * (max - min) + min;
}

function runValidation() {
  const NUM_SCENARIOS = 10000;
  
  let buyCount = 0;
  let sellCount = 0;
  let holdCount = 0;
  
  let totalConfidence = 0;
  const hist = {
    '90-100%': 0,
    '80-89%': 0,
    '70-79%': 0,
    '60-69%': 0,
    '50-59%': 0,
    'Under 50%': 0
  };

  const buyHighProb = [];
  const sellHighProb = [];
  const closeProbs = [];

  for (let i = 0; i < NUM_SCENARIOS; i++) {
    // Generate synthetic inputs
    const stockMomentum = randomRange(-15, 15);
    const niftyMomentum = randomRange(-8, 8);
    const bankniftyMomentum = randomRange(-8, 8);
    const vixReturn = randomRange(-30, 50);
    const volumeRatio = randomRange(0.2, 5.0);
    const newsSentiment = randomRange(-1, 1);
    
    const inputs = [stockMomentum, niftyMomentum, bankniftyMomentum, vixReturn, volumeRatio, newsSentiment];
    const res = forward(inputs);
    
    totalConfidence += res.confidence;
    
    if (res.signal === 'BUY') buyCount++;
    else if (res.signal === 'SELL') sellCount++;
    else holdCount++;

    const confPct = res.confidence * 100;
    if (confPct >= 90) hist['90-100%']++;
    else if (confPct >= 80) hist['80-89%']++;
    else if (confPct >= 70) hist['70-79%']++;
    else if (confPct >= 60) hist['60-69%']++;
    else if (confPct >= 50) hist['50-59%']++;
    else hist['Under 50%']++;

    const pBuy = res.probs[0];
    const pSell = res.probs[1];
    const pHold = res.probs[2];

    const scenarioData = {
      inputs: {
        stockMomentum,
        niftyMomentum,
        bankniftyMomentum,
        vixReturn,
        volumeRatio,
        newsSentiment
      },
      probs: { BUY: pBuy, SELL: pSell, HOLD: pHold },
      signal: res.signal,
      confidence: res.confidence
    };

    if (pBuy > 0.8) {
      buyHighProb.push(scenarioData);
    }
    if (pSell > 0.8) {
      sellHighProb.push(scenarioData);
    }

    // close probabilities (all within 10% range of each other, e.g. max - min < 0.1)
    const maxP = Math.max(pBuy, pSell, pHold);
    const minP = Math.min(pBuy, pSell, pHold);
    if (maxP - minP <= 0.1) {
      closeProbs.push(scenarioData);
    }
  }

  const avgConfidence = totalConfidence / NUM_SCENARIOS;

  console.log(JSON.stringify({
    buyCount,
    sellCount,
    holdCount,
    avgConfidence,
    hist,
    totalScenarios: NUM_SCENARIOS,
    buyHighProbCount: buyHighProb.length,
    sellHighProbCount: sellHighProb.length,
    closeProbsCount: closeProbs.length,
    sampleBuyHighProb: buyHighProb.slice(0, 2),
    sampleSellHighProb: sellHighProb.slice(0, 2),
    sampleCloseProbs: closeProbs.slice(0, 2)
  }, null, 2));
}

runValidation();
