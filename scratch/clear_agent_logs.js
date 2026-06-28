const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const config = require('../config');

async function clean() {
  console.log('🧹 CLEARING MOCK AGENT ENTRIES...');
  
  if (config.DATABASE_URL) {
    const pool = new Pool({
      connectionString: config.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });
    await pool.query('TRUNCATE agent20_reports, agent21_trust_logs, agent22_research_logs, agent23_journals');
    console.log('✅ PostgreSQL Agent tables truncated.');
    await pool.end();
  }

  const dbPath = path.join(__dirname, '../db.json');
  if (fs.existsSync(dbPath)) {
    const data = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    data.agent20_reports = [];
    data.agent21_trust_logs = [];
    data.agent22_research_logs = [];
    data.agent23_journals = [];
    fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));
    console.log('✅ Local db.json Agent cache cleared.');
  }
  process.exit(0);
}
clean().catch(err => {
  console.error(err);
  process.exit(1);
});
