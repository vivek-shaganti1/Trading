const { Client } = require('pg');
require('dotenv').config();

async function runDiagnostic() {
  console.log('🏁 INITIATING DUPLICATE RECORDS DIAGNOSTIC...');
  
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set.');
    return;
  }

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  await client.connect();

  try {
    // 1. Count total HOLD rows
    const totalHoldsRes = await client.query("SELECT COUNT(*) FROM consensus_decisions WHERE decision = 'HOLD'");
    const totalHolds = totalHoldsRes.rows[0].count;

    // 2. Count DISTINCT id
    const distinctIdsRes = await client.query("SELECT COUNT(DISTINCT id) FROM consensus_decisions WHERE decision = 'HOLD'");
    const distinctIds = distinctIdsRes.rows[0].count;

    // 3. Count DISTINCT symbol
    const distinctSymbolsRes = await client.query("SELECT COUNT(DISTINCT symbol) FROM consensus_decisions WHERE decision = 'HOLD'");
    const distinctSymbols = distinctSymbolsRes.rows[0].count;

    // 4. Count ADANIPORTS rows
    const adaniportsCountRes = await client.query("SELECT COUNT(*) FROM consensus_decisions WHERE symbol = 'ADANIPORTS'");
    const adaniportsCount = adaniportsCountRes.rows[0].count;

    // 5. First 10 unique decision_ids with timestamps and symbol
    const sampleRes = await client.query("SELECT id, symbol, timestamp, confidence FROM consensus_decisions WHERE decision = 'HOLD' ORDER BY timestamp DESC LIMIT 20");
    
    console.log(`\n--- Diagnostic Stats ---`);
    console.log(`• Total HOLD rows: ${totalHolds}`);
    console.log(`• Distinct IDs count: ${distinctIds}`);
    console.log(`• Distinct Symbols count: ${distinctSymbols}`);
    console.log(`• Total ADANIPORTS rows: ${adaniportsCount}`);
    
    console.log(`\n--- Sample of Recent HOLD Records ---`);
    sampleRes.rows.forEach(r => {
      console.log(`ID: ${r.id} | Symbol: ${r.symbol} | Timestamp: ${r.timestamp} | Confidence: ${r.confidence}`);
    });

    // Check if the printed rows in the sample share duplicate IDs
    const idMap = {};
    sampleRes.rows.forEach(r => {
      idMap[r.id] = (idMap[r.id] || 0) + 1;
    });

    console.log(`\n--- Duplicate ID Verification ---`);
    let duplicatesFound = false;
    Object.keys(idMap).forEach(id => {
      if (idMap[id] > 1) {
        console.log(`⚠️ ID ${id} appears ${idMap[id]} times in the sample!`);
        duplicatesFound = true;
      }
    });
    if (!duplicatesFound) {
      console.log(`✅ No duplicate IDs found in the recent sample.`);
    }

  } catch (err) {
    console.error('Error running diagnostics:', err);
  } finally {
    await client.end();
  }
}

runDiagnostic();
