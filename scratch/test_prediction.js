const predictor = require('../backend/predictor');
const broker = require('../backend/broker');

async function test() {
  const symbol = 'ADANIPORTS';
  console.log(`Running test prediction for ${symbol}...`);
  const result = await predictor.getPrediction(symbol, [1800, 1810, 1820]);
  console.log('--- PREDICTION DETAILS ---');
  console.log('Symbol:', result.symbol);
  console.log('Signal:', result.signal);
  console.log('Confidence:', result.confidence);
  console.log('TQS:', result.tradeQuality);
  console.log('Indicators from Agent 3 Technicals:', JSON.stringify(result.participating_models.agent4_technical.indicators, null, 2));
  console.log('Indicators from Agent 4 Context:', JSON.stringify(result.participating_models.agent5_context.indicators, null, 2));
  process.exit(0);
}

test().catch(e => {
  console.error(e);
  process.exit(1);
});
