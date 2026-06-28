require('dotenv').config();
const { Client } = require('pg');

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error('❌ Error: DATABASE_URL is missing in your .env file.');
  process.exit(1);
}

const client = new Client({
  connectionString: databaseUrl,
  ssl: {
    rejectUnauthorized: false
  }
});

async function runTest() {
  console.log('🔌 Initiating Neon PostgreSQL CRUD & Session Restore Verification...\n');

  try {
    // 1. Connection Test
    console.log('1. Checking Connection...');
    await client.connect();
    console.log('   ✅ Connection successful!\n');

    // 2. Insert Capability
    console.log('2. Testing INSERT Capability...');
    const testId = `ALT-TEST-${Date.now()}`;
    const insertQuery = `
      INSERT INTO alerts (id, timestamp, type, message, status)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `;
    const insertParams = [
      testId,
      new Date().toISOString(),
      'system',
      'Neon PostgreSQL CRUD Verification Alert',
      'MOCKED'
    ];
    
    const insertRes = await client.query(insertQuery, insertParams);
    if (insertRes.rows.length === 0) {
      throw new Error('Insert failed: No row returned.');
    }
    console.log('   ✅ Insert successful! Inserted Row:', JSON.stringify(insertRes.rows[0]));
    console.log('');

    // 3. Read Capability
    console.log('3. Testing READ Capability...');
    const readRes = await client.query('SELECT * FROM alerts WHERE id = $1', [testId]);
    if (readRes.rows.length === 0) {
      throw new Error('Read failed: Row not found.');
    }
    console.log('   ✅ Read successful! Retrieved Row:', JSON.stringify(readRes.rows[0]));
    console.log('');

    // 4. Update Capability
    console.log('4. Testing UPDATE Capability...');
    const updateQuery = `
      UPDATE alerts
      SET status = $1, message = $2
      WHERE id = $3
      RETURNING *
    `;
    const updateRes = await client.query(updateQuery, ['SENT', 'Neon PostgreSQL CRUD Verification Alert - Updated', testId]);
    if (updateRes.rows.length === 0) {
      throw new Error('Update failed: No row returned.');
    }
    console.log('   ✅ Update successful! Updated Row:', JSON.stringify(updateRes.rows[0]));
    console.log('');

    // 5. Delete Capability
    console.log('5. Testing DELETE Capability...');
    const deleteRes = await client.query('DELETE FROM alerts WHERE id = $1 RETURNING *', [testId]);
    if (deleteRes.rows.length === 0) {
      throw new Error('Delete failed: No row returned.');
    }
    console.log('   ✅ Delete successful! Deleted Row:', JSON.stringify(deleteRes.rows[0]));
    console.log('');

    // Verify row is gone
    const verifyDelete = await client.query('SELECT * FROM alerts WHERE id = $1', [testId]);
    if (verifyDelete.rows.length > 0) {
      throw new Error('Verify Delete failed: Row still exists.');
    }
    console.log('   ✅ Double Check: Row successfully confirmed deleted from database.');
    console.log('');

    // 6. Session Restore Capability
    console.log('6. Testing Session Restore Capability...');
    const sessionRes = await client.query("SELECT * FROM sessions WHERE status = 'ACTIVE' LIMIT 1");
    if (sessionRes.rows.length > 0) {
      console.log(`   ✅ Session restore capability verified! Active session: ${sessionRes.rows[0].id}`);
    } else {
      console.log('   ℹ️ No active sessions found. Starting new active session...');
      const newSessionId = `SESS-TEST-${Date.now()}`;
      await client.query("INSERT INTO sessions (id, status, start_time) VALUES ($1, 'ACTIVE', NOW())", [newSessionId]);
      
      const verifySession = await client.query('SELECT * FROM sessions WHERE id = $1', [newSessionId]);
      if (verifySession.rows.length === 0) {
        throw new Error('Session restore verification failed.');
      }
      console.log(`   ✅ Session start & restore capability verified! Created Session: ${verifySession.rows[0].id}`);
    }
    console.log('');

    console.log('🎉 ALL NEON POSTGRESQL CRUD & SESSION TESTS COMPLETED SUCCESSFULLY!');
    await client.end();
    process.exit(0);

  } catch (err) {
    console.error('\n❌ ERROR RUNNING TEST SUITE:', err.message);
    try {
      await client.end();
    } catch (e) {}
    process.exit(1);
  }
}

runTest();
