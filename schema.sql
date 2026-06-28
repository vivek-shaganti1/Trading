-- Neon PostgreSQL Database Schema: AI Trading Bot Memory Layer
-- Copy and execute this script in your Neon PostgreSQL SQL Editor / Console.

-- 1. Users Table
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    email TEXT UNIQUE NOT NULL
);

-- 2. Sessions Table
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id UUID REFERENCES users(id),
    start_time TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    end_time TIMESTAMP WITH TIME ZONE,
    status TEXT NOT NULL -- 'ACTIVE', 'COMPLETED', 'LOCKED'
);

-- 3. Portfolio State Table
CREATE TABLE IF NOT EXISTS portfolio_state (
    id TEXT PRIMARY KEY, -- 'default'
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    strategy TEXT NOT NULL, -- 'DAY_TRADING', 'LONG_TERM'
    balance NUMERIC NOT NULL,
    equity_value NUMERIC NOT NULL,
    current_daily_target NUMERIC NOT NULL,
    lifetime_pnl NUMERIC NOT NULL,
    holding_stocks JSONB DEFAULT '[]'::jsonb
);

-- 4. Daily Stats Table
CREATE TABLE IF NOT EXISTS daily_stats (
    date TEXT PRIMARY KEY, -- 'YYYY-MM-DD'
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    start_capital NUMERIC NOT NULL,
    end_capital NUMERIC NOT NULL,
    net_pnl NUMERIC NOT NULL,
    daily_target NUMERIC NOT NULL,
    target_met BOOLEAN DEFAULT false,
    strategy_switched BOOLEAN DEFAULT false,
    status TEXT NOT NULL -- 'ACTIVE', 'LIFETIME_FLOOR_BREACHED'
);

-- 5. Trade Logs Table
CREATE TABLE IF NOT EXISTS trade_logs (
    id TEXT PRIMARY KEY,
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
    symbol TEXT NOT NULL,
    action TEXT NOT NULL, -- 'BUY', 'SELL'
    strategy TEXT NOT NULL,
    quantity NUMERIC NOT NULL,
    price NUMERIC NOT NULL,
    total_value NUMERIC NOT NULL,
    reason TEXT
);

-- 6. Prediction Logs Table
CREATE TABLE IF NOT EXISTS prediction_logs (
    id TEXT PRIMARY KEY,
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
    symbol TEXT NOT NULL,
    signal TEXT NOT NULL, -- 'BUY', 'SELL', 'HOLD'
    model_source INTEGER NOT NULL, -- stage index (1 or 3)
    consensus BOOLEAN DEFAULT false,
    custom_signal TEXT NOT NULL, -- Agent 1
    kraken_signal TEXT NOT NULL, -- Agent 3
    debate_summary TEXT,
    entry_price NUMERIC,
    exit_price NUMERIC,
    pnl NUMERIC
);

-- 7. Model Weights Table
CREATE TABLE IF NOT EXISTS model_weights (
    id TEXT PRIMARY KEY, -- 'default'
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    agent1_weight NUMERIC NOT NULL,
    agent2_weight NUMERIC NOT NULL,
    agent3_weight NUMERIC NOT NULL,
    agent4_weight NUMERIC NOT NULL,
    ema_weight NUMERIC NOT NULL,
    rsi_weight NUMERIC NOT NULL,
    macd_weight NUMERIC NOT NULL,
    rsi_threshold NUMERIC NOT NULL,
    adaptation_count INTEGER NOT NULL,
    neural_model_weights JSONB NOT NULL
);

-- 8. Consensus Decisions Table
CREATE TABLE IF NOT EXISTS consensus_decisions (
    id TEXT PRIMARY KEY,
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
    symbol TEXT NOT NULL,
    decision TEXT NOT NULL, -- 'BUY', 'SELL', 'HOLD'
    confidence NUMERIC NOT NULL,
    participating_models JSONB NOT NULL,
    debate_summary TEXT,
    final_outcome TEXT,
    result_after_closes NUMERIC
);

-- 9. Telegram Commands Table
CREATE TABLE IF NOT EXISTS telegram_commands (
    id TEXT PRIMARY KEY,
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
    command TEXT NOT NULL,
    parameters JSONB DEFAULT '{}'::jsonb,
    applied BOOLEAN DEFAULT true
);

-- 10. Risk Events Table
CREATE TABLE IF NOT EXISTS risk_events (
    id TEXT PRIMARY KEY,
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
    event_type TEXT NOT NULL, -- 'DAILY_STOP_LOSS', 'LIFETIME_FLOOR_BREACH', etc.
    description TEXT NOT NULL,
    portfolio_value NUMERIC NOT NULL,
    details JSONB DEFAULT '{}'::jsonb
);

-- 11. Alerts Table
CREATE TABLE IF NOT EXISTS alerts (
    id TEXT PRIMARY KEY,
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
    type TEXT NOT NULL, -- 'telegram', 'email', 'system'
    message TEXT NOT NULL,
    status TEXT NOT NULL -- 'SENT', 'FAILED', 'MOCKED'
);

-- 12. Learning Feedback Table
CREATE TABLE IF NOT EXISTS learning_feedback (
    id TEXT PRIMARY KEY,
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
    prediction_id TEXT NOT NULL,
    pnl NUMERIC NOT NULL,
    learning_rate NUMERIC NOT NULL,
    weights_before JSONB NOT NULL,
    weights_after JSONB NOT NULL
);

-- 13. Agent Memory Table
CREATE TABLE IF NOT EXISTS agent_memory (
    id TEXT PRIMARY KEY, -- 'default'
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    paper_trading_stats JSONB NOT NULL,
    winning_patterns JSONB DEFAULT '[]'::jsonb,
    losing_patterns JSONB DEFAULT '[]'::jsonb,
    user_instructions JSONB DEFAULT '{}'::jsonb
);

-- 14. Paper Trading Results Table
CREATE TABLE IF NOT EXISTS paper_trading_results (
    id TEXT PRIMARY KEY, -- 'default'
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    trading_days_tracked INTEGER NOT NULL DEFAULT 0,
    win_rate NUMERIC NOT NULL DEFAULT 0.00,
    profit_factor NUMERIC NOT NULL DEFAULT 1.00,
    sharpe_ratio NUMERIC NOT NULL DEFAULT 0.00,
    max_drawdown NUMERIC NOT NULL DEFAULT 0.00,
    accuracy NUMERIC NOT NULL DEFAULT 0.00,
    net_pnl NUMERIC NOT NULL DEFAULT 0.00,
    details JSONB DEFAULT '{}'::jsonb
);

-- 15. Daily Model Performance Table
CREATE TABLE IF NOT EXISTS daily_model_performance (
    date TEXT PRIMARY KEY, -- 'YYYY-MM-DD'
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    agent1_accuracy NUMERIC NOT NULL DEFAULT 0.00,
    agent2_accuracy NUMERIC NOT NULL DEFAULT 0.00,
    agent3_accuracy NUMERIC NOT NULL DEFAULT 0.00,
    agent4_accuracy NUMERIC NOT NULL DEFAULT 0.00,
    consensus_accuracy NUMERIC NOT NULL DEFAULT 0.00,
    total_predictions INTEGER NOT NULL DEFAULT 0,
    details JSONB DEFAULT '{}'::jsonb
);

-- 16. Completed Trades Table
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
);

-- Index optimizations for rapid audits and logs querying
CREATE INDEX IF NOT EXISTS idx_trade_logs_timestamp ON trade_logs(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_prediction_logs_timestamp ON prediction_logs(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_consensus_decisions_timestamp ON consensus_decisions(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_risk_events_timestamp ON risk_events(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_learning_feedback_timestamp ON learning_feedback(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_daily_model_performance_date ON daily_model_performance(date DESC);
CREATE INDEX IF NOT EXISTS idx_completed_trades_timestamp ON completed_trades(exit_time DESC);
