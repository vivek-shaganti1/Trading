const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config();

async function run() {
  console.log('=== SECTION 4 — TELEGRAM AUDIT ===');
  const todayDateStr = '2026-06-12';

  // Find in local db.json
  const dbJsonPath = path.join(__dirname, '../db.json');
  let localAlerts = [];
  if (fs.existsSync(dbJsonPath)) {
    const dbData = JSON.parse(fs.readFileSync(dbJsonPath, 'utf8'));
    localAlerts = dbData.alerts || [];
  }

  // Filter EOD reports for today in local db.json
  const localEodAlerts = localAlerts.filter(a => {
    const isToday = a.timestamp && a.timestamp.startsWith(todayDateStr);
    const isEod = a.message && a.message.includes('EOD PERFORMANCE REPORT');
    return isToday && isEod;
  });

  console.log(`Local db.json EOD alerts for today (${todayDateStr}):`);
  localEodAlerts.forEach(a => {
    console.log(`- Time: ${a.timestamp} | Type: ${a.type} | Message length: ${a.message.length}`);
  });
  console.log(`Total count in local db.json: ${localEodAlerts.length}\n`);

  // Query PostgreSQL
  if (process.env.DATABASE_URL) {
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });
    try {
      const query = `
        SELECT * FROM alerts 
        WHERE message LIKE '%EOD PERFORMANCE REPORT%' 
          AND timestamp >= '2026-06-12 00:00:00+05:30'
          AND timestamp <= '2026-06-12 23:59:59+05:30'
        ORDER BY timestamp ASC
      `;
      const res = await pool.query(query);
      const pgAlerts = res.rows;
      console.log(`PostgreSQL EOD alerts for today (${todayDateStr}):`);
      pgAlerts.forEach(a => {
        console.log(`- Time: ${a.timestamp} | Type: ${a.type} | Message MD5: ${require('crypto').createHash('md5').update(a.message).digest('hex')} | Status: ${a.status}`);
      });
      console.log(`Total count in PostgreSQL: ${pgAlerts.length}`);
    } catch (err) {
      console.error('Error querying PostgreSQL:', err.message);
    } finally {
      await pool.end();
    }
  } else {
    console.log('DATABASE_URL not set');
  }
}

run().catch(console.error);
