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

function forward(inputs, threshold) {
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
  if (probs[0] > probs[1] && probs[0] > probs[2] && probs[0] >= threshold) {
    signal = 'BUY';
  } else if (probs[1] > probs[0] && probs[1] > probs[2] && probs[1] >= threshold) {
    signal = 'SELL';
  }

  return signal;
}

function randomRange(min, max) {
  return Math.random() * (max - min) + min;
}

const NUM_SCENARIOS = 10000;
const scenarios = [];
for (let i = 0; i < NUM_SCENARIOS; i++) {
  scenarios.push([
    randomRange(-15, 15),
    randomRange(-8, 8),
    randomRange(-8, 8),
    randomRange(-30, 50),
    randomRange(0.2, 5.0),
    randomRange(-1, 1)
  ]);
}

const thresholds = [0.35, 0.45, 0.55, 0.65];
const results = {};

thresholds.forEach(t => {
  let buy = 0, sell = 0, hold = 0;
  scenarios.forEach(sc => {
    const sig = forward(sc, t);
    if (sig === 'BUY') buy++;
    else if (sig === 'SELL') sell++;
    else hold++;
  });
  results[t] = { buy, sell, hold };
});

console.log(JSON.stringify(results, null, 2));
