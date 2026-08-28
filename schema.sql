-- =============================================================================
-- AGY-TRADER — PostgreSQL schema (Neon)
-- =============================================================================
-- RECONCILED AGAINST THE CODE, not hand-written from intent.
--
-- Every column below was derived from the actual INSERT statements in
-- backend/db.js. The previous schema.sql disagreed with the code on TWELVE
-- tables — eight were missing columns the code writes, and two tables were
-- absent entirely. Because the runtime uses CREATE TABLE IF NOT EXISTS, a
-- wrong-shaped table is never repaired, so those INSERTs failed silently
-- forever: every affected record stayed synced=false and never left the local
-- cache.
--
-- Conflict targets (id / date / trade_id) are declared PRIMARY KEY or UNIQUE
-- because db.js relies on ON CONFLICT upserts against exactly those columns.
--
-- Money is NUMERIC, never FLOAT. Timestamps are TIMESTAMPTZ so the IST/UTC
-- distinction is explicit rather than implied.
-- =============================================================================

-- ── Singletons ───────────────────────────────────────────────────────────────
-- One row each, keyed 'default'. Upserted via ON CONFLICT (id).

CREATE TABLE IF NOT EXISTS portfolio_state (
  id                   TEXT PRIMARY KEY,
  strategy             TEXT,
  balance              NUMERIC(18,2),
  equity_value         NUMERIC(18,2),
  current_daily_target NUMERIC(18,2),
  lifetime_pnl         NUMERIC(18,2),
  holding_stocks       JSONB,
  -- Baseline that lifetime P&L is measured against. Captured once on first
  -- live connect; without it P&L was computed against a hardcoded 12000.
  capital_baseline     NUMERIC(18,2),
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS model_weights (
  id                   TEXT PRIMARY KEY,
  agent1_weight        NUMERIC(8,4),
  agent2_weight        NUMERIC(8,4),
  agent3_weight        NUMERIC(8,4),
  agent4_weight        NUMERIC(8,4),
  ema_weight           NUMERIC(8,4),
  rsi_weight           NUMERIC(8,4),
  macd_weight          NUMERIC(8,4),
  rsi_threshold        NUMERIC(8,4),
  adaptation_count     INTEGER DEFAULT 0,
  neural_model_weights JSONB,
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent_memory (
  id                   TEXT PRIMARY KEY,
  paper_trading_stats  JSONB,
  winning_patterns     JSONB,
  losing_patterns      JSONB,
  user_instructions    JSONB,
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS paper_trading_results (
  id                   TEXT PRIMARY KEY,
  trading_days_tracked INTEGER DEFAULT 0,
  win_rate             NUMERIC(8,4),
  profit_factor        NUMERIC(10,4),
  sharpe_ratio         NUMERIC(10,4),
  max_drawdown         NUMERIC(10,4),
  accuracy             NUMERIC(8,4),
  net_pnl              NUMERIC(18,2),
  details              JSONB,
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS scanner_rankings (
  id         SERIAL PRIMARY KEY,
  longs      JSONB,
  shorts     JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Orders and positions ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS trade_logs (
  id              TEXT PRIMARY KEY,
  timestamp       TIMESTAMPTZ NOT NULL,
  symbol          TEXT NOT NULL,
  action          TEXT NOT NULL,
  strategy        TEXT,
  quantity        NUMERIC(18,4),
  price           NUMERIC(18,4),
  total_value     NUMERIC(18,2),
  reason          TEXT,
  execution_mode  TEXT,
  -- Execution provenance. Without these it is impossible to tell afterwards
  -- which rows were real money and which were paper, or to measure slippage:
  -- `price` used to be a pre-trade quote, not the broker's average fill.
  venue           TEXT,
  broker_order_id TEXT,
  quote_price     NUMERIC(18,4),
  slippage_pct    NUMERIC(10,4),
  synced          BOOLEAN DEFAULT TRUE
);
CREATE INDEX IF NOT EXISTS idx_trade_logs_ts     ON trade_logs (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_trade_logs_symbol ON trade_logs (symbol);

CREATE TABLE IF NOT EXISTS completed_trades (
  id                SERIAL PRIMARY KEY,
  trade_id          TEXT UNIQUE,
  symbol            TEXT NOT NULL,
  entry_time        TIMESTAMPTZ,
  exit_time         TIMESTAMPTZ,
  entry_price       NUMERIC(18,4),
  exit_price        NUMERIC(18,4),
  quantity          NUMERIC(18,4),
  gross_pnl         NUMERIC(18,2),
  net_pnl           NUMERIC(18,2),
  return_pct        NUMERIC(10,4),
  holding_minutes   INTEGER,
  exit_reason       TEXT,
  tqs               NUMERIC(8,2),
  confidence        NUMERIC(8,4),
  execution_mode    TEXT,
  entry_efficiency  NUMERIC(8,4),
  exit_efficiency   NUMERIC(8,4),
  mfe               NUMERIC(18,4),
  mae               NUMERIC(18,4),
  synced            BOOLEAN DEFAULT TRUE
);
CREATE INDEX IF NOT EXISTS idx_completed_exit ON completed_trades (exit_time DESC);

CREATE TABLE IF NOT EXISTS shadow_trades (
  id                TEXT PRIMARY KEY,
  timestamp         TIMESTAMPTZ,
  symbol            TEXT,
  entry_price       NUMERIC(18,4),
  current_price     NUMERIC(18,4),
  quantity          NUMERIC(18,4),
  confidence        NUMERIC(8,4),
  tqs               NUMERIC(8,2),
  opportunity_score NUMERIC(10,4),
  status            TEXT,
  pnl               NUMERIC(18,2),
  return_pct        NUMERIC(10,4)
);

-- ── Daily accounting ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS daily_stats (
  date              TEXT PRIMARY KEY,
  start_capital     NUMERIC(18,2),
  end_capital       NUMERIC(18,2),
  net_pnl           NUMERIC(18,2),
  daily_target      NUMERIC(18,2),
  target_met        BOOLEAN DEFAULT FALSE,
  strategy_switched BOOLEAN DEFAULT FALSE,
  status            TEXT,
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS daily_model_performance (
  date              TEXT PRIMARY KEY,
  agent1_accuracy   NUMERIC(8,4),
  agent2_accuracy   NUMERIC(8,4),
  agent3_accuracy   NUMERIC(8,4),
  agent4_accuracy   NUMERIC(8,4),
  consensus_accuracy NUMERIC(8,4),
  total_predictions INTEGER,
  details           JSONB,
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS performance_metrics (
  date                TEXT PRIMARY KEY,
  expected_profit     NUMERIC(18,2),
  profit_factor       NUMERIC(10,4),
  sharpe_ratio        NUMERIC(10,4),
  max_drawdown        NUMERIC(10,4),
  winning_symbols     JSONB,
  losing_symbols      JSONB,
  capital_utilization NUMERIC(8,4)
);

CREATE TABLE IF NOT EXISTS eod_report_state (
  date    TEXT PRIMARY KEY,
  sent    BOOLEAN DEFAULT FALSE,
  sent_at TIMESTAMPTZ
);

-- ── Signals, decisions and telemetry ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS prediction_logs (
  id             TEXT PRIMARY KEY,
  timestamp      TIMESTAMPTZ,
  symbol         TEXT,
  signal         TEXT,
  model_source   TEXT,
  consensus      TEXT,
  custom_signal  TEXT,
  kraken_signal  TEXT,
  debate_summary TEXT,
  entry_price    NUMERIC(18,4),
  exit_price     NUMERIC(18,4),
  pnl            NUMERIC(18,2)
);
CREATE INDEX IF NOT EXISTS idx_prediction_ts ON prediction_logs (timestamp DESC);

CREATE TABLE IF NOT EXISTS consensus_decisions (
  id                  TEXT PRIMARY KEY,
  timestamp           TIMESTAMPTZ,
  symbol              TEXT,
  decision            TEXT,
  confidence          NUMERIC(8,4),
  participating_models JSONB,
  debate_summary      TEXT,
  final_outcome       TEXT,
  result_after_closes NUMERIC(10,4),
  -- Forward-reference prices used to score a decision after the fact.
  ref_15m             NUMERIC(18,4),
  ref_30m             NUMERIC(18,4),
  ref_1h              NUMERIC(18,4),
  ref_eod             NUMERIC(18,4)
);
CREATE INDEX IF NOT EXISTS idx_consensus_ts ON consensus_decisions (timestamp DESC);

CREATE TABLE IF NOT EXISTS opportunity_tracker (
  id                 SERIAL PRIMARY KEY,
  symbol             TEXT,
  current_price      NUMERIC(18,4),
  confidence         NUMERIC(8,4),
  tqs                NUMERIC(8,2),
  consensus_score    NUMERIC(10,4),
  buy_votes          INTEGER,
  sell_votes         INTEGER,
  hold_votes         INTEGER,
  agent_count        INTEGER,
  signal_type        TEXT,
  rejection_reason   TEXT,
  scan_timestamp     TIMESTAMPTZ,
  opportunity_score  NUMERIC(10,4),
  status             TEXT,
  participating_models JSONB,
  debate_summary     TEXT
);
CREATE INDEX IF NOT EXISTS idx_opportunity_scan ON opportunity_tracker (scan_timestamp DESC);

CREATE TABLE IF NOT EXISTS throughput_history (
  id                SERIAL PRIMARY KEY,
  timestamp         TIMESTAMPTZ,
  scanned           INTEGER,
  researched        INTEGER,
  ranked            INTEGER,
  scored            INTEGER,
  candidates        INTEGER,
  consensus         INTEGER,
  executed          INTEGER,
  passed_risk       INTEGER,
  rejection_reasons JSONB
);

CREATE TABLE IF NOT EXISTS threshold_history (
  id              SERIAL PRIMARY KEY,
  threshold       NUMERIC(8,2),
  regime          TEXT,
  volatility      TEXT,
  sector_strength NUMERIC(8,4),
  reasoning       TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── Operational log ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS alerts (
  id        TEXT PRIMARY KEY,
  timestamp TIMESTAMPTZ,
  type      TEXT,
  message   TEXT,
  status    TEXT
);
CREATE INDEX IF NOT EXISTS idx_alerts_ts ON alerts (timestamp DESC);

CREATE TABLE IF NOT EXISTS risk_events (
  id              TEXT PRIMARY KEY,
  timestamp       TIMESTAMPTZ,
  event_type      TEXT,
  description     TEXT,
  portfolio_value NUMERIC(18,2),
  details         JSONB
);

CREATE TABLE IF NOT EXISTS telegram_commands (
  id         TEXT PRIMARY KEY,
  timestamp  TIMESTAMPTZ,
  command    TEXT,
  parameters JSONB,
  applied    BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  status     TEXT,
  start_time TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS learning_feedback (
  id             TEXT PRIMARY KEY,
  timestamp      TIMESTAMPTZ,
  prediction_id  TEXT,
  pnl            NUMERIC(18,2),
  learning_rate  NUMERIC(10,6),
  weights_before JSONB,
  weights_after  JSONB
);

-- ── Agent subsystems ─────────────────────────────────────────────────────────
-- These are the tables the old schema got wrong. Columns below match the
-- INSERTs in db.js exactly.

CREATE TABLE IF NOT EXISTS agent20_reports (
  id                SERIAL PRIMARY KEY,
  trade_id          TEXT,
  symbol            TEXT,
  entry_reason      TEXT,
  exit_reason       TEXT,
  supporting_agents JSONB,
  opposing_agents   JSONB,
  market_conditions JSONB,
  outcome           TEXT,
  lessons_learned   TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent21_trust_logs (
  id             SERIAL PRIMARY KEY,
  weights_before JSONB,
  weights_after  JSONB,
  adjustments    JSONB,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent22_research_logs (
  id               SERIAL PRIMARY KEY,
  regime           TEXT,
  sector           TEXT,
  volatility       TEXT,
  momentum         TEXT,
  improvements     JSONB,
  backtest_results JSONB,
  deployed         BOOLEAN DEFAULT FALSE,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent23_journals (
  id              SERIAL PRIMARY KEY,
  trade_id        TEXT,
  symbol          TEXT,
  entry_thesis    TEXT,
  exit_thesis     TEXT,
  outcome         TEXT,
  mistakes        TEXT,
  success_factors TEXT,
  lessons         TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent24_audit_logs (
  id                 SERIAL PRIMARY KEY,
  symbol             TEXT,
  tqs                NUMERIC(8,2),
  rejection_reason   TEXT,
  price_at_rejection NUMERIC(18,4),
  current_price      NUMERIC(18,4),
  return_pct         NUMERIC(10,4),
  ref_15m            NUMERIC(18,4),
  ref_30m            NUMERIC(18,4),
  ref_1h             NUMERIC(18,4),
  ref_eod            NUMERIC(18,4),
  completed          BOOLEAN DEFAULT FALSE,
  created_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent25_sizing_logs (
  id                SERIAL PRIMARY KEY,
  symbol            TEXT,
  sector            TEXT,
  tqs_band          TEXT,
  regime            TEXT,
  expectancy        NUMERIC(10,4),
  current_alloc     NUMERIC(8,4),
  recommended_alloc NUMERIC(8,4),
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent26_market_memory (
  id             SERIAL PRIMARY KEY,
  symbol         TEXT,
  signal         TEXT,
  feature_vector JSONB,
  outcome_pnl    NUMERIC(18,2),
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS nightly_learning_reports (
  id                    SERIAL PRIMARY KEY,
  metrics               JSONB,
  missed_opportunities  JSONB,
  sizing_recommendations JSONB,
  learning_log          TEXT,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);
