require('dotenv').config();
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

async function takeBackup() {
  console.log('🔄 STARTING READ-ONLY BACKUP SNAPSHOT...');
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    const tables = [
      'portfolio_state',
      'trade_logs',
      'consensus_decisions',
      'agent20_reports',
      'agent21_trust_logs',
      'agent22_research_logs',
      'agent23_journals',
      'agent25_sizing_logs',
      'agent26_market_memory'
    ];

    const snapshot = {
      timestamp: new Date().toISOString(),
      data: {}
    };

    for (const table of tables) {
      try {
        const res = await client.query(`SELECT * FROM ${table}`);
        snapshot.data[table] = res.rows;
        console.log(`✅ Backed up ${res.rows.length} rows from table "${table}"`);
      } catch (err) {
        console.error(`❌ Error backing up table "${table}":`, err.message);
      }
    }

    const backupPath = path.join(__dirname, 'db_backup_snapshot.json');
    fs.writeFileSync(backupPath, JSON.stringify(snapshot, null, 2));
    console.log(`🎉 BACKUP SNAPSHOT COMPLETED SUCCESSFULLY! Saved to: ${backupPath}`);
  } catch (err) {
    console.error('❌ Backup failed:', err.message);
  } finally {
    await client.end();
  }
}

takeBackup();
