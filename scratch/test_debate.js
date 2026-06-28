require('dotenv').config();
const db = require('../backend/db');
const predictor = require('../backend/predictor');
const broker = require('../backend/broker');

async function testDebate() {
  console.log('🧪 Testing Prediction Intelligence and Debate Console formatting...\n');

  // Stub mock prices for the instruments
  broker._setMockPrice('RELIANCE', 1258.80);

  const closes = [1250, 1252, 1255, 1258.80];
  try {
    await predictor.getPrediction('RELIANCE', closes);
  } catch (err) {
    console.error('❌ Error during prediction:', err);
  }
}

testDebate();
