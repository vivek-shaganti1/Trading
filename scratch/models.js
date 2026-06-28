// Multi-Layer Perceptron (17x32x16x3) Deep Neural Network in pure JS
class DeeperNeuralNet {
  constructor(inputDim = 17, h1 = 32, h2 = 16, outputDim = 3) {
    this.inputDim = inputDim;
    this.h1 = h1;
    this.h2 = h2;
    this.outputDim = outputDim;
    
    // He/Xavier Normal Initialization
    this.w1 = Array.from({ length: inputDim }, () => Array.from({ length: h1 }, () => (Math.random() - 0.5) * Math.sqrt(2.0 / inputDim)));
    this.b1 = new Array(h1).fill(0.0);
    this.w2 = Array.from({ length: h1 }, () => Array.from({ length: h2 }, () => (Math.random() - 0.5) * Math.sqrt(2.0 / h1)));
    this.b2 = new Array(h2).fill(0.0);
    this.w3 = Array.from({ length: h2 }, () => Array.from({ length: outputDim }, () => (Math.random() - 0.5) * Math.sqrt(2.0 / h2)));
    this.b3 = new Array(outputDim).fill(0.0);
  }

  forward(x) {
    // Hidden Layer 1 (ReLU)
    const z1 = new Array(this.h1).fill(0);
    const a1 = new Array(this.h1).fill(0);
    for (let j = 0; j < this.h1; j++) {
      let sum = this.b1[j];
      for (let i = 0; i < this.inputDim; i++) {
        sum += x[i] * this.w1[i][j];
      }
      z1[j] = sum;
      a1[j] = Math.max(0, sum); // ReLU
    }

    // Hidden Layer 2 (ReLU)
    const z2 = new Array(this.h2).fill(0);
    const a2 = new Array(this.h2).fill(0);
    for (let k = 0; k < this.h2; k++) {
      let sum = this.b2[k];
      for (let j = 0; j < this.h1; j++) {
        sum += a1[j] * this.w2[j][k];
      }
      z2[k] = sum;
      a2[k] = Math.max(0, sum); // ReLU
    }

    // Output Layer (Softmax)
    const logits = new Array(this.outputDim).fill(0);
    for (let m = 0; m < this.outputDim; m++) {
      let sum = this.b3[m];
      for (let k = 0; k < this.h2; k++) {
        sum += a2[k] * this.w3[k][m];
      }
      logits[m] = sum;
    }

    const max = Math.max(...logits);
    const exps = logits.map(l => Math.exp(l - max));
    const sumExps = exps.reduce((a, b) => a + b, 0);
    const probs = exps.map(e => e / (sumExps || 1));

    return { a1, a2, logits, probs };
  }

  train(x, targetLabel, lr = 0.01) {
    const { a1, a2, probs } = this.forward(x);
    const gradOut = [...probs];
    gradOut[targetLabel] -= 1.0;

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

// Multiclass Logistic Regression (Softmax Linear Classifier)
class LogisticRegression {
  constructor(inputDim = 17, outputDim = 3) {
    this.inputDim = inputDim;
    this.outputDim = outputDim;
    this.w = Array.from({ length: inputDim }, () => new Array(outputDim).fill(0.0));
    this.b = new Array(outputDim).fill(0.0);
  }

  predict(x) {
    const logits = new Array(this.outputDim).fill(0);
    for (let k = 0; k < this.outputDim; k++) {
      let sum = this.b[k];
      for (let i = 0; i < this.inputDim; i++) {
        sum += x[i] * this.w[i][k];
      }
      logits[k] = sum;
    }
    const max = Math.max(...logits);
    const exps = logits.map(v => Math.exp(v - max));
    const sum = exps.reduce((a, b) => a + b, 0);
    return exps.map(e => e / (sum || 1));
  }

  train(x, targetLabel, lr = 0.01) {
    const probs = this.predict(x);
    const grad = [...probs];
    grad[targetLabel] -= 1.0;

    for (let k = 0; k < this.outputDim; k++) {
      this.b[k] -= lr * grad[k];
      for (let i = 0; i < this.inputDim; i++) {
        this.w[i][k] -= lr * x[i] * grad[k];
      }
    }
  }
}

// Decision Tree Node
class DecisionTreeNode {
  constructor(feature = null, threshold = null, left = null, right = null, val = null) {
    this.feature = feature;
    this.threshold = threshold;
    this.left = left;
    this.right = right;
    this.val = val;
  }
}

// Builds a level-wise regression tree
function buildRegressionTree(X, y, depth = 0, maxDepth = 4, minSamples = 10) {
  if (depth >= maxDepth || X.length < minSamples) {
    const avg = y.reduce((a, b) => a + b, 0) / (y.length || 1);
    return new DecisionTreeNode(null, null, null, null, avg);
  }

  const nFeatures = X[0].length;
  let bestFeature = null;
  let bestThreshold = null;
  let bestVarReduction = -1;
  let bestLeftX = [], bestLeftY = [];
  let bestRightX = [], bestRightY = [];

  const currentVariance = getVariance(y);

  for (let f = 0; f < nFeatures; f++) {
    const values = X.map(x => x[f]);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const step = (max - min) / 10;
    
    for (let t = min + step; t < max; t += step) {
      const leftIdx = [];
      const rightIdx = [];
      for (let i = 0; i < X.length; i++) {
        if (X[i][f] < t) leftIdx.push(i);
        else rightIdx.push(i);
      }
      
      if (leftIdx.length < 2 || rightIdx.length < 2) continue;

      const leftY = leftIdx.map(idx => y[idx]);
      const rightY = rightIdx.map(idx => y[idx]);
      const wVar = (leftY.length / y.length) * getVariance(leftY) + (rightY.length / y.length) * getVariance(rightY);
      const varReduction = currentVariance - wVar;

      if (varReduction > bestVarReduction) {
        bestVarReduction = varReduction;
        bestFeature = f;
        bestThreshold = t;
        bestLeftX = leftIdx.map(idx => X[idx]);
        bestLeftY = leftY;
        bestRightX = rightIdx.map(idx => X[idx]);
        bestRightY = rightY;
      }
    }
  }

  if (bestVarReduction <= 0) {
    const avg = y.reduce((a, b) => a + b, 0) / (y.length || 1);
    return new DecisionTreeNode(null, null, null, null, avg);
  }

  const leftChild = buildRegressionTree(bestLeftX, bestLeftY, depth + 1, maxDepth, minSamples);
  const rightChild = buildRegressionTree(bestRightX, bestRightY, depth + 1, maxDepth, minSamples);
  return new DecisionTreeNode(bestFeature, bestThreshold, leftChild, rightChild, null);
}

function getVariance(arr) {
  if (arr.length === 0) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  return arr.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / arr.length;
}

function predictTree(node, x) {
  if (node.val !== null) return node.val;
  if (x[node.feature] < node.threshold) return predictTree(node.left, x);
  return predictTree(node.right, x);
}

// Gradient Boosted Decision Trees (GBDT / XGBoost equivalent)
class GradientBoostedTrees {
  constructor(nEstimators = 15, maxDepth = 3) {
    this.nEstimators = nEstimators;
    this.maxDepth = maxDepth;
    this.trees = []; 
  }

  train(X, y) {
    const nSamples = X.length;
    const nClasses = 3;
    let fValues = Array.from({ length: nSamples }, () => [0.0, 0.0, 0.0]);
    this.trees = Array.from({ length: nClasses }, () => []);

    for (let m = 0; m < this.nEstimators; m++) {
      const p = Array.from({ length: nSamples }, () => [0.0, 0.0, 0.0]);
      for (let i = 0; i < nSamples; i++) {
        const max = Math.max(...fValues[i]);
        const exps = fValues[i].map(v => Math.exp(v - max));
        const sum = exps.reduce((a, b) => a + b, 0);
        p[i] = exps.map(e => e / (sum || 1));
      }

      for (let c = 0; c < nClasses; c++) {
        const residuals = new Array(nSamples).fill(0);
        for (let i = 0; i < nSamples; i++) {
          const target = y[i] === c ? 1.0 : 0.0;
          residuals[i] = target - p[i][c];
        }

        const tree = buildRegressionTree(X, residuals, 0, this.maxDepth, 15);
        this.trees[c].push(tree);

        const lr = 0.1;
        for (let i = 0; i < nSamples; i++) {
          const pred = predictTree(tree, X[i]);
          fValues[i][c] += lr * pred;
        }
      }
    }
  }

  predict(x) {
    const nClasses = 3;
    const f = [0.0, 0.0, 0.0];
    const lr = 0.1;
    for (let c = 0; c < nClasses; c++) {
      for (let m = 0; m < this.trees[c].length; m++) {
        f[c] += lr * predictTree(this.trees[c][m], x);
      }
    }
    const max = Math.max(...f);
    const exps = f.map(v => Math.exp(v - max));
    const sum = exps.reduce((a, b) => a + b, 0);
    return exps.map(e => e / (sum || 1));
  }
}

// LightGBM (Leaf-wise Tree GBDT with L2 Leaf Regularization)
class LightGBM {
  constructor(nEstimators = 15, maxLeaves = 15, lambdaL2 = 1.0) {
    this.nEstimators = nEstimators;
    this.maxLeaves = maxLeaves;
    this.lambdaL2 = lambdaL2;
    this.trees = []; 
  }

  buildLeafwiseTree(X, residuals) {
    const root = new DecisionTreeNode(null, null, null, null, null);
    
    const splitNode = (node, subsetX, subsetRes, depth) => {
      if (depth >= 3 || subsetX.length < 10) {
        const sumRes = subsetRes.reduce((a, b) => a + b, 0);
        node.val = sumRes / (subsetRes.length + this.lambdaL2);
        return;
      }

      const nFeatures = subsetX[0].length;
      let bestFeature = null;
      let bestThreshold = null;
      let bestGain = -1;
      let bestLeftX = [], bestLeftRes = [];
      let bestRightX = [], bestRightRes = [];

      for (let f = 0; f < nFeatures; f++) {
        const values = subsetX.map(x => x[f]);
        const min = Math.min(...values);
        const max = Math.max(...values);
        const step = (max - min) / 6;

        for (let t = min + step; t < max; t += step) {
          const leftRes = [], rightRes = [];
          const leftX = [], rightX = [];
          for (let i = 0; i < subsetX.length; i++) {
            if (subsetX[i][f] < t) {
              leftX.push(subsetX[i]);
              leftRes.push(subsetRes[i]);
            } else {
              rightX.push(subsetX[i]);
              rightRes.push(subsetRes[i]);
            }
          }
          if (leftRes.length < 2 || rightRes.length < 2) continue;

          const G_L = leftRes.reduce((a,b)=>a+b, 0);
          const G_R = rightRes.reduce((a,b)=>a+b, 0);
          const H_L = leftRes.length;
          const H_R = rightRes.length;

          const gain = 0.5 * (Math.pow(G_L, 2) / (H_L + this.lambdaL2) + Math.pow(G_R, 2) / (H_R + this.lambdaL2) - Math.pow(G_L + G_R, 2) / (H_L + H_R + this.lambdaL2));

          if (gain > bestGain) {
            bestGain = gain;
            bestFeature = f;
            bestThreshold = t;
            bestLeftX = leftX;
            bestLeftRes = leftRes;
            bestRightX = rightX;
            bestRightRes = rightRes;
          }
        }
      }

      if (bestGain <= 0) {
        const sumRes = subsetRes.reduce((a, b) => a + b, 0);
        node.val = sumRes / (subsetRes.length + this.lambdaL2);
        return;
      }

      node.feature = bestFeature;
      node.threshold = bestThreshold;
      node.left = new DecisionTreeNode();
      node.right = new DecisionTreeNode();

      splitNode(node.left, bestLeftX, bestLeftRes, depth + 1);
      splitNode(node.right, bestRightX, bestRightRes, depth + 1);
    };

    splitNode(root, X, residuals, 0);
    return root;
  }

  train(X, y) {
    const nSamples = X.length;
    const nClasses = 3;
    let fValues = Array.from({ length: nSamples }, () => [0.0, 0.0, 0.0]);
    this.trees = Array.from({ length: nClasses }, () => []);

    for (let m = 0; m < this.nEstimators; m++) {
      const p = Array.from({ length: nSamples }, () => [0.0, 0.0, 0.0]);
      for (let i = 0; i < nSamples; i++) {
        const max = Math.max(...fValues[i]);
        const exps = fValues[i].map(v => Math.exp(v - max));
        const sum = exps.reduce((a, b) => a + b, 0);
        p[i] = exps.map(e => e / (sum || 1));
      }

      for (let c = 0; c < nClasses; c++) {
        const residuals = new Array(nSamples).fill(0);
        for (let i = 0; i < nSamples; i++) {
          const target = y[i] === c ? 1.0 : 0.0;
          residuals[i] = target - p[i][c];
        }

        const tree = this.buildLeafwiseTree(X, residuals);
        this.trees[c].push(tree);

        const lr = 0.1;
        for (let i = 0; i < nSamples; i++) {
          const pred = predictTree(tree, X[i]);
          fValues[i][c] += lr * pred;
        }
      }
    }
  }

  predict(x) {
    const nClasses = 3;
    const f = [0.0, 0.0, 0.0];
    const lr = 0.1;
    for (let c = 0; c < nClasses; c++) {
      for (let m = 0; m < this.trees[c].length; m++) {
        f[c] += lr * predictTree(this.trees[c][m], x);
      }
    }
    const max = Math.max(...f);
    const exps = f.map(v => Math.exp(v - max));
    const sum = exps.reduce((a, b) => a + b, 0);
    return exps.map(e => e / (sum || 1));
  }
}

// CatBoost (Oblivious / Symmetric Tree Classifier equivalent)
class CatBoost {
  constructor(nEstimators = 15, maxDepth = 3, regularization = 1.0) {
    this.nEstimators = nEstimators;
    this.maxDepth = maxDepth;
    this.regularization = regularization;
    this.trees = []; // nClasses * nEstimators
  }

  buildObliviousTree(X, residuals) {
    const root = new DecisionTreeNode();
    const treeSplits = []; // stores { feature, threshold } for each level

    // Grow oblivious structure level-wise (same split criteria for all nodes on level)
    let currentSubset = X.map((x, idx) => ({ x, res: residuals[idx] }));

    for (let d = 0; d < this.maxDepth; d++) {
      const nFeatures = X[0].length;
      let bestFeature = null;
      let bestThreshold = null;
      let bestGain = -1;

      for (let f = 0; f < nFeatures; f++) {
        const values = X.map(x => x[f]);
        const min = Math.min(...values);
        const max = Math.max(...values);
        const step = (max - min) / 6;

        for (let t = min + step; t < max; t += step) {
          // Compute regularized gain across ALL oblivious leaves on this level
          let gLeft = 0, gRight = 0;
          let hLeft = 0, hRight = 0;

          currentSubset.forEach(item => {
            if (item.x[f] < t) {
              gLeft += item.res;
              hLeft++;
            } else {
              gRight += item.res;
              hRight++;
            }
          });

          if (hLeft < 2 || hRight < 2) continue;

          const gain = 0.5 * (Math.pow(gLeft, 2) / (hLeft + this.regularization) + Math.pow(gRight, 2) / (hRight + this.regularization) - Math.pow(gLeft + gRight, 2) / (hLeft + hRight + this.regularization));
          if (gain > bestGain) {
            bestGain = gain;
            bestFeature = f;
            bestThreshold = t;
          }
        }
      }

      if (bestFeature !== null) {
        treeSplits.push({ feature: bestFeature, threshold: bestThreshold });
      } else {
        break;
      }
    }

    // Assign leaf values based on symmetric splits path
    const assignLeaves = (node, pathIdx, subset) => {
      if (pathIdx >= treeSplits.length || subset.length < 5) {
        const sum = subset.reduce((acc, val) => acc + val.res, 0);
        node.val = sum / (subset.length + this.regularization);
        return;
      }

      const split = treeSplits[pathIdx];
      node.feature = split.feature;
      node.threshold = split.threshold;
      node.left = new DecisionTreeNode();
      node.right = new DecisionTreeNode();

      const leftSubset = subset.filter(item => item.x[split.feature] < split.threshold);
      const rightSubset = subset.filter(item => item.x[split.feature] >= split.threshold);

      assignLeaves(node.left, pathIdx + 1, leftSubset);
      assignLeaves(node.right, pathIdx + 1, rightSubset);
    };

    assignLeaves(root, 0, currentSubset);
    return root;
  }

  train(X, y) {
    const nSamples = X.length;
    const nClasses = 3;
    let fValues = Array.from({ length: nSamples }, () => [0.0, 0.0, 0.0]);
    this.trees = Array.from({ length: nClasses }, () => []);

    for (let m = 0; m < this.nEstimators; m++) {
      const p = Array.from({ length: nSamples }, () => [0.0, 0.0, 0.0]);
      for (let i = 0; i < nSamples; i++) {
        const max = Math.max(...fValues[i]);
        const exps = fValues[i].map(v => Math.exp(v - max));
        const sum = exps.reduce((a, b) => a + b, 0);
        p[i] = exps.map(e => e / (sum || 1));
      }

      for (let c = 0; c < nClasses; c++) {
        const residuals = new Array(nSamples).fill(0);
        for (let i = 0; i < nSamples; i++) {
          const target = y[i] === c ? 1.0 : 0.0;
          residuals[i] = target - p[i][c];
        }

        const tree = this.buildObliviousTree(X, residuals);
        this.trees[c].push(tree);

        const lr = 0.1;
        for (let i = 0; i < nSamples; i++) {
          const pred = predictTree(tree, X[i]);
          fValues[i][c] += lr * pred;
        }
      }
    }
  }

  predict(x) {
    const nClasses = 3;
    const f = [0.0, 0.0, 0.0];
    const lr = 0.1;
    for (let c = 0; c < nClasses; c++) {
      for (let m = 0; m < this.trees[c].length; m++) {
        f[c] += lr * predictTree(this.trees[c][m], x);
      }
    }
    const max = Math.max(...f);
    const exps = f.map(v => Math.exp(v - max));
    const sum = exps.reduce((a, b) => a + b, 0);
    return exps.map(e => e / (sum || 1));
  }
}

// Ensemble Voting Model (Averages classification probabilities across models)
class EnsembleVotingModel {
  constructor(modelsList) {
    this.models = modelsList;
  }

  predict(x) {
    const sumProbs = [0.0, 0.0, 0.0];
    this.models.forEach(m => {
      const probs = m.forward ? m.forward(x).probs : m.predict(x);
      for (let k = 0; k < 3; k++) {
        sumProbs[k] += probs[k];
      }
    });
    return sumProbs.map(p => p / this.models.length);
  }
}

// Custom Random Forest Classifier
class RandomForest {
  constructor(nTrees = 15, maxDepth = 4) {
    this.nTrees = nTrees;
    this.maxDepth = maxDepth;
    this.trees = [];
  }

  train(X, y) {
    this.trees = [];
    const nSamples = X.length;
    
    for (let t = 0; t < this.nTrees; t++) {
      const bagX = [];
      const bagY = [];
      for (let i = 0; i < nSamples; i++) {
        const randIdx = Math.floor(Math.random() * nSamples);
        bagX.push(X[randIdx]);
        bagY.push(y[randIdx]);
      }
      
      const tree = buildRegressionTree(bagX, bagY, 0, this.maxDepth, 10);
      this.trees.push(tree);
    }
  }

  predict(x) {
    const votes = [0, 0, 0];
    this.trees.forEach(t => {
      const pred = predictTree(t, x);
      const cls = Math.max(0, Math.min(2, Math.round(pred)));
      votes[cls]++;
    });
    const sum = votes.reduce((a, b) => a + b, 0);
    return votes.map(v => v / (sum || 1));
  }
}

module.exports = {
  DeeperNeuralNet,
  LogisticRegression,
  GradientBoostedTrees,
  LightGBM,
  CatBoost,
  EnsembleVotingModel,
  RandomForest
};
