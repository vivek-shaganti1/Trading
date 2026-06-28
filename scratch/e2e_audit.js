require('dotenv').config();
const db = require('../db');
const predictor = require('../predictor');
const broker = require('../broker');
const alerts = require('../alerts');
const { Client } = require('pg');

async function runAudit() {
  console.log('🏁 Initiating End-to-End Workflow Audit...\n');

  // Stub mock prices for the instruments to provide raw data
  const entryPrice = 1258.80;
  broker._setMockPrice('RELIANCE', entryPrice);
  const closes = [1250.00, 1252.50, 1255.00, entryPrice];

  console.log('1. Raw Market Data Input:');
  console.log(`   - Symbol: RELIANCE`);
  console.log(`   - Closing Prices Series: [${closes.join(', ')}]`);
  console.log(`   - Current Price (LTP): ₹${entryPrice}`);
  console.log(`   - Timestamp: ${new Date().toISOString()}`);

  console.log('\n2. Executing Multi-Model Consensus Engine...');
  // This will execute prediction, run agent consensus, debate moderator logic, and write database logs.
  // Note: predictor will print the formatted intelligence JSON and debate directly to stdout.
  const prediction = await predictor.getPrediction('RELIANCE', closes);

  console.log('\n3. Verifying Database Writes...');
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();

    // Query prediction_logs
    const plRes = await client.query('SELECT * FROM prediction_logs WHERE id = $1', [prediction.id]);
    if (plRes.rows.length > 0) {
      console.log(`✅ prediction_logs row exists for ID: ${prediction.id}`);
      console.log(JSON.stringify(plRes.rows[0], null, 2));
    } else {
      console.error(`❌ Error: prediction_logs row missing for ID: ${prediction.id}`);
    }

    // Query consensus_decisions
    const cdRes = await client.query('SELECT * FROM consensus_decisions WHERE id = $1', [prediction.id]);
    if (cdRes.rows.length > 0) {
      console.log(`✅ consensus_decisions row exists for ID: ${prediction.id}`);
      console.log(JSON.stringify(cdRes.rows[0], null, 2));
    } else {
      console.error(`❌ Error: consensus_decisions row missing for ID: ${prediction.id}`);
    }

    // 4. Send Telegram Notification
    console.log('\n4. Dispatched Telegram final decision alert...');
    const tgMessage = `🎯 <b>E2E Audit Prediction Alert</b>\n` +
                      `• Symbol: <b>${prediction.symbol}</b>\n` +
                      `• Signal: <b>${prediction.signal}</b>\n` +
                      `• Confidence: <b>${Math.round(prediction.confidence * 100)}%</b>\n` +
                      `• Decision ID: <code>${prediction.id}</code>\n` +
                      `• Timestamp: <code>${new Date().toLocaleTimeString()}</code>`;

    const tgDelivery = await alerts.sendTelegram(tgMessage);
    console.log(`Telegram delivery result: ${tgDelivery ? 'SUCCESS 🟢' : 'FAILED 🔴'}`);

    // 5. Emitting Dashboard WebSocket Event Mock
    console.log('\n5. WebSocket/Dashboard Event Payload Structure:');
    const wsUpdate = {
      type: 'STATUS_UPDATE',
      data: {
        strategy: 'DAY_TRADING',
        isRunning: true,
        balance: 12000.00,
        equityValue: 0.00,
        totalVal: 12000.00,
        netPnL: 0.00,
        target: 1000.00,
        lastPrediction: {
          id: prediction.id,
          symbol: prediction.symbol,
          signal: prediction.signal,
          confidence: prediction.confidence,
          timestamp: prediction.timestamp
        },
        recentAlerts: alerts.getRecentAlerts()
      }
    };
    console.log(JSON.stringify(wsUpdate, null, 2));

  } catch (err) {
    console.error('Audit verification database check failed:', err.message);
  } finally {
    await client.end();
  }
}

runAudit();
