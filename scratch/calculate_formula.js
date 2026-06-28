const inputs = [0.20, -1.03, 2.75, 1.43, 1.01, 0.00];

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
  let expr = `${weights.b1[j]}`;
  let sum = weights.b1[j];
  for (let i = 0; i < 6; i++) {
    const term = inputs[i] * weights.w1[i][j];
    expr += ` + (${inputs[i]} * ${weights.w1[i][j]})`;
    sum += term;
  }
  const relu = Math.max(0, sum);
  hidden.push(relu);
  console.log(`h${j} = max(0, ${expr}) = max(0, ${sum.toFixed(4)}) = ${relu.toFixed(4)}`);
}

// Output Layer Logits
const logits = [];
console.log('\n--- STEP 2: OUTPUT LAYER LOGITS ---');
const classes = ['BUY', 'SELL', 'HOLD'];
for (let k = 0; k < 3; k++) {
  let expr = `${weights.b2[k]}`;
  let sum = weights.b2[k];
  for (let j = 0; j < 8; j++) {
    const term = hidden[j] * weights.w2[j][k];
    expr += ` + (${hidden[j].toFixed(4)} * ${weights.w2[j][k]})`;
    sum += term;
  }
  logits.push(sum);
  console.log(`logit(${classes[k]}) = ${expr} = ${sum.toFixed(4)}`);
}

// Softmax
const max = Math.max(...logits);
const exps = logits.map(x => Math.exp(x - max));
const sumExps = exps.reduce((a, b) => a + b, 0);
const probs = exps.map(x => x / sumExps);

console.log('\n--- STEP 3: SOFTMAX PROBABILITIES ---');
console.log(`max_logit = ${max.toFixed(4)}`);
for (let k = 0; k < 3; k++) {
  console.log(`P(${classes[k]}) = exp(${logits[k].toFixed(4)} - ${max.toFixed(4)}) / sum(exp) = ${Math.exp(logits[k] - max).toFixed(4)} / ${sumExps.toFixed(4)} = ${(probs[k]*100).toFixed(1)}%`);
}
