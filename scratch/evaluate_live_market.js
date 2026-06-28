require('dotenv').config();
const marketModel = require('../marketModel');

async function testLive() {
  console.log('🧪 Testing Production upgraded Agent 1 (marketModel) live inference...');
  try {
    const res = await marketModel.predict('RELIANCE');
    console.log('Success! Upgraded Model Output:', JSON.stringify(res, null, 2));
  } catch (err) {
    console.error('❌ Error during prediction:', err);
  }
}

testLive();
