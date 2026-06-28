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

  // Class selection rules
  let signal = 'HOLD';
  let confidence = probs[2];

  if (probs[0] > probs[1] && probs[0] > probs[2] && probs[0] >= 0.35) {
    signal = 'BUY';
    confidence = probs[0];
  } else if (probs[1] > probs[0] && probs[1] > probs[2] && probs[1] >= 0.35) {
    signal = 'SELL';
    confidence = probs[1];
  }

  return { hidden, probs, signal, confidence };
}

const scenarios = [
  {
    name: 'Strong bullish trend',
    inputs: [4.0, 2.0, 2.5, -8.0, 1.2, 0.5]
  },
  {
    name: 'Strong bearish trend',
    inputs: [-4.0, -2.0, -2.5, 15.0, 1.3, -0.5]
  },
  {
    name: 'Sideways market',
    inputs: [0.05, -0.02, 0.03, 0.1, 0.95, 0.0]
  },
  {
    name: 'High VIX panic',
    inputs: [-6.0, -4.0, -4.5, 45.0, 1.8, -0.7]
  },
  {
    name: 'Volume breakout',
    inputs: [3.0, 0.2, 0.3, -1.0, 4.5, 0.2]
  },
  {
    name: 'Positive news shock',
    inputs: [0.5, 0.0, 0.0, -0.5, 1.5, 1.0]
  },
  {
    name: 'Negative news shock',
    inputs: [-0.5, 0.0, 0.0, 1.0, 1.6, -1.0]
  }
];

scenarios.forEach((sc, index) => {
  const res = forward(sc.inputs);
  console.log(`=== SCENARIO ${index + 1}: ${sc.name} ===`);
  console.log('Inputs:', JSON.stringify(sc.inputs));
  console.log('Hidden Layer activations:', JSON.stringify(res.hidden.map(h => parseFloat(h.toFixed(4)))));
  console.log('Softmax outputs (BUY, SELL, HOLD):', JSON.stringify(res.probs.map(p => parseFloat(p.toFixed(4)))));
  console.log('Signal:', res.signal);
  console.log('Confidence:', parseFloat(res.confidence.toFixed(4)));
  console.log();
});
