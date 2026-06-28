require('dotenv').config();
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const dbFile = path.join(__dirname, '..', 'db.json');

async function fixWeights() {
  console.log('🔧 Fixing model weights...');

  // 1. Update local db.json
  if (fs.existsSync(dbFile)) {
    const data = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
    data.portfolio_state.model_weights = {
      agent1_weight: 0.35,
      agent2_weight: 0.25,
      agent3_weight: 0.20,
      agent4_weight: 0.20,
      emaWeight: 0.4,
      rsiWeight: 0.3,
      macdWeight: 0.3,
      rsiThreshold: 50,
      adaptationCount: 1
    };
    fs.writeFileSync(dbFile, JSON.stringify(data, null, 2));
    console.log('✅ Local db.json updated.');
  }

  // 2. Update Neon PostgreSQL
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false
    }
  });

  try {
    await client.connect();
    await client.query(`
      INSERT INTO model_weights (id, agent1_weight, agent2_weight, agent3_weight, agent4_weight, ema_weight, rsi_weight, macd_weight, rsi_threshold, adaptation_count, neural_model_weights, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
      ON CONFLICT (id) DO UPDATE SET
        agent1_weight = EXCLUDED.agent1_weight,
        agent2_weight = EXCLUDED.agent2_weight,
        agent3_weight = EXCLUDED.agent3_weight,
        agent4_weight = EXCLUDED.agent4_weight,
        ema_weight = EXCLUDED.ema_weight,
        rsi_weight = EXCLUDED.rsi_weight,
        macd_weight = EXCLUDED.macd_weight,
        rsi_threshold = EXCLUDED.rsi_threshold,
        adaptation_count = EXCLUDED.adaptation_count,
        updated_at = NOW()
    `, [
      'default',
      0.35,
      0.25,
      0.20,
      0.20,
      0.4,
      0.3,
      0.3,
      50,
      1,
      JSON.stringify({})
    ]);
    console.log('✅ Neon PostgreSQL model_weights table updated.');
  } catch (err) {
    console.error('❌ Error updating Neon PostgreSQL:', err.message);
  } finally {
    await client.end();
  }
}

fixWeights();
