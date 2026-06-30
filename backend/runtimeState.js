'use strict';

/**
 * AGY Trader V10.1 — Runtime State Manager
 * Single source of truth for ALL system state.
 * Nothing computes independently. Everything reads from here.
 */
class RuntimeState {
  constructor() {
    this.state = {
      // ── Top-level flags ─────────────────────────────────────────────────
      isRunning: false,
      entriesPaused: false,
      dailyLossLimitBreached: false,

      // ── Service health indicators ────────────────────────────────────────
      services: {
        database:    'PENDING',
        telegram:    'PENDING',
        broker:      'PENDING',
        scanner:     'PENDING',
        scheduler:   'PENDING',
        websocket:   'ONLINE',
        market_data: 'PENDING',
        system:      'PENDING'
      },

      // ── Market & time state ───────────────────────────────────────────────
      market: {
        status: 'CLOSED',
        isOpen: false,
        clock: new Date().toISOString(),
        currentDate: null,
        preMarketInitialized: false,
        finalCheckPassed:     false,
        marketOpenTriggered:  false,
        firstScanCompleted:   false,
        firstSignalGenerated: false,
        firstTradeExecuted:   false
      },

      // ── Scheduler phase ──────────────────────────────────────────────────
      scheduler: {
        current_phase:    'MARKET_CLOSED', // PREMARKET|SCANNING|TRADING|EOD|MARKET_CLOSED
        market_open_at:   null,
        market_close_at:  null,
        next_event_at:    null,
        last_tick_at:     null,
        tick_count_today: 0
      },

      // ── Financials ────────────────────────────────────────────────────────
      financials: {
        capital:             12000.0,
        cash:                12000.0,
        equity_value:        0.0,
        total_value:         12000.0,
        realized_pnl:        0.0,
        unrealized_pnl:      0.0,
        net_pnl:             0.0,
        daily_pnl:           0.0,
        lifetime_pnl:        0.0,
        daily_target:        1000.0,
        daily_stop_loss:     0.0,
        lifetime_floor:      8000.0,
        capital_utilization: 0.0,
        risk_exposure:       0.0
      },

      // ── Scanner telemetry ────────────────────────────────────────────────
      scanner: {
        current_symbol:         'None',
        session_scanned_count:  0,
        today_scanned_count:    0,
        lifetime_scanned_count: 0,
        scan_speed:             0,
        last_scan_timestamp:    0,
        scanner_health:         'PAUSED'
      },

      // ── Buy Funnel Stage Counters ─────────────────────────────────────────
      funnel: {
        universe_total:    0,
        stage1_scanned:    0,
        stage2_tqs_passed: 0,
        stage3_technical:  0,
        stage4_confidence: 0,
        stage5_risk:       0,
        stage6_consensus:  0,
        stage7_submitted:  0,
        stage8_filled:     0,
        last_rejected:     [],
        last_updated:      null
      },

      // ── Per-symbol pipeline log ───────────────────────────────────────────
      pipeline_log: [],

      // ── Open positions and pending orders ────────────────────────────────
      positions: [],
      pending_orders: [],

      // ── Real performance metrics ──────────────────────────────────────────
      performance: {
        today_trades:              0,
        today_wins:                0,
        today_losses:              0,
        today_win_rate:            0,
        today_realized_pnl:        0,
        today_profit_factor:       0,
        today_sharpe:              0,
        lifetime_trades:           0,
        lifetime_win_rate:         0,
        avg_fill_slippage_pct:     0,
        avg_execution_latency_ms:  0,
        latency_samples:           [],
        slippage_samples:          []
      },

      // ── Provider health (real measured latencies) ─────────────────────────
      provider_health: {
        gemini:  { latency_ms: null, success_rate: null, calls: 0, errors: 0, last_call: null },
        groq:    { latency_ms: null, success_rate: null, calls: 0, errors: 0, last_call: null },
        yahoo:   { latency_ms: null, success_rate: null, calls: 0, errors: 0, last_call: null },
        zerodha: { latency_ms: null, success_rate: null, calls: 0, errors: 0, last_call: null }
      },

      // ── Timeline & audit log ──────────────────────────────────────────────
      timeline: [],
      auditLog: [],

      // ── System telemetry ──────────────────────────────────────────────────
      system: {
        version:        '10.1.0',
        uptime_seconds: 0,
        memory_usage:   {},
        cpu_usage:      {},
        latency:        0
      }
    };
  }

  // ── Read ──────────────────────────────────────────────────────────────────

  getSnapshot() {
    this.state.market.clock          = new Date().toISOString();
    this.state.system.uptime_seconds = Math.floor(process.uptime());
    this.state.system.memory_usage   = process.memoryUsage();
    this.state.system.cpu_usage      = process.cpuUsage();
    return { ...this.state };
  }

  // ── Write ─────────────────────────────────────────────────────────────────

  update(path, value) {
    const keys = path.split('.');
    let current = this.state;
    for (let i = 0; i < keys.length - 1; i++) {
      if (!current[keys[i]]) current[keys[i]] = {};
      current = current[keys[i]];
    }
    current[keys[keys.length - 1]] = value;
  }

  updateBatch(updates) {
    for (const [path, value] of Object.entries(updates)) {
      this.update(path, value);
    }
  }

  /** Atomic update of all funnel stage counters in one call. */
  updateFunnel(counts) {
    Object.assign(this.state.funnel, counts, { last_updated: new Date().toISOString() });
  }

  /**
   * Add a real rejected candidate to the funnel modal data.
   * Replaces the hardcoded mockRejections in dashboard.js.
   */
  addRejectedCandidate(symbol, stage, reason, meta = {}) {
    this.state.funnel.last_rejected.unshift({
      timestamp: new Date().toISOString(),
      symbol,
      stage,
      reason,
      ...meta
    });
    if (this.state.funnel.last_rejected.length > 20) {
      this.state.funnel.last_rejected.length = 20;
    }
  }

  /** Push a per-symbol pipeline entry (drives the funnel stage detail modal). */
  addPipelineEntry(entry) {
    this.state.pipeline_log.unshift({
      timestamp: new Date().toISOString(),
      ...entry
    });
    if (this.state.pipeline_log.length > 50) {
      this.state.pipeline_log.length = 50;
    }
  }

  /** Update real performance metrics computed from actual trade records. */
  updatePerformance(metrics) {
    Object.assign(this.state.performance, metrics);
  }

  /**
   * Record a real API provider call result.
   * Uses exponential smoothing (alpha=0.2) for latency rolling average.
   */
  updateProviderHealth(provider, latencyMs, success) {
    const p = this.state.provider_health[provider];
    if (!p) return;
    p.calls++;
    if (!success) p.errors++;
    p.last_call = new Date().toISOString();
    p.latency_ms = p.latency_ms === null
      ? latencyMs
      : Math.round(p.latency_ms * 0.8 + latencyMs * 0.2);
    p.success_rate = Math.round(((p.calls - p.errors) / p.calls) * 100);
  }

  /**
   * Record a confirmed fill event.
   * @param {number} slippagePct - real (fillPrice - scannerPrice) / scannerPrice * 100
   * @param {number} latencyMs   - real ms from signal generation to DB write
   */
  recordFill(slippagePct, latencyMs) {
    const p = this.state.performance;
    p.slippage_samples.push(slippagePct);
    if (p.slippage_samples.length > 20) p.slippage_samples.shift();
    p.avg_fill_slippage_pct = parseFloat(
      (p.slippage_samples.reduce((a, b) => a + b, 0) / p.slippage_samples.length).toFixed(4)
    );
    p.latency_samples.push(latencyMs);
    if (p.latency_samples.length > 20) p.latency_samples.shift();
    p.avg_execution_latency_ms = Math.round(
      p.latency_samples.reduce((a, b) => a + b, 0) / p.latency_samples.length
    );
  }

  // ── Events ────────────────────────────────────────────────────────────────

  addTimelineEvent(type, message, metadata = {}) {
    const event = {
      timestamp: new Date().toISOString(),
      type,
      message,
      ...metadata
    };
    this.state.timeline.push(event);
    if (this.state.timeline.length > 100) this.state.timeline.shift();
    return event;
  }

  addAuditLog(symbol, action, status, details = {}) {
    const log = {
      timestamp: new Date().toISOString(),
      symbol,
      action,
      status,
      details
    };
    this.state.auditLog.push(log);
    if (this.state.auditLog.length > 100) this.state.auditLog.shift();
    return log;
  }
}

const runtimeState = new RuntimeState();
module.exports = runtimeState;
