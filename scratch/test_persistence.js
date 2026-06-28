require('dotenv').config();
const db = require('../db');
const marketModel = require('../marketModel');
const { Client } = require('pg');

async function testPersistence() {
  console.log('Waiting 6 seconds for DB validation and background restore to complete...');
  await new Promise(resolve => setTimeout(resolve, 6000));
  
  console.log('--- WEIGHT PERSISTENCE VERIFICATION TEST ---');
  
  try {
    // 1. Load active weights
    const originalWeights = await marketModel.getWeights();
    console.log('Successfully loaded original weights.');
    
    // 2. Modify one weight coefficient slightly
    const modifiedWeights = JSON.parse(JSON.stringify(originalWeights));
    const originalValue = modifiedWeights.w1[0][0];
    modifiedWeights.w1[0][0] = parseFloat((originalValue + 0.05).toFixed(4));
    console.log(`Modifying w1[0][0] from ${originalValue} to ${modifiedWeights.w1[0][0]}`);
    
    // 3. Save modified weights
    await marketModel.saveWeights(modifiedWeights);
    console.log('Saved modified weights to database.');
    
    // 4. Query PostgreSQL directly to see if the modified weight is written inside the table
    const client = new Client({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });
    await client.connect();
    const res = await client.query('SELECT * FROM model_weights WHERE id = $1 LIMIT 1', ['default']);
    await client.end();
    
    const dbRow = res.rows[0];
    const dbVal = dbRow?.neural_model_weights?.w1?.[0]?.[0];
    console.log(`Direct SQL check: neural_model_weights.w1[0][0] in DB = ${dbVal}`);
    
    if (dbVal === modifiedWeights.w1[0][0]) {
      console.log('✅ Success: Persistence confirmed! Weights match modified values.');
    } else {
      console.log('❌ Failure: Persistence failed! Weights do not match.');
    }
    
    // 5. Restore back to original weights
    originalWeights.w1[0][0] = originalValue;
    await marketModel.saveWeights(originalWeights);
    console.log('Restored original weights.');
    
  } catch (err) {
    console.error('Persistence test failed with error:', err.message);
  }
}

testPersistence().then(() => {
  console.log('[PERSISTENCE] Exiting cleanly.');
  process.exit(0);
}).catch(err => {
  console.error(err);
  process.exit(1);
});
