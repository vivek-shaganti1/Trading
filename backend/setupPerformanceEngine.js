/**
 * Setup Performance Engine for AGY-Trader
 * Stores and learns setup outcomes to suppress negative expectancy combinations.
 */

const db = require('./db');

// Ensure database table if Postgres is active
async function initSetupPerformanceTable() {
  if (db.isDbAvailable && typeof db.runQuery === 'function') {
    try {
      await db.runQuery(`
        CREATE TABLE IF NOT EXISTS setup_performance (
          id SERIAL PRIMARY KEY,
          timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          pattern TEXT,
          regime TEXT,
          volume_state TEXT,
          smc_state TEXT,
          outcome_pnl NUMERIC
        );
      `);
    } catch (err) {
      console.error('[SETUP PERFORMANCE] Table init failed:', err.message);
    }
  }
}

// Call on startup
initSetupPerformanceTable();

/**
 * Log a setup outcome to the database
 */
async function logSetup(pattern, regime, volumeState, smcState, outcomePnL) {
  const entry = {
    timestamp: new Date().toISOString(),
    pattern: pattern || 'None',
    regime: regime || 'Neutral',
    volume_state: volumeState || 'Normal',
    smc_state: smcState || 'None',
    outcome_pnl: Number(outcomePnL || 0)
  };

  try {
    // Save to local db cache
    const data = db.readLocalDb();
    data.setup_performance = data.setup_performance || [];
    data.setup_performance.push(entry);
    db.writeLocalDb(data);

    // Save to Postgres
    if (db.isDbAvailable && typeof db.runQuery === 'function') {
      await db.runQuery(`
        INSERT INTO setup_performance (pattern, regime, volume_state, smc_state, outcome_pnl)
        VALUES ($1, $2, $3, $4, $5)
      `, [entry.pattern, entry.regime, entry.volume_state, entry.smc_state, entry.outcome_pnl]);
    }
    console.log(`[SETUP PERFORMANCE] Logged setup: ${entry.pattern} under ${entry.regime} (PnL: ₹${entry.outcome_pnl.toFixed(2)})`);
  } catch (err) {
    console.error('[SETUP PERFORMANCE] Failed to log setup:', err.message);
  }
}

/**
 * Evaluate expectancy of a setup configuration
 * Returns { count, winRate, expectancy, suppressed }
 */
function evaluateSetup(pattern, regime, volumeState, smcState) {
  const data = db.readLocalDb();
  const setups = data.setup_performance || [];

  // Filter matching setups
  const matches = setups.filter(s => 
    s.pattern === pattern &&
    s.regime === regime &&
    s.volume_state === volumeState &&
    s.smc_state === smcState
  );

  if (matches.length < 3) {
    // Not enough data to suppress yet
    return { count: matches.length, winRate: 100, expectancy: 1.0, suppressed: false };
  }

  const wins = matches.filter(s => s.outcome_pnl > 0).length;
  const winRate = wins / matches.length;
  const totalPnL = matches.reduce((sum, s) => sum + s.outcome_pnl, 0);
  const expectancy = totalPnL / matches.length;

  // Suppress if negative expectancy or win rate < 40%
  const suppressed = expectancy < 0 || winRate < 0.40;

  return {
    count: matches.length,
    winRate,
    expectancy,
    suppressed
  };
}

/**
 * Auto-check if a setup is suppressed
 */
function isSuppressed(pattern, regime, volumeState, smcState) {
  const evaluation = evaluateSetup(pattern, regime, volumeState, smcState);
  if (evaluation.suppressed) {
    console.log(`[SETUP PERFORMANCE] Suppression active for combination: Pattern=${pattern}, Regime=${regime}, Vol=${volumeState}, SMC=${smcState} (Expectancy: ₹${evaluation.expectancy.toFixed(2)}, WinRate: ${(evaluation.winRate * 100).toFixed(1)}%)`);
  }
  return evaluation.suppressed;
}

module.exports = {
  logSetup,
  evaluateSetup,
  isSuppressed
};
