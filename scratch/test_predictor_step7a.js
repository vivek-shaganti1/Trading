const predictor = require('../backend/predictor');
const marketModel = require('../backend/marketModel');
const agent3_technicals = require('../backend/agent3_technicals');
const agent4_context = require('../backend/agent4_context');
const priceActionStructureAgent = require('../backend/priceActionStructureAgent');
const smcAgent = require('../backend/smcAgent');

async function test() {
  marketModel.predict = async () => ({ signal: 'BUY', confidence: 0.95, reasoning: 'Stubbed Neural BUY' });
  agent3_technicals.predict = async () => ({ signal: 'BUY', confidence: 0.95, reasoning: 'Stubbed Technicals BUY', indicators: { ema9: 105, ema21: 100, rsi: 65, macd: 5 } });
  agent4_context.predict = async () => ({ signal: 'BUY', confidence: 0.95, reasoning: 'Stubbed Context BUY' });
  predictor.predictGemini = async () => ({ signal: 'BUY', confidence: 0.95, reasoning: 'Stubbed Gemini BUY', debateSummary: 'Gemini agreed.' });
  priceActionStructureAgent.predict = () => ({ direction: 'BUY', probability: 95, tqsPa: 95, reasoning: 'Stubbed PA BUY' });
  smcAgent.predict = () => ({ vote: 'BUY', confidence: 0.95, bosScore: 95, chochScore: 95, orderBlockScore: 95, fvgScore: 95, liquidityScore: 95, premiumDiscountScore: 95, reasoning: 'Stubbed SMC BUY' });

  const positiveCloses = Array.from({ length: 30 }, (_, idx) => 100 + idx * 5);
  const res = await predictor.getPrediction('NIFTY50_MINI', positiveCloses);
  console.log('Result:', JSON.stringify({ consensus: res.consensus, signal: res.signal, stage: res.stage, execute: res.execute, rejections: res.rejections, score: res.adaptiveScore, grade: res.grade }, null, 2));
}

test();
