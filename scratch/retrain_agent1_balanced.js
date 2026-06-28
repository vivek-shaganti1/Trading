require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { DeeperNeuralNet } = require('./models');
const { loadAllHistoricalData } = require('./data_loader');
const { constructFeatures } = require('./feature_engineer');
const db = require('../db');

function calculateMetrics(preds, targets) {
  const classes = ['BUY', 'SELL', 'HOLD'];
  
  // Confusion Matrix [Actual][Predicted]
  const matrix = Array.from({ length: 3 }, () => new Array(3).fill(0));
  for (let i = 0; i < preds.length; i++) {
    matrix[targets[i]][preds[i]]++;
  }

  // Precision, Recall, F1
  const report = {};
  classes.forEach((cls, idx) => {
    let tp = matrix[idx][idx];
    let fp = 0;
    let fn = 0;
    for (let i = 0; i < 3; i++) {
      if (i !== idx) {
        fp += matrix[i][idx];
        fn += matrix[idx][i];
      }
    }

    const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
    const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
    const f1 = precision + recall > 0 ? 2 * (precision * recall) / (precision + recall) : 0;

    report[cls] = {
      precision: parseFloat((precision * 100).toFixed(2)),
      recall: parseFloat((recall * 100).toFixed(2)),
      f1: parseFloat((f1 * 100).toFixed(2)),
      support: tp + fn
    };
  });

  const overallAccuracy = (preds.filter((p, i) => p === targets[i]).length / preds.length) * 100;

  return { matrix, report, overallAccuracy };
}

class ClassWeightedNeuralNet extends DeeperNeuralNet {
  constructor(inputDim = 17, h1 = 32, h2 = 16, outputDim = 3, classWeights = [1, 1, 1]) {
    super(inputDim, h1, h2, outputDim);
    this.classWeights = classWeights;
  }

  train(x, targetLabel, lr = 0.01) {
    const { a1, a2, probs } = this.forward(x);

    const gradOut = [...probs];
    gradOut[targetLabel] -= 1.0;

    const weight = this.classWeights[targetLabel];
    for (let m = 0; m < this.outputDim; m++) {
      gradOut[m] *= weight;
    }

    const gradH2 = new Array(this.h2).fill(0);
    for (let k = 0; k < this.h2; k++) {
      if (a2[k] > 0) {
        let sum = 0;
        for (let m = 0; m < this.outputDim; m++) {
          sum += gradOut[m] * this.w3[k][m];
        }
        gradH2[k] = sum;
      }
    }

    const gradH1 = new Array(this.h1).fill(0);
    for (let j = 0; j < this.h1; j++) {
      if (a1[j] > 0) {
        let sum = 0;
        for (let k = 0; k < this.h2; k++) {
          sum += gradH2[k] * this.w2[j][k];
        }
        gradH1[j] = sum;
      }
    }

    for (let m = 0; m < this.outputDim; m++) {
      this.b3[m] -= lr * gradOut[m];
      for (let k = 0; k < this.h2; k++) {
        this.w3[k][m] -= lr * a2[k] * gradOut[m];
      }
    }
    for (let k = 0; k < this.h2; k++) {
      this.b2[k] -= lr * gradH2[k];
      for (let j = 0; j < this.h1; j++) {
        this.w2[j][k] -= lr * a1[j] * gradH2[k];
      }
    }
    for (let j = 0; j < this.h1; j++) {
      this.b1[j] -= lr * gradH1[j];
      for (let i = 0; i < this.inputDim; i++) {
        this.w1[i][j] -= lr * x[i] * gradH1[j];
      }
    }
  }
}

async function runRetraining() {
  console.log('🏁 Starting Class-Balanced Retraining of Agent 1 with Standard Scaling...');
  
  const rawData = await loadAllHistoricalData();
  const niftyData = rawData.NIFTY;
  
  if (!niftyData || niftyData.length === 0) {
    console.error('Nifty 50 historical data missing. Halting.');
    return;
  }

  const allSamples = [];
  const symbols = Object.keys(rawData).filter(k => k !== 'NIFTY');
  
  symbols.forEach(sym => {
    const candles = rawData[sym];
    const engineered = constructFeatures(sym, candles, niftyData, rawData);
    allSamples.push(...engineered);
  });

  console.log(`Total engineered samples: ${allSamples.length}`);

  const splitIdx = Math.round(allSamples.length * 0.8);
  const trainData = allSamples.slice(0, splitIdx);
  const testData = allSamples.slice(splitIdx);

  // Compute Mean and Std of each feature from Train dataset
  const numFeatures = 17;
  const means = new Array(numFeatures).fill(0);
  const stds = new Array(numFeatures).fill(0);

  for (let f = 0; f < numFeatures; f++) {
    let sum = 0;
    trainData.forEach(row => {
      sum += row.inputs[f];
    });
    means[f] = sum / trainData.length;

    let varianceSum = 0;
    trainData.forEach(row => {
      varianceSum += Math.pow(row.inputs[f] - means[f], 2);
    });
    stds[f] = Math.sqrt(varianceSum / trainData.length) || 1.0; // avoid div by zero
  }

  console.log('\nCalculated Feature Scales:');
  const featureNames = [
    'Stock Momentum', 'Nifty Momentum', 'VIX Return', 'Volume Spike Score',
    'RSI (14)', 'MACD Hist', 'ATR (14)', 'EMA9 Dist', 'EMA21 Dist', 'EMA50 Dist',
    'VWAP Distance', 'Bollinger Position', 'ADX (14)', 'Relative Strength vs Nifty',
    'Sector Momentum', 'Gap %', 'Intraday Volatility'
  ];
  featureNames.forEach((name, i) => {
    console.log(`  • ${name.padEnd(28)}: Mean = ${means[i].toFixed(4).padStart(8)}, Std = ${stds[i].toFixed(4).padStart(8)}`);
  });

  // Apply scaling to train data
  const scaleVector = (inputs) => {
    return inputs.map((val, idx) => (val - means[idx]) / stds[idx]);
  };

  trainData.forEach(row => {
    row.rawInputs = [...row.inputs];
    row.inputs = scaleVector(row.inputs);
  });

  // Apply scaling to test data
  testData.forEach(row => {
    row.rawInputs = [...row.inputs];
    row.inputs = scaleVector(row.inputs);
  });

  // Analyze class distribution before balancing
  const countsBefore = [0, 0, 0];
  trainData.forEach(s => countsBefore[s.target]++);

  console.log('\n--- CLASS DISTRIBUTION BEFORE BALANCING (TRAIN) ---');
  console.log(`BUY (0):  ${countsBefore[0]} (${(countsBefore[0]/trainData.length*100).toFixed(2)}%)`);
  console.log(`SELL (1): ${countsBefore[1]} (${(countsBefore[1]/trainData.length*100).toFixed(2)}%)`);
  console.log(`HOLD (2): ${countsBefore[2]} (${(countsBefore[2]/trainData.length*100).toFixed(2)}%)`);

  // Oversample minority classes (BUY and SELL)
  const maxClassCount = Math.max(...countsBefore);
  const balancedTrainData = [];

  for (let label = 0; label < 3; label++) {
    const classRows = trainData.filter(r => r.target === label);
    if (classRows.length === 0) continue;
    for (let i = 0; i < maxClassCount; i++) {
      balancedTrainData.push(classRows[i % classRows.length]);
    }
  }

  balancedTrainData.sort(() => Math.random() - 0.5);

  const countsAfter = [0, 0, 0];
  balancedTrainData.forEach(s => countsAfter[s.target]++);

  console.log('\n--- CLASS DISTRIBUTION AFTER BALANCING (TRAIN) ---');
  console.log(`BUY (0):  ${countsAfter[0]} (${(countsAfter[0]/balancedTrainData.length*100).toFixed(2)}%)`);
  console.log(`SELL (1): ${countsAfter[1]} (${(countsAfter[1]/balancedTrainData.length*100).toFixed(2)}%)`);
  console.log(`HOLD (2): ${countsAfter[2]} (${(countsAfter[2]/balancedTrainData.length*100).toFixed(2)}%)`);

  // Calculate inverse class weights
  const totalWeightSamples = countsBefore.reduce((a,b)=>a+b, 0);
  const classWeights = countsBefore.map(c => c > 0 ? totalWeightSamples / (3 * c) : 1.0);
  console.log('\nCalculated Inverse Class Weights for Loss:', classWeights.map(w => w.toFixed(4)));

  // Train Neural Net
  console.log('\nTraining Class-Weighted Standardized Neural Network...');
  const nn = new ClassWeightedNeuralNet(17, 32, 16, 3, classWeights);
  
  const epochs = 40;
  let bestValAcc = 0;
  let bestWeights = null;

  for (let ep = 1; ep <= epochs; ep++) {
    balancedTrainData.forEach(row => {
      nn.train(row.inputs, row.target, 0.005); // slightly lower learning rate for stability
    });
    
    // Evaluate on test/validation set
    const valPreds = testData.map(row => {
      const probs = nn.forward(row.inputs).probs;
      if (probs[0] > probs[1] && probs[0] > probs[2]) return 0;
      if (probs[1] > probs[0] && probs[1] > probs[2]) return 1;
      return 2;
    });
    const valTargets = testData.map(row => row.target);
    const acc = (valPreds.filter((p, i) => p === valTargets[i]).length / valPreds.length) * 100;
    
    if (acc > bestValAcc) {
      bestValAcc = acc;
      bestWeights = {
        w1: JSON.parse(JSON.stringify(nn.w1)),
        b1: [...nn.b1],
        w2: JSON.parse(JSON.stringify(nn.w2)),
        b2: [...nn.b2],
        w3: JSON.parse(JSON.stringify(nn.w3)),
        b3: [...nn.b3]
      };
    }
    
    if (ep % 5 === 0 || ep === epochs) {
      console.log(`Epoch ${ep}/${epochs} completed. Validation Accuracy: ${acc.toFixed(2)}% (Best: ${bestValAcc.toFixed(2)}%)`);
    }
  }

  // Restore best weights
  nn.w1 = bestWeights.w1; nn.b1 = bestWeights.b1;
  nn.w2 = bestWeights.w2; nn.b2 = bestWeights.b2;
  nn.w3 = bestWeights.w3; nn.b3 = bestWeights.b3;

  // Final evaluation
  const finalPreds = testData.map(row => {
    const probs = nn.forward(row.inputs).probs;
    if (probs[0] > probs[1] && probs[0] > probs[2]) return 0;
    if (probs[1] > probs[0] && probs[1] > probs[2]) return 1;
    return 2;
  });
  const finalTargets = testData.map(row => row.target);

  const { matrix, report, overallAccuracy } = calculateMetrics(finalPreds, finalTargets);

  console.log('\n--- CONFUSION MATRIX ON TEST DATA (Actual Rows, Predicted Cols) ---');
  console.log('       [BUY]  [SELL]  [HOLD]');
  console.log(`[BUY]  ${String(matrix[0][0]).padEnd(5)}  ${String(matrix[0][1]).padEnd(6)}  ${matrix[0][2]}`);
  console.log(`[SELL] ${String(matrix[1][0]).padEnd(5)}  ${String(matrix[1][1]).padEnd(6)}  ${matrix[1][2]}`);
  console.log(`[HOLD] ${String(matrix[2][0]).padEnd(5)}  ${String(matrix[2][1]).padEnd(6)}  ${matrix[2][2]}`);

  console.log('\n--- METRICS PER CLASS ---');
  console.log('Class | Precision | Recall | F1 Score | Support');
  console.log('------|-----------|--------|----------|--------');
  Object.keys(report).forEach(cls => {
    const r = report[cls];
    console.log(`${cls.padEnd(5)} | ${String(r.precision + '%').padEnd(9)} | ${String(r.recall + '%').padEnd(6)} | ${String(r.f1 + '%').padEnd(8)} | ${r.support}`);
  });
  console.log(`Overall Accuracy: ${overallAccuracy.toFixed(2)}%\n`);

  console.log('Saving retrained weights & scale factors to database...');
  try {
    const defaultWeights = {
      agent1_weight: 0.35,
      agent2_weight: 0.25,
      agent3_weight: 0.20,
      agent4_weight: 0.20,
      emaWeight: 0.4,
      rsiWeight: 0.3,
      macdWeight: 0.3,
      rsiThreshold: 50,
      adaptationCount: 1,
      neural_model_weights: {
        w1: nn.w1,
        b1: nn.b1,
        w2: nn.w2,
        b2: nn.b2,
        w3: nn.w3,
        b3: nn.b3,
        inputDim: 17,
        h1: 32,
        h2: 16,
        outputDim: 3,
        means: means,
        stds: stds
      }
    };
    
    await db.updatePortfolioState({
      model_weights: defaultWeights
    });
    console.log('✅ Success: Standardized class-balanced weights saved successfully to PostgreSQL!');
  } catch (dbErr) {
    console.error('Error writing weights to database:', dbErr.message);
  }

  fs.writeFileSync(path.join(__dirname, 'balanced_neural_model_weights.json'), JSON.stringify({
    w1: nn.w1,
    b1: nn.b1,
    w2: nn.w2,
    b2: nn.b2,
    w3: nn.w3,
    b3: nn.b3,
    means,
    stds
  }, null, 2));
}

if (require.main === module) {
  runRetraining().then(() => {
    process.exit(0);
  }).catch(err => {
    console.error(err);
    process.exit(1);
  });
}
