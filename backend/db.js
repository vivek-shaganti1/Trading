const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const config = require('../shared/config');
const providerHealth = require('./providerHealth');

const DB_FILE = path.join(__dirname, '..', process.env.DB_FILE || 'db.json');

let pool = null;
let dbAvailable = false;
let syncInProgress = false;
let syncInterval = null;

// Initialize postgres pool if URL is available
if (config.DATABASE_URL) {
  pool = new Pool({
    connectionString: config.DATABASE_URL,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    ssl: {
      rejectUnauthorized: false
    }
  });
  pool.on('error', (err, client) => {
    console.error('[DB POOL ERROR]: Idle client encountered error:', err.message);
  });
}

// Initialize local JSON database if not exists or migrate structures
function initLocalDb() {
  let modified = false;
  let dbData = {
    portfolio_state: {
      strategy: 'SWING',
      balance: config.INITIAL_CAPITAL,
      equity_value: 0,
      current_daily_target: config.DAILY_PROFIT_TARGET_START,
      lifetime_pnl: 0,
      holding_stocks: []
    },
    daily_stats: [],
    trade_logs: [],
    prediction_logs: [],
    consensus_decisions: [],
    telegram_commands: [],
    risk_events: [],
    alerts: [],
    learning_feedback: [],
    paper_trading_results: {
      id: 'default',
      trading_days_tracked: 0,
      win_rate: 0.00,
      profit_factor: 1.00,
      sharpe_ratio: 0.00,
      max_drawdown: 0.00,
      accuracy: 0.00,
      net_pnl: 0.00,
      details: {}
    },
    daily_model_performance: [],
    completed_trades: []
  };

  if (fs.existsSync(DB_FILE)) {
    try {
      dbData = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    } catch (err) {
      // ignore
    }
  } else {
    modified = true;
  }

  // Ensure default structures
  if (!dbData.portfolio_state) {
    dbData.portfolio_state = {};
    modified = true;
  }
  if (!dbData.portfolio_state.user_instructions) {
    dbData.portfolio_state.user_instructions = {
      risk_mode: 'NORMAL',
      min_confidence_override: 0.75,
      avoid_intraday: false,
      avoid_longterm: false,
      max_positions: 3
    };
    modified = true;
  }
  if (!dbData.portfolio_state.model_weights) {
    dbData.portfolio_state.model_weights = {
      agent1_weight: 0.35,
      agent2_weight: 0.25,
      agent3_weight: 0.20,
      agent4_weight: 0.20,
      emaWeight: 0.4,
      rsiWeight: 0.3,
      macdWeight: 0.3,
      rsiThreshold: 50,
      adaptationCount: 0
    };
    modified = true;
  }
  if (!dbData.session_memory) {
    dbData.session_memory = {
      winning_patterns: [],
      losing_patterns: [],
      risk_events: [],
      paper_trading_stats: {
        trading_days_tracked: 0,
        win_rate: 0.00,
        profit_factor: 1.00,
        sharpe_ratio: 0.00,
        max_drawdown: 0.00,
        accuracy: 0.00
      }
    };
    modified = true;
  }
  if (!dbData.daily_stats) { dbData.daily_stats = []; modified = true; }
  if (!dbData.trade_logs) { dbData.trade_logs = []; modified = true; }
  if (!dbData.prediction_logs) { dbData.prediction_logs = []; modified = true; }
  if (!dbData.consensus_decisions) { dbData.consensus_decisions = []; modified = true; }
  if (!dbData.telegram_commands) { dbData.telegram_commands = []; modified = true; }
  if (!dbData.risk_events) { dbData.risk_events = []; modified = true; }
  if (!dbData.alerts) { dbData.alerts = []; modified = true; }
  if (!dbData.learning_feedback) { dbData.learning_feedback = []; modified = true; }
  if (!dbData.agent20_reports) { dbData.agent20_reports = []; modified = true; }
  if (!dbData.agent21_trust_logs) { dbData.agent21_trust_logs = []; modified = true; }
  if (!dbData.agent22_research_logs) { dbData.agent22_research_logs = []; modified = true; }
  if (!dbData.agent23_journals) { dbData.agent23_journals = []; modified = true; }
  if (!dbData.agent24_audit_logs) { dbData.agent24_audit_logs = []; modified = true; }
  if (!dbData.agent25_sizing_logs) { dbData.agent25_sizing_logs = []; modified = true; }
  if (!dbData.agent26_market_memory) { dbData.agent26_market_memory = []; modified = true; }
  if (!dbData.nightly_learning_reports) { dbData.nightly_learning_reports = []; modified = true; }
  if (!dbData.threshold_history) { dbData.threshold_history = []; modified = true; }
  if (!dbData.performance_metrics) { dbData.performance_metrics = []; modified = true; }
  if (!dbData.throughput_history) { dbData.throughput_history = []; modified = true; }
  if (!dbData.opportunity_tracker) { dbData.opportunity_tracker = []; modified = true; }
  if (!dbData.shadow_trades) { dbData.shadow_trades = []; modified = true; }
  if (!dbData.paper_trading_results) {
    dbData.paper_trading_results = {
      id: 'default',
      trading_days_tracked: 0,
      win_rate: 0.00,
      profit_factor: 1.00,
      sharpe_ratio: 0.00,
      max_drawdown: 0.00,
      accuracy: 0.00,
      net_pnl: 0.00,
      details: {}
    };
    modified = true;
  }
  if (!dbData.daily_model_performance) { dbData.daily_model_performance = []; modified = true; }
  if (!dbData.completed_trades) { dbData.completed_trades = []; modified = true; }
  if (!dbData.eod_report_state) { dbData.eod_report_state = []; modified = true; }

  if (modified) {
    fs.writeFileSync(DB_FILE, JSON.stringify(dbData, null, 2));
  }
}

// Helper to read local DB
let localDbCache = null;

function readLocalDb() {
  try {
    if (fs.existsSync(DB_FILE)) {
      localDbCache = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      return localDbCache;
    }
  } catch (err) {
    console.error('[DB ERROR] Failed to read/parse db.json from disk:', err.message);
  }

  if (localDbCache === null) {
    initLocalDb();
    try {
      localDbCache = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    } catch (err) {
      console.warn('[DB] Failed to read db.json, re-initializing cache');
      localDbCache = {
        portfolio_state: {
          strategy: 'SWING',
          balance: config.INITIAL_CAPITAL,
          equity_value: 0,
          current_daily_target: config.DAILY_PROFIT_TARGET_START,
          lifetime_pnl: 0,
          holding_stocks: [],
          user_instructions: {
            risk_mode: 'NORMAL',
            min_confidence_override: 0.75,
            avoid_intraday: false,
            avoid_longterm: false,
            max_positions: 3
          },
          model_weights: {
            agent1_weight: 0.35,
            agent2_weight: 0.25,
            agent3_weight: 0.20,
            agent4_weight: 0.20,
            emaWeight: 0.4,
            rsiWeight: 0.3,
            macdWeight: 0.3,
            rsiThreshold: 50,
            adaptationCount: 0
          }
        },
        daily_stats: [],
        trade_logs: [],
        prediction_logs: [],
        consensus_decisions: [],
        telegram_commands: [],
        risk_events: [],
        alerts: [],
        learning_feedback: [],
        paper_trading_results: {
          id: 'default',
          trading_days_tracked: 0,
          win_rate: 0.00,
          profit_factor: 1.00,
          sharpe_ratio: 0.00,
          max_drawdown: 0.00,
          accuracy: 0.00,
          net_pnl: 0.00,
          details: {}
        },
        daily_model_performance: [],
        completed_trades: [],
        eod_report_state: []
      };
      fs.writeFileSync(DB_FILE, JSON.stringify(localDbCache, null, 2));
    }
  }
  return localDbCache;
}

// Helper to write local DB
function writeLocalDb(data) {
  localDbCache = data;
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// Check database connectivity with retries & backoff
let consecutiveDbFailures = 0;
async function checkPostgresConnection() {
  if (config.USE_LOCAL_CACHE || !pool) {
    dbAvailable = false;
    return false;
  }
  let attempts = 3;
  let delay = 1000;
  for (let i = 0; i < attempts; i++) {
    try {
      const client = await pool.connect();
      client.release();
      dbAvailable = true;
      if (consecutiveDbFailures > 0) {
        console.log('[DB RECOVERY]: Neon PostgreSQL connection restored successfully.');
        consecutiveDbFailures = 0;
      }
      return true;
    } catch (err) {
      if (i < attempts - 1) {
        await new Promise(r => setTimeout(r, delay));
        delay *= 2;
      }
    }
  }
  dbAvailable = false;
  consecutiveDbFailures++;
  if (consecutiveDbFailures === 1) {
    console.warn('[DB CRITICAL]: Neon PostgreSQL connection lost. Running on Safe Local Mode.');
  }
  return false;
}

// Helper to run query with auto-fallback logging and retry
async function runQuery(text, params = [], retryCount = 1) {
  if (config.USE_LOCAL_CACHE) return null;
  
  if (!dbAvailable) {
    const connected = await checkPostgresConnection();
    if (!connected) return null;
  }
  
  const startTime = Date.now();
  try {
    const res = await pool.query(text, params);
    providerHealth.recordCall('Postgres', startTime, true, 'OK');
    return res.rows;
  } catch (err) {
    providerHealth.recordCall('Postgres', startTime, false, err.message);
    console.warn(`[DATABASE ERROR]: Query failed. Error: ${err.message}`);
    
    await checkPostgresConnection();
    if (retryCount > 0 && dbAvailable) {
      console.log(`[DATABASE RETRY]: Retrying query...`);
      return runQuery(text, params, retryCount - 1);
    }
    return null;
  }
}

// RESTORE STATE FROM DATABASE ON STARTUP (WITH SCHEMA & DATABASE VALIDATION)
async function restoreStateFromPostgres() {
  console.log('[DB VALIDATE]: Running database startup validation...');
  
  if (!config.DATABASE_URL) {
    console.warn('[DB VALIDATE]: DATABASE_URL is missing in environment variables. Falling back to Safe Local Mode.');
    dbAvailable = false;
    return;
  }

  try {
    await checkPostgresConnection();
    if (!dbAvailable) {
      console.warn('[DB VALIDATE]: Unable to connect to Neon PostgreSQL. Falling back to Safe Local Mode.');
      return;
    }

    if (dbAvailable) {
      try {
        await runQuery(`
          CREATE TABLE IF NOT EXISTS eod_report_state (
            date TEXT PRIMARY KEY,
            sent BOOLEAN NOT NULL DEFAULT false,
            sent_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
          )
        `);
        await runQuery(`
          CREATE TABLE IF NOT EXISTS agent20_reports (
            id SERIAL PRIMARY KEY,
            timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
            trade_id TEXT NOT NULL,
            symbol TEXT NOT NULL,
            entry_reason TEXT,
            exit_reason TEXT,
            supporting_agents JSONB,
            opposing_agents JSONB,
            market_conditions JSONB,
            outcome JSONB,
            lessons_learned TEXT
          )
        `);
        await runQuery(`
          CREATE TABLE IF NOT EXISTS agent21_trust_logs (
            id SERIAL PRIMARY KEY,
            timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
            weights_before JSONB NOT NULL,
            weights_after JSONB NOT NULL,
            adjustments JSONB NOT NULL
          )
        `);
        await runQuery(`
          CREATE TABLE IF NOT EXISTS agent22_research_logs (
            id SERIAL PRIMARY KEY,
            timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
            regime TEXT,
            sector TEXT,
            volatility TEXT,
            momentum TEXT,
            improvements JSONB,
            backtest_results JSONB,
            deployed BOOLEAN DEFAULT FALSE
          )
        `);
        await runQuery(`
          CREATE TABLE IF NOT EXISTS agent23_journals (
            id SERIAL PRIMARY KEY,
            timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
            trade_id TEXT NOT NULL,
            symbol TEXT NOT NULL,
            entry_thesis TEXT,
            exit_thesis TEXT,
            outcome TEXT,
            mistakes TEXT,
            success_factors TEXT,
            lessons TEXT
          )
        `);
        await runQuery(`
          CREATE TABLE IF NOT EXISTS agent24_audit_logs (
            id SERIAL PRIMARY KEY,
            timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
            symbol TEXT NOT NULL,
            tqs NUMERIC NOT NULL,
            rejection_reason TEXT,
            price_at_rejection NUMERIC,
            current_price NUMERIC,
            return_pct NUMERIC,
            ref_15m NUMERIC,
            ref_30m NUMERIC,
            ref_1h NUMERIC,
            ref_eod NUMERIC,
            completed BOOLEAN DEFAULT FALSE
          )
        `);
        await runQuery(`
          CREATE TABLE IF NOT EXISTS agent25_sizing_logs (
            id SERIAL PRIMARY KEY,
            timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
            symbol TEXT NOT NULL,
            sector TEXT,
            tqs_band TEXT,
            regime TEXT,
            expectancy NUMERIC,
            current_alloc NUMERIC,
            recommended_alloc NUMERIC
          )
        `);
        await runQuery(`
          CREATE TABLE IF NOT EXISTS agent26_market_memory (
            id SERIAL PRIMARY KEY,
            timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
            symbol TEXT NOT NULL,
            signal TEXT NOT NULL,
            feature_vector JSONB NOT NULL,
            outcome_pnl NUMERIC
          )
        `);
        await runQuery(`
          CREATE TABLE IF NOT EXISTS nightly_learning_reports (
            id SERIAL PRIMARY KEY,
            timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
            metrics JSONB NOT NULL,
            missed_opportunities JSONB NOT NULL,
            sizing_recommendations JSONB NOT NULL,
            learning_log TEXT NOT NULL
          )
        `);
        await runQuery(`
          CREATE TABLE IF NOT EXISTS threshold_history (
            id SERIAL PRIMARY KEY,
            timestamp TIMESTAMPTZ DEFAULT NOW(),
            threshold NUMERIC,
            regime TEXT,
            volatility TEXT,
            sector_strength TEXT,
            reasoning TEXT
          )
        `);
        await runQuery(`
          CREATE TABLE IF NOT EXISTS performance_metrics (
            id SERIAL PRIMARY KEY,
            date TEXT UNIQUE NOT NULL,
            expected_profit NUMERIC,
            profit_factor NUMERIC,
            sharpe_ratio NUMERIC,
            max_drawdown NUMERIC,
            winning_symbols JSONB,
            losing_symbols JSONB,
            capital_utilization NUMERIC,
            timestamp TIMESTAMPTZ DEFAULT NOW()
          )
        `);
        await runQuery(`
          CREATE TABLE IF NOT EXISTS throughput_history (
            id SERIAL PRIMARY KEY,
            timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
            scanned INTEGER NOT NULL,
            researched INTEGER NOT NULL,
            ranked INTEGER NOT NULL,
            scored INTEGER NOT NULL,
            candidates INTEGER NOT NULL,
            consensus INTEGER NOT NULL,
            executed INTEGER NOT NULL,
            passed_risk INTEGER DEFAULT 0,
            rejection_reasons JSONB NOT NULL
          )
        `);
        await runQuery(`
          CREATE TABLE IF NOT EXISTS shadow_trades (
            id TEXT PRIMARY KEY,
            timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
            symbol TEXT NOT NULL,
            entry_price NUMERIC NOT NULL,
            current_price NUMERIC,
            quantity NUMERIC,
            confidence NUMERIC,
            tqs NUMERIC,
            opportunity_score NUMERIC,
            status TEXT DEFAULT 'OPEN',
            pnl NUMERIC DEFAULT 0,
            return_pct NUMERIC DEFAULT 0,
            exit_price NUMERIC,
            exit_timestamp TIMESTAMP WITH TIME ZONE
          )
        `);
        await runQuery(`
          CREATE TABLE IF NOT EXISTS opportunity_tracker (
            id SERIAL PRIMARY KEY,
            symbol TEXT NOT NULL,
            current_price NUMERIC,
            confidence NUMERIC,
            tqs NUMERIC,
            consensus_score NUMERIC,
            buy_votes INTEGER,
            sell_votes INTEGER,
            hold_votes INTEGER,
            agent_count INTEGER,
            signal_type TEXT,
            rejection_reason TEXT,
            scan_timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
            opportunity_score NUMERIC,
            status TEXT DEFAULT 'WATCHLIST',
            ref_15m NUMERIC,
            ref_30m NUMERIC,
            ref_1h NUMERIC,
            ref_eod NUMERIC,
            completed BOOLEAN DEFAULT FALSE,
            participating_models JSONB,
            debate_summary TEXT
          )
        `);
        await runQuery(`
          CREATE TABLE IF NOT EXISTS completed_trades (
            trade_id TEXT PRIMARY KEY,
            symbol TEXT NOT NULL,
            entry_time TIMESTAMP WITH TIME ZONE NOT NULL,
            exit_time TIMESTAMP WITH TIME ZONE NOT NULL,
            entry_price NUMERIC NOT NULL,
            exit_price NUMERIC NOT NULL,
            quantity NUMERIC NOT NULL,
            gross_pnl NUMERIC NOT NULL,
            net_pnl NUMERIC NOT NULL,
            return_pct NUMERIC NOT NULL,
            holding_minutes NUMERIC NOT NULL,
            exit_reason TEXT,
            tqs NUMERIC,
            confidence NUMERIC,
            execution_mode TEXT
          )
        `);
        await runQuery(`ALTER TABLE agent24_audit_logs ADD COLUMN IF NOT EXISTS confidence NUMERIC;`).catch(() => {});
        await runQuery(`ALTER TABLE agent24_audit_logs ADD COLUMN IF NOT EXISTS vote_breakdown JSONB;`).catch(() => {});
        await runQuery(`ALTER TABLE agent24_audit_logs ADD COLUMN IF NOT EXISTS opportunity_score NUMERIC;`).catch(() => {});
        await runQuery(`ALTER TABLE agent24_audit_logs ADD COLUMN IF NOT EXISTS status TEXT;`).catch(() => {});
        await runQuery(`ALTER TABLE trade_logs ADD COLUMN IF NOT EXISTS execution_mode TEXT;`).catch(() => {});
        await runQuery(`ALTER TABLE throughput_history ADD COLUMN IF NOT EXISTS passed_risk INTEGER DEFAULT 0;`).catch(() => {});
        await runQuery(`ALTER TABLE completed_trades ADD COLUMN IF NOT EXISTS entry_efficiency NUMERIC;`).catch(() => {});
        await runQuery(`ALTER TABLE completed_trades ADD COLUMN IF NOT EXISTS exit_efficiency NUMERIC;`).catch(() => {});
        await runQuery(`ALTER TABLE completed_trades ADD COLUMN IF NOT EXISTS mfe NUMERIC;`).catch(() => {});
        await runQuery(`ALTER TABLE completed_trades ADD COLUMN IF NOT EXISTS mae NUMERIC;`).catch(() => {});
      } catch (tableErr) {
        console.error('[DB RESTORE] Error creating/altering Agent tables:', tableErr.message);
      }
    }

    const tableCheckRows = await runQuery(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'"
    );
    
    if (!tableCheckRows) {
      console.warn('[DB VALIDATE]: Unable to fetch tables from information_schema. Falling back to Safe Local Mode.');
      dbAvailable = false;
      return;
    }

    const existingTables = tableCheckRows.map(r => r.table_name.toLowerCase());
    const requiredTables = [
      'users', 'sessions', 'portfolio_state', 'daily_stats', 'trade_logs',
      'prediction_logs', 'model_weights', 'consensus_decisions', 'telegram_commands',
      'risk_events', 'alerts', 'learning_feedback', 'agent_memory',
      'paper_trading_results', 'daily_model_performance', 'agent20_reports',
      'agent21_trust_logs', 'agent22_research_logs', 'agent23_journals',
      'agent24_audit_logs', 'agent25_sizing_logs', 'agent26_market_memory',
      'nightly_learning_reports', 'threshold_history', 'performance_metrics',
      'throughput_history', 'completed_trades'
    ];

    const missingTables = requiredTables.filter(t => !existingTables.includes(t));
    if (missingTables.length > 0) {
      console.warn(`[DB VALIDATE]: Database schema is missing tables: [${missingTables.join(', ')}]. Falling back to Safe Local Mode.`);
      dbAvailable = false;
      return;
    }

    console.log('[DB VALIDATE]: Schema validation successful! All required tables are present.');
    console.log('[DB RESTORE]: Neon PostgreSQL online. Fetching system state in parallel...');

    // Fetch essential system data in parallel to reduce boot time to under 1 second
    const [
      pRows,
      wRows,
      mRows,
      rRows,
      memRows,
      trustRows,
      researchRows,
      journalRows,
      a20Rows,
      a24Rows,
      ctRows,
      eodRows,
      sRows
    ] = await Promise.all([
      runQuery('SELECT * FROM portfolio_state WHERE id = $1 LIMIT 1', ['default']).catch(() => null),
      runQuery('SELECT * FROM model_weights WHERE id = $1 LIMIT 1', ['default']).catch(() => null),
      runQuery('SELECT * FROM agent_memory WHERE id = $1 LIMIT 1', ['default']).catch(() => null),
      runQuery('SELECT * FROM paper_trading_results WHERE id = $1 LIMIT 1', ['default']).catch(() => null),
      runQuery('SELECT * FROM agent26_market_memory ORDER BY timestamp DESC LIMIT 50').catch(() => null),
      runQuery('SELECT * FROM agent21_trust_logs ORDER BY timestamp DESC LIMIT 10').catch(() => null),
      runQuery('SELECT * FROM agent22_research_logs ORDER BY timestamp DESC LIMIT 10').catch(() => null),
      runQuery('SELECT * FROM agent23_journals ORDER BY timestamp DESC LIMIT 10').catch(() => null),
      runQuery('SELECT * FROM agent20_reports ORDER BY timestamp DESC LIMIT 10').catch(() => null),
      runQuery('SELECT * FROM agent24_audit_logs ORDER BY timestamp DESC LIMIT 20').catch(() => null),
      runQuery('SELECT * FROM completed_trades ORDER BY exit_time DESC LIMIT 20').catch(() => null),
      runQuery('SELECT * FROM eod_report_state').catch(() => null),
      runQuery("SELECT * FROM sessions WHERE status = 'ACTIVE' LIMIT 1").catch(() => null)
    ]);

    const dbData = readLocalDb();

    // 1. Process portfolio_state
    if (pRows && pRows.length > 0) {
      dbData.portfolio_state = {
        ...dbData.portfolio_state,
        strategy: pRows[0].strategy,
        balance: Number(pRows[0].balance),
        equity_value: Number(pRows[0].equity_value),
        current_daily_target: Number(pRows[0].current_daily_target),
        lifetime_pnl: Number(pRows[0].lifetime_pnl),
        holding_stocks: pRows[0].holding_stocks || []
      };
      console.log('   - Restored portfolio state.');
    }

    // 2. Process model_weights
    if (wRows && wRows.length > 0) {
      dbData.portfolio_state.model_weights = {
        agent1_weight: Number(wRows[0].agent1_weight),
        agent2_weight: Number(wRows[0].agent2_weight),
        agent3_weight: Number(wRows[0].agent3_weight),
        agent4_weight: Number(wRows[0].agent4_weight),
        emaWeight: Number(wRows[0].ema_weight),
        rsiWeight: Number(wRows[0].rsi_weight),
        macdWeight: Number(wRows[0].macd_weight),
        rsiThreshold: Number(wRows[0].rsi_threshold),
        adaptationCount: Number(wRows[0].adaptation_count),
        neural_model_weights: wRows[0].neural_model_weights
      };
      console.log('   - Restored model weights.');
    }

    // 3. Process agent_memory
    if (mRows && mRows.length > 0) {
      dbData.session_memory = {
        ...dbData.session_memory,
        paper_trading_stats: mRows[0].paper_trading_stats || {},
        winning_patterns: mRows[0].winning_patterns || [],
        losing_patterns: mRows[0].losing_patterns || [],
        user_instructions: mRows[0].user_instructions || {}
      };
      dbData.portfolio_state.user_instructions = mRows[0].user_instructions || {};
      console.log('   - Restored agent memory & preferences.');
    }

    // 4. Process paper_trading_results
    if (rRows && rRows.length > 0) {
      dbData.paper_trading_results = {
        id: 'default',
        trading_days_tracked: Number(rRows[0].trading_days_tracked),
        win_rate: Number(rRows[0].win_rate),
        profit_factor: Number(rRows[0].profit_factor),
        sharpe_ratio: Number(rRows[0].sharpe_ratio),
        max_drawdown: Number(rRows[0].max_drawdown),
        accuracy: Number(rRows[0].accuracy),
        net_pnl: Number(rRows[0].net_pnl),
        details: rRows[0].details || {}
      };
      console.log('   - Restored paper trading results.');
    }

    // 5. Process agent26_market_memory
    if (memRows && memRows.length > 0) {
      dbData.agent26_market_memory = memRows.map(r => ({
        symbol: r.symbol,
        signal: r.signal,
        feature_vector: typeof r.feature_vector === 'string' ? JSON.parse(r.feature_vector) : r.feature_vector,
        outcome_pnl: r.outcome_pnl !== null ? Number(r.outcome_pnl) : null,
        timestamp: r.timestamp,
        synced: true
      }));
      console.log(`   - Restored ${memRows.length} market memory records.`);
    }

    // 6. Process agent21_trust_logs
    if (trustRows && trustRows.length > 0) {
      dbData.agent21_trust_logs = trustRows.map(r => ({
        weights_before: typeof r.weights_before === 'string' ? JSON.parse(r.weights_before) : r.weights_before,
        weights_after: typeof r.weights_after === 'string' ? JSON.parse(r.weights_after) : r.weights_after,
        adjustments: typeof r.adjustments === 'string' ? JSON.parse(r.adjustments) : r.adjustments,
        timestamp: r.timestamp,
        synced: true
      }));
      console.log(`   - Restored ${trustRows.length} trust engine logs.`);
    }

    // 7. Process agent22_research_logs
    if (researchRows && researchRows.length > 0) {
      dbData.agent22_research_logs = researchRows.map(r => ({
        regime: r.regime,
        sector: r.sector,
        volatility: r.volatility,
        momentum: r.momentum,
        improvements: typeof r.improvements === 'string' ? JSON.parse(r.improvements) : r.improvements,
        backtest_results: typeof r.backtest_results === 'string' ? JSON.parse(r.backtest_results) : r.backtest_results,
        deployed: r.deployed,
        timestamp: r.timestamp,
        synced: true
      }));
      console.log(`   - Restored ${researchRows.length} research logs.`);
    }

    // 8. Process agent23_journals
    if (journalRows && journalRows.length > 0) {
      dbData.agent23_journals = journalRows.map(r => ({
        trade_id: r.trade_id,
        symbol: r.symbol,
        entry_thesis: r.entry_thesis,
        exit_thesis: r.exit_thesis,
        outcome: r.outcome,
        mistakes: r.mistakes,
        success_factors: r.success_factors,
        lessons: r.lessons,
        timestamp: r.timestamp,
        synced: true
      }));
      console.log(`   - Restored ${journalRows.length} trading journals.`);
    }

    // 9. Process agent20_reports
    if (a20Rows && a20Rows.length > 0) {
      dbData.agent20_reports = a20Rows.map(r => ({
        trade_id: r.trade_id,
        symbol: r.symbol,
        entry_reason: r.entry_reason,
        exit_reason: r.exit_reason,
        supporting_agents: typeof r.supporting_agents === 'string' ? JSON.parse(r.supporting_agents) : r.supporting_agents,
        opposing_agents: typeof r.opposing_agents === 'string' ? JSON.parse(r.opposing_agents) : r.opposing_agents,
        market_conditions: typeof r.market_conditions === 'string' ? JSON.parse(r.market_conditions) : r.market_conditions,
        outcome: typeof r.outcome === 'string' ? JSON.parse(r.outcome) : r.outcome,
        lessons_learned: r.lessons_learned,
        timestamp: r.timestamp,
        synced: true
      }));
      console.log(`   - Restored ${a20Rows.length} performance analyst reports.`);
    }

    // 10. Process agent24_audit_logs
    if (a24Rows && a24Rows.length > 0) {
      dbData.agent24_audit_logs = a24Rows.map(r => ({
        symbol: r.symbol,
        tqs: Number(r.tqs),
        rejection_reason: r.rejection_reason,
        price_at_rejection: r.price_at_rejection !== null ? Number(r.price_at_rejection) : null,
        current_price: r.current_price !== null ? Number(r.current_price) : null,
        return_pct: r.return_pct !== null ? Number(r.return_pct) : null,
        ref_15m: r.ref_15m !== null ? Number(r.ref_15m) : null,
        ref_30m: r.ref_30m !== null ? Number(r.ref_30m) : null,
        ref_1h: r.ref_1h !== null ? Number(r.ref_1h) : null,
        ref_eod: r.ref_eod !== null ? Number(r.ref_eod) : null,
        completed: r.completed,
        timestamp: r.timestamp,
        synced: true
      }));
      console.log(`   - Restored ${a24Rows.length} opportunity audit logs.`);
    }

    // 10b. Process completed_trades
    if (ctRows && ctRows.length > 0) {
      dbData.completed_trades = ctRows.map(r => ({
        trade_id: r.trade_id,
        symbol: r.symbol,
        entry_time: r.entry_time,
        exit_time: r.exit_time,
        entry_price: Number(r.entry_price),
        exit_price: Number(r.exit_price),
        quantity: Number(r.quantity),
        gross_pnl: Number(r.gross_pnl),
        net_pnl: Number(r.net_pnl),
        return_pct: Number(r.return_pct),
        holding_minutes: Number(r.holding_minutes),
        exit_reason: r.exit_reason,
        tqs: r.tqs ? Number(r.tqs) : null,
        confidence: r.confidence ? Number(r.confidence) : null,
        execution_mode: r.execution_mode
      }));
      console.log(`   - Restored ${ctRows.length} completed trades.`);
    }

    // 10c. Process EOD report state
    if (eodRows && eodRows.length > 0) {
      dbData.eod_report_state = eodRows.map(r => ({
        date: r.date,
        sent: r.sent,
        sent_at: r.sent_at
      }));
      console.log(`   - Restored ${eodRows.length} EOD report states.`);
    }

    // 11. Process active session
    if (sRows && sRows.length > 0) {
      console.log(`   - Restored active session: ${sRows[0].id}`);
    } else {
      const sessionId = `SESS-${Date.now()}`;
      await runQuery('INSERT INTO sessions (id, status, start_time) VALUES ($1, $2, NOW())', [sessionId, 'ACTIVE']).catch(() => {});
      console.log(`   - Started new active session: ${sessionId}`);
    }

    writeLocalDb(dbData);
    console.log('[DB RESTORE]: System state parallel recovery completed.');
  } catch (err) {
    console.error('[DB RESTORE]: Error during parallel state restoration:', err.message);
    dbAvailable = false;
  }
}

// LOCAL TO POSTGRES SYNCHRONIZER WORKER
async function syncLocalToPostgres() {
  if (syncInProgress) return;
  
  const prevStatus = dbAvailable;
  await checkPostgresConnection();
  
  if (!dbAvailable) {
    if (prevStatus) {
      console.log('[DB SYNC]: Neon PostgreSQL lost connection. Safe Local Mode activated.');
    }
    return;
  }

  if (!prevStatus && dbAvailable) {
    console.log('[DB SYNC]: Neon PostgreSQL connection restored. Running synchronization worker...');
  }

  syncInProgress = true;
  try {
    const data = readLocalDb();

    // 1. Sync Portfolio State (Upsert)
    await runQuery(`
      INSERT INTO portfolio_state (id, strategy, balance, equity_value, current_daily_target, lifetime_pnl, holding_stocks, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      ON CONFLICT (id) DO UPDATE SET
        strategy = EXCLUDED.strategy,
        balance = EXCLUDED.balance,
        equity_value = EXCLUDED.equity_value,
        current_daily_target = EXCLUDED.current_daily_target,
        lifetime_pnl = EXCLUDED.lifetime_pnl,
        holding_stocks = EXCLUDED.holding_stocks,
        updated_at = NOW()
    `, [
      'default',
      data.portfolio_state.strategy,
      Number(data.portfolio_state.balance),
      Number(data.portfolio_state.equity_value),
      Number(data.portfolio_state.current_daily_target),
      Number(data.portfolio_state.lifetime_pnl),
      JSON.stringify(data.portfolio_state.holding_stocks)
    ]);

    // 2. Sync Model Weights (Upsert)
    if (data.portfolio_state.model_weights) {
      const w = data.portfolio_state.model_weights;
      await runQuery(`
        INSERT INTO model_weights (id, agent1_weight, agent2_weight, agent3_weight, agent4_weight, ema_weight, rsi_weight, macd_weight, rsi_threshold, adaptation_count, neural_model_weights, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
        ON CONFLICT (id) DO UPDATE SET
          agent1_weight = EXCLUDED.agent1_weight,
          agent2_weight = EXCLUDED.agent2_weight,
          agent3_weight = EXCLUDED.agent3_weight,
          agent4_weight = EXCLUDED.agent4_weight,
          ema_weight = EXCLUDED.ema_weight,
          rsi_weight = EXCLUDED.rsi_weight,
          macd_weight = EXCLUDED.macd_weight,
          rsi_threshold = EXCLUDED.rsi_threshold,
          adaptation_count = EXCLUDED.adaptation_count,
          neural_model_weights = EXCLUDED.neural_model_weights,
          updated_at = NOW()
      `, [
        'default',
        Number(w.agent1_weight),
        Number(w.agent2_weight),
        Number(w.agent3_weight),
        Number(w.agent4_weight),
        Number(w.emaWeight),
        Number(w.rsiWeight),
        Number(w.macdWeight),
        Number(w.rsiThreshold),
        Number(w.adaptationCount),
        JSON.stringify(w.neural_model_weights || {})
      ]);
    }

    // 3. Sync Agent Memory (Upsert)
    if (data.session_memory) {
      const sm = data.session_memory;
      await runQuery(`
        INSERT INTO agent_memory (id, paper_trading_stats, winning_patterns, losing_patterns, user_instructions, updated_at)
        VALUES ($1, $2, $3, $4, $5, NOW())
        ON CONFLICT (id) DO UPDATE SET
          paper_trading_stats = EXCLUDED.paper_trading_stats,
          winning_patterns = EXCLUDED.winning_patterns,
          losing_patterns = EXCLUDED.losing_patterns,
          user_instructions = EXCLUDED.user_instructions,
          updated_at = NOW()
      `, [
        'default',
        JSON.stringify(sm.paper_trading_stats || {}),
        JSON.stringify(sm.winning_patterns || []),
        JSON.stringify(sm.losing_patterns || []),
        JSON.stringify(sm.user_instructions || data.portfolio_state.user_instructions || {})
      ]);
    }

    // 4. Sync Paper Trading Results (Upsert)
    if (data.paper_trading_results) {
      const ptr = data.paper_trading_results;
      await runQuery(`
        INSERT INTO paper_trading_results (id, trading_days_tracked, win_rate, profit_factor, sharpe_ratio, max_drawdown, accuracy, net_pnl, details, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
        ON CONFLICT (id) DO UPDATE SET
          trading_days_tracked = EXCLUDED.trading_days_tracked,
          win_rate = EXCLUDED.win_rate,
          profit_factor = EXCLUDED.profit_factor,
          sharpe_ratio = EXCLUDED.sharpe_ratio,
          max_drawdown = EXCLUDED.max_drawdown,
          accuracy = EXCLUDED.accuracy,
          net_pnl = EXCLUDED.net_pnl,
          details = EXCLUDED.details,
          updated_at = NOW()
      `, [
        'default',
        Number(ptr.trading_days_tracked),
        Number(ptr.win_rate),
        Number(ptr.profit_factor),
        Number(ptr.sharpe_ratio),
        Number(ptr.max_drawdown),
        Number(ptr.accuracy),
        Number(ptr.net_pnl),
        JSON.stringify(ptr.details || {})
      ]);
    }

    // 5. Sync Daily Stats
    if (data.daily_stats && data.daily_stats.length > 0) {
      for (const stats of data.daily_stats) {
        await runQuery(`
          INSERT INTO daily_stats (date, start_capital, end_capital, net_pnl, daily_target, target_met, strategy_switched, status, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
          ON CONFLICT (date) DO UPDATE SET
            start_capital = EXCLUDED.start_capital,
            end_capital = EXCLUDED.end_capital,
            net_pnl = EXCLUDED.net_pnl,
            daily_target = EXCLUDED.daily_target,
            target_met = EXCLUDED.target_met,
            strategy_switched = EXCLUDED.strategy_switched,
            status = EXCLUDED.status,
            updated_at = NOW()
        `, [
          stats.date,
          Number(stats.start_capital),
          Number(stats.end_capital),
          Number(stats.net_pnl),
          Number(stats.daily_target),
          stats.target_met,
          stats.strategy_switched,
          stats.status
        ]);
      }
    }

    // Helper: Sync custom logger arrays (append-only or conflict update logs)
    const syncArray = async (arrayKey, tableName, insertQueryGen) => {
      if (!data[arrayKey] || data[arrayKey].length === 0) return;
      const unsynced = data[arrayKey].filter(x => x.synced === false);
      for (const item of unsynced) {
        const payloadParams = insertQueryGen(item);
        const res = await runQuery(payloadParams.query, payloadParams.args);
        if (res !== null) {
          item.synced = true;
        }
      }
    };

    // Sync trade logs
    await syncArray('trade_logs', 'trade_logs', (item) => ({
      query: `INSERT INTO trade_logs (id, timestamp, symbol, action, strategy, quantity, price, total_value, reason) 
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (id) DO NOTHING`,
      args: [item.id, item.timestamp, item.symbol, item.action, item.strategy, Number(item.quantity), Number(item.price), Number(item.total_value), item.reason]
    }));

    // Sync prediction logs
    await syncArray('prediction_logs', 'prediction_logs', (item) => ({
      query: `INSERT INTO prediction_logs (id, timestamp, symbol, signal, model_source, consensus, custom_signal, kraken_signal, debate_summary, entry_price, exit_price, pnl)
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
              ON CONFLICT (id) DO UPDATE SET exit_price = EXCLUDED.exit_price, pnl = EXCLUDED.pnl`,
      args: [item.id, item.timestamp, item.symbol, item.signal, Number(item.model_source), item.consensus, item.custom_signal, item.kraken_signal, item.debate_summary, 
             item.entry_price ? Number(item.entry_price) : null, item.exit_price ? Number(item.exit_price) : null, item.pnl ? Number(item.pnl) : null]
    }));

    // Sync consensus decisions
    await syncArray('consensus_decisions', 'consensus_decisions', (item) => ({
      query: `INSERT INTO consensus_decisions (id, timestamp, symbol, decision, confidence, participating_models, debate_summary, final_outcome, result_after_closes, ref_15m, ref_30m, ref_1h, ref_eod)
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
              ON CONFLICT (id) DO UPDATE SET 
                final_outcome = EXCLUDED.final_outcome, 
                result_after_closes = EXCLUDED.result_after_closes,
                ref_15m = EXCLUDED.ref_15m,
                ref_30m = EXCLUDED.ref_30m,
                ref_1h = EXCLUDED.ref_1h,
                ref_eod = EXCLUDED.ref_eod`,
      args: [
        item.id, item.timestamp, item.symbol, item.decision, Number(item.confidence), JSON.stringify(item.participating_models), item.debate_summary,
        item.final_outcome, item.result_after_closes ? Number(item.result_after_closes) : null,
        item.ref_15m ? Number(item.ref_15m) : null,
        item.ref_30m ? Number(item.ref_30m) : null,
        item.ref_1h ? Number(item.ref_1h) : null,
        item.ref_eod ? Number(item.ref_eod) : null
      ]
    }));

    // Sync telegram commands
    await syncArray('telegram_commands', 'telegram_commands', (item) => ({
      query: `INSERT INTO telegram_commands (id, timestamp, command, parameters, applied) 
              VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING`,
      args: [item.id, item.timestamp, item.command, JSON.stringify(item.parameters || {}), item.applied]
    }));

    // Sync risk events
    await syncArray('risk_events', 'risk_events', (item) => ({
      query: `INSERT INTO risk_events (id, timestamp, event_type, description, portfolio_value, details) 
              VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING`,
      args: [item.id, item.timestamp, item.event_type, item.description, Number(item.portfolio_value), JSON.stringify(item.details || {})]
    }));

    // Sync alerts
    await syncArray('alerts', 'alerts', (item) => ({
      query: `INSERT INTO alerts (id, timestamp, type, message, status) 
              VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING`,
      args: [item.id, item.timestamp, item.type, item.message, item.status]
    }));

    // Sync learning feedback
    await syncArray('learning_feedback', 'learning_feedback', (item) => ({
      query: `INSERT INTO learning_feedback (id, timestamp, prediction_id, pnl, learning_rate, weights_before, weights_after) 
              VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (id) DO NOTHING`,
      args: [item.id, item.timestamp, item.prediction_id, Number(item.pnl), Number(item.learning_rate), JSON.stringify(item.weights_before), JSON.stringify(item.weights_after)]
    }));

    // Sync daily model performance
    await syncArray('daily_model_performance', 'daily_model_performance', (item) => ({
      query: `INSERT INTO daily_model_performance (date, agent1_accuracy, agent2_accuracy, agent3_accuracy, agent4_accuracy, consensus_accuracy, total_predictions, details, updated_at) 
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
              ON CONFLICT (date) DO UPDATE SET
                agent1_accuracy = EXCLUDED.agent1_accuracy,
                agent2_accuracy = EXCLUDED.agent2_accuracy,
                agent3_accuracy = EXCLUDED.agent3_accuracy,
                agent4_accuracy = EXCLUDED.agent4_accuracy,
                consensus_accuracy = EXCLUDED.consensus_accuracy,
                total_predictions = EXCLUDED.total_predictions,
                details = EXCLUDED.details,
                updated_at = NOW()`,
      args: [item.date, Number(item.agent1_accuracy), Number(item.agent2_accuracy), Number(item.agent3_accuracy), Number(item.agent4_accuracy), 
             Number(item.consensus_accuracy), Number(item.total_predictions), JSON.stringify(item.details || {})]
    }));

    // Sync Agent 20 Reports
    await syncArray('agent20_reports', 'agent20_reports', (item) => ({
      query: `INSERT INTO agent20_reports (trade_id, symbol, entry_reason, exit_reason, supporting_agents, opposing_agents, market_conditions, outcome, lessons_learned)
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      args: [item.trade_id, item.symbol, item.entry_reason, item.exit_reason, JSON.stringify(item.supporting_agents), JSON.stringify(item.opposing_agents), JSON.stringify(item.market_conditions), JSON.stringify(item.outcome), item.lessons_learned]
    }));

    // Sync Agent 21 Trust Logs
    await syncArray('agent21_trust_logs', 'agent21_trust_logs', (item) => ({
      query: `INSERT INTO agent21_trust_logs (weights_before, weights_after, adjustments)
              VALUES ($1, $2, $3)`,
      args: [JSON.stringify(item.weights_before), JSON.stringify(item.weights_after), JSON.stringify(item.adjustments)]
    }));

    // Sync Agent 22 Research Logs
    await syncArray('agent22_research_logs', 'agent22_research_logs', (item) => ({
      query: `INSERT INTO agent22_research_logs (regime, sector, volatility, momentum, improvements, backtest_results, deployed)
              VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      args: [item.regime, item.sector, item.volatility, item.momentum, JSON.stringify(item.improvements), JSON.stringify(item.backtest_results), item.deployed]
    }));

    // Sync Agent 23 Journals
    await syncArray('agent23_journals', 'agent23_journals', (item) => ({
      query: `INSERT INTO agent23_journals (trade_id, symbol, entry_thesis, exit_thesis, outcome, mistakes, success_factors, lessons)
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      args: [item.trade_id, item.symbol, item.entry_thesis, item.exit_thesis, item.outcome, item.mistakes, item.success_factors, item.lessons]
    }));

    // Sync Agent 24 Audit Logs
    await syncArray('agent24_audit_logs', 'agent24_audit_logs', (item) => ({
      query: `INSERT INTO agent24_audit_logs (symbol, tqs, rejection_reason, price_at_rejection, current_price, return_pct, ref_15m, ref_30m, ref_1h, ref_eod, completed)
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      args: [item.symbol, Number(item.tqs), item.rejection_reason, Number(item.price_at_rejection), Number(item.current_price), Number(item.return_pct), 
             item.ref_15m ? Number(item.ref_15m) : null, item.ref_30m ? Number(item.ref_30m) : null, item.ref_1h ? Number(item.ref_1h) : null, item.ref_eod ? Number(item.ref_eod) : null, item.completed]
    }));

    // Sync Agent 25 Sizing Logs
    await syncArray('agent25_sizing_logs', 'agent25_sizing_logs', (item) => ({
      query: `INSERT INTO agent25_sizing_logs (symbol, sector, tqs_band, regime, expectancy, current_alloc, recommended_alloc)
              VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      args: [item.symbol, item.sector, item.tqs_band, item.regime, Number(item.expectancy), Number(item.current_alloc), Number(item.recommended_alloc)]
    }));

    // Sync Agent 26 Market Memory
    await syncArray('agent26_market_memory', 'agent26_market_memory', (item) => ({
      query: `INSERT INTO agent26_market_memory (symbol, signal, feature_vector, outcome_pnl)
              VALUES ($1, $2, $3, $4)`,
      args: [item.symbol, item.signal, JSON.stringify(item.feature_vector), item.outcome_pnl ? Number(item.outcome_pnl) : null]
    }));

    // Sync Nightly Learning Reports
    await syncArray('nightly_learning_reports', 'nightly_learning_reports', (item) => ({
      query: `INSERT INTO nightly_learning_reports (metrics, missed_opportunities, sizing_recommendations, learning_log)
              VALUES ($1, $2, $3, $4)`,
      args: [JSON.stringify(item.metrics), JSON.stringify(item.missed_opportunities), JSON.stringify(item.sizing_recommendations), item.learning_log]
    }));

    // Sync Completed Trades
    await syncArray('completed_trades', 'completed_trades', (item) => ({
      query: `INSERT INTO completed_trades (trade_id, symbol, entry_time, exit_time, entry_price, exit_price, quantity, gross_pnl, net_pnl, return_pct, holding_minutes, exit_reason, tqs, confidence, execution_mode)
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
              ON CONFLICT (trade_id) DO NOTHING`,
      args: [item.trade_id, item.symbol, item.entry_time, item.exit_time, Number(item.entry_price), Number(item.exit_price), Number(item.quantity),
             Number(item.gross_pnl), Number(item.net_pnl), Number(item.return_pct), Number(item.holding_minutes), item.exit_reason,
             item.tqs ? Number(item.tqs) : null, item.confidence ? Number(item.confidence) : null, item.execution_mode]
    }));

    writeLocalDb(data);
  } catch (err) {
    console.error('[DB SYNC]: Sync loop failed:', err.message);
  } finally {
    syncInProgress = false;
  }
}

// Start Background Syncer Polling Loop
function startSyncWorker() {
  if (syncInterval) clearInterval(syncInterval);
  // Initial sync attempt
  syncLocalToPostgres();
  // Poll connection and sync every 20 seconds
  syncInterval = setInterval(syncLocalToPostgres, 20000);
}

// Immediate load from database and kick off syncer worker on startup
let resolveInit;
const initPromise = new Promise((resolve) => {
  resolveInit = resolve;
});

const isMainApp = require.main && (
  require.main.filename.endsWith('server.js') || 
  require.main.filename.endsWith('tradingBot.js')
);
const shouldSync = isMainApp || process.env.START_SYNC === 'true';

if (shouldSync) {
  console.log('[DB] Main application detected or START_SYNC enabled. Restoring state from Postgres and starting sync worker...');
  restoreStateFromPostgres().then(() => {
    startSyncWorker();
    resolveInit();
  });
} else {
  // Utility script or subprocess: skip startup restore & background sync interval.
  // We initialize the local database schema and check connection silently so direct queries work.
  initLocalDb();
  checkPostgresConnection().then(() => {
    resolveInit();
  });
}

const db = {
  readLocalDb() {
    return readLocalDb();
  },
  writeLocalDb(data) {
    writeLocalDb(data);
  },
  // Execute database query directly
  async runQueryDirect(text, params = []) {
    return await runQuery(text, params);
  },

  // Check connection state
  isNeonOnline() {
    return dbAvailable;
  },

  // Check connection state historical wrapper
  isSupabaseOnline() {
    return dbAvailable;
  },

  // Get current portfolio state
  async getPortfolioState(forceFresh = false) {
    if (!forceFresh) {
      const data = readLocalDb();
      if (data.portfolio_state && data.portfolio_state.model_weights) {
        return data.portfolio_state;
      }
    }
    if (dbAvailable) {
      try {
        const pRows = await runQuery('SELECT * FROM portfolio_state WHERE id = $1 LIMIT 1', ['default']);
        if (pRows && pRows.length > 0) {
          const state = { 
            strategy: pRows[0].strategy,
            balance: Number(pRows[0].balance),
            equity_value: Number(pRows[0].equity_value),
            current_daily_target: Number(pRows[0].current_daily_target),
            lifetime_pnl: Number(pRows[0].lifetime_pnl),
            holding_stocks: pRows[0].holding_stocks || []
          };
          
          // Merge weights
          const wRows = await runQuery('SELECT * FROM model_weights WHERE id = $1 LIMIT 1', ['default']);
          if (wRows && wRows.length > 0) {
            const w = wRows[0];
            state.model_weights = {
              agent1_weight: Number(w.agent1_weight),
              agent2_weight: Number(w.agent2_weight),
              agent3_weight: Number(w.agent3_weight),
              agent4_weight: Number(w.agent4_weight),
              emaWeight: Number(w.ema_weight),
              rsiWeight: Number(w.rsi_weight),
              macdWeight: Number(w.macd_weight),
              rsiThreshold: Number(w.rsi_threshold),
              adaptationCount: Number(w.adaptation_count),
              neural_model_weights: w.neural_model_weights
            };
          }
          
          // Merge user instructions
          const mRows = await runQuery('SELECT * FROM agent_memory WHERE id = $1 LIMIT 1', ['default']);
          if (mRows && mRows.length > 0) {
            state.user_instructions = mRows[0].user_instructions || {};
          }
          return state;
        }
      } catch (err) {
        console.error('[DB]: Error fetching portfolio state:', err.message);
      }
    }
    const data = readLocalDb();
    return data.portfolio_state;
  },

  // Update portfolio state
  async updatePortfolioState(updates) {
    const data = readLocalDb();
    data.portfolio_state = { ...data.portfolio_state, ...updates };
    writeLocalDb(data);

    if (dbAvailable) {
      try {
        await runQuery(`
          INSERT INTO portfolio_state (id, strategy, balance, equity_value, current_daily_target, lifetime_pnl, holding_stocks, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
          ON CONFLICT (id) DO UPDATE SET
            strategy = EXCLUDED.strategy,
            balance = EXCLUDED.balance,
            equity_value = EXCLUDED.equity_value,
            current_daily_target = EXCLUDED.current_daily_target,
            lifetime_pnl = EXCLUDED.lifetime_pnl,
            holding_stocks = EXCLUDED.holding_stocks,
            updated_at = NOW()
        `, [
          'default',
          data.portfolio_state.strategy,
          Number(data.portfolio_state.balance),
          Number(data.portfolio_state.equity_value),
          Number(data.portfolio_state.current_daily_target),
          Number(data.portfolio_state.lifetime_pnl),
          JSON.stringify(data.portfolio_state.holding_stocks)
        ]);

        if (updates.model_weights) {
          const w = data.portfolio_state.model_weights;
          await runQuery(`
            INSERT INTO model_weights (id, agent1_weight, agent2_weight, agent3_weight, agent4_weight, ema_weight, rsi_weight, macd_weight, rsi_threshold, adaptation_count, neural_model_weights, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
            ON CONFLICT (id) DO UPDATE SET
              agent1_weight = EXCLUDED.agent1_weight,
              agent2_weight = EXCLUDED.agent2_weight,
              agent3_weight = EXCLUDED.agent3_weight,
              agent4_weight = EXCLUDED.agent4_weight,
              ema_weight = EXCLUDED.ema_weight,
              rsi_weight = EXCLUDED.rsi_weight,
              macd_weight = EXCLUDED.macd_weight,
              rsi_threshold = EXCLUDED.rsi_threshold,
              adaptation_count = EXCLUDED.adaptation_count,
              neural_model_weights = EXCLUDED.neural_model_weights,
              updated_at = NOW()
          `, [
            'default',
            Number(w.agent1_weight),
            Number(w.agent2_weight),
            Number(w.agent3_weight),
            Number(w.agent4_weight),
            Number(w.emaWeight),
            Number(w.rsiWeight),
            Number(w.macdWeight),
            Number(w.rsiThreshold),
            Number(w.adaptationCount),
            JSON.stringify(w.neural_model_weights || {})
          ]);
        }

        if (updates.user_instructions) {
          const sm = data.session_memory;
          await runQuery(`
            INSERT INTO agent_memory (id, paper_trading_stats, winning_patterns, losing_patterns, user_instructions, updated_at)
            VALUES ($1, $2, $3, $4, $5, NOW())
            ON CONFLICT (id) DO UPDATE SET
              paper_trading_stats = EXCLUDED.paper_trading_stats,
              winning_patterns = EXCLUDED.winning_patterns,
              losing_patterns = EXCLUDED.losing_patterns,
              user_instructions = EXCLUDED.user_instructions,
              updated_at = NOW()
          `, [
            'default',
            JSON.stringify(sm.paper_trading_stats || {}),
            JSON.stringify(sm.winning_patterns || []),
            JSON.stringify(sm.losing_patterns || []),
            JSON.stringify(data.portfolio_state.user_instructions || {})
          ]);
        }
      } catch (err) {
        console.error('[DB]: Error updating portfolio state:', err.message);
      }
    }
    return data.portfolio_state;
  },

  // Get daily stats
  async getDailyStats(dateStr) {
    if (dbAvailable) {
      const rows = await runQuery('SELECT * FROM daily_stats WHERE date = $1 LIMIT 1', [dateStr]);
      if (rows && rows.length > 0) {
        return {
          date: rows[0].date,
          start_capital: Number(rows[0].start_capital),
          end_capital: Number(rows[0].end_capital),
          net_pnl: Number(rows[0].net_pnl),
          daily_target: Number(rows[0].daily_target),
          target_met: rows[0].target_met,
          strategy_switched: rows[0].strategy_switched,
          status: rows[0].status
        };
      }
    }
    const data = readLocalDb();
    return data.daily_stats.find(s => s.date === dateStr) || null;
  },

  // Get recent daily stats
  async getRecentDailyStats(limit = 30) {
    if (dbAvailable) {
      const rows = await runQuery('SELECT * FROM daily_stats ORDER BY date DESC LIMIT $1', [limit]);
      return (rows || []).map(r => ({
        date: r.date,
        start_capital: Number(r.start_capital),
        end_capital: Number(r.end_capital),
        net_pnl: Number(r.net_pnl),
        daily_target: Number(r.daily_target),
        target_met: r.target_met,
        strategy_switched: r.strategy_switched,
        status: r.status
      }));
    }
    const data = readLocalDb();
    const sorted = [...(data.daily_stats || [])].sort((a, b) => b.date.localeCompare(a.date));
    return sorted.slice(0, limit);
  },

  // Save/Update daily stats
  async saveDailyStats(stats) {
    const data = readLocalDb();
    const idx = data.daily_stats.findIndex(s => s.date === stats.date);
    if (idx !== -1) {
      data.daily_stats[idx] = { ...data.daily_stats[idx], ...stats };
    } else {
      data.daily_stats.push(stats);
    }
    writeLocalDb(data);

    if (dbAvailable) {
      await runQuery(`
        INSERT INTO daily_stats (date, start_capital, end_capital, net_pnl, daily_target, target_met, strategy_switched, status, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
        ON CONFLICT (date) DO UPDATE SET
          start_capital = EXCLUDED.start_capital,
          end_capital = EXCLUDED.end_capital,
          net_pnl = EXCLUDED.net_pnl,
          daily_target = EXCLUDED.daily_target,
          target_met = EXCLUDED.target_met,
          strategy_switched = EXCLUDED.strategy_switched,
          status = EXCLUDED.status,
          updated_at = NOW()
      `, [
        stats.date,
        Number(stats.start_capital),
        Number(stats.end_capital),
        Number(stats.net_pnl),
        Number(stats.daily_target),
        stats.target_met,
        stats.strategy_switched,
        stats.status
      ]);
    }
    return stats;
  },

  // Get EOD report state
  async getEodReportState(dateStr) {
    if (dbAvailable) {
      try {
        const rows = await runQuery('SELECT * FROM eod_report_state WHERE date = $1 LIMIT 1', [dateStr]);
        if (rows && rows.length > 0) {
          return {
            date: rows[0].date,
            sent: rows[0].sent,
            sent_at: rows[0].sent_at
          };
        }
      } catch (err) {
        console.error('[DB]: Error getting EOD report state:', err.message);
      }
    }
    const data = readLocalDb();
    if (!data.eod_report_state) {
      data.eod_report_state = [];
    }
    return data.eod_report_state.find(s => s.date === dateStr) || null;
  },

  // Save EOD report state
  async saveEodReportState(state) {
    const data = readLocalDb();
    if (!data.eod_report_state) {
      data.eod_report_state = [];
    }
    const idx = data.eod_report_state.findIndex(s => s.date === state.date);
    if (idx !== -1) {
      data.eod_report_state[idx] = { ...data.eod_report_state[idx], ...state };
    } else {
      data.eod_report_state.push(state);
    }
    writeLocalDb(data);

    if (dbAvailable) {
      try {
        await runQuery(`
          INSERT INTO eod_report_state (date, sent, sent_at)
          VALUES ($1, $2, $3)
          ON CONFLICT (date) DO UPDATE
          SET sent = EXCLUDED.sent, sent_at = EXCLUDED.sent_at
        `, [state.date, state.sent, state.sent_at || new Date().toISOString()]);
      } catch (err) {
        console.error('[DB]: Error saving EOD report state:', err.message);
      }
    }
    return state;
  },

  // Log a trade
  async logTrade(trade) {
    let execution_mode = 'INSTITUTIONAL';
    if (trade.execution_mode) {
      execution_mode = trade.execution_mode;
    } else if (trade.reason) {
      if (trade.reason.includes('ADAPTIVE Mode') || trade.reason.includes('[ADAPTIVE]')) {
        execution_mode = 'ADAPTIVE';
      }
    }

    const tradeLog = {
      id: trade.id || `T-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      timestamp: trade.timestamp || new Date().toISOString(),
      symbol: trade.symbol,
      action: trade.action,
      strategy: trade.strategy,
      quantity: trade.quantity,
      price: trade.price,
      total_value: trade.total_value,
      reason: trade.reason,
      execution_mode,
      synced: false
    };

    const data = readLocalDb();
    data.trade_logs.push(tradeLog);
    writeLocalDb(data);

    if (dbAvailable) {
      const res = await runQuery(`
        INSERT INTO trade_logs (id, timestamp, symbol, action, strategy, quantity, price, total_value, reason, execution_mode)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (id) DO NOTHING
      `, [
        tradeLog.id,
        tradeLog.timestamp,
        tradeLog.symbol,
        tradeLog.action,
        tradeLog.strategy,
        Number(tradeLog.quantity),
        Number(tradeLog.price),
        Number(tradeLog.total_value),
        tradeLog.reason,
        tradeLog.execution_mode
      ]);
      if (res !== null) {
        tradeLog.synced = true;
        data.trade_logs[data.trade_logs.length - 1].synced = true;
        writeLocalDb(data);
      }
    }
    return tradeLog;
  },

  // Get trade logs
  async getTradeLogs(limit = 100) {
    if (dbAvailable) {
      const rows = await runQuery('SELECT * FROM trade_logs ORDER BY timestamp DESC LIMIT $1', [limit]);
      if (rows) {
        return rows.map(r => ({
          ...r,
          quantity: Number(r.quantity),
          price: Number(r.price),
          total_value: Number(r.total_value)
        }));
      }
    }
    const data = readLocalDb();
    return data.trade_logs.slice(-limit).reverse();
  },

  // Log a prediction
  async logPrediction(pred) {
    const predLog = {
      id: `P-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      timestamp: new Date().toISOString(),
      symbol: pred.symbol,
      signal: pred.signal,
      model_source: pred.stage,
      consensus: pred.consensus || false,
      custom_signal: pred.customPred?.signal || pred.pred1?.signal || 'HOLD',
      kraken_signal: pred.krakenPred?.signal || pred.pred3?.signal || 'HOLD',
      debate_summary: pred.debateSummary || '',
      entry_price: pred.entry_price,
      exit_price: null,
      pnl: null,
      synced: false
    };

    const data = readLocalDb();
    data.prediction_logs.push(predLog);
    writeLocalDb(data);

    if (dbAvailable) {
      const res = await runQuery(`
        INSERT INTO prediction_logs (id, timestamp, symbol, signal, model_source, consensus, custom_signal, kraken_signal, debate_summary, entry_price, exit_price, pnl)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      `, [
        predLog.id,
        predLog.timestamp,
        predLog.symbol,
        predLog.signal,
        Number(predLog.model_source),
        predLog.consensus,
        predLog.custom_signal,
        predLog.kraken_signal,
        predLog.debate_summary,
        predLog.entry_price ? Number(predLog.entry_price) : null,
        null,
        null
      ]);
      if (res !== null) {
        predLog.synced = true;
        data.prediction_logs[data.prediction_logs.length - 1].synced = true;
        writeLocalDb(data);
      }
    }
    return predLog;
  },

  // Update prediction log (e.g. on trade exit)
  async updatePredictionLog(id, updates) {
    const data = readLocalDb();
    const idx = data.prediction_logs.findIndex(p => p.id === id);
    let item = null;
    if (idx !== -1) {
      data.prediction_logs[idx] = { ...data.prediction_logs[idx], ...updates, synced: false };
      item = data.prediction_logs[idx];
      writeLocalDb(data);
    }

    if (dbAvailable && item) {
      const res = await runQuery(`
        INSERT INTO prediction_logs (id, timestamp, symbol, signal, model_source, consensus, custom_signal, kraken_signal, debate_summary, entry_price, exit_price, pnl)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        ON CONFLICT (id) DO UPDATE SET
          exit_price = EXCLUDED.exit_price,
          pnl = EXCLUDED.pnl
      `, [
        item.id,
        item.timestamp,
        item.symbol,
        item.signal,
        Number(item.model_source),
        item.consensus,
        item.custom_signal,
        item.kraken_signal,
        item.debate_summary,
        item.entry_price ? Number(item.entry_price) : null,
        item.exit_price ? Number(item.exit_price) : null,
        item.pnl ? Number(item.pnl) : null
      ]);
      if (res !== null) {
        item.synced = true;
        data.prediction_logs[idx].synced = true;
        writeLocalDb(data);
      }
    }
    return item;
  },

  // Get prediction logs
  async getPredictionLogs(limit = 100) {
    if (dbAvailable) {
      const rows = await runQuery('SELECT * FROM prediction_logs ORDER BY timestamp DESC LIMIT $1', [limit]);
      if (rows) {
        return rows.map(r => ({
          ...r,
          model_source: Number(r.model_source),
          entry_price: r.entry_price ? Number(r.entry_price) : null,
          exit_price: r.exit_price ? Number(r.exit_price) : null,
          pnl: r.pnl ? Number(r.pnl) : null
        }));
      }
    }
    const data = readLocalDb();
    return data.prediction_logs.slice(-limit).reverse();
  },

  // Get session memory
  async getSessionMemory() {
    if (dbAvailable) {
      const rows = await runQuery('SELECT * FROM agent_memory WHERE id = $1 LIMIT 1', ['default']);
      if (rows && rows.length > 0) {
        const mem = {
          paper_trading_stats: rows[0].paper_trading_stats,
          winning_patterns: rows[0].winning_patterns,
          losing_patterns: rows[0].losing_patterns,
          user_instructions: rows[0].user_instructions
        };
        const data = readLocalDb();
        data.session_memory = { ...data.session_memory, ...mem };
        writeLocalDb(data);
        return data.session_memory;
      }
    }
    const data = readLocalDb();
    return data.session_memory;
  },

  // Update session memory
  async updateSessionMemory(updates) {
    const data = readLocalDb();
    data.session_memory = { ...data.session_memory, ...updates };
    writeLocalDb(data);

    if (dbAvailable) {
      const sm = data.session_memory;
      await runQuery(`
        INSERT INTO agent_memory (id, paper_trading_stats, winning_patterns, losing_patterns, user_instructions, updated_at)
        VALUES ($1, $2, $3, $4, $5, NOW())
        ON CONFLICT (id) DO UPDATE SET
          paper_trading_stats = EXCLUDED.paper_trading_stats,
          winning_patterns = EXCLUDED.winning_patterns,
          losing_patterns = EXCLUDED.losing_patterns,
          user_instructions = EXCLUDED.user_instructions,
          updated_at = NOW()
      `, [
        'default',
        JSON.stringify(sm.paper_trading_stats || {}),
        JSON.stringify(sm.winning_patterns || []),
        JSON.stringify(sm.losing_patterns || []),
        JSON.stringify(sm.user_instructions || data.portfolio_state.user_instructions || {})
      ]);
    }
    return data.session_memory;
  },

  async calculateCompletedTradesStats() {
    const data = readLocalDb();
    const completed = data.completed_trades || [];
    const tradeLogs = data.trade_logs || [];

    if (completed.length === 0) {
      return {
        total_trades: 0,
        winning_trades: 0,
        losing_trades: 0,
        win_rate: 0.00,
        profit_factor: 1.00,
        sharpe_ratio: 0.00,
        max_drawdown: 0.00,
        accuracy: 0.00,
        net_pnl: 0.00,
        average_winner: 0.00,
        average_loser: 0.00,
        average_holding_time: 0.00,
        verification_status: 'UNVERIFIED'
      };
    }

    let winningTrades = 0;
    let losingTrades = 0;
    let grossProfits = 0;
    let grossLosses = 0;
    let totalWinPnL = 0;
    let totalLossPnL = 0;
    let totalHoldingMinutes = 0;

    const returnPctList = [];

    completed.forEach(t => {
      const pnl = Number(t.net_pnl);
      totalHoldingMinutes += Number(t.holding_minutes || 0);
      returnPctList.push(Number(t.return_pct || 0));

      if (pnl > 0) {
        winningTrades++;
        grossProfits += pnl;
        totalWinPnL += pnl;
      } else {
        losingTrades++;
        grossLosses += Math.abs(pnl);
        totalLossPnL += pnl;
      }
    });

    const totalTrades = completed.length;
    const winRate = (winningTrades / totalTrades) * 100;
    const profitFactor = grossLosses > 0 ? (grossProfits / grossLosses) : (grossProfits > 0 ? grossProfits : 1.00);
    const averageWinner = winningTrades > 0 ? (totalWinPnL / winningTrades) : 0;
    const averageLoser = losingTrades > 0 ? (totalLossPnL / losingTrades) : 0;
    const netPnL = grossProfits - grossLosses;
    const averageHoldingTime = totalHoldingMinutes / totalTrades;

    // Sharpe Ratio calculation
    let sharpeRatio = 0.00;
    if (totalTrades > 1) {
      const meanReturn = returnPctList.reduce((sum, r) => sum + r, 0) / totalTrades;
      const variance = returnPctList.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / (totalTrades - 1);
      const stdDev = Math.sqrt(variance);
      if (stdDev > 0) {
        sharpeRatio = meanReturn / stdDev;
      }
    }

    // Max Drawdown calculation
    const sortedCompleted = [...completed].sort((a, b) => new Date(a.exit_time) - new Date(b.exit_time));
    let currentPnL = 0;
    let peakPnL = 0;
    let maxDd = 0;
    const initialCapital = config.INITIAL_CAPITAL || 12000;
    
    sortedCompleted.forEach(t => {
      currentPnL += Number(t.net_pnl);
      if (currentPnL > peakPnL) {
        peakPnL = currentPnL;
      }
      const peakCapital = initialCapital + peakPnL;
      const currentCapital = initialCapital + currentPnL;
      const ddPct = ((peakCapital - currentCapital) / peakCapital) * 100;
      if (ddPct > maxDd) {
        maxDd = ddPct;
      }
    });

    // Anomaly Check
    let hasAnomalies = false;
    const sellLogs = tradeLogs.filter(l => l.action === 'SELL');
    const buyLogs = tradeLogs.filter(l => l.action === 'BUY');

    for (const sell of sellLogs) {
      const matchingBuys = buyLogs.filter(b => b.symbol === sell.symbol && new Date(b.timestamp) < new Date(sell.timestamp));
      if (matchingBuys.length === 0) {
        hasAnomalies = true;
        break;
      }
    }

    const matchedEntryTimes = new Set();
    for (const t of completed) {
      const key = `${t.symbol}-${new Date(t.entry_time).getTime()}`;
      if (matchedEntryTimes.has(key)) {
        hasAnomalies = true;
        break;
      }
      matchedEntryTimes.add(key);
    }

    const verificationStatus = hasAnomalies ? 'PARTIAL' : 'VERIFIED';

    return {
      total_trades: totalTrades,
      winning_trades: winningTrades,
      losing_trades: losingTrades,
      win_rate: Number(winRate.toFixed(2)),
      profit_factor: Number(profitFactor.toFixed(2)),
      sharpe_ratio: Number(sharpeRatio.toFixed(2)),
      max_drawdown: Number(maxDd.toFixed(2)),
      accuracy: Number(winRate.toFixed(2)),
      net_pnl: Number(netPnL.toFixed(2)),
      average_winner: Number(averageWinner.toFixed(2)),
      average_loser: Number(averageLoser.toFixed(2)),
      average_holding_time: Number(averageHoldingTime.toFixed(2)),
      verification_status: verificationStatus
    };
  },

  // Get paper trading results
  async getPaperTradingResults(forceFresh = false) {
    const stats = await this.calculateCompletedTradesStats();
    const data = readLocalDb();
    data.paper_trading_results = {
      id: 'default',
      trading_days_tracked: data.paper_trading_results?.trading_days_tracked || 0,
      win_rate: stats.win_rate,
      profit_factor: stats.profit_factor,
      sharpe_ratio: stats.sharpe_ratio,
      max_drawdown: stats.max_drawdown,
      accuracy: stats.accuracy,
      net_pnl: stats.net_pnl,
      verification_status: stats.verification_status,
      total_trades: stats.total_trades,
      average_winner: stats.average_winner,
      average_loser: stats.average_loser,
      average_holding_time: stats.average_holding_time,
      details: data.paper_trading_results?.details || {}
    };
    writeLocalDb(data);
    return data.paper_trading_results;
  },

  // Save/Update paper trading results
  async savePaperTradingResults(results) {
    const data = readLocalDb();
    data.paper_trading_results = { ...data.paper_trading_results, ...results };
    writeLocalDb(data);

    if (dbAvailable) {
      const ptr = data.paper_trading_results;
      await runQuery(`
        INSERT INTO paper_trading_results (id, trading_days_tracked, win_rate, profit_factor, sharpe_ratio, max_drawdown, accuracy, net_pnl, details, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
        ON CONFLICT (id) DO UPDATE SET
          trading_days_tracked = EXCLUDED.trading_days_tracked,
          win_rate = EXCLUDED.win_rate,
          profit_factor = EXCLUDED.profit_factor,
          sharpe_ratio = EXCLUDED.sharpe_ratio,
          max_drawdown = EXCLUDED.max_drawdown,
          accuracy = EXCLUDED.accuracy,
          net_pnl = EXCLUDED.net_pnl,
          details = EXCLUDED.details,
          updated_at = NOW()
      `, [
        'default',
        Number(ptr.trading_days_tracked),
        Number(ptr.win_rate),
        Number(ptr.profit_factor),
        Number(ptr.sharpe_ratio),
        Number(ptr.max_drawdown),
        Number(ptr.accuracy),
        Number(ptr.net_pnl),
        JSON.stringify(ptr.details || {})
      ]);
    }
    return data.paper_trading_results;
  },

  // Get daily model performance
  async getDailyModelPerformance(dateStr) {
    if (dbAvailable) {
      const rows = await runQuery('SELECT * FROM daily_model_performance WHERE date = $1 LIMIT 1', [dateStr]);
      if (rows && rows.length > 0) {
        return {
          date: rows[0].date,
          agent1_accuracy: Number(rows[0].agent1_accuracy),
          agent2_accuracy: Number(rows[0].agent2_accuracy),
          agent3_accuracy: Number(rows[0].agent3_accuracy),
          agent4_accuracy: Number(rows[0].agent4_accuracy),
          consensus_accuracy: Number(rows[0].consensus_accuracy),
          total_predictions: Number(rows[0].total_predictions),
          details: rows[0].details || {}
        };
      }
    }
    const data = readLocalDb();
    return data.daily_model_performance.find(p => p.date === dateStr) || null;
  },

  // Save daily model performance
  async saveDailyModelPerformance(perf) {
    const data = readLocalDb();
    const idx = data.daily_model_performance.findIndex(p => p.date === perf.date);
    const item = { ...perf, synced: false };
    if (idx !== -1) {
      data.daily_model_performance[idx] = { ...data.daily_model_performance[idx], ...item };
    } else {
      data.daily_model_performance.push(item);
    }
    writeLocalDb(data);

    if (dbAvailable) {
      const res = await runQuery(`
        INSERT INTO daily_model_performance (date, agent1_accuracy, agent2_accuracy, agent3_accuracy, agent4_accuracy, consensus_accuracy, total_predictions, details, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
        ON CONFLICT (date) DO UPDATE SET
          agent1_accuracy = EXCLUDED.agent1_accuracy,
          agent2_accuracy = EXCLUDED.agent2_accuracy,
          agent3_accuracy = EXCLUDED.agent3_accuracy,
          agent4_accuracy = EXCLUDED.agent4_accuracy,
          consensus_accuracy = EXCLUDED.consensus_accuracy,
          total_predictions = EXCLUDED.total_predictions,
          details = EXCLUDED.details,
          updated_at = NOW()
      `, [
        perf.date,
        Number(perf.agent1_accuracy),
        Number(perf.agent2_accuracy),
        Number(perf.agent3_accuracy),
        Number(perf.agent4_accuracy),
        Number(perf.consensus_accuracy),
        Number(perf.total_predictions),
        JSON.stringify(perf.details || {})
      ]);
      if (res !== null) {
        data.daily_model_performance[data.daily_model_performance.length - 1].synced = true;
        writeLocalDb(data);
      }
    }
    return perf;
  },

  // Log a risk event
  async logRiskEvent(event) {
    const newEvent = {
      id: `RE-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      timestamp: new Date().toISOString(),
      event_type: event.event_type || 'DAILY_STOP_LOSS',
      description: event.description,
      portfolio_value: event.portfolio_value || 12000,
      details: event.details || {},
      synced: false
    };

    const data = readLocalDb();
    if (!data.risk_events) data.risk_events = [];
    data.risk_events.push(newEvent);
    
    if (!data.session_memory.risk_events) data.session_memory.risk_events = [];
    data.session_memory.risk_events.push(newEvent);
    writeLocalDb(data);

    if (dbAvailable) {
      const res = await runQuery(`
        INSERT INTO risk_events (id, timestamp, event_type, description, portfolio_value, details)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (id) DO NOTHING
      `, [
        newEvent.id,
        newEvent.timestamp,
        newEvent.event_type,
        newEvent.description,
        Number(newEvent.portfolio_value),
        JSON.stringify(newEvent.details)
      ]);
      if (res !== null) {
        newEvent.synced = true;
        data.risk_events[data.risk_events.length - 1].synced = true;
        writeLocalDb(data);
      }
    }
    return newEvent;
  },

  // Log a winning or losing pattern
  async logPattern(type, pattern) {
    const data = readLocalDb();
    const listKey = type === 'winning' ? 'winning_patterns' : 'losing_patterns';
    
    const newPattern = {
      timestamp: new Date().toISOString(),
      ...pattern
    };
    
    if (!data.session_memory[listKey]) data.session_memory[listKey] = [];
    data.session_memory[listKey].push(newPattern);
    if (data.session_memory[listKey].length > 20) {
      data.session_memory[listKey].shift();
    }
    writeLocalDb(data);

    if (dbAvailable) {
      const sm = data.session_memory;
      await runQuery(`
        INSERT INTO agent_memory (id, paper_trading_stats, winning_patterns, losing_patterns, user_instructions, updated_at)
        VALUES ($1, $2, $3, $4, $5, NOW())
        ON CONFLICT (id) DO UPDATE SET
          paper_trading_stats = EXCLUDED.paper_trading_stats,
          winning_patterns = EXCLUDED.winning_patterns,
          losing_patterns = EXCLUDED.losing_patterns,
          user_instructions = EXCLUDED.user_instructions,
          updated_at = NOW()
      `, [
        'default',
        JSON.stringify(sm.paper_trading_stats || {}),
        JSON.stringify(sm.winning_patterns || []),
        JSON.stringify(sm.losing_patterns || []),
        JSON.stringify(sm.user_instructions || data.portfolio_state.user_instructions || {})
      ]);
    }
    return newPattern;
  },

  // Log consensus decision
  async logConsensusDecision(decision) {
    const item = {
      id: decision.id || `CD-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      timestamp: decision.timestamp || new Date().toISOString(),
      symbol: decision.symbol,
      decision: decision.decision,
      confidence: decision.confidence,
      participating_models: decision.participating_models,
      debate_summary: decision.debate_summary,
      final_outcome: decision.final_outcome || null,
      result_after_closes: decision.result_after_closes || null,
      ref_15m: decision.ref_15m !== undefined ? decision.ref_15m : null,
      ref_30m: decision.ref_30m !== undefined ? decision.ref_30m : null,
      ref_1h: decision.ref_1h !== undefined ? decision.ref_1h : null,
      ref_eod: decision.ref_eod !== undefined ? decision.ref_eod : null,
      synced: false
    };

    const data = readLocalDb();
    if (!data.consensus_decisions) data.consensus_decisions = [];
    data.consensus_decisions.push(item);
    writeLocalDb(data);

    if (dbAvailable) {
      const res = await runQuery(`
        INSERT INTO consensus_decisions (id, timestamp, symbol, decision, confidence, participating_models, debate_summary, final_outcome, result_after_closes, ref_15m, ref_30m, ref_1h, ref_eod)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        ON CONFLICT (id) DO NOTHING
      `, [
        item.id,
        item.timestamp,
        item.symbol,
        item.decision,
        Number(item.confidence),
        JSON.stringify(item.participating_models),
        item.debate_summary,
        item.final_outcome,
        item.result_after_closes ? Number(item.result_after_closes) : null,
        item.ref_15m ? Number(item.ref_15m) : null,
        item.ref_30m ? Number(item.ref_30m) : null,
        item.ref_1h ? Number(item.ref_1h) : null,
        item.ref_eod ? Number(item.ref_eod) : null
      ]);
      if (res !== null) {
        item.synced = true;
        data.consensus_decisions[data.consensus_decisions.length - 1].synced = true;
        writeLocalDb(data);
      }
    }
    return item;
  },

  // Update consensus decision
  async updateConsensusDecision(id, updates) {
    const data = readLocalDb();
    if (!data.consensus_decisions) data.consensus_decisions = [];
    const idx = data.consensus_decisions.findIndex(c => c.id === id);
    let item = null;
    if (idx !== -1) {
      data.consensus_decisions[idx] = { ...data.consensus_decisions[idx], ...updates, synced: false };
      item = data.consensus_decisions[idx];
      writeLocalDb(data);
    }

    if (dbAvailable && item) {
      const res = await runQuery(`
        INSERT INTO consensus_decisions (id, timestamp, symbol, decision, confidence, participating_models, debate_summary, final_outcome, result_after_closes, ref_15m, ref_30m, ref_1h, ref_eod)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        ON CONFLICT (id) DO UPDATE SET
          final_outcome = EXCLUDED.final_outcome,
          result_after_closes = EXCLUDED.result_after_closes,
          ref_15m = EXCLUDED.ref_15m,
          ref_30m = EXCLUDED.ref_30m,
          ref_1h = EXCLUDED.ref_1h,
          ref_eod = EXCLUDED.ref_eod
      `, [
        item.id,
        item.timestamp,
        item.symbol,
        item.decision,
        Number(item.confidence),
        JSON.stringify(item.participating_models),
        item.debate_summary,
        item.final_outcome,
        item.result_after_closes ? Number(item.result_after_closes) : null,
        item.ref_15m ? Number(item.ref_15m) : null,
        item.ref_30m ? Number(item.ref_30m) : null,
        item.ref_1h ? Number(item.ref_1h) : null,
        item.ref_eod ? Number(item.ref_eod) : null
      ]);
      if (res !== null) {
        item.synced = true;
        data.consensus_decisions[idx].synced = true;
        writeLocalDb(data);
      }
    }
    return item;
  },

  // Log Telegram command
  async logTelegramCommand(cmd) {
    const item = {
      id: `CMD-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      timestamp: new Date().toISOString(),
      command: cmd.command,
      parameters: cmd.parameters || {},
      applied: cmd.applied !== false,
      synced: false
    };

    const data = readLocalDb();
    if (!data.telegram_commands) data.telegram_commands = [];
    data.telegram_commands.push(item);
    writeLocalDb(data);

    if (dbAvailable) {
      const res = await runQuery(`
        INSERT INTO telegram_commands (id, timestamp, command, parameters, applied)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (id) DO NOTHING
      `, [
        item.id,
        item.timestamp,
        item.command,
        JSON.stringify(item.parameters || {}),
        item.applied
      ]);
      if (res !== null) {
        item.synced = true;
        data.telegram_commands[data.telegram_commands.length - 1].synced = true;
        writeLocalDb(data);
      }
    }
    return item;
  },

  // Log system alert
  async logAlert(alert) {
    const item = {
      id: `ALT-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      timestamp: alert.timestamp || new Date().toISOString(),
      type: alert.type,
      message: alert.message,
      status: alert.status || 'SENT',
      synced: false
    };

    const data = readLocalDb();
    if (!data.alerts) data.alerts = [];
    data.alerts.push(item);
    writeLocalDb(data);

    if (dbAvailable) {
      const res = await runQuery(`
        INSERT INTO alerts (id, timestamp, type, message, status)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (id) DO NOTHING
      `, [
        item.id,
        item.timestamp,
        item.type,
        item.message,
        item.status
      ]);
      if (res !== null) {
        item.synced = true;
        data.alerts[data.alerts.length - 1].synced = true;
        writeLocalDb(data);
      }
    }
    return item;
  },

  // Log learning feedback cycle
  async logLearningFeedback(feedback) {
    const item = {
      id: `LF-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      timestamp: new Date().toISOString(),
      prediction_id: feedback.prediction_id,
      pnl: feedback.pnl,
      learning_rate: feedback.learning_rate || 0.02,
      weights_before: feedback.weights_before,
      weights_after: feedback.weights_after,
      synced: false
    };

    const data = readLocalDb();
    if (!data.learning_feedback) data.learning_feedback = [];
    data.learning_feedback.push(item);
    writeLocalDb(data);

    if (dbAvailable) {
      const res = await runQuery(`
        INSERT INTO learning_feedback (id, timestamp, prediction_id, pnl, learning_rate, weights_before, weights_after)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (id) DO NOTHING
      `, [
        item.id,
        item.timestamp,
        item.prediction_id,
        Number(item.pnl),
        Number(item.learning_rate),
        JSON.stringify(item.weights_before),
        JSON.stringify(item.weights_after)
      ]);
      if (res !== null) {
        item.synced = true;
        data.learning_feedback[data.learning_feedback.length - 1].synced = true;
        writeLocalDb(data);
      }
    }
    return item;
  },

  // Save market scanner rankings
  async saveScannerRankings(rankings) {
    const data = readLocalDb();
    data.scanner_rankings = rankings;
    writeLocalDb(data);

    if (dbAvailable) {
      try {
        await runQuery(`
          CREATE TABLE IF NOT EXISTS scanner_rankings (
            id SERIAL PRIMARY KEY,
            timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
            longs JSONB NOT NULL,
            shorts JSONB NOT NULL
          )
        `);
        await runQuery(`
          INSERT INTO scanner_rankings (longs, shorts) VALUES ($1, $2)
        `, [JSON.stringify(rankings.longs), JSON.stringify(rankings.shorts)]);
      } catch (err) {
        console.error('Error saving scanner rankings to Postgres:', err.message);
      }
    }
  },

  // Get latest market scanner rankings
  async getLatestScannerRankings() {
    if (dbAvailable) {
      try {
        const rows = await runQuery(`
          SELECT longs, shorts FROM scanner_rankings ORDER BY timestamp DESC LIMIT 1
        `);
        if (rows && rows.length > 0) {
          return {
            longs: typeof rows[0].longs === 'string' ? JSON.parse(rows[0].longs) : rows[0].longs,
            shorts: typeof rows[0].shorts === 'string' ? JSON.parse(rows[0].shorts) : rows[0].shorts
          };
        }
      } catch (err) {
        console.error('Error getting scanner rankings from Postgres:', err.message);
      }
    }
    const data = readLocalDb();
    return data.scanner_rankings || null;
  },

  async saveAgent20Report(report) {
    const reportLog = {
      ...report,
      timestamp: new Date().toISOString(),
      synced: false
    };
    const data = readLocalDb();
    if (!data.agent20_reports) data.agent20_reports = [];
    data.agent20_reports.push(reportLog);
    writeLocalDb(data);
    if (dbAvailable) {
      try {
        const res = await runQuery(`
          INSERT INTO agent20_reports (trade_id, symbol, entry_reason, exit_reason, supporting_agents, opposing_agents, market_conditions, outcome, lessons_learned)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `, [reportLog.trade_id, reportLog.symbol, reportLog.entry_reason, reportLog.exit_reason, JSON.stringify(reportLog.supporting_agents), JSON.stringify(reportLog.opposing_agents), JSON.stringify(reportLog.market_conditions), JSON.stringify(reportLog.outcome), reportLog.lessons_learned]);
        if (res !== null) {
          reportLog.synced = true;
          data.agent20_reports[data.agent20_reports.length - 1].synced = true;
          writeLocalDb(data);
        }
      } catch (e) {
        console.error('Error saving Agent 20 report to Postgres:', e.message);
      }
    }
    return reportLog;
  },

  async saveAgent21TrustLog(log) {
    const trustLog = {
      ...log,
      timestamp: new Date().toISOString(),
      synced: false
    };
    const data = readLocalDb();
    if (!data.agent21_trust_logs) data.agent21_trust_logs = [];
    data.agent21_trust_logs.push(trustLog);
    writeLocalDb(data);
    if (dbAvailable) {
      try {
        const res = await runQuery(`
          INSERT INTO agent21_trust_logs (weights_before, weights_after, adjustments)
          VALUES ($1, $2, $3)
        `, [JSON.stringify(trustLog.weights_before), JSON.stringify(trustLog.weights_after), JSON.stringify(trustLog.adjustments)]);
        if (res !== null) {
          trustLog.synced = true;
          data.agent21_trust_logs[data.agent21_trust_logs.length - 1].synced = true;
          writeLocalDb(data);
        }
      } catch (e) {
        console.error('Error saving Agent 21 trust log to Postgres:', e.message);
      }
    }
    return trustLog;
  },

  async saveAgent22ResearchLog(log) {
    const researchLog = {
      ...log,
      timestamp: new Date().toISOString(),
      synced: false
    };
    const data = readLocalDb();
    if (!data.agent22_research_logs) data.agent22_research_logs = [];
    data.agent22_research_logs.push(researchLog);
    writeLocalDb(data);
    if (dbAvailable) {
      try {
        const res = await runQuery(`
          INSERT INTO agent22_research_logs (regime, sector, volatility, momentum, improvements, backtest_results, deployed)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [researchLog.regime, researchLog.sector, researchLog.volatility, researchLog.momentum, JSON.stringify(researchLog.improvements), JSON.stringify(researchLog.backtest_results), researchLog.deployed]);
        if (res !== null) {
          researchLog.synced = true;
          data.agent22_research_logs[data.agent22_research_logs.length - 1].synced = true;
          writeLocalDb(data);
        }
      } catch (e) {
        console.error('Error saving Agent 22 research log to Postgres:', e.message);
      }
    }
    return researchLog;
  },

  async saveAgent23Journal(journal) {
    const journalLog = {
      ...journal,
      timestamp: new Date().toISOString(),
      synced: false
    };
    const data = readLocalDb();
    if (!data.agent23_journals) data.agent23_journals = [];
    data.agent23_journals.push(journalLog);
    writeLocalDb(data);
    if (dbAvailable) {
      try {
        const res = await runQuery(`
          INSERT INTO agent23_journals (trade_id, symbol, entry_thesis, exit_thesis, outcome, mistakes, success_factors, lessons)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `, [journalLog.trade_id, journalLog.symbol, journalLog.entry_thesis, journalLog.exit_thesis, journalLog.outcome, journalLog.mistakes, journalLog.success_factors, journalLog.lessons]);
        if (res !== null) {
          journalLog.synced = true;
          data.agent23_journals[data.agent23_journals.length - 1].synced = true;
          writeLocalDb(data);
        }
      } catch (e) {
        console.error('Error saving Agent 23 journal to Postgres:', e.message);
      }
    }
    return journalLog;
  },

  async saveAgent24AuditLog(log) {
    const auditLog = { ...log, id: log.id || `A24-${Date.now()}-${Math.floor(Math.random() * 1000)}`, timestamp: log.timestamp || new Date().toISOString(), synced: false };
    const data = readLocalDb();
    if (!data.agent24_audit_logs) data.agent24_audit_logs = [];
    data.agent24_audit_logs.push(auditLog);
    writeLocalDb(data);
    if (dbAvailable) {
      try {
        await runQuery(`
          INSERT INTO agent24_audit_logs (symbol, tqs, rejection_reason, price_at_rejection, current_price, return_pct, ref_15m, ref_30m, ref_1h, ref_eod, completed)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        `, [auditLog.symbol, Number(auditLog.tqs), auditLog.rejection_reason, Number(auditLog.price_at_rejection), Number(auditLog.current_price), Number(auditLog.return_pct),
            auditLog.ref_15m ? Number(auditLog.ref_15m) : null, auditLog.ref_30m ? Number(auditLog.ref_30m) : null, auditLog.ref_1h ? Number(auditLog.ref_1h) : null, auditLog.ref_eod ? Number(auditLog.ref_eod) : null, auditLog.completed]);
      } catch (e) {
        console.error('Error saving Agent 24 log:', e.message);
      }
    }
    return auditLog;
  },

  async updateAgent24AuditLog(log) {
    const data = readLocalDb();
    if (!data.agent24_audit_logs) data.agent24_audit_logs = [];
    const idx = data.agent24_audit_logs.findIndex(x => x.symbol === log.symbol && x.timestamp === log.timestamp);
    if (idx !== -1) {
      data.agent24_audit_logs[idx] = { ...data.agent24_audit_logs[idx], ...log, synced: false };
      writeLocalDb(data);
    }
    if (dbAvailable) {
      try {
        await runQuery(`
          UPDATE agent24_audit_logs 
          SET current_price = $1, return_pct = $2, ref_15m = $3, ref_30m = $4, ref_1h = $5, ref_eod = $6, completed = $7 
          WHERE symbol = $8 AND ABS(EXTRACT(EPOCH FROM (timestamp - $9))) < 10
        `, [Number(log.current_price), Number(log.return_pct), log.ref_15m ? Number(log.ref_15m) : null, log.ref_30m ? Number(log.ref_30m) : null, log.ref_1h ? Number(log.ref_1h) : null, log.ref_eod ? Number(log.ref_eod) : null, log.completed, log.symbol, new Date(log.timestamp)]);
      } catch (e) {
        console.error('Error updating Agent 24 log:', e.message);
      }
    }
  },

  async saveAgent25SizingLog(log) {
    const sizingLog = { ...log, timestamp: new Date().toISOString(), synced: false };
    const data = readLocalDb();
    if (!data.agent25_sizing_logs) data.agent25_sizing_logs = [];
    data.agent25_sizing_logs.push(sizingLog);
    writeLocalDb(data);
    if (dbAvailable) {
      try {
        await runQuery(`
          INSERT INTO agent25_sizing_logs (symbol, sector, tqs_band, regime, expectancy, current_alloc, recommended_alloc)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [sizingLog.symbol, sizingLog.sector, sizingLog.tqs_band, sizingLog.regime, Number(sizingLog.expectancy), Number(sizingLog.current_alloc), Number(sizingLog.recommended_alloc)]);
      } catch (e) {
        console.error('Error saving Agent 25 log:', e.message);
      }
    }
    return sizingLog;
  },

  async saveAgent26MarketMemory(mem) {
    const memoryLog = { ...mem, timestamp: new Date().toISOString(), synced: false };
    const data = readLocalDb();
    if (!data.agent26_market_memory) data.agent26_market_memory = [];
    data.agent26_market_memory.push(memoryLog);
    writeLocalDb(data);
    if (dbAvailable) {
      try {
        await runQuery(`
          INSERT INTO agent26_market_memory (symbol, signal, feature_vector, outcome_pnl)
          VALUES ($1, $2, $3, $4)
        `, [memoryLog.symbol, memoryLog.signal, JSON.stringify(memoryLog.feature_vector), memoryLog.outcome_pnl ? Number(memoryLog.outcome_pnl) : null]);
      } catch (e) {
        console.error('Error saving Agent 26 log:', e.message);
      }
    }
    return memoryLog;
  },

  async saveNightlyLearningReport(report) {
    const reportLog = { ...report, timestamp: new Date().toISOString(), synced: false };
    const data = readLocalDb();
    if (!data.nightly_learning_reports) data.nightly_learning_reports = [];
    data.nightly_learning_reports.push(reportLog);
    writeLocalDb(data);
    if (dbAvailable) {
      try {
        await runQuery(`
          INSERT INTO nightly_learning_reports (metrics, missed_opportunities, sizing_recommendations, learning_log)
          VALUES ($1, $2, $3, $4)
        `, [JSON.stringify(reportLog.metrics), JSON.stringify(reportLog.missed_opportunities), JSON.stringify(reportLog.sizing_recommendations), reportLog.learning_log]);
      } catch (e) {
        console.error('Error saving Nightly Learning report:', e.message);
      }
    }
    return reportLog;
  },

  // Force sync execution
  async executeSyncNow() {
    await syncLocalToPostgres();
  },

  initPromise,

  readLocalDb() {
    return readLocalDb();
  },

  writeLocalDb(data) {
    writeLocalDb(data);
  },

  async saveLeaderboardState(leaderboard) {
    console.log('[DB] Saving persistent agent trust leaderboard state...');
    const portfolio = await this.getPortfolioState();
    if (!portfolio.model_weights) {
      portfolio.model_weights = {};
    }
    if (!portfolio.model_weights.neural_model_weights) {
      portfolio.model_weights.neural_model_weights = {};
    }
    portfolio.model_weights.neural_model_weights.leaderboard_state = leaderboard;
    await this.updatePortfolioState({ model_weights: portfolio.model_weights });
    console.log('[DB] Leaderboard state successfully saved.');
  },

  async saveThresholdHistory(entry) {
    const historyLog = {
      ...entry,
      timestamp: entry.timestamp || new Date().toISOString(),
      synced: false
    };
    const data = readLocalDb();
    if (!data.threshold_history) data.threshold_history = [];
    data.threshold_history.push(historyLog);
    writeLocalDb(data);
    if (dbAvailable) {
      try {
        const res = await runQuery(`
          INSERT INTO threshold_history (threshold, regime, volatility, sector_strength, reasoning)
          VALUES ($1, $2, $3, $4, $5)
        `, [
          Number(historyLog.threshold),
          historyLog.regime,
          historyLog.volatility,
          historyLog.sector_strength,
          historyLog.reasoning
        ]);
        if (res !== null) {
          historyLog.synced = true;
          data.threshold_history[data.threshold_history.length - 1].synced = true;
          writeLocalDb(data);
        }
      } catch (e) {
        console.error('Error saving threshold history to Postgres:', e.message);
      }
    }
    return historyLog;
  },

  async getThresholdHistory(limit = 50) {
    if (dbAvailable) {
      const rows = await runQuery(
        'SELECT * FROM threshold_history ORDER BY timestamp DESC LIMIT $1',
        [limit]
      );
      if (rows) {
        return rows.map(r => ({
          threshold: Number(r.threshold),
          regime: r.regime,
          volatility: r.volatility,
          sector_strength: r.sector_strength,
          reasoning: r.reasoning,
          timestamp: r.timestamp
        }));
      }
    }
    const data = readLocalDb();
    const history = data.threshold_history || [];
    return history.slice(-limit).reverse();
  },

  async savePerformanceMetrics(metrics) {
    const data = readLocalDb();
    data.performance_metrics = data.performance_metrics || [];
    const idx = data.performance_metrics.findIndex(m => m.date === metrics.date);
    const entry = {
      date: metrics.date,
      expected_profit: Number(metrics.expected_profit || 0),
      profit_factor: Number(metrics.profit_factor || 0),
      sharpe_ratio: Number(metrics.sharpe_ratio || 0),
      max_drawdown: Number(metrics.max_drawdown || 0),
      winning_symbols: metrics.winning_symbols || [],
      losing_symbols: metrics.losing_symbols || [],
      capital_utilization: Number(metrics.capital_utilization || 0),
      timestamp: new Date().toISOString()
    };
    if (idx !== -1) {
      data.performance_metrics[idx] = entry;
    } else {
      data.performance_metrics.push(entry);
    }
    writeLocalDb(data);

    if (dbAvailable) {
      try {
        await runQuery(`
          INSERT INTO performance_metrics (date, expected_profit, profit_factor, sharpe_ratio, max_drawdown, winning_symbols, losing_symbols, capital_utilization)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          ON CONFLICT (date) DO UPDATE SET
            expected_profit = EXCLUDED.expected_profit,
            profit_factor = EXCLUDED.profit_factor,
            sharpe_ratio = EXCLUDED.sharpe_ratio,
            max_drawdown = EXCLUDED.max_drawdown,
            winning_symbols = EXCLUDED.winning_symbols,
            losing_symbols = EXCLUDED.losing_symbols,
            capital_utilization = EXCLUDED.capital_utilization
        `, [
          entry.date,
          entry.expected_profit,
          entry.profit_factor,
          entry.sharpe_ratio,
          entry.max_drawdown,
          JSON.stringify(entry.winning_symbols),
          JSON.stringify(entry.losing_symbols),
          entry.capital_utilization
        ]);
      } catch (err) {
        console.error('[DB] Failed to save performance metrics to Postgres:', err.message);
      }
    }
    return entry;
  },

  async getPerformanceMetrics(limit = 30) {
    if (dbAvailable) {
      try {
        const rows = await runQuery('SELECT * FROM performance_metrics ORDER BY date DESC LIMIT $1', [limit]);
        if (rows) return rows;
      } catch (err) {
        console.error('[DB] Failed to get performance metrics:', err.message);
      }
    }
    const data = readLocalDb();
    const metrics = data.performance_metrics || [];
    return metrics.slice(-limit).reverse();
  },

  async logThroughput(entry) {
    const data = readLocalDb();
    if (!data.throughput_history) data.throughput_history = [];
    
     const item = {
      id: `TH-${Date.now()}`,
      timestamp: new Date().toISOString(),
      scanned: Number(entry.scanned),
      researched: Number(entry.researched),
      ranked: Number(entry.ranked),
      scored: Number(entry.scored),
      candidates: Number(entry.candidates),
      consensus: Number(entry.consensus),
      executed: Number(entry.executed),
      passed_risk: Number(entry.passed_risk || 0),
      rejection_reasons: entry.rejection_reasons
    };
    
    data.throughput_history.push(item);
    if (data.throughput_history.length > 500) data.throughput_history.shift();
    writeLocalDb(data);
    
    if (dbAvailable) {
      try {
        await runQuery(`
          INSERT INTO throughput_history (timestamp, scanned, researched, ranked, scored, candidates, consensus, executed, passed_risk, rejection_reasons)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `, [
          item.timestamp,
          item.scanned,
          item.researched,
          item.ranked,
          item.scored,
          item.candidates,
          item.consensus,
          item.executed,
          item.passed_risk,
          JSON.stringify(item.rejection_reasons)
        ]);
      } catch (err) {
        console.error('[DB] Error logging throughput history:', err.message);
      }
    }
    return item;
  },

  async getThroughputHistory(limit = 100) {
    if (dbAvailable) {
      try {
        const rows = await runQuery('SELECT * FROM throughput_history ORDER BY timestamp DESC LIMIT $1', [limit]);
        return rows;
      } catch (err) {
        console.error('[DB] Error fetching throughput history:', err.message);
      }
    }
    const data = readLocalDb();
    const history = data.throughput_history || [];
    return history.slice(-limit).reverse();
  },

  async saveOpportunity(opp) {
    const data = readLocalDb();
    data.opportunity_tracker = data.opportunity_tracker || [];
    
    const now = new Date();
    // Dedup: if same symbol within 30 seconds, replace. Otherwise push.
    const idx = data.opportunity_tracker.findIndex(x => x.symbol === opp.symbol && (now - new Date(x.scan_timestamp)) < 30000);
    
    const item = {
      ...opp,
      id: opp.id || `OPP-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      scan_timestamp: opp.scan_timestamp || now.toISOString(),
      synced: false
    };

    if (idx !== -1) {
      data.opportunity_tracker[idx] = { ...data.opportunity_tracker[idx], ...item };
    } else {
      data.opportunity_tracker.push(item);
    }
    
    if (data.opportunity_tracker.length > 500) {
      data.opportunity_tracker.shift();
    }
    
    writeLocalDb(data);

    if (dbAvailable) {
      try {
        await runQuery(`
          INSERT INTO opportunity_tracker (symbol, current_price, confidence, tqs, consensus_score, buy_votes, sell_votes, hold_votes, agent_count, signal_type, rejection_reason, scan_timestamp, opportunity_score, status, participating_models, debate_summary)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
        `, [
          item.symbol,
          Number(item.current_price),
          Number(item.confidence),
          Number(item.tqs),
          Number(item.consensus_score),
          parseInt(item.buy_votes),
          parseInt(item.sell_votes),
          parseInt(item.hold_votes),
          parseInt(item.agent_count),
          item.signal_type,
          item.rejection_reason,
          item.scan_timestamp,
          Number(item.opportunity_score),
          item.status,
          JSON.stringify(item.participating_models),
          item.debate_summary
        ]);
      } catch (e) {
        console.error('Error saving opportunity:', e.message);
      }
    }
    return item;
  },

  async updateOpportunityLocal(opp) {
    const data = readLocalDb();
    data.opportunity_tracker = data.opportunity_tracker || [];
    const idx = data.opportunity_tracker.findIndex(x => x.id === opp.id);
    if (idx !== -1) {
      data.opportunity_tracker[idx] = { ...data.opportunity_tracker[idx], ...opp };
      writeLocalDb(data);
    }
    if (dbAvailable) {
      try {
        const isIntegerId = typeof opp.id === 'number' || (typeof opp.id === 'string' && /^\d+$/.test(opp.id));
        const queryId = isIntegerId ? parseInt(opp.id) : null;
        await runQuery(`
          UPDATE opportunity_tracker 
          SET ref_15m = $1, ref_30m = $2, ref_1h = $3, ref_eod = $4, completed = $5, status = $6, rejection_reason = $7
          WHERE id = $8 OR (symbol = $9 AND scan_timestamp = $10)
        `, [
          opp.ref_15m ? Number(opp.ref_15m) : null,
          opp.ref_30m ? Number(opp.ref_30m) : null,
          opp.ref_1h ? Number(opp.ref_1h) : null,
          opp.ref_eod ? Number(opp.ref_eod) : null,
          opp.completed,
          opp.status,
          opp.rejection_reason,
          queryId,
          opp.symbol,
          opp.scan_timestamp
        ]);
      } catch (e) {
        console.error('Error updating opportunity:', e.message);
      }
    }
  },

  async hasOpenShadowTrade(symbol) {
    const data = readLocalDb();
    data.shadow_trades = data.shadow_trades || [];
    return data.shadow_trades.some(t => t.symbol === symbol && t.status === 'OPEN');
  },

  async saveShadowTrade(trade) {
    const data = readLocalDb();
    data.shadow_trades = data.shadow_trades || [];
    data.shadow_trades.push(trade);
    writeLocalDb(data);

    if (dbAvailable) {
      try {
        await runQuery(`
          INSERT INTO shadow_trades (id, timestamp, symbol, entry_price, current_price, quantity, confidence, tqs, opportunity_score, status, pnl, return_pct)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        `, [
          trade.id,
          trade.timestamp,
          trade.symbol,
          Number(trade.entry_price),
          Number(trade.current_price),
          parseInt(trade.quantity),
          Number(trade.confidence),
          Number(trade.tqs),
          Number(trade.opportunity_score),
          trade.status,
          Number(trade.pnl),
          Number(trade.return_pct)
        ]);
      } catch (e) {
        console.error('Error saving shadow trade to Postgres:', e.message);
      }
    }
    return trade;
  },

  async updateShadowTrade(trade) {
    const data = readLocalDb();
    data.shadow_trades = data.shadow_trades || [];
    const idx = data.shadow_trades.findIndex(t => t.id === trade.id);
    if (idx !== -1) {
      data.shadow_trades[idx] = { ...data.shadow_trades[idx], ...trade };
      writeLocalDb(data);
    }

    if (dbAvailable) {
      try {
        await runQuery(`
          UPDATE shadow_trades
          SET current_price = $1, status = $2, pnl = $3, return_pct = $4, exit_price = $5, exit_timestamp = $6
          WHERE id = $7
        `, [
          Number(trade.current_price),
          trade.status,
          Number(trade.pnl),
          Number(trade.return_pct),
          trade.exit_price ? Number(trade.exit_price) : null,
          trade.exit_timestamp,
          trade.id
        ]);
      } catch (e) {
        console.error('Error updating shadow trade in Postgres:', e.message);
      }
    }
  },

  async getCompletedTrades() {
    const data = readLocalDb();
    return data.completed_trades || [];
  },

  async matchBuyAndCreateCompletedTrade(symbol, exitPrice, exitQty, exitTime, exitReason) {
    if (exitQty <= 0) {
      console.warn(`[COMPLETED TRADE] Rejected completed trade matchmaking for ${symbol} due to zero or negative quantity: ${exitQty}`);
      return null;
    }
    try {
      const data = readLocalDb();
      const tradeLogs = data.trade_logs || [];
      const completedTrades = data.completed_trades || [];
      
      const buyLogs = tradeLogs
        .filter(t => t.symbol === symbol && t.action === 'BUY')
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        
      if (buyLogs.length === 0) {
        console.warn(`[ANOMALY DETECTION] UNMATCHED BUY POSITION DETECTED for ${symbol} exit.`);
        return null;
      }
      
      let matchedBuy = null;
      for (const buy of buyLogs) {
        const isAlreadyMatched = completedTrades.some(ct => 
          ct.symbol === symbol && 
          new Date(ct.entry_time).getTime() === new Date(buy.timestamp).getTime()
        );
        if (!isAlreadyMatched) {
          matchedBuy = buy;
          break;
        }
      }
      
      if (!matchedBuy) {
        console.warn(`[ANOMALY DETECTION] DUPLICATE SELL DETECTED: No unmatched BUY found for ${symbol} sell.`);
        matchedBuy = buyLogs[0];
      }
      
      const entryPrice = Number(matchedBuy.price);
      const quantity = Number(exitQty || matchedBuy.quantity);
      const grossPnL = Number(((exitPrice - entryPrice) * quantity).toFixed(2));
      
      const transactionCost = Number((entryPrice * quantity * 0.0005 + exitPrice * quantity * 0.0005).toFixed(2));
      const netPnL = Number((grossPnL - transactionCost).toFixed(2));
      
      const returnPct = Number((((exitPrice - entryPrice) / entryPrice) * 100).toFixed(4));
      
      const holdingMs = new Date(exitTime) - new Date(matchedBuy.timestamp);
      const holdingMinutes = Number((holdingMs / 60000).toFixed(2));
      
      const execMode = matchedBuy.execution_mode || (matchedBuy.reason && matchedBuy.reason.includes('ADAPTIVE') ? 'ADAPTIVE' : 'INSTITUTIONAL');
      
      let tqs = 65;
      let confidence = 0.75;
      
      if (matchedBuy.reason) {
        const tqsMatch = matchedBuy.reason.match(/TQS (\d+)%/i);
        if (tqsMatch) tqs = parseInt(tqsMatch[1]);
        
        const confMatch = matchedBuy.reason.match(/confidence (0\.\d+)/i);
        if (confMatch) confidence = parseFloat(confMatch[1]);
      }

      // Calculate Execution Quality metrics (Section 8)
      let entry_efficiency = 0.85;
      let exit_efficiency = 0.80;
      let mfe = Math.max(0.01, returnPct > 0 ? returnPct * 1.15 : 0.05);
      let mae = Math.max(0.01, returnPct < 0 ? Math.abs(returnPct) * 1.10 : 0.08);

      try {
        const marketData = require('./marketData');
        const hist = await marketData.getHistory(symbol, [], '5m', '5d');
        if (hist && hist.closes && hist.closes.length > 0) {
          const maxHigh = Math.max(...hist.highs);
          const minLow = Math.min(...hist.lows);
          
          const entryHigh = entryPrice * 1.01;
          const entryLow = entryPrice * 0.99;
          const exitHigh = exitPrice * 1.01;
          const exitLow = exitPrice * 0.99;

          entry_efficiency = Number(Math.max(0, Math.min(1, 1 - Math.abs(entryPrice - entryLow) / Math.max(0.01, entryHigh - entryLow))).toFixed(4));
          exit_efficiency = Number(Math.max(0, Math.min(1, Math.abs(exitPrice - exitLow) / Math.max(0.01, exitHigh - exitLow))).toFixed(4));
          mfe = Number(Math.max(0, ((maxHigh - entryPrice) / entryPrice) * 100).toFixed(4));
          mae = Number(Math.max(0, ((entryPrice - minLow) / entryPrice) * 100).toFixed(4));
        }
      } catch (err) {
        console.warn(`[COMPLETED TRADE] Using default execution metrics for ${symbol}: ${err.message}`);
      }
      
      const completedTrade = {
        trade_id: `CT-${Date.now()}-${Math.floor(Math.random()*1000)}`,
        symbol,
        entry_time: matchedBuy.timestamp,
        exit_time: exitTime,
        entry_price: entryPrice,
        exit_price: Number(exitPrice),
        quantity,
        gross_pnl: grossPnL,
        net_pnl: netPnL,
        return_pct: returnPct,
        holding_minutes: holdingMinutes,
        exit_reason: exitReason,
        tqs,
        confidence,
        execution_mode: execMode,
        entry_efficiency,
        exit_efficiency,
        mfe,
        mae
      };
      
      await this.saveCompletedTrade(completedTrade);
      console.log(`[COMPLETED TRADE] Logged closed trade for ${symbol}: PnL ₹${netPnL.toFixed(2)} (${returnPct.toFixed(2)}%) | MFE: ${mfe}% MAE: ${mae}%`);
      return completedTrade;
    } catch (err) {
      console.error('[COMPLETED TRADE] Matchmaking failed:', err.message);
      return null;
    }
  },

  async saveCompletedTrade(trade) {
    const data = readLocalDb();
    data.completed_trades = data.completed_trades || [];
    data.completed_trades.push(trade);
    writeLocalDb(data);

    if (dbAvailable) {
      try {
        await runQuery(`
          INSERT INTO completed_trades (trade_id, symbol, entry_time, exit_time, entry_price, exit_price, quantity, gross_pnl, net_pnl, return_pct, holding_minutes, exit_reason, tqs, confidence, execution_mode, entry_efficiency, exit_efficiency, mfe, mae)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
        `, [
          trade.trade_id,
          trade.symbol,
          trade.entry_time,
          trade.exit_time,
          Number(trade.entry_price),
          Number(trade.exit_price),
          Number(trade.quantity),
          Number(trade.gross_pnl),
          Number(trade.net_pnl),
          Number(trade.return_pct),
          Number(trade.holding_minutes),
          trade.exit_reason,
          trade.tqs ? Number(trade.tqs) : null,
          trade.confidence ? Number(trade.confidence) : null,
          trade.execution_mode,
          trade.entry_efficiency ? Number(trade.entry_efficiency) : null,
          trade.exit_efficiency ? Number(trade.exit_efficiency) : null,
          trade.mfe ? Number(trade.mfe) : null,
          trade.mae ? Number(trade.mae) : null
        ]);
      } catch (e) {
        console.error('Error saving completed trade to Postgres:', e.message);
      }
    }
    return trade;
  },

  async resetSimulationData() {
    if (dbAvailable && !config.USE_LOCAL_CACHE) {
      try {
        await runQuery('DELETE FROM daily_stats');
        await runQuery('DELETE FROM trade_logs');
        await runQuery('DELETE FROM completed_trades');
        await runQuery('DELETE FROM throughput_history');
        await runQuery('DELETE FROM opportunity_tracker');
        await runQuery('DELETE FROM agent24_audit_logs');
        await runQuery('DELETE FROM agent26_market_memory');
        await runQuery('DELETE FROM threshold_history');
        await runQuery('DELETE FROM performance_metrics');
      } catch (err) {
        console.error('Error clearing Postgres tables during reset:', err.message);
      }
    }
    const data = readLocalDb();
    data.daily_stats = [];
    data.trade_logs = [];
    data.completed_trades = [];
    data.throughput_history = [];
    data.opportunity_tracker = [];
    data.agent24_audit_logs = [];
    data.agent26_market_memory = [];
    data.threshold_history = [];
    data.performance_metrics = [];
    writeLocalDb(data);
  },

  async close() {
    if (syncInterval) {
      clearInterval(syncInterval);
      syncInterval = null;
    }
    if (pool) {
      try {
        await pool.end();
      } catch (err) {}
      pool = null;
    }
    dbAvailable = false;
    localDbCache = null;
  }
};

module.exports = db;
