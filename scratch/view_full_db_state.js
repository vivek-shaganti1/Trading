const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

async function run() {
  console.log('=== DATABASE AUDIT ===');
  
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL not defined');
    return;
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    // 1. Check EOD Report States
    const eodRes = await pool.query('SELECT * FROM eod_report_state ORDER BY date');
    console.log('\n--- eod_report_state Table ---');
    console.log(eodRes.rows);

    // 2. Check Portfolio State
    const portRes = await pool.query('SELECT * FROM portfolio_state');
    console.log('\n--- portfolio_state Table ---');
    console.log(portRes.rows);

    // 3. Check Daily Stats
    const statsRes = await pool.query('SELECT * FROM daily_stats ORDER BY date');
    console.log('\n--- daily_stats Table ---');
    console.log(statsRes.rows);

    // 4. Check Open/Completed Trades
    const tradesCount = await pool.query('SELECT count(*), action FROM trade_logs GROUP BY action');
    console.log('\n--- trade_logs Count ---');
    console.log(tradesCount.rows);

    const completedTradesCount = await pool.query('SELECT count(*) FROM completed_trades');
    console.log('\n--- completed_trades Count ---');
    console.log(completedTradesCount.rows);

  } catch (err) {
    console.error('Audit query error:', err.message);
  } finally {
    await pool.end();
  }
}

run().catch(console.error);
