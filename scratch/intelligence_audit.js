require('dotenv').config();
const { Client } = require('pg');
const predictor = require('../backend/predictor');

async function audit() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  try {
    await client.connect();

    // 1. Scanner Rankings
    console.log('--- Last 100 Scanner Rankings ---');
    const scannerRes = await client.query('SELECT * FROM scanner_rankings ORDER BY timestamp DESC LIMIT 100');
    console.log(`Retrieved ${scannerRes.rows.length} scanner rankings.`);

    // 2. Consensus Decisions
    console.log('\n--- Last 100 Consensus Decisions ---');
    const consensusRes = await client.query('SELECT * FROM consensus_decisions ORDER BY timestamp DESC LIMIT 100');
    console.log(`Retrieved ${consensusRes.rows.length} consensus decisions.`);

    // 3. Trade Logs
    console.log('\n--- Last 20 Executed Trades ---');
    const tradeRes = await client.query('SELECT * FROM trade_logs ORDER BY timestamp DESC LIMIT 20');
    console.log(`Retrieved ${tradeRes.rows.length} trade logs.`);

    // Analyse distributions
    const scannerSymbols = new Set();
    const tradeSymbols = new Set();
    const scannerSectors = {};
    const tradeSectors = {};

    // Helper sector mapping
    const getSector = (sym) => {
      if (['ICICIBANK', 'AXISBANK', 'KOTAKBANK', 'HDFCBANK', 'SBIN'].includes(sym)) return 'BANKING';
      if (['TCS', 'INFOSYS', 'WIPRO', 'HCLTECH'].includes(sym)) return 'IT';
      if (['RELIANCE'].includes(sym)) return 'ENERGY';
      if (['ASIANPAINT', 'TATAMOTORS', 'ADANIPORTS'].includes(sym)) return 'OTHER/CONGLOMERATE';
      return 'UNKNOWN';
    };

    // Process scanner rankings
    scannerRes.rows.forEach(r => {
      // Assuming rankings are stored with symbol, rank or as a list in JSON
      // Let's print a sample row first to understand the schema
    });
    if (scannerRes.rows.length > 0) {
      console.log('\nSample Scanner Ranking row:', JSON.stringify(scannerRes.rows[0], null, 2));
    }

    // Process consensus decisions
    const uniqueConsensusSymbols = new Set();
    consensusRes.rows.forEach(c => {
      uniqueConsensusSymbols.add(c.symbol);
    });

    // Process trade logs
    tradeRes.rows.forEach(t => {
      tradeSymbols.add(t.symbol);
      const sector = getSector(t.symbol);
      tradeSectors[sector] = (tradeSectors[sector] || 0) + 1;
    });

    console.log('\n--- Unique Symbols ---');
    console.log(`Unique symbols considered in last 100 consensus: ${uniqueConsensusSymbols.size} (${Array.from(uniqueConsensusSymbols).join(', ')})`);
    console.log(`Unique symbols traded: ${tradeSymbols.size} (${Array.from(tradeSymbols).join(', ')})`);

    console.log('\n--- Traded Sector Distribution ---');
    console.log(tradeSectors);

    // Check weights
    console.log('\n--- Current Active Trust Weights in Predictor ---');
    const leaderboard = predictor.getLeaderboard();
    console.log(JSON.stringify(leaderboard, null, 2));

  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}

audit();
