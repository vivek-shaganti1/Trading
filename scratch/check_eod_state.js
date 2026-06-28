const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config();

async function run() {
  console.log('=== SECTION 1 — EOD STATE VERIFICATION ===');
  
  // 1. Read local db.json
  let localEodState = [];
  try {
    const dbJsonPath = path.join(__dirname, '../db.json');
    if (fs.existsSync(dbJsonPath)) {
      const data = JSON.parse(fs.readFileSync(dbJsonPath, 'utf8'));
      localEodState = data.eod_report_state || [];
      console.log('Local db.json eod_report_state:', JSON.stringify(localEodState, null, 2));
    } else {
      console.log('local db.json not found!');
    }
  } catch (err) {
    console.error('Error reading local db.json:', err.message);
  }

  // 2. Read Postgres
  let pgEodState = [];
  if (process.env.DATABASE_URL) {
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });
    try {
      const res = await pool.query('SELECT * FROM eod_report_state ORDER BY date DESC');
      pgEodState = res.rows;
      console.log('PostgreSQL eod_report_state:', JSON.stringify(pgEodState, null, 2));
    } catch (err) {
      console.error('Error querying Postgres:', err.message);
    } finally {
      await pool.end();
    }
  } else {
    console.log('DATABASE_URL not set in env');
  }

  // 3. For today's date (2026-06-12)
  const todayStr = '2026-06-12';
  console.log(`\nFor today's date (${todayStr}):`);
  
  const localToday = localEodState.find(s => s.date === todayStr);
  const pgToday = pgEodState.find(s => s.date === todayStr);
  
  console.log('Local Cache Today:', localToday);
  console.log('Postgres Today:', pgToday);

  // 4. Verification Check
  let agreement = false;
  if (!localToday && !pgToday) {
    console.log('Both are empty for today (No EOD report sent yet).');
    agreement = true;
  } else if (localToday && pgToday) {
    const localTime = new Date(localToday.sent_at).getTime();
    const pgTime = new Date(pgToday.sent_at).getTime();
    if (localToday.sent === pgToday.sent && localTime === pgTime) {
      console.log('Local cache and Postgres match exactly.');
      agreement = true;
    } else {
      console.log(`Mismatch detected! Local: sent=${localToday.sent}, sent_at=${localToday.sent_at} | Postgres: sent=${pgToday.sent}, sent_at=${pgToday.sent_at}`);
    }
  } else {
    console.log('Mismatch: exists in one but not the other.');
  }

  console.log('\nResult: ' + (agreement ? 'PASS' : 'FAIL'));
}

run().catch(console.error);
