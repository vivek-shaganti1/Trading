const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

async function run() {
  console.log('=== CLEANING FUTURE-DATE TEST DATA ===');

  // 1. Clean PostgreSQL
  if (process.env.DATABASE_URL) {
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });
    try {
      console.log('Cleaning PostgreSQL tables...');
      
      const eodDel = await pool.query("DELETE FROM eod_report_state WHERE date IN ('2026-06-13', '2026-06-14')");
      console.log(`Deleted from eod_report_state: ${eodDel.rowCount} rows`);

      const statsDel = await pool.query("DELETE FROM daily_stats WHERE date IN ('2026-06-13', '2026-06-14')");
      console.log(`Deleted from daily_stats: ${statsDel.rowCount} rows`);

      // Let's also check if there are future alerts
      const alertsDel = await pool.query("DELETE FROM alerts WHERE message LIKE '%2026-06-13%' OR message LIKE '%2026-06-14%'");
      console.log(`Deleted from alerts: ${alertsDel.rowCount} rows`);

    } catch (err) {
      console.error('Error cleaning PostgreSQL:', err.message);
    } finally {
      await pool.end();
    }
  } else {
    console.log('DATABASE_URL not set');
  }

  // 2. Clean local db.json
  const dbJsonPath = path.join(__dirname, '../db.json');
  try {
    if (fs.existsSync(dbJsonPath)) {
      console.log('Cleaning db.json...');
      const dbData = JSON.parse(fs.readFileSync(dbJsonPath, 'utf8'));

      if (dbData.eod_report_state) {
        const initialCount = dbData.eod_report_state.length;
        dbData.eod_report_state = dbData.eod_report_state.filter(s => s.date !== '2026-06-13' && s.date !== '2026-06-14');
        console.log(`Filtered db.json eod_report_state: ${initialCount} -> ${dbData.eod_report_state.length}`);
      }

      if (dbData.daily_stats) {
        const initialCount = dbData.daily_stats.length;
        dbData.daily_stats = dbData.daily_stats.filter(s => s.date !== '2026-06-13' && s.date !== '2026-06-14');
        console.log(`Filtered db.json daily_stats: ${initialCount} -> ${dbData.daily_stats.length}`);
      }

      if (dbData.alerts) {
        const initialCount = dbData.alerts.length;
        dbData.alerts = dbData.alerts.filter(a => !a.message.includes('2026-06-13') && !a.message.includes('2026-06-14'));
        console.log(`Filtered db.json alerts: ${initialCount} -> ${dbData.alerts.length}`);
      }

      fs.writeFileSync(dbJsonPath, JSON.stringify(dbData, null, 2), 'utf8');
      console.log('db.json updated successfully.');
    }
  } catch (err) {
    console.error('Error cleaning db.json:', err.message);
  }
}

run().catch(console.error);
