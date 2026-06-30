const os = require('os');

class RuntimeState {
  constructor() {
    this.state = {
      isRunning: false,
      entriesPaused: false,
      dailyLossLimitBreached: false,
      
      // Services status indicators
      services: {
        database: 'PENDING',
        telegram: 'PENDING',
        broker: 'PENDING',
        scanner: 'PENDING',
        scheduler: 'PENDING',
        websocket: 'PENDING',
        market_data: 'PENDING',
        system: 'PENDING'
      },
      
      // Market and time states
      market: {
        status: 'CLOSED', // OPEN or CLOSED
        isOpen: false,
        clock: new Date().toISOString(),
        currentDate: null,
        preMarketInitialized: false,
        finalCheckPassed: false,
        marketOpenTriggered: false,
        firstScanCompleted: false,
        firstSignalGenerated: false,
        firstTradeExecuted: false
      },
      
      // Financials
      financials: {
        capital: 12000.0,
        cash: 12000.0,
        equity_value: 0.0,
        realized_pnl: 0.0,
        unrealized_pnl: 0.0,
        daily_pnl: 0.0,
        lifetime_pnl: 0.0,
        daily_target: 1000.0,
        capital_utilization: 0.0,
        risk_exposure: 0.0
      },
      
      // Active Scanning
      scanner: {
        current_symbol: 'None',
        session_scanned_count: 0,
        today_scanned_count: 0,
        lifetime_scanned_count: 0,
        scan_speed: 0,
        last_scan_timestamp: 0,
        scanner_health: 'PAUSED'
      },
      
      // Positions and Orders
      positions: [],
      pending_orders: [],
      
      // Timeline & Audits
      timeline: [],
      auditLog: [],
      
      // System telemetry
      system: {
        version: '9.0.0',
        uptime_seconds: 0,
        memory_usage: {},
        cpu_usage: {},
        latency: 0
      }
    };
  }

  // Get complete snapshot
  getSnapshot() {
    this.state.market.clock = new Date().toISOString();
    this.state.system.uptime_seconds = Math.floor(process.uptime());
    this.state.system.memory_usage = process.memoryUsage();
    this.state.system.cpu_usage = process.cpuUsage();
    return { ...this.state };
  }

  // Generic update method
  update(path, value) {
    const keys = path.split('.');
    let current = this.state;
    for (let i = 0; i < keys.length - 1; i++) {
      if (!current[keys[i]]) current[keys[i]] = {};
      current = current[keys[i]];
    }
    current[keys[keys.length - 1]] = value;
  }

  // Update multiple values at once
  updateBatch(updates) {
    for (const [path, value] of Object.entries(updates)) {
      this.update(path, value);
    }
  }

  // Add event to timeline
  addTimelineEvent(type, message, metadata = {}) {
    const event = {
      timestamp: new Date().toISOString(),
      type,
      message,
      ...metadata
    };
    this.state.timeline.push(event);
    if (this.state.timeline.length > 100) {
      this.state.timeline.shift();
    }
    return event;
  }

  // Add audit log
  addAuditLog(symbol, action, status, details = {}) {
    const log = {
      timestamp: new Date().toISOString(),
      symbol,
      action,
      status,
      details
    };
    this.state.auditLog.push(log);
    if (this.state.auditLog.length > 100) {
      this.state.auditLog.shift();
    }
    return log;
  }
}

const runtimeState = new RuntimeState();
module.exports = runtimeState;
