require('dotenv').config();
const { Client } = require('pg');
const marketModel = require('../backend/marketModel');

async function auditAgent1() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();

    // 1. Fetch prediction_logs & consensus_decisions
    const plRes = await client.query('SELECT * FROM prediction_logs ORDER BY timestamp DESC LIMIT 100');
    const cdRes = await client.query('SELECT * FROM consensus_decisions ORDER BY timestamp DESC LIMIT 100');
    
    const cds = {};
    cdRes.rows.forEach(r => cds[r.id] = r);

    console.log('--- PREDICTIONS RAW DATA ---');
    console.log('Prediction ID | Timestamp | Symbol | Agent 1 Signal | Agent 1 Confidence | Entry Price | Price After 15 Min | Price After 1 Hour | Price After Close | Actual Outcome');
    console.log('---|---|---|---|---|---|---|---|---|---');
    
    plRes.rows.forEach(r => {
      const cd = cds[r.id] || {};
      const pm = cd.participating_models || {};
      const a1 = pm.agent1 || {};
      const a1Signal = a1.signal || r.custom_signal || 'HOLD';
      const a1Conf = a1.confidence || 0.50;
      
      console.log(`${r.id} | ${r.timestamp.toISOString()} | ${r.symbol} | ${a1Signal} | ${(a1Conf * 100).toFixed(0)}% | ₹${r.entry_price || '-'} | - | - | - | -`);
    });

    // 2. Metrics (if any completed trades exist)
    const completed = plRes.rows.filter(r => r.pnl !== null);
    console.log(`\nCompleted trades count: ${completed.length}`);

    // 3. Feature Importance coefficients
    console.log('\n--- FEATURE IMPORTANCE AUDIT ---');
    const weights = await marketModel.getWeights();
    const w1 = weights.w1;
    
    const features = [
      { name: 'Stock Momentum', w: w1[0] },
      { name: 'Nifty Momentum', w: w1[1] },
      { name: 'Bank Nifty', w: w1[2] },
      { name: 'VIX Return', w: w1[3] },
      { name: 'Volume Ratio', w: w1[4] },
      { name: 'News Sentiment', w: w1[5] }
    ];

    const ranked = features.map(f => {
      const absSum = f.w.reduce((sum, val) => sum + Math.abs(val), 0);
      return {
        name: f.name,
        contribution: parseFloat(absSum.toFixed(4)),
        rawWeights: f.w
      };
    }).sort((a, b) => b.contribution - a.contribution);

    console.log('Rank | Feature | Contribution Weight (Abs Sum) | Coefficients');
    console.log('---|---|---|---');
    ranked.forEach((f, idx) => {
      console.log(`${idx + 1} | ${f.name} | ${f.contribution} | [${f.rawWeights.join(', ')}]`);
    });

  } catch(err) {
    console.error(err);
  } finally {
    await client.end();
  }
}

auditAgent1();
