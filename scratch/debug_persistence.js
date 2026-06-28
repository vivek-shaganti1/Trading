require('dotenv').config();
const db = require('../backend/db');

async function debugPersist() {
  console.log('1. Fetching portfolio state...');
  const state = await db.getPortfolioState();
  console.log('model_weights inside state:', JSON.stringify(state.model_weights, null, 2));

  console.log('2. Updating model weights...');
  const testWeights = { test_value: 1234 };
  const mw = state.model_weights || {};
  mw.neural_model_weights = testWeights;
  
  await db.updatePortfolioState({
    model_weights: mw
  });
  console.log('Update function finished.');

  console.log('3. Fetching portfolio state again from DB...');
  const state2 = await db.getPortfolioState();
  console.log('model_weights inside state after update:', JSON.stringify(state2.model_weights, null, 2));
}

debugPersist();
