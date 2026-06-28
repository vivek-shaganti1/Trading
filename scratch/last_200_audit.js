const { Client } = require('pg');
require('dotenv').config();

async function run() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  await client.connect();

  const res = await client.query('SELECT * FROM consensus_decisions ORDER BY timestamp DESC LIMIT 200');
  const rows = res.rows.reverse(); // chronological order of last 200

  let modifiedCount = 0;
  let examples = [];

  rows.forEach(cd => {
    let pm = cd.participating_models;
    if (typeof pm === 'string') {
      try { pm = JSON.parse(pm); } catch(e) {}
    }
    const impact = pm?.learning_impact;
    if (impact) {
      const isChanged = impact.confidence_delta !== 0 || impact.pre_learning_tqs !== impact.post_learning_tqs;
      if (isChanged) {
        modifiedCount++;
        examples.push({
          symbol: cd.symbol,
          decision: cd.decision,
          preTQS: impact.pre_learning_tqs,
          postTQS: impact.post_learning_tqs,
          preConf: impact.pre_learning_confidence,
          postConf: impact.post_learning_confidence,
          matchCount: impact.match_count,
          delta: impact.confidence_delta
        });
      }
    }
  });

  console.log(`=== LAST 200 PREDICTIONS ===`);
  console.log(`Total predictions: ${rows.length}`);
  console.log(`Modified predictions: ${modifiedCount}`);
  console.log(`Percentage modified: ${((modifiedCount / rows.length) * 100).toFixed(2)}%`);
  console.log(`\nExamples:`);
  examples.forEach(ex => {
    console.log(`  - ${ex.symbol} (${ex.decision}): Pre-TQS=${ex.preTQS}, Post-TQS=${ex.postTQS} | Pre-Conf=${ex.preConf?.toFixed(4)}, Post-Conf=${ex.postConf?.toFixed(4)} | Match Count=${ex.matchCount} | Delta=${ex.delta}`);
  });

  await client.end();
}
run();
