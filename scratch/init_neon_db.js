require('dotenv').config();
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('❌ Error: DATABASE_URL is missing in your .env file.');
  process.exit(1);
}

const schemaPath = path.join(__dirname, '..', 'schema.sql');
if (!fs.existsSync(schemaPath)) {
  console.error('❌ Error: schema.sql not found at ' + schemaPath);
  process.exit(1);
}

const schemaSql = fs.readFileSync(schemaPath, 'utf8');

async function initDb() {
  console.log('🔌 Connecting to Neon PostgreSQL...');
  const client = new Client({
    connectionString: databaseUrl,
    ssl: {
      rejectUnauthorized: false
    }
  });

  try {
    await client.connect();
    console.log('✅ Connected successfully.');

    console.log('🚀 Executing schema.sql as a single multi-statement query...');
    await client.query(schemaSql);
    console.log('🎉 Database schema initialized successfully!');
  } catch (err) {
    console.error('💥 Error executing schema SQL:', err);
  } finally {
    await client.end();
  }
}

initDb();
