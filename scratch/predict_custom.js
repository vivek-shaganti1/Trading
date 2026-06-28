const inputs = [8.5, 2.8, 3.2, -12.0, 3.5, 0.9];

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

// Hidden Layer activations
const hidden = [];
console.log('--- STEP 1: HIDDEN LAYER ACTIVATIONS (ReLU) ---');
for (let j = 0; j < 8; j++) {
  let sum = weights.b1[j];
  for (let i = 0; i < 6; i++) {
    sum += inputs[i] * weights.w1[i][j];
  }
  const relu = Math.max(0, sum);
  hidden.push(relu);
  console.log(`h${j} = ${relu.toFixed(4)}`);
}

// Output Layer Logits
const logits = [];
console.log('\n--- STEP 2: OUTPUT LAYER LOGITS ---');
const classes = ['BUY', 'SELL', 'HOLD'];
for (let k = 0; k < 3; k++) {
  let sum = weights.b2[k];
  for (let j = 0; j < 8; j++) {
    sum += hidden[j] * weights.w2[j][k];
  }
  logits.push(sum);
  console.log(`logit(${classes[k]}) = ${sum.toFixed(4)}`);
}

// Softmax
const max = Math.max(...logits);
const exps = logits.map(x => Math.exp(x - max));
const sumExps = exps.reduce((a, b) => a + b, 0);
const probs = exps.map(x => x / sumExps);

console.log('\n--- STEP 3: SOFTMAX PROBABILITIES ---');
for (let k = 0; k < 3; k++) {
  console.log(`P(${classes[k]}) = ${(probs[k]*100).toFixed(1)}%`);
}

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

console.log(`\nFinal Decision: ${signal} (Confidence: ${(confidence*100).toFixed(1)}%)`);
