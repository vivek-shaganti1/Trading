require('dotenv').config();
const { Client } = require('pg');

async function runProductionTests() {
  console.log('🛡️  Initiating Production Readiness Verification Suite for Neon PostgreSQL...\n');

  const results = {
    envDatabaseUrl: { status: 'PENDING', message: '' },
    envGeminiKey: { status: 'PENDING', message: '' },
    envGroqKey: { status: 'PENDING', message: '' },
    envTelegramCreds: { status: 'PENDING', message: '' },
    connection: { status: 'PENDING', message: '' },
    schema: { status: 'PENDING', message: '' },
    insert: { status: 'PENDING', message: '' },
    read: { status: 'PENDING', message: '' },
    update: { status: 'PENDING', message: '' },
    delete: { status: 'PENDING', message: '' },
    jsonb: { status: 'PENDING', message: '' },
    transaction: { status: 'PENDING', message: '' },
    sessionRecovery: { status: 'PENDING', message: '' }
  };

  // 1. Environment Variable Checks
  // DATABASE_URL
  if (process.env.DATABASE_URL) {
    results.envDatabaseUrl = { status: 'PASS', message: 'DATABASE_URL exists and is populated.' };
  } else {
    results.envDatabaseUrl = { status: 'FAIL', message: 'DATABASE_URL is missing or empty.' };
  }

  // Gemini Key
  if (process.env.GEMINI_API_KEY) {
    results.envGeminiKey = { status: 'PASS', message: 'GEMINI_API_KEY exists and is populated.' };
  } else {
    results.envGeminiKey = { status: 'FAIL', message: 'GEMINI_API_KEY is missing or empty (Required AI Moderator).' };
  }

  // Groq Key
  if (process.env.GROQ_API_KEY) {
    results.envGroqKey = { status: 'PASS', message: 'GROQ_API_KEY exists and is populated.' };
  } else {
    results.envGroqKey = { status: 'WARN', message: 'GROQ_API_KEY is missing or empty (Optional fallback).' };
  }

  // Telegram Credentials
  if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
    results.envTelegramCreds = { status: 'PASS', message: 'TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID exist and are populated.' };
  } else {
    results.envTelegramCreds = { status: 'WARN', message: `Telegram variables are incomplete. Token: ${process.env.TELEGRAM_BOT_TOKEN ? 'OK' : 'MISSING'}, Chat ID: ${process.env.TELEGRAM_CHAT_ID ? 'OK' : 'MISSING'}` };
  }

  // Stop if DATABASE_URL is missing
  if (results.envDatabaseUrl.status === 'FAIL') {
    results.connection = { status: 'BLOCKED', message: 'Skipped due to missing DATABASE_URL.' };
    results.schema = { status: 'BLOCKED', message: 'Skipped due to missing DATABASE_URL.' };
    results.insert = { status: 'BLOCKED', message: 'Skipped due to missing DATABASE_URL.' };
    results.read = { status: 'BLOCKED', message: 'Skipped due to missing DATABASE_URL.' };
    results.update = { status: 'BLOCKED', message: 'Skipped due to missing DATABASE_URL.' };
    results.delete = { status: 'BLOCKED', message: 'Skipped due to missing DATABASE_URL.' };
    results.jsonb = { status: 'BLOCKED', message: 'Skipped due to missing DATABASE_URL.' };
    results.transaction = { status: 'BLOCKED', message: 'Skipped due to missing DATABASE_URL.' };
    results.sessionRecovery = { status: 'BLOCKED', message: 'Skipped due to missing DATABASE_URL.' };
    printReport(results);
    return;
  }

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false
    }
  });

  try {
    // 2. Connection Test
    try {
      await client.connect();
      results.connection = { status: 'PASS', message: 'Successfully connected and authenticated with Neon.' };
    } catch (err) {
      results.connection = { status: 'FAIL', message: err.message };
      printReport(results);
      return;
    }

    // 3. Schema Validation (All 15 tables)
    try {
      const tableCheck = await client.query(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'"
      );
      const existingTables = tableCheck.rows.map(r => r.table_name.toLowerCase());
      
      const requiredTables = [
        'users',
        'sessions',
        'portfolio_state',
        'daily_stats',
        'trade_logs',
        'prediction_logs',
        'model_weights',
        'consensus_decisions',
        'telegram_commands',
        'risk_events',
        'alerts',
        'learning_feedback',
        'agent_memory',
        'paper_trading_results',
        'daily_model_performance'
      ];

      const missingTables = requiredTables.filter(t => !existingTables.includes(t));
      if (missingTables.length > 0) {
        results.schema = { 
          status: 'FAIL', 
          message: `Missing required schema tables: [${missingTables.join(', ')}]. Please run schema.sql first.` 
        };
      } else {
        results.schema = { status: 'PASS', message: 'All 15 required tables exist in public schema.' };
      }
    } catch (err) {
      results.schema = { status: 'FAIL', message: `Schema check query failed: ${err.message}` };
    }

    // Prepare a test user ID for referencing
    let testUserId = null;
    try {
      const userRes = await client.query(
        "INSERT INTO users (email) VALUES ($1) ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email RETURNING id",
        ['neon-prod-test@quantbot.test']
      );
      testUserId = userRes.rows[0].id;
    } catch (err) {
      console.warn('⚠️ Warning: Failed to upsert test user, proceeding without FK validation...', err.message);
    }

    // 4. Insert Test Records (Using alerts)
    const testAlertId = `ALT-PROD-TEST-${Date.now()}`;
    try {
      const insertRes = await client.query(
        `INSERT INTO alerts (id, timestamp, type, message, status)
         VALUES ($1, NOW(), $2, $3, $4) RETURNING *`,
        [testAlertId, 'system', 'Production test message', 'MOCKED']
      );
      if (insertRes.rows.length === 1) {
        results.insert = { status: 'PASS', message: `Successfully inserted record into alerts: ${testAlertId}` };
      } else {
        throw new Error('Insert query executed but returned 0 rows.');
      }
    } catch (err) {
      results.insert = { status: 'FAIL', message: `Insert failed: ${err.message}` };
    }

    // 5. Read Records
    try {
      const readRes = await client.query('SELECT * FROM alerts WHERE id = $1', [testAlertId]);
      if (readRes.rows.length === 1 && readRes.rows[0].message === 'Production test message') {
        results.read = { status: 'PASS', message: 'Successfully selected record with parameter bindings.' };
      } else {
        throw new Error('Selected record was missing or fields did not match.');
      }
    } catch (err) {
      results.read = { status: 'FAIL', message: `Read query failed: ${err.message}` };
    }

    // 6. Update Records
    try {
      const updateRes = await client.query(
        "UPDATE alerts SET status = $1, message = $2 WHERE id = $3 RETURNING *",
        ['SENT', 'Production test message - Updated', testAlertId]
      );
      if (updateRes.rows.length === 1 && updateRes.rows[0].status === 'SENT') {
        results.update = { status: 'PASS', message: 'Successfully updated record.' };
      } else {
        throw new Error('Update returned 0 rows or did not apply value.');
      }
    } catch (err) {
      results.update = { status: 'FAIL', message: `Update query failed: ${err.message}` };
    }

    // 7. JSONB Storage Verification (Using risk_events)
    const testRiskId = `RE-PROD-TEST-${Date.now()}`;
    const complexJsonData = {
      nested: {
        value: 1234.56,
        array: ['risk_mode', 'conservative'],
        flag: true
      }
    };
    try {
      await client.query(
        `INSERT INTO risk_events (id, timestamp, event_type, description, portfolio_value, details)
         VALUES ($1, NOW(), $2, $3, $4, $5)`,
        [testRiskId, 'TEST_JSONB', 'JSONB data validation', 12000, JSON.stringify(complexJsonData)]
      );
      
      const jsonRes = await client.query('SELECT details FROM risk_events WHERE id = $1', [testRiskId]);
      const retrievedDetails = jsonRes.rows[0].details;
      
      if (retrievedDetails.nested && retrievedDetails.nested.value === 1234.56 && retrievedDetails.nested.flag === true) {
        results.jsonb = { status: 'PASS', message: 'JSONB serialization, storage, and automatic deserialization working.' };
      } else {
        throw new Error('Deserialized JSON object did not match inserted object.');
      }
      
      // Cleanup risk event
      await client.query('DELETE FROM risk_events WHERE id = $1', [testRiskId]);
    } catch (err) {
      results.jsonb = { status: 'FAIL', message: `JSONB test failed: ${err.message}` };
    }

    // 8. Transaction Support Verification (Atomicity BEGIN / ROLLBACK / COMMIT)
    try {
      const txTestId1 = `ALT-TX1-${Date.now()}`;
      const txTestId2 = `ALT-TX2-${Date.now()}`;
      
      // Test 8a: ROLLBACK rollback verification
      await client.query('BEGIN');
      await client.query(
        "INSERT INTO alerts (id, timestamp, type, message, status) VALUES ($1, NOW(), 'system', 'TX Rollback Test', 'MOCKED')",
        [txTestId1]
      );
      await client.query('ROLLBACK');
      
      const checkRollback = await client.query('SELECT * FROM alerts WHERE id = $1', [txTestId1]);
      if (checkRollback.rows.length !== 0) {
        throw new Error('ROLLBACK executed, but inserted row still exists in database.');
      }

      // Test 8b: COMMIT commit verification
      await client.query('BEGIN');
      await client.query(
        "INSERT INTO alerts (id, timestamp, type, message, status) VALUES ($1, NOW(), 'system', 'TX Commit Test', 'MOCKED')",
        [txTestId2]
      );
      await client.query('COMMIT');
      
      const checkCommit = await client.query('SELECT * FROM alerts WHERE id = $1', [txTestId2]);
      if (checkCommit.rows.length !== 1) {
        throw new Error('COMMIT executed, but inserted row is missing from database.');
      }

      // Cleanup
      await client.query('DELETE FROM alerts WHERE id = $1', [txTestId2]);
      results.transaction = { status: 'PASS', message: 'Transaction BEGIN, ROLLBACK, and COMMIT atomicity verified.' };
    } catch (err) {
      results.transaction = { status: 'FAIL', message: `Transaction test failed: ${err.message}` };
    }

    // 9. Session Recovery Verification (Sessions table lookup)
    try {
      const sessionSearch = await client.query("SELECT * FROM sessions WHERE status = 'ACTIVE' LIMIT 1");
      if (sessionSearch.rows.length > 0) {
        results.sessionRecovery = { 
          status: 'PASS', 
          message: `Active session recovered successfully from memory. ID: ${sessionSearch.rows[0].id}` 
        };
      } else {
        // Create an active session and retrieve it
        const sessId = `SESS-REC-${Date.now()}`;
        await client.query(
          "INSERT INTO sessions (id, user_id, start_time, status) VALUES ($1, $2, NOW(), $3)",
          [sessId, testUserId, 'ACTIVE']
        );
        const checkSess = await client.query("SELECT * FROM sessions WHERE status = 'ACTIVE' LIMIT 1");
        if (checkSess.rows.length > 0) {
          results.sessionRecovery = { status: 'PASS', message: `Created and successfully recovered session: ${checkSess.rows[0].id}` };
        } else {
          throw new Error('Session was inserted but could not be recovered.');
        }
      }
    } catch (err) {
      results.sessionRecovery = { status: 'FAIL', message: `Session recovery check failed: ${err.message}` };
    }

    // 10. Delete Capability (Clean up the test records)
    try {
      const deleteRes = await client.query('DELETE FROM alerts WHERE id = $1 RETURNING *', [testAlertId]);
      if (deleteRes.rows.length === 1) {
        results.delete = { status: 'PASS', message: `Successfully deleted test record: ${testAlertId}` };
      } else {
        throw new Error('Delete returned 0 rows.');
      }
    } catch (err) {
      results.delete = { status: 'FAIL', message: `Delete failed: ${err.message}` };
    }

  } catch (err) {
    console.error('💥 Critical Suite Exception:', err.message);
  } finally {
    await client.end();
    printReport(results);
  }
}

function printReport(results) {
  console.log('========================================================================');
  console.log('📋 NEON POSTGRESQL PRODUCTION READINESS AUDIT REPORT');
  console.log('========================================================================');
  
  let allPass = true;
  for (const [testName, result] of Object.entries(results)) {
    let icon = '⚪ PENDING';
    if (result.status === 'PASS') icon = '🟢 PASS';
    else if (result.status === 'FAIL') icon = '🔴 FAIL';
    else if (result.status === 'WARN') icon = '🟡 WARN';
    else if (result.status === 'BLOCKED') icon = '🔴 BLOCKED';
    
    if (result.status === 'FAIL') allPass = false;
    console.log(`${icon.padEnd(8)} | ${testName.toUpperCase().padEnd(16)} | ${result.message}`);
  }
  
  console.log('========================================================================');
  console.log(`STATUS: ${allPass ? 'Ready for production deployment!' : 'Deployment blocked by configuration/database validation failures.'}`);
  console.log('========================================================================');
  
  process.exit(allPass ? 0 : 1);
}

runProductionTests();
