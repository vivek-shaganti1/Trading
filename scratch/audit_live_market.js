require('dotenv').config();
const { Client } = require('pg');
const db = require('../db');
const predictor = require('../predictor');

async function runLiveAudit() {
  console.log('🏁 INITIATING LIVE MARKET DEBUG AUDIT...');
  console.log('====================================================\n');

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  await client.connect();

  // 1. Scanner timestamp & rankings
  const resScanner = await client.query('SELECT timestamp, longs, shorts FROM scanner_rankings ORDER BY timestamp DESC LIMIT 1');
  const lastScanTime = resScanner.rows[0]?.timestamp;
  const longs = typeof resScanner.rows[0]?.longs === 'string' ? JSON.parse(resScanner.rows[0].longs) : resScanner.rows[0]?.longs || [];
  
  console.log(`[1] Current Scanner Cycle Timestamp: ${lastScanTime}`);
  console.log('----------------------------------------------------');
  console.log(`[2] Top 20 Scanner Candidates & Conviction Scores:\n`);
  longs.slice(0, 20).forEach((c, idx) => {
    console.log(`   ${idx + 1}. ${c.symbol.padEnd(12)} | Score: ${(c.score || c.longScore || 0).toFixed(2)} | Price: ₹${c.price.toFixed(2)}`);
  });
  console.log('----------------------------------------------------\n');

  // 2. Predictions & TQS
  console.log('[3] TQS & Agent Signals Breakdown for Candidates:\n');
  const topCandidates = longs.slice(0, 10);
  
  let bestCandidate = null;
  let maxTQS = -1;

  for (const c of topCandidates) {
    const pred = await predictor.getPrediction(c.symbol, [c.price * 0.98, c.price * 0.99, c.price]);
    const tqs = pred.tradeQuality;
    if (tqs > maxTQS) {
      maxTQS = tqs;
      bestCandidate = { symbol: c.symbol, tqs, signal: pred.signal };
    }
    
    console.log(`Symbol: ${c.symbol}`);
    console.log(`   - TQS: ${tqs}`);
    console.log(`   - Signal: ${pred.signal} (Confidence: ${pred.confidence.toFixed(4)})`);
    console.log(`   - Rejection Reason: ${pred.signal === 'HOLD' ? 'Consensus signal is HOLD' : ''} ${tqs < 75 ? 'TQS below 75' : ''}`);
    console.log(`   - Agent Signals:`);
    console.log(`     * Agent 1 (Neural): ${pred.participating_models.agent1?.signal}`);
    console.log(`     * Agent 4 (Technical): ${pred.participating_models.agent4_technical?.signal}`);
    console.log(`     * Agent 5 (Context): ${pred.participating_models.agent5_context?.signal}`);
    console.log(`   - Raw Indicators:`);
    const ind = pred.participating_models.agent4_technical?.indicators;
    if (ind) {
      console.log(`     * EMA9: ${ind.ema9} | EMA21: ${ind.ema21} | EMA50: ${ind.ema50}`);
      console.log(`     * RSI: ${ind.rsi} | MACD: ${ind.macd} | ATR: ${ind.atr} | VWAP: ${ind.vwap}`);
    } else {
      console.log(`     * Technical indicators null (Insufficient price history)`);
    }
    console.log('');
  }
  console.log('----------------------------------------------------\n');

  console.log(`[4] Current Best Candidate: ${bestCandidate ? `${bestCandidate.symbol} (TQS: ${bestCandidate.tqs}, Signal: ${bestCandidate.signal})` : 'None'}`);
  console.log('----------------------------------------------------');

  // 3. System properties (thresholds, backend NaN checks)
  const portState = await db.getPortfolioState();
  const w = await predictor.getModelWeights();
  console.log('\n[5] Entry Threshold & Weight Mapping on Backend:');
  console.log(`   - RSI Entry Threshold: ${w.rsiThreshold}`);
  console.log(`   - Learning Adapts Count: ${w.adaptationCount}`);
  console.log(`   - EMA / RSI / MACD weights: ${w.emaWeight} / ${w.rsiWeight} / ${w.macdWeight}`);
  console.log(`   - Are any backend weight values NaN? ${Object.values(w).some(val => Number.isNaN(val)) ? 'YES' : 'NO'}`);
  console.log(`   - Raw backend weights payload: ${JSON.stringify(w)}`);

  console.log('\n[6] Yahoo API Details:');
  const status = await db.getLatestScannerRankings();
  const resQuote = await client.query('SELECT timestamp FROM consensus_decisions ORDER BY timestamp DESC LIMIT 1');
  console.log(`   - Last Consensus Decided Timestamp: ${resQuote.rows[0]?.timestamp}`);

  await client.end();
  process.exit(0);
}

runLiveAudit().catch(e => {
  console.error(e);
  process.exit(1);
});
