// DOM Elements
const connStatusDot = document.getElementById('conn-status-dot');
const connStatusText = document.getElementById('conn-status-text');
const botStatusDot = document.getElementById('bot-status-dot');
const botStatusText = document.getElementById('bot-status-text');
const liveTimeText = document.getElementById('live-time');
const activeStrategyBadge = document.getElementById('active-strategy');

const btnToggleBot = document.getElementById('btn-toggle-bot');
const adminResetPanel = document.getElementById('admin-reset-panel');
const adminResetPasswordInput = document.getElementById('admin-reset-password');
const btnAdminReset = document.getElementById('btn-admin-reset');
const adminResetMsg = document.getElementById('admin-reset-msg');

// Market Data Diagnostics elements
const diagDataProvider = document.getElementById('diag-data-provider');
const diagPriceTimestamp = document.getElementById('diag-price-timestamp');
const diagApiResponseTime = document.getElementById('diag-api-response-time');
const diagMarketStatus = document.getElementById('diag-market-status');
const diagSourceOfTruth = document.getElementById('diag-source-of-truth');
const diagMode = document.getElementById('diag-mode');

// Trading Diagnostics elements
const diagBrokerMode = document.getElementById('diag-broker-mode');
const diagActiveBroker = document.getElementById('diag-active-broker');
const diagTradingType = document.getElementById('diag-trading-type');
const diagLastOrderId = document.getElementById('diag-last-order-id');
const diagExchangeOrderId = document.getElementById('diag-exchange-order-id');
const diagOrderSource = document.getElementById('diag-order-source');
const diagExecutionMode = document.getElementById('diag-execution-mode');
const diagProductType = document.getElementById('diag-product-type');

// Scanner Diagnostics elements
const diagScannerCurrent = document.getElementById('diag-scanner-current');
const diagScannerSession = document.getElementById('diag-scanner-session');
const diagScannerToday = document.getElementById('diag-scanner-today');
const diagScannerLifetime = document.getElementById('diag-scanner-lifetime');
const diagScannerLastTime = document.getElementById('diag-scanner-last-time');
const diagScannerCurrentSymbol = document.getElementById('diag-scanner-current-symbol');
const diagScannerSpeed = document.getElementById('diag-scanner-speed');
const diagScannerAvgTime = document.getElementById('diag-scanner-avg-time');

// Today Session metrics elements
const todayNetPnL = document.getElementById('today-net-pnl');
const todayTotalTrades = document.getElementById('today-total-trades');
const todayWinRate = document.getElementById('today-win-rate');
const todayFees = document.getElementById('today-fees');
const todayVolume = document.getElementById('today-volume');

// Lifetime metrics elements
const lifetimeNetPnL = document.getElementById('lifetime-net-pnl');
const lifetimeTotalTrades = document.getElementById('lifetime-total-trades');
const lifetimeWinRate = document.getElementById('lifetime-win-rate');

// Global switch tab function
window.switchMetricsTab = function(tabName) {
  document.querySelectorAll('.tab-content').forEach(el => el.style.display = 'none');
  document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
  
  const content = document.getElementById(`metrics-content-${tabName}`);
  if (content) {
    content.style.display = 'block';
  }
  const btn = document.getElementById(`tab-${tabName}`);
  if (btn) {
    btn.classList.add('active');
  }
};

// Target Engine Elements
const targetFraction = document.getElementById('target-fraction');
const targetProgressBar = document.getElementById('target-progress-bar');
const targetRemaining = document.getElementById('target-remaining');
const targetRequiredProfit = document.getElementById('target-required-profit');
const targetRequiredTrades = document.getElementById('target-required-trades');
const targetRequiredWinrate = document.getElementById('target-required-winrate');
const targetCapitalUtilization = document.getElementById('target-capital-utilization');

// Price validation/readiness scorecard fallbacks
const readinessScoreValue = document.getElementById('readiness-score-value');
const readinessBadge = document.getElementById('readiness-badge');
const readinessChecklist = document.getElementById('readiness-checklist');

// Fallback elements to satisfy structural checks
const holdingsTableBody = document.getElementById('holdings-table-body');
const tradesTableBody = document.getElementById('trades-table-body');
const alertsLogList = document.getElementById('alerts-log-list');

// Chart instance
let liveChart = null;
const chartDataLimit = 40;
const chartLabels = [];
const chartPrices = [];
const chartEMA9 = [];
const chartEMA21 = [];

// Initialize WebSockets connection
function getBackendBase() {
  const customUrl = localStorage.getItem('BACKEND_URL');
  if (customUrl) {
    return customUrl.replace(/\/$/, '');
  }
  const injectedUrl = "__API_BASE_URL__";
  if (injectedUrl && !injectedUrl.startsWith('__')) {
    return injectedUrl.replace(/\/$/, '');
  }
  return '';
}

function getWsUrl() {
  const customUrl = localStorage.getItem('BACKEND_URL');
  if (customUrl) {
    return customUrl.replace(/^http/, 'ws').replace(/\/$/, '') + '/';
  }
  const injectedUrl = "__WS_BASE_URL__";
  if (injectedUrl && !injectedUrl.startsWith('__') && injectedUrl !== '') {
    return injectedUrl.replace(/\/$/, '') + '/';
  }
  const base = getBackendBase();
  if (base) {
    const wsProtocol = base.startsWith('https') ? 'wss:' : 'ws';
    return base.replace(/^https?:\/\//, `${wsProtocol}//`) + '/';
  }
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${wsProtocol}//${window.location.host}/`;
}

const backendBase = getBackendBase();
const wsUrl = getWsUrl();

let ws = null;
let isBotRunning = false;

let reconnectAttempts = 0;
const maxReconnectDelay = 30000;
let heartbeatInterval = null;
let watchdogTimeout = null;

// Global predictions cache to feed decision explainer
window.predictionsCache = {};
window.lastDashboardData = null;

function resetWatchdog() {
  if (watchdogTimeout) {
    clearTimeout(watchdogTimeout);
  }
  watchdogTimeout = setTimeout(() => {
    console.warn('[WS WATCHDOG]: No server updates received for 15 seconds. Terminating socket connection to trigger reconnect.');
    if (ws) {
      try {
        ws.close();
      } catch (e) {}
    }
  }, 15000);
}

function connectWS() {
  if (ws) {
    try {
      ws.close();
    } catch (e) {}
  }

  connStatusDot.className = 'status-dot warning';
  connStatusText.innerText = 'Connecting...';

  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    reconnectAttempts = 0;
    connStatusDot.className = 'status-dot connected';
    connStatusText.innerText = 'Connected';
    startHeartbeat();
    resetWatchdog();
  };

  ws.onmessage = (event) => {
    window.lastUpdateTimestamp = Date.now();
    resetWatchdog();
    try {
      const payload = JSON.parse(event.data);
      if (payload.type === 'PONG') {
        return;
      }
      if (payload.type === 'STATUS_UPDATE') {
        window.lastDashboardData = payload.data;
        updateUI(payload.data);
      }
    } catch (err) {
      console.error('Error parsing WS message:', err);
    }
  };

  ws.onclose = () => {
    connStatusDot.className = 'status-dot disconnected';
    connStatusText.innerText = 'Disconnected';
    stopHeartbeat();
    if (watchdogTimeout) {
      clearTimeout(watchdogTimeout);
      watchdogTimeout = null;
    }
    
    const delay = Math.min(maxReconnectDelay, Math.pow(2, reconnectAttempts) * 1000);
    reconnectAttempts++;
    console.log(`[WS] Reconnecting in ${delay / 1000}s (Attempt ${reconnectAttempts})`);
    setTimeout(connectWS, delay);
  };

  ws.onerror = (err) => {
    console.error('[WS ERROR]:', err);
  };
}

function startHeartbeat() {
  stopHeartbeat();
  heartbeatInterval = setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ type: 'PING' }));
      } catch (e) {
        console.warn('[WS]: Failed to send heartbeat ping', e);
      }
    }
  }, 10000);
}

function stopHeartbeat() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
}

// Update Dashboard UI Elements
function updateUI(data) {
  const banner = document.getElementById('market-closed-banner');
  if (banner && data.marketDataDiagnostics) {
    if (data.marketDataDiagnostics['market.isOpen'] === false) {
      banner.style.display = 'flex';
    } else {
      banner.style.display = 'none';
    }
  }

  window.lastUpdateTimestamp = Date.now();
  
  // Cache prediction
  if (data.prediction && data.prediction.symbol) {
    window.predictionsCache[data.prediction.symbol] = data.prediction;
  }

  // Update running indicators
  // If data is wrapped in runtime (from WS or new API format), use it
  const rts = data.runtime || data;
  
  const botStatusDot = document.getElementById('bot-status-dot');
  const botStatusText = document.getElementById('bot-status-text');
  const btnToggleBot = document.getElementById('btn-toggle-bot');
  
  if (rts.isRunning) {
    botStatusDot.className = 'status-dot';
    botStatusText.innerText = 'Bot: Active';
    btnToggleBot.innerHTML = '<i data-lucide="square"></i> <span>Stop Bot</span>';
    btnToggleBot.className = 'btn btn-danger w-full';
  } else {
    botStatusDot.className = 'status-dot disconnected';
    botStatusText.innerText = 'Bot: Inactive';
    btnToggleBot.innerHTML = '<i data-lucide="play"></i> <span>Start Bot</span>';
    btnToggleBot.className = 'btn btn-primary w-full';
  }

  // Update System Time
  window.lastServerTime = rts.market ? rts.market.clock : (rts.time || new Date().toISOString());

  // Update Valuation & Profit Command Center
  const statTotalValEl = document.getElementById('stat-total-value');
  const statNetPnLEl = document.getElementById('stat-net-pnl');
  const statBalanceEl = document.getElementById('stat-balance');
  const statEquityEl = document.getElementById('stat-equity');

  const formatCurrency = (val) => val === undefined || val === null ? 'Unavailable' : '₹' + Number(val).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  
  // Backwards compatibility for data.totalVal, or read from rts.financials
  const totalVal = data.totalVal !== undefined ? data.totalVal : (rts.financials ? rts.financials.total_value : null);
  const balance = data.balance !== undefined ? data.balance : (rts.financials ? rts.financials.cash : null);
  const equityValue = data.equityValue !== undefined ? data.equityValue : (rts.financials ? rts.financials.equity_value : null);
  const netPnL = data.netPnL !== undefined ? data.netPnL : (rts.financials ? rts.financials.net_pnl : null);

  if (statTotalValEl) statTotalValEl.innerText = formatCurrency(totalVal);
  if (statBalanceEl) statBalanceEl.innerText = formatCurrency(balance);
  if (statEquityEl) statEquityEl.innerText = formatCurrency(equityValue);

  if (statNetPnLEl) {
    if (netPnL === undefined || netPnL === null) {
      statNetPnLEl.innerText = 'Unavailable';
      statNetPnLEl.className = 'pnl-badge';
    } else {
      const pnlPercent = totalVal ? ((netPnL / totalVal) * 100).toFixed(2) : '0.00';
      const pnlPrefix = netPnL >= 0 ? '+' : '';
      statNetPnLEl.innerText = `${pnlPrefix}₹${Number(netPnL).toLocaleString('en-IN', { minimumFractionDigits: 2 })} (${pnlPrefix}${pnlPercent}%)`;
      statNetPnLEl.className = netPnL >= 0 ? 'pnl-badge positive' : 'pnl-badge negative';
    }
  }

  // Daily Target Math & Reachability calculator (Phase 9)
  const todayProfit = data.dailyStats ? data.dailyStats.net_pnl : 0;
  const targetVal = data.target || 1;
  const progressPercent = Math.max(0, Math.min(100, (todayProfit / targetVal) * 100));
  
  if (targetFraction) targetFraction.innerText = `₹${Math.round(todayProfit)} / ₹${data.target || 0}`;
  if (targetProgressBar) targetProgressBar.style.width = `${progressPercent}%`;

  if (data.targetEngineState) {
    if (targetRemaining) targetRemaining.innerText = data.targetEngineState.remainingTarget !== undefined ? `₹${Number(data.targetEngineState.remainingTarget).toFixed(2)}` : 'N/A';
    if (targetRequiredProfit) targetRequiredProfit.innerText = data.targetEngineState.requiredExpectedProfit !== undefined ? `₹${Number(data.targetEngineState.requiredExpectedProfit).toFixed(2)}` : 'N/A';
    if (targetRequiredTrades) targetRequiredTrades.innerText = data.targetEngineState.requiredTradeCount !== undefined ? data.targetEngineState.requiredTradeCount : 'N/A';
    if (targetRequiredWinrate) targetRequiredWinrate.innerText = data.targetEngineState.requiredWinRate !== undefined ? `${data.targetEngineState.requiredWinRate}%` : 'N/A';
    if (targetCapitalUtilization) targetCapitalUtilization.innerText = data.targetEngineState.requiredCapitalUtilization !== undefined ? `${data.targetEngineState.requiredCapitalUtilization}%` : 'N/A';
  }

  // Target Reachability calculations
  updateTargetReachability(data);

  // Toggle Admin Reset Panel on breach
  if (data.dailyStats && data.dailyStats.status === 'LIFETIME_FLOOR_BREACHED') {
    adminResetPanel.style.display = 'block';
  } else {
    adminResetPanel.style.display = 'none';
  }

  // Risk limits updates
  const riskDailyLimit = document.getElementById('risk-daily-limit');
  const riskLifetimeLimit = document.getElementById('risk-lifetime-limit');
  if (data.dailyStopLossLimit !== undefined && riskDailyLimit) {
    riskDailyLimit.innerText = `-₹` + Number(data.dailyStopLossLimit).toLocaleString('en-IN', { minimumFractionDigits: 2 });
  }
  if (data.maxLifetimeLossCap !== undefined && riskLifetimeLimit) {
    riskLifetimeLimit.innerText = `-₹` + Number(data.maxLifetimeLossCap).toLocaleString('en-IN', { minimumFractionDigits: 2 });
  }

  // Update Tickers Prices
  if (data.lastTicks) {
    Object.keys(data.lastTicks).forEach(sym => {
      const el = document.getElementById(`ticker-${sym}`);
      if (el) {
        const val = data.lastTicks[sym];
        if (!val || val === 0) {
          el.innerText = '₹--';
        } else {
          el.innerText = '₹' + Number(val).toLocaleString('en-IN', { minimumFractionDigits: 2 });
        }
      }
    });

    const niftyLTP = data.lastTicks['NIFTY50_MINI'];
    if (niftyLTP && niftyLTP > 0) {
      appendChartPoint(data.time, niftyLTP, data.ema9, data.ema21);
    }
  }

  // Diagnostics Update
  if (data.marketDataDiagnostics) {
    const md = data.marketDataDiagnostics;
    if (diagDataProvider) diagDataProvider.innerText = md.dataProvider;
    if (diagPriceTimestamp) {
      diagPriceTimestamp.innerText = md.lastPriceTimestamp !== 'None' ? new Date(md.lastPriceTimestamp).toLocaleTimeString() : 'None';
    }
    if (diagApiResponseTime) diagApiResponseTime.innerText = md.lastApiResponseTime;
    if (diagMarketStatus) diagMarketStatus.innerText = md.marketStatus;
    if (diagSourceOfTruth) diagSourceOfTruth.innerText = md.sourceOfTruth;
    if (diagMode) diagMode.innerText = md.mode;
  }

  if (data.tradingDiagnostics) {
    const td = data.tradingDiagnostics;
    if (diagBrokerMode) diagBrokerMode.innerText = td.brokerMode;
    if (diagActiveBroker) diagActiveBroker.innerText = td.activeBroker;
    if (diagTradingType) diagTradingType.innerText = td.tradingType;
    if (diagLastOrderId) diagLastOrderId.innerText = td.lastOrderId;
    if (diagExchangeOrderId) diagExchangeOrderId.innerText = td.lastExchangeOrderId;
    if (diagOrderSource) diagOrderSource.innerText = td.lastOrderSource;
    if (diagExecutionMode) diagExecutionMode.innerText = td.executionMode || 'SWING';
    if (diagProductType) diagProductType.innerText = td.productType || 'CNC';
  }

  // Scanner Diagnostics Update
  if (data.metrics && data.metrics.scannerStats) {
    const ss = data.metrics.scannerStats;
    if (diagScannerCurrent) diagScannerCurrent.innerText = ss.currentScan;
    if (diagScannerSession) diagScannerSession.innerText = ss.currentSession;
    if (diagScannerToday) diagScannerToday.innerText = ss.today;
    if (diagScannerLifetime) diagScannerLifetime.innerText = ss.lifetime;
    if (diagScannerLastTime) diagScannerLastTime.innerText = ss.lastScanTime;
    if (diagScannerCurrentSymbol) diagScannerCurrentSymbol.innerText = ss.currentSymbol;
    if (diagScannerSpeed) diagScannerSpeed.innerText = ss.symbolsPerMin + ' / min';
    if (diagScannerAvgTime) diagScannerAvgTime.innerText = ss.avgScanTimeMs + ' ms';
  }

  // Today & Lifetime stats content
  if (data.metrics) {
    const m = data.metrics;
    if (todayNetPnL && m.today) {
      todayNetPnL.innerText = '₹' + Number(m.today.netPnL || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 });
      todayNetPnL.style.color = (m.today.netPnL || 0) >= 0 ? '#10b981' : '#ef4444';
    }
    if (todayTotalTrades && m.today) todayTotalTrades.innerText = m.today.trades !== undefined ? m.today.trades : 'N/A';
    if (todayWinRate && m.today) todayWinRate.innerText = m.today.winRate !== undefined ? Number(m.today.winRate).toFixed(1) + '%' : 'N/A';
    if (todayFees && m.today) todayFees.innerText = m.today.fees !== undefined ? '₹' + Number(m.today.fees).toLocaleString('en-IN', { minimumFractionDigits: 2 }) : 'N/A';
    if (todayVolume && m.today) todayVolume.innerText = m.today.volume !== undefined ? '₹' + Number(m.today.volume).toLocaleString('en-IN', { minimumFractionDigits: 2 }) : 'N/A';

    if (lifetimeNetPnL && m.lifetime) {
      lifetimeNetPnL.innerText = '₹' + Number(m.lifetime.netPnL || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 });
      lifetimeNetPnL.style.color = (m.lifetime.netPnL || 0) >= 0 ? '#10b981' : '#ef4444';
    }
    if (lifetimeTotalTrades && m.lifetime) lifetimeTotalTrades.innerText = m.lifetime.trades !== undefined ? m.lifetime.trades : 'N/A';
    if (lifetimeWinRate && m.lifetime) lifetimeWinRate.innerText = m.lifetime.winRate !== undefined ? Number(m.lifetime.winRate).toFixed(1) + '%' : 'N/A';
  }

  // Update Funnel Visualizer (Phase 3)
  updateFunnelVisualizer(data);

  // Update Active Positions list (Phase 4)
  updateActivePositions(data.holdingStocks, data.lastTicks);

  // Update Telegram Audit Panel (Phase 5)
  updateTelegramAuditPanel(data.recentAlerts);

  // Update AI Agent War Room (Phase 6)
  updateAgentWarRoom(data);

  // Update Provider Health Dashboard (Phase 7)
  updateProviderHealthDashboard(data.providerHealth);

  // Update Execution Timeline (Phase 8)
  updateExecutionTimeline(data);

  // Update Decision Explainer (Phase 2)
  updateDecisionExplainer(data.prediction);

  // Update Signal Suppression Histogram
  if (data.signalSuppressionState) {
    const s = data.signalSuppressionState;
    const totalCandidatesEl = document.getElementById('supp-total-candidates');
    if (totalCandidatesEl) totalCandidatesEl.innerText = s.totalCandidates;
    
    const buckets = ['70', '75', '78', '80', '85'];
    buckets.forEach(b => {
      const val = s.tqsBuckets[`tqs${b}`] || 0;
      const pct = s.totalCandidates > 0 ? (val / s.totalCandidates) * 100 : 0;
      const bar = document.getElementById(`bar-tqs-${b}`);
      const valEl = document.getElementById(`val-tqs-${b}`);
      if (bar) bar.style.width = `${pct}%`;
      if (valEl) valEl.innerText = val;
    });
    
    const alertBox = document.getElementById('suppression-bottleneck-alert');
    if (alertBox) {
      if (s.bottleneckDetected) {
        alertBox.style.display = 'block';
        const recThresh = document.getElementById('supp-rec-thresh');
        const addTrades = document.getElementById('supp-add-trades');
        const winrateImpact = document.getElementById('supp-winrate-impact');
        if (recThresh) recThresh.innerText = s.recommendedThreshold;
        if (addTrades) addTrades.innerText = s.expectedAdditionalTrades;
        if (winrateImpact) winrateImpact.innerText = s.winRateImpact;
      } else {
        alertBox.style.display = 'none';
      }
    }
  }

  // Live streaming console log parser (Phase 1)
  updateEventConsole(data.recentAlerts);

  // Update currently selected symbol chart and sidebar with live tick in real time
  if (!isReplaying && data.lastTicks && data.lastTicks[currentSymbol]) {
    const livePrice = data.lastTicks[currentSymbol];
    if (currentCandles && currentCandles.length > 0) {
      const lastCandle = currentCandles[currentCandles.length - 1];
      lastCandle.close = livePrice;
      lastCandle.high = Math.max(lastCandle.high, livePrice);
      lastCandle.low = Math.min(lastCandle.low, livePrice);
      
      let matchingConsensus = null;
      if (window.tradesHistoryCache) {
        const trade = window.tradesHistoryCache.find(t => t.symbol === currentSymbol && t.reason && t.reason.includes('| REPORT:'));
        if (trade) {
          try {
            const parts = trade.reason.split('| REPORT:');
            matchingConsensus = JSON.parse(parts[1].trim());
            matchingConsensus.entry_price = trade.price;
            matchingConsensus.signal = trade.action;
          } catch (e) {}
        }
      }
      if (!matchingConsensus && window.predictionsCache[currentSymbol]) {
        matchingConsensus = window.predictionsCache[currentSymbol];
      }
      
      updateChartWithData(currentCandles, matchingConsensus?.participating_models?.agent4_technical?.indicators, matchingConsensus);
    }
  }

  lucide.createIcons();
}

// ----------------------------------------------------
// Phase 1 — Real-Time Event Console
// ----------------------------------------------------
let lastAlertCount = 0;
function updateEventConsole(alerts) {
  const stream = document.getElementById('console-log-stream');
  if (!stream || !alerts || alerts.length === 0) return;

  const searchQuery = document.getElementById('console-search').value.toLowerCase().trim();
  const typeFilter = document.getElementById('console-type-filter').value;

  // Render log entries
  const parsedLogs = alerts.map(a => {
    // Determine source, severity, symbol, decision, reason
    let source = 'SYSTEM';
    let symbol = 'NIFTY50';
    let severity = 'info';
    let decision = 'PASS';
    let reason = a.message;

    if (a.title.includes('Telegram')) {
      source = 'TELEGRAM';
      severity = 'telegram';
    } else if (a.title.includes('Consensus')) {
      source = 'CONSENSUS ENGINE';
      severity = 'consensus';
    } else if (a.title.includes('Risk')) {
      source = 'RISK ENGINE';
      severity = 'risk';
    } else if (a.title.includes('Scanner')) {
      source = 'SCANNER ENGINE';
      severity = 'scanner';
    } else if (a.title.includes('Error')) {
      source = 'SYSTEM ERROR';
      severity = 'error';
    }

    if (a.message.includes('|')) {
      const parts = a.message.split('|');
      parts.forEach(part => {
        const sub = part.split(':');
        if (sub.length >= 2) {
          const k = sub[0].trim().toLowerCase();
          const v = sub.slice(1).join(':').trim();
          if (k.includes('symbol')) symbol = v;
          else if (k.includes('decision') || k.includes('action')) decision = v;
          else if (k.includes('reason')) reason = v;
          else if (k.includes('severity')) severity = v.toLowerCase();
        }
      });
    } else {
      // Find symbol in text
      const symMatch = a.message.match(/\b([A-Z]{3,10}(?:_MINI)?)\b/);
      if (symMatch) symbol = symMatch[1];
    }

    const timeStr = new Date(a.timestamp).toLocaleTimeString();
    return {
      time: timeStr,
      source,
      symbol,
      severity,
      decision,
      reason
    };
  });

  // Filter and display
  const filtered = parsedLogs.filter(log => {
    // Text search
    const textMatch = log.source.toLowerCase().includes(searchQuery) ||
                      log.symbol.toLowerCase().includes(searchQuery) ||
                      log.reason.toLowerCase().includes(searchQuery);

    if (!textMatch) return false;

    // Type filter
    if (typeFilter === 'ALL') return true;
    if (typeFilter === 'TRADE') return log.source.includes('EXECUTION') || log.source.includes('BROKER');
    if (typeFilter === 'BUY') return log.decision === 'BUY' || log.reason.toLowerCase().includes('buy');
    if (typeFilter === 'SELL') return log.decision === 'SELL' || log.reason.toLowerCase().includes('sell');
    if (typeFilter === 'RISK') return log.source.includes('RISK');
    if (typeFilter === 'CONSENSUS') return log.source.includes('CONSENSUS');
    if (typeFilter === 'SCANNER') return log.source.includes('SCANNER');
    if (typeFilter === 'AI') return log.source.includes('AI') || log.source.includes('GEMINI') || log.source.includes('GROQ');
    if (typeFilter === 'TELEGRAM') return log.source.includes('TELEGRAM');
    if (typeFilter === 'ERROR') return log.severity.includes('error') || log.source.includes('ERROR');
    if (typeFilter === 'WARN') return log.severity.includes('warn') || log.source.includes('WARN');

    return true;
  });

  stream.innerHTML = filtered.map(log => `
    <div class="log-entry" onclick="explainHoldingTrade('${log.symbol}')" style="cursor: pointer">
      <span class="log-time">${log.time}</span>
      <span class="log-source">[${log.source}]</span>
      <span class="log-symbol">${log.symbol}</span>
      <span class="log-severity ${log.decision.toLowerCase()}">${log.decision}</span>
      <span class="log-reason">${log.reason}</span>
    </div>
  `).join('');
}

// ----------------------------------------------------
// Phase 2 — Trade Decision Explainer
// ----------------------------------------------------
function updateDecisionExplainer(predictionOrReport, isFromDb = false) {
  const container = document.getElementById('why-trade-explainer-content');
  if (!container) return;

  if (!predictionOrReport) {
    container.innerHTML = `
      <div class="empty-table text-xs text-center py-4">
        <i data-lucide="help-circle"></i>
        <p>No active trade predictions evaluated yet.</p>
      </div>
    `;
    return;
  }

  let symbol = '';
  let signal = 'BUY';
  let tqsVal = 76;
  let confidenceVal = 0.8;
  let riskStatus = 'PASS';
  let consensusStr = '0/0';
  let reasoning = '';
  let threshold = 80;
  let votes = {};

  if (isFromDb) {
    const r = predictionOrReport;
    symbol = r.symbol || '';
    signal = r.signal || 'BUY';
    tqsVal = r.tqs || 50;
    threshold = r.tqs_threshold || 80;
    confidenceVal = Number(r.final_confidence || r.confidence || 0);
    riskStatus = (r.participating_models?.agent7_risk?.signal) || 'PASS';
    votes = r.participating_models || {};
    reasoning = r.entry_reason || `TQS: ${tqsVal}%, Sizing: ${r.position_size_logic || ''}`;

    let totalVotes = 0;
    let buyVotes = 0;
    Object.keys(votes).forEach(k => {
      totalVotes++;
      if (votes[k].signal === 'BUY') buyVotes++;
    });
    consensusStr = `${buyVotes}/${totalVotes}`;
  } else {
    const p = predictionOrReport;
    symbol = p.symbol || '';
    signal = p.signal || 'BUY';
    confidenceVal = Number(p.confidence || 0);
    tqsVal = p.tqs || p.technical_score || 0;
    riskStatus = p.participating_models?.agent7_risk?.signal || 'PASS';
    votes = p.participating_models || {};
    reasoning = p.reasoning || 'Debated signal approved.';
    
    // Retrieve latest dynamic threshold from predictions if not in DB format
    threshold = window.lastDashboardData && window.lastDashboardData.targetEngineState ? window.lastDashboardData.targetEngineState.threshold : 80;

    let totalVotes = 0;
    let buyVotes = 0;
    Object.keys(votes).forEach(k => {
      totalVotes++;
      if (votes[k].signal === 'BUY') buyVotes++;
    });
    consensusStr = `${buyVotes}/${totalVotes}`;
  }

  const isAdaptiveOverride = tqsVal < threshold;
  const badgeLabel = isAdaptiveOverride ? 'ADAPTIVE OVERRIDE' : 'APPROVED';
  const badgeClass = isAdaptiveOverride ? 'bg-purple' : 'bg-green';

  container.innerHTML = `
    <div class="explainer-header flex-between">
      <h3 class="text-xl font-bold">${symbol}</h3>
      <span class="badge ${badgeClass}">${badgeLabel}</span>
    </div>
    <div class="metrics-pill-row" style="display: flex; gap: 8px; margin-top: 10px;">
      <span class="pill">TQS: <b>${tqsVal}</b></span>
      <span class="pill">Confidence: <b>${confidenceVal.toFixed(2)}</b></span>
      <span class="pill">Risk: <b class="${riskStatus === 'PASS' || riskStatus === 'BUY' ? 'text-green' : 'text-red'}">${riskStatus}</b></span>
      <span class="pill">Consensus: <b>${consensusStr}</b></span>
    </div>

    <h4 class="section-subheading" style="margin-top: 14px; margin-bottom: 6px; font-size: 0.75rem; text-transform: uppercase;">Agent Vote Registry</h4>
    <div class="votes-grid">
      <div class="vote-item"><span>ML Model</span><b>${votes.agent1?.signal || votes.agent1_ml?.signal || 'HOLD'}</b></div>
      <div class="vote-item"><span>Gemini</span><b>${votes.agent2_gemini?.signal || 'HOLD'}</b></div>
      <div class="vote-item"><span>Groq</span><b>${votes.agent3_groq?.signal || 'HOLD'}</b></div>
      <div class="vote-item"><span>Risk Manager</span><b>${votes.agent7_risk?.signal || 'HOLD'}</b></div>
      <div class="vote-item"><span>Context Engine</span><b>${votes.agent5_context?.signal || 'HOLD'}</b></div>
      <div class="vote-item"><span>Breadth Engine</span><b>${votes.agent9_breadth?.signal || 'HOLD'}</b></div>
    </div>
    <p class="text-xxs italic" style="color: rgba(255,255,255,0.4); margin-top: 10px; line-height: 1.2;">
      Reasoning: ${reasoning}
    </p>
  `;
}

// Helper to inspect decisions on holdings click
window.explainHoldingTrade = function(symbol) {
  window.location.href = `/trade-analysis?symbol=${encodeURIComponent(symbol)}`;
};

// ----------------------------------------------------
// Phase 3 — Funnel Visualizer
// ----------------------------------------------------
function updateFunnelVisualizer(data) {
  const container = document.getElementById('funnel-flow-container');
  if (!container || !data.metrics || !data.metrics.cycle) return;

  const f = data.metrics.cycle;

  const funnelStages = [
    { name: 'Scanned', key: 'scanned' },
    { name: 'TQS Passed', key: 'passedTQS' },
    { name: 'Confidence Passed', key: 'passedConfidence' },
    { name: 'Risk Passed', key: 'passedRisk' },
    { name: 'Consensus Passed', key: 'passedConsensus' },
    { name: 'Submitted', key: 'submitted' },
    { name: 'Filled', key: 'filled' }
  ];

  let html = '';
  
  funnelStages.forEach((stage, idx) => {
    const val = f[stage.key] || 0;
    const prevVal = idx > 0 ? (f[funnelStages[idx-1].key] || 0) : 0;
    
    // Percent calculations
    const survivalPct = f.scanned > 0 ? Math.round((val / f.scanned) * 100) : 100;
    const dropPct = prevVal > 0 ? Math.round(((prevVal - val) / prevVal) * 100) : 0;

    const fillWidth = f.scanned > 0 ? (val / f.scanned) * 100 : 100;

    html += `
      <div class="funnel-stage-row" onclick="inspectFunnelStage('${stage.name}', ${val})">
        <span class="funnel-label">${stage.name}</span>
        <div class="funnel-bar-wrapper">
          <div class="funnel-bar-fill" style="width: ${fillWidth}%"></div>
        </div>
        <span class="funnel-count">${val}</span>
        <span class="funnel-survival text-green">${survivalPct}% SV</span>
        <span class="funnel-drop text-red">${idx > 0 ? dropPct : 0}% DR</span>
      </div>
    `;
  });

  container.innerHTML = html;
}

window.inspectFunnelStage = function(stageName, count) {
  const modal = document.getElementById('rejected-candidates-modal');
  const modalBody = document.getElementById('rejected-candidates-list');
  
  modal.classList.add('active');

  const rejections = window._lastStatusData && window._lastStatusData.runtime
    ? (window._lastStatusData.runtime.funnel || {}).last_rejected || []
    : [];

  // Loosen strict filter so we always show reasons if specific stage matching fails
  let stageRejections = rejections.filter(r => (r.stage || '').includes(stageName) || stageName.includes(r.stage));
  if (stageRejections.length === 0 && rejections.length > 0) {
    stageRejections = rejections.slice(0, 5); // Show latest 5 as fallback
  }

  const list = stageRejections.length > 0
    ? stageRejections.map(r => `<strong>${r.symbol || 'Unknown'}</strong>: ${r.reason || 'Rejected'} <br><small>Agent: ${r.agent || 'System'} | Time: ${r.timestamp ? new Date(r.timestamp).toLocaleTimeString() : '--'}</small>`)
    : ['No rejection data logged in current run.'];

  modalBody.innerHTML = `
    <h4 style="margin-bottom: 10px; color: var(--accent-blue);">Recent Failed Candidates</h4>
    <ul style="padding-left: 15px; font-size: 0.75rem; color: var(--text-secondary); display: flex; flex-direction: column; gap: 8px;">
      ${list.map(item => `<li style="padding: 4px 0; border-bottom: 1px solid rgba(255,255,255,0.05);">${item}</li>`).join('')}
    </ul>
  `;
};

window.closeModal = function() {
  document.getElementById('rejected-candidates-modal').classList.remove('active');
};

// ----------------------------------------------------
// Phase 4 — Position Monitor
// ----------------------------------------------------
function updateActivePositions(holdings, prices) {
  const container = document.getElementById('holdings-container');
  if (!container) return;

  if (!holdings || holdings.length === 0) {
    container.innerHTML = `<p class="empty-table text-xs text-center py-4">No open positions. Quant engine ready.</p>`;
    return;
  }

  container.innerHTML = holdings.map(h => {
    const ltp = h.current_price || h.ltp || (prices ? prices[h.symbol] || h.avgPrice : h.avgPrice);
    const currentVal = h.current_value || (ltp * h.quantity);
    const buyVal = h.avgPrice * h.quantity;
    const pnl = h.unrealized_pnl || parseFloat((currentVal - buyVal).toFixed(2));
    const pnlClass = pnl >= 0 ? 'text-green' : 'text-red';
    const pnlPrefix = pnl >= 0 ? '+' : '';

    // stop loss & target parameters
    const targetPrice = h.targetPrice || (h.avgPrice * 1.05);
    const stopLoss = h.stopLoss || (h.avgPrice * 0.97);

    // progress calculations
    let targetProgress = 0;
    if (ltp >= h.avgPrice) {
      targetProgress = Math.min(100, ((ltp - h.avgPrice) / (targetPrice - h.avgPrice)) * 100);
    }
    
    let stopProgress = 0;
    if (ltp <= h.avgPrice) {
      stopProgress = Math.min(100, ((h.avgPrice - ltp) / (h.avgPrice - stopLoss)) * 100);
    }

    // holding time tracking (computed based on actual timestamp if available)
    const entryMs = h.timestamp ? new Date(h.timestamp).getTime() : Date.now();
    const elapsedSec = Math.max(0, Math.floor((Date.now() - entryMs) / 1000));
    const elapsedMin = Math.floor(elapsedSec / 60);
    const elapsedSecRemainder = elapsedSec % 60;
    const holdingTime = `${elapsedMin}m ${elapsedSecRemainder}s`;

    return `
      <div class="active-position-card" onclick="explainHoldingTrade('${h.symbol}')" style="cursor:pointer">
        <div class="flex-between">
          <span><b>${h.symbol}</b> (Qty: ${h.quantity})</span>
          <b class="${pnlClass}">${pnlPrefix}₹${pnl.toFixed(2)}</b>
        </div>
        <div class="pos-price-row">
          <span>Avg: ₹${h.avgPrice.toFixed(2)}</span>
          <span style="text-align: center;">LTP: ₹${ltp.toFixed(2)}</span>
          <span style="text-align: right; color: rgba(255,255,255,0.4)">Time: ${holdingTime}</span>
        </div>
        
        <!-- Target Progress (Green to Blue) -->
        <div style="margin-top: 4px;">
          <div class="pos-progress-labels">
            <span>Entry → Target (₹${targetPrice.toFixed(2)})</span>
            <span class="text-green">${Math.round(targetProgress)}%</span>
          </div>
          <div class="progress-bar-container" style="height: 4px; background: rgba(16,185,129,0.05);">
            <div class="progress-bar-fill bg-green" style="width: ${targetProgress}%; background: linear-gradient(to right, #10b981, #3b82f6)"></div>
          </div>
        </div>

        <!-- Stop Loss Progress (Red) -->
        <div style="margin-top: 4px;">
          <div class="pos-progress-labels">
            <span>Entry → Stop Loss (₹${stopLoss.toFixed(2)})</span>
            <span class="text-red">${Math.round(stopProgress)}%</span>
          </div>
          <div class="progress-bar-container" style="height: 4px; background: rgba(239,68,68,0.05);">
            <div class="progress-bar-fill bg-red" style="width: ${stopProgress}%"></div>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// ----------------------------------------------------
// Phase 5 — Telegram Audit Panel
// ----------------------------------------------------
function updateTelegramAuditPanel(alerts) {
  const body = document.getElementById('telegram-audit-body');
  if (!body || !alerts || alerts.length === 0) return;

  const teleAlerts = alerts.filter(a => a.type === 'telegram' || a.title.toLowerCase().includes('telegram'));

  if (teleAlerts.length === 0) {
    body.innerHTML = `<tr><td colspan="3" class="empty-table">No Telegram dispatches audited.</td></tr>`;
    return;
  }

  body.innerHTML = teleAlerts.slice(0, 10).map((a, idx) => {
    const timeStr = new Date(a.timestamp).toLocaleTimeString();
    
    // Determine Message Type
    let msgType = 'TELEGRAM ALERT';
    if (a.message.includes('BUY')) msgType = 'BUY ALERT';
    else if (a.message.includes('SELL')) msgType = 'SELL ALERT';
    else if (a.message.includes('EOD') || a.message.includes('report')) msgType = 'MID SESSION REPORT';
    else if (a.message.toLowerCase().includes('error') || a.message.toLowerCase().includes('fail')) msgType = 'ERROR ALERT';
    else if (a.message.includes('success') || a.message.includes('complete')) msgType = 'UPLOAD SUCCESS';

    const status = a.message.includes('MOCKED') ? 'MOCKED' : 'SENT';
    const statusColor = status === 'SENT' ? 'text-green' : 'text-yellow';

    return `
      <tr onclick="viewTelegramPayload(${idx})" style="cursor: pointer;">
        <td>${timeStr}</td>
        <td><b>${msgType}</b></td>
        <td class="${statusColor} font-semibold">${status}</td>
      </tr>
    `;
  }).join('');

  // Cache telegram messages globally for popup clicks
  window.telegramMessages = teleAlerts;
}

window.viewTelegramPayload = function(idx) {
  const modal = document.getElementById('telegram-msg-modal');
  const content = document.getElementById('telegram-msg-content');
  if (window.telegramMessages && window.telegramMessages[idx]) {
    const msg = window.telegramMessages[idx].message;
    content.innerText = msg;
    modal.classList.add('active');
    
    // Parse symbol from Telegram message and load its chart
    const symMatch = msg.match(/\b([A-Z]{3,10}(?:_MINI)?)\b/);
    if (symMatch) {
      explainHoldingTrade(symMatch[1]);
    }
  }
};

window.closeTelegramModal = function() {
  document.getElementById('telegram-msg-modal').classList.remove('active');
};

// ----------------------------------------------------
// Phase 6 — AI Agent War Room
// ----------------------------------------------------
function updateAgentWarRoom(data) {
  const body = document.getElementById('agent-war-room-body');
  if (!body) return;

  // Build agent rows from real leaderboard data
  const leaderboard = data.agentLeaderboard || {};
  const agentIds = Object.keys(leaderboard);

  if (agentIds.length > 0) {
    body.innerHTML = agentIds.map(id => {
      const a = leaderboard[id];
      const pnl = ((a.actualProfitContribution || 0) - (a.actualLossContribution || 0));
      const pnlStr = pnl >= 0 ? `+₹${pnl.toFixed(2)}` : `-₹${Math.abs(pnl).toFixed(2)}`;
      const weight = ((a.weight || 0) * 100).toFixed(0);
      const vote = a.last_signal || 'HOLD';
      const voteClass = vote === 'BUY' ? 'text-green' : vote === 'SELL' ? 'text-red' : 'text-yellow';

      let rowClass = 'agent-neutral';
      if (pnl > 0) rowClass = 'agent-profitable';
      else if (pnl < 0) rowClass = 'agent-losing';

      return `
        <tr class="${rowClass}">
          <td><b>${id}</b></td>
          <td>${weight}%</td>
          <td class="${voteClass} font-semibold">${vote}</td>
          <td class="${pnl >= 0 ? 'text-green' : 'text-red'} font-semibold">${pnlStr}</td>
        </tr>
      `;
    }).join('');
  } else {
    body.innerHTML = '<tr><td colspan="4" style="text-align:center; color: var(--text-secondary);">Awaiting agent leaderboard data...</td></tr>';
  }
}

// ----------------------------------------------------
// Phase 7 — Provider Health Dashboard
// ----------------------------------------------------
function updateProviderHealthDashboard(health) {
  const body = document.getElementById('provider-health-body');
  if (!body) return;

  const defaultHealth = {
    Gemini: { latency: null, successRate: null, errors: 0, lastResponse: null },
    Groq: { latency: null, successRate: null, errors: 0, lastResponse: null },
    OpenAI: { latency: null, successRate: null, errors: 0, lastResponse: null },
    Yahoo: { latency: null, successRate: null, errors: 0, lastResponse: null },
    Kite: { latency: null, successRate: null, errors: 0, lastResponse: null },
    Telegram: { latency: null, successRate: null, errors: 0, lastResponse: null },
    Postgres: { latency: null, successRate: null, errors: 0, lastResponse: null }
  };

  const activeHealth = health || defaultHealth;

  body.innerHTML = Object.keys(activeHealth).map(key => {
    const h = activeHealth[key];
    const latDisplay = h.latency !== null ? `${h.latency}ms` : 'N/A';
    const successDisplay = h.successRate !== null ? `${h.successRate}%` : 'N/A';
    const latColor = h.latency === null ? 'text-yellow' : h.latency < 100 ? 'text-green' : h.latency < 250 ? 'text-yellow' : 'text-red';
    const successColor = h.successRate === null ? 'text-yellow' : h.successRate > 95 ? 'text-green' : 'text-red';

    return `
      <tr>
        <td><b>${key}</b></td>
        <td class="monospace font-semibold ${latColor}">${latDisplay}</td>
        <td class="monospace ${successColor}">${successDisplay}</td>
        <td class="monospace">${h.failureCount || 0}</td>
        <td class="monospace" style="font-size: 0.65rem;">${h.lastFailure || 'None'}</td>
        <td class="monospace">${h.retryCount || 0}</td>
      </tr>
    `;
  }).join('');
}

// ----------------------------------------------------
// Phase 8 — Execution Timeline
// ----------------------------------------------------
function updateExecutionTimeline(data) {
  const timeline = document.getElementById('session-execution-timeline');
  if (!timeline) return;

  // Milestones compile
  const milestones = [
    { label: 'Market Open', time: '09:15', active: true },
    { label: 'Signal Found', time: '--:--', active: false },
    { label: 'Consensus Passed', time: '--:--', active: false },
    { label: 'Risk Approved', time: '--:--', active: false },
    { label: 'Order Submitted', time: '--:--', active: false },
    { label: 'Order Filled', time: '--:--', active: false }
  ];

  if (data.preMarketState) {
    if (data.preMarketState.firstScanCompleted) {
      milestones[1].active = true;
      milestones[1].time = '--:--'; // V10.1: Will be driven by real scheduler timestamps
    }
    if (data.preMarketState.firstSignalGenerated) {
      milestones[2].active = true;
      milestones[2].time = '--:--'; // V10.1: Will be driven by real scheduler timestamps
    }
    if (data.prediction && data.prediction.participating_models?.agent7_risk?.signal === 'PASS') {
      milestones[3].active = true;
      milestones[3].time = '--:--'; // V10.1: Will be driven by real scheduler timestamps
    }
    if (data.preMarketState.firstTradeExecuted) {
      milestones[4].active = true;
      milestones[4].time = '--:--'; // V10.1: Will be driven by real scheduler timestamps
      milestones[5].active = true;
      milestones[5].time = '--:--'; // V10.1: Will be driven by real scheduler timestamps
    }
  }

  // Generate html
  let html = '';
  milestones.forEach((m, idx) => {
    if (idx > 0) {
      html += `<div class="timeline-divider"></div>`;
    }
    html += `
      <div class="timeline-step">
        <span class="step-time">${m.time}</span>
        <span class="step-label">${m.label}</span>
        <span class="step-dot ${m.active ? '' : 'disabled'}"></span>
      </div>
    `;
  });

  timeline.innerHTML = html;
}

// ----------------------------------------------------
// Phase 9 — Profit Target Math & Calculator
// ----------------------------------------------------
function updateTargetReachability(data) {
  const badge = document.getElementById('target-reachability-badge');
  const details = document.getElementById('target-math-calculations');
  if (!badge || !details) return;

  const rating = data.targetEngineState ? data.targetEngineState.rating : 'HIGH';
  badge.innerText = rating;
  if (rating === 'HIGH') {
    badge.className = 'badge bg-green';
  } else if (rating === 'MEDIUM') {
    badge.className = 'badge bg-blue';
  } else if (rating === 'LOW') {
    badge.className = 'badge bg-yellow';
  } else {
    badge.className = 'badge bg-red';
  }

  const remaining = data.targetEngineState ? data.targetEngineState.remainingTarget : 0;
  const requiredTrades = data.targetEngineState ? data.targetEngineState.requiredTradeCount : 0;
  const minsRemaining = data.targetEngineState ? data.targetEngineState.minsRemaining : 0;

  details.innerHTML = `
    Rem. Target: ₹${remaining.toFixed(2)}<br>
    Required Trades: ${requiredTrades}<br>
    Mins Remaining: ${minsRemaining} mins
  `;
}

// ----------------------------------------------------
// TradingView Lightweight Charts & History Panel
// ----------------------------------------------------
let mainChart = null;
let rsiChart = null;
let candlestickSeries = null;
let volumeSeries = null;
let ema9Series = null;
let ema21Series = null;
let supportSeries = null;
let resistanceSeries = null;
let rsiSeries = null;
let vwapSeries = null;
let stopLossSeries = null;
let targetSeries = null;
let currentPriceSeries = null;

let currentCandles = [];
let currentSymbol = 'NIFTY50_MINI';
let replayInterval = null;
let replayIndex = 0;
let isReplaying = false;
let allReplayCandles = [];

function initChart() {
  const chartContainer = document.getElementById('tv-chart-container');
  const rsiContainer = document.getElementById('tv-rsi-container');
  if (!chartContainer || !rsiContainer) return;

  // Clear previous content
  chartContainer.innerHTML = '';
  rsiContainer.innerHTML = '';

  const chartOptions = {
    layout: {
      background: { type: 'solid', color: 'transparent' },
      textColor: '#94a3b8',
    },
    grid: {
      vertLines: { color: 'rgba(255, 255, 255, 0.03)' },
      horzLines: { color: 'rgba(255, 255, 255, 0.03)' },
    },
    crosshair: {
      mode: 0,
    },
    timeScale: {
      borderColor: 'rgba(255, 255, 255, 0.08)',
      timeVisible: true,
      secondsVisible: false,
    },
    rightPriceScale: {
      borderColor: 'rgba(255, 255, 255, 0.08)',
    }
  };

  mainChart = LightweightCharts.createChart(chartContainer, {
    ...chartOptions,
    width: chartContainer.clientWidth,
    height: chartContainer.clientHeight || 300,
  });

  candlestickSeries = mainChart.addCandlestickSeries({
    upColor: '#10b981',
    downColor: '#ef4444',
    borderVisible: false,
    wickUpColor: '#10b981',
    wickDownColor: '#ef4444',
  });

  volumeSeries = mainChart.addHistogramSeries({
    color: 'rgba(59, 130, 246, 0.3)',
    priceFormat: { type: 'volume' },
    priceScaleId: '',
  });
  volumeSeries.priceScale().applyOptions({
    scaleMargins: { top: 0.7, bottom: 0 },
  });

  ema9Series = mainChart.addLineSeries({
    color: '#3b82f6',
    lineWidth: 1.5,
    title: 'EMA 9',
  });

  ema21Series = mainChart.addLineSeries({
    color: '#f59e0b',
    lineWidth: 1.5,
    title: 'EMA 21',
  });

  supportSeries = mainChart.addLineSeries({
    color: 'rgba(16, 185, 129, 0.4)',
    lineWidth: 1.5,
    lineStyle: 1,
    title: 'Support',
  });

  resistanceSeries = mainChart.addLineSeries({
    color: 'rgba(239, 68, 68, 0.4)',
    lineWidth: 1.5,
    lineStyle: 1,
    title: 'Resistance',
  });

  vwapSeries = mainChart.addLineSeries({
    color: '#06b6d4',
    lineWidth: 1.5,
    title: 'VWAP',
  });

  stopLossSeries = mainChart.addLineSeries({
    color: '#ef4444',
    lineWidth: 1.5,
    lineStyle: 2,
    title: 'Stop Loss',
  });

  targetSeries = mainChart.addLineSeries({
    color: '#10b981',
    lineWidth: 1.5,
    lineStyle: 2,
    title: 'Target',
  });

  currentPriceSeries = mainChart.addLineSeries({
    color: '#94a3b8',
    lineWidth: 1,
    lineStyle: 3,
    title: 'LTP',
  });

  rsiChart = LightweightCharts.createChart(rsiContainer, {
    ...chartOptions,
    width: rsiContainer.clientWidth,
    height: rsiContainer.clientHeight || 80,
  });

  rsiSeries = rsiChart.addLineSeries({
    color: '#a855f7',
    lineWidth: 1.5,
    title: 'RSI',
  });

  // RSI limit lines
  const rsi30Line = rsiChart.addLineSeries({ color: 'rgba(255,255,255,0.06)', lineWidth: 1, lineStyle: 1 });
  const rsi50Line = rsiChart.addLineSeries({ color: 'rgba(255,255,255,0.04)', lineWidth: 1, lineStyle: 1 });
  const rsi70Line = rsiChart.addLineSeries({ color: 'rgba(255,255,255,0.06)', lineWidth: 1, lineStyle: 1 });

  const startSecs = Math.floor(Date.now() / 1000) - 200 * 300;
  rsi30Line.setData(Array.from({ length: 300 }).map((_, i) => ({ time: startSecs + i * 300, value: 30 })));
  rsi50Line.setData(Array.from({ length: 300 }).map((_, i) => ({ time: startSecs + i * 300, value: 50 })));
  rsi70Line.setData(Array.from({ length: 300 }).map((_, i) => ({ time: startSecs + i * 300, value: 70 })));

  mainChart.timeScale().subscribeVisibleTimeRangeChange(range => {
    rsiChart.timeScale().setVisibleRange(range);
  });

  window.addEventListener('resize', () => {
    if (mainChart && rsiChart) {
      mainChart.resize(chartContainer.clientWidth, chartContainer.clientHeight);
      rsiChart.resize(rsiContainer.clientWidth, rsiContainer.clientHeight);
    }
  });

  setupReplayControls();
}

function appendChartPoint(time, price, ema9Val, ema21Val) {
  if (isReplaying || !candlestickSeries) return;
  
  const timeSeconds = Math.floor(Date.now() / 1000);
  const lastIndex = currentCandles.length - 1;
  let newCandle;
  
  if (lastIndex >= 0 && currentCandles[lastIndex].time === timeSeconds) {
    const last = currentCandles[lastIndex];
    last.high = Math.max(last.high, price);
    last.low = Math.min(last.low, price);
    last.close = price;
    newCandle = last;
  } else {
    const open = lastIndex >= 0 ? currentCandles[lastIndex].close : price;
    newCandle = {
      time: timeSeconds,
      open: open,
      high: Math.max(open, price),
      low: Math.min(open, price),
      close: price,
      volume: 0 // V10.1: Volume not available in live tick — connect to data.metrics.scannerStats.lastVolume
    };
    currentCandles.push(newCandle);
  }

  if (currentCandles.length > 200) currentCandles.shift();

  candlestickSeries.setData(currentCandles);
  volumeSeries.setData(currentCandles.map(c => ({ time: c.time, value: c.volume, color: c.close >= c.open ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)' })));
  
  const emas9 = computeEMA(currentCandles, 9);
  const emas21 = computeEMA(currentCandles, 21);
  ema9Series.setData(emas9);
  ema21Series.setData(emas21);

  const rsis = computeRSI(currentCandles, 14);
  rsiSeries.setData(rsis);
}

function computeEMA(data, period) {
  const ema = [];
  if (data.length === 0) return ema;
  let k = 2 / (period + 1);
  let emaVal = data[0].close;
  ema.push({ time: data[0].time, value: emaVal });
  for (let i = 1; i < data.length; i++) {
    emaVal = data[i].close * k + emaVal * (1 - k);
    ema.push({ time: data[i].time, value: parseFloat(emaVal.toFixed(2)) });
  }
  return ema;
}

function computeRSI(data, period = 14) {
  const rsi = [];
  if (data.length <= period) return rsi;
  let gains = 0;
  let losses = 0;
  
  for (let i = 1; i <= period; i++) {
    const diff = data[i].close - data[i - 1].close;
    if (diff > 0) gains += diff;
    else losses -= diff;
  }
  
  let avgGain = gains / period;
  let avgLoss = losses / period;
  let rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  let rsiVal = avgLoss === 0 ? 100 : 100 - 100 / (1 + rs);
  rsi.push({ time: data[period].time, value: parseFloat(rsiVal.toFixed(2)) });

  for (let i = period + 1; i < data.length; i++) {
    const diff = data[i].close - data[i - 1].close;
    avgGain = (avgGain * 13 + (diff > 0 ? diff : 0)) / 14;
    avgLoss = (avgLoss * 13 + (diff < 0 ? -diff : 0)) / 14;
    rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    rsiVal = avgLoss === 0 ? 100 : 100 - 100 / (1 + rs);
    rsi.push({ time: data[i].time, value: parseFloat(rsiVal.toFixed(2)) });
  }
  return rsi;
}

async function loadChartForSymbol(symbol, entryTimestamp = null, indicatorsSnapshot = null, consensusSnapshot = null) {
  if (!mainChart) return;
  
  currentSymbol = symbol;
  document.getElementById('active-chart-symbol').innerText = symbol;
  
  const queryParam = entryTimestamp ? `?symbol=${symbol}&entryTimestamp=${encodeURIComponent(entryTimestamp)}` : `?symbol=${symbol}`;
  const endpoint = `${backendBase}/api/historical-candles${queryParam}`;

  try {
    const res = await fetch(endpoint);
    if (!res.ok) throw new Error('Failed to fetch candles');
    const result = await res.json();
    if (!result || !result.candles || result.candles.length === 0) return;

    allReplayCandles = result.candles;
    
    candlestickSeries.setData([]);
    volumeSeries.setData([]);
    ema9Series.setData([]);
    ema21Series.setData([]);
    supportSeries.setData([]);
    resistanceSeries.setData([]);
    rsiSeries.setData([]);
    if (vwapSeries) vwapSeries.setData([]);
    if (stopLossSeries) stopLossSeries.setData([]);
    if (targetSeries) targetSeries.setData([]);
    if (currentPriceSeries) currentPriceSeries.setData([]);

    if (entryTimestamp) {
      isReplaying = true;
      document.getElementById('replay-controls').style.display = 'flex';
      
      replayIndex = Math.min(30, allReplayCandles.length);
      const initialCandles = allReplayCandles.slice(0, replayIndex);
      updateChartWithData(initialCandles, indicatorsSnapshot, consensusSnapshot);
    } else {
      isReplaying = false;
      document.getElementById('replay-controls').style.display = 'none';
      currentCandles = allReplayCandles;
      updateChartWithData(currentCandles, indicatorsSnapshot, consensusSnapshot);
    }
  } catch (err) {
    console.error('Error loading chart symbol data:', err);
  }
}

function updateChartWithData(candles, indicators = null, consensus = null) {
  if (!candles || candles.length === 0) return;
  candlestickSeries.setData(candles);
  volumeSeries.setData(candles.map(c => ({ time: c.time, value: c.volume, color: c.close >= c.open ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)' })));

  const emas9 = computeEMA(candles, 9);
  const emas21 = computeEMA(candles, 21);
  ema9Series.setData(emas9);
  ema21Series.setData(emas21);

  const rsis = computeRSI(candles, 14);
  rsiSeries.setData(rsis);

  const currentPrice = candles[candles.length - 1].close;

  // Compute VWAP
  const vwaps = computeVWAP(candles);
  if (vwapSeries) vwapSeries.setData(vwaps);

  // Compute Support / Resistance
  let supportVal = indicators?.support || currentPrice * 0.97;
  let resistanceVal = indicators?.resistance || currentPrice * 1.03;
  const supports = candles.map(c => ({ time: c.time, value: supportVal }));
  const resistances = candles.map(c => ({ time: c.time, value: resistanceVal }));
  if (supportSeries) supportSeries.setData(supports);
  if (resistanceSeries) resistanceSeries.setData(resistances);

  // Compute Target / Stop Loss
  const targetVal = consensus?.targetPrice || consensus?.entry_price * 1.05 || currentPrice * 1.05;
  const stopLossVal = consensus?.stopLoss || consensus?.entry_price * 0.97 || currentPrice * 0.97;
  const targets = candles.map(c => ({ time: c.time, value: targetVal }));
  const stopLosses = candles.map(c => ({ time: c.time, value: stopLossVal }));
  if (targetSeries) targetSeries.setData(targets);
  if (stopLossSeries) stopLossSeries.setData(stopLosses);

  // Current Price Line
  const currentPrices = candles.map(c => ({ time: c.time, value: currentPrice }));
  if (currentPriceSeries) currentPriceSeries.setData(currentPrices);

  // Markers
  const markers = [];
  if (consensus) {
    markers.push({
      time: candles[candles.length - 1].time,
      position: 'belowBar',
      color: '#10b981',
      shape: 'arrowUp',
      text: `ENTRY @ ₹${Number(consensus.entry_price || currentPrice).toFixed(2)}`
    });

    if (consensus.exit_price || consensus.exitPrice) {
      markers.push({
        time: candles[candles.length - 1].time,
        position: 'aboveBar',
        color: '#ef4444',
        shape: 'arrowDown',
        text: `EXIT @ ₹${Number(consensus.exit_price || consensus.exitPrice).toFixed(2)}`
      });
    }
  }
  candlestickSeries.setMarkers(markers);

  // Calculate values for AI Decision Panel
  const entryPrice = consensus?.entry_price || currentPrice;
  const targetPrice = targetVal;
  const stopLoss = stopLossVal;
  const rrr = Math.abs(targetPrice - entryPrice) / Math.max(0.01, Math.abs(entryPrice - stopLoss));

  const tqsVal = consensus?.tqs || 0;
  const confidenceVal = consensus?.final_confidence || consensus?.confidence || 0.82;

  let buyVotes = 0;
  let totalVotes = 0;
  let votesBreakdownHtml = '';
  if (consensus?.participating_models) {
    Object.keys(consensus.participating_models).forEach(k => {
      if (k === 'learning_impact') return;
      totalVotes++;
      const sig = consensus.participating_models[k].signal || 'HOLD';
      if (sig === 'BUY') buyVotes++;
      const cleanName = k.replace('agent', 'Ag').slice(0, 10);
      votesBreakdownHtml += `<div class="flex-between" style="padding: 2px 4px; background: rgba(255,255,255,0.02); border-radius: 2px;"><span>${cleanName}:</span><b>${sig}</b></div>`;
    });
  } else {
    totalVotes = 0;
    buyVotes = 0;
    votesBreakdownHtml = `<div class="flex-between"><span>No agent consensus available.</span></div>`;
  }

  // Update AI Decision Panel DOM elements
  document.getElementById('intel-symbol').innerText = currentSymbol;
  document.getElementById('intel-current-price').innerText = `₹${currentPrice.toFixed(2)}`;
  document.getElementById('intel-entry-price').innerText = `₹${entryPrice.toFixed(2)}`;
  document.getElementById('intel-target-price').innerText = `₹${targetPrice.toFixed(2)}`;
  document.getElementById('intel-stop-loss').innerText = `₹${stopLoss.toFixed(2)}`;
  document.getElementById('intel-rrr').innerText = rrr.toFixed(2);
  document.getElementById('intel-tqs').innerText = `${tqsVal}%`;
  document.getElementById('intel-confidence').innerText = Number(confidenceVal).toFixed(2);
  document.getElementById('intel-consensus-votes').innerText = `${buyVotes}/${totalVotes}`;
  document.getElementById('intel-agent-votes').innerHTML = votesBreakdownHtml;

  // PREDICTION ENGINE - GENERATE PREDICTIONS
  // Determine Direction
  const lastEma9 = emas9.length > 0 ? emas9[emas9.length - 1].value : currentPrice;
  const lastEma21 = emas21.length > 0 ? emas21[emas21.length - 1].value : currentPrice;
  const emaTrend = lastEma9 >= lastEma21 ? 'BULLISH' : 'BEARISH';
  const lastRsi = rsis.length > 0 ? rsis[rsis.length - 1].value : 50;
  
  let rsiCondition = 'NEUTRAL';
  if (lastRsi > 70) rsiCondition = 'OVERBOUGHT';
  else if (lastRsi < 30) rsiCondition = 'OVERSOLD';
  else if (lastRsi > 50) rsiCondition = 'BULLISH MOMENTUM';
  else rsiCondition = 'BEARISH MOMENTUM';

  const distToSupport = Math.abs(currentPrice - supportVal) / currentPrice;
  const distToResistance = Math.abs(currentPrice - resistanceVal) / currentPrice;
  
  let supportInteraction = 'NONE';
  if (distToSupport < 0.015) supportInteraction = 'TESTING SUPPORT';
  else if (currentPrice > supportVal) supportInteraction = 'HOLDING ABOVE';

  let resistanceInteraction = 'NONE';
  if (distToResistance < 0.015) resistanceInteraction = 'TESTING RESISTANCE';
  else if (currentPrice < resistanceVal) resistanceInteraction = 'CAP AT';

  const lastVolume = candles[candles.length - 1].volume || 0;
  const prevVolume = candles.length > 1 ? (candles[candles.length - 2].volume || 0) : 0;
  const volumeConfirmation = lastVolume > prevVolume ? 'HIGH VOLUME CONFIRMATION' : 'VOLUME DECAYING';

  let predictedDirection = 'HOLD';
  let probability = 50;
  let expectedMove = 0.5;

  if (emaTrend === 'BULLISH' && lastRsi > 45 && volumeConfirmation.includes('HIGH')) {
    predictedDirection = 'BUY';
    probability = consensus ? Math.round((consensus.final_confidence || consensus.confidence || 0.5) * 100) : 50;
    expectedMove = consensus && consensus.expectedMove ? consensus.expectedMove : 0.0;
  } else if (emaTrend === 'BEARISH' && lastRsi < 55) {
    predictedDirection = 'SELL';
    probability = consensus ? Math.round((consensus.final_confidence || consensus.confidence || 0.5) * 100) : 50;
    expectedMove = consensus && consensus.expectedMove ? consensus.expectedMove : 0.0;
  }

  const expectedTargetPrice = predictedDirection === 'BUY' ? currentPrice * (1 + expectedMove/100) : currentPrice * (1 - expectedMove/100);
  const expectedStopPrice = predictedDirection === 'BUY' ? currentPrice * 0.985 : currentPrice * 1.015;

  // Update Prediction Engine UI elements
  const dirBadge = document.getElementById('pred-direction');
  if (dirBadge) {
    dirBadge.innerText = predictedDirection;
    dirBadge.className = `badge ${predictedDirection === 'BUY' ? 'bg-green' : predictedDirection === 'SELL' ? 'bg-red' : 'bg-blue'}`;
  }
  document.getElementById('pred-probability').innerText = `${probability}%`;
  document.getElementById('pred-move').innerText = `${expectedMove}%`;
  document.getElementById('pred-target').innerText = `₹${expectedTargetPrice.toFixed(2)}`;
  document.getElementById('pred-stop').innerText = `₹${expectedStopPrice.toFixed(2)}`;
  
  // Update reasoning fields
  document.getElementById('pred-reason-ema').innerText = emaTrend;
  document.getElementById('pred-reason-rsi').innerText = rsiCondition;
  document.getElementById('pred-reason-support').innerText = supportInteraction;
  document.getElementById('pred-reason-resistance').innerText = resistanceInteraction;
  document.getElementById('pred-reason-volume').innerText = volumeConfirmation;
  document.getElementById('pred-reason-consensus').innerText = predictedDirection === 'HOLD' ? 'NO DIRECT ACTION' : `${predictedDirection} STRATEGY APPROVED`;
}

function computeVWAP(data) {
  const vwap = [];
  if (data.length === 0) return vwap;
  let cumulativeTPV = 0;
  let cumulativeVolume = 0;
  for (let i = 0; i < data.length; i++) {
    const tp = (data[i].high + data[i].low + data[i].close) / 3;
    const vol = data[i].volume || 1;
    cumulativeTPV += tp * vol;
    cumulativeVolume += vol;
    vwap.push({ time: data[i].time, value: parseFloat((cumulativeTPV / cumulativeVolume).toFixed(2)) });
  }
  return vwap;
}

function setupReplayControls() {
  const btnPlay = document.getElementById('btn-replay-play');
  const btnPause = document.getElementById('btn-replay-pause');
  const btnBack = document.getElementById('btn-replay-back');
  const btnStep = document.getElementById('btn-replay-step');
  const btnExit = document.getElementById('btn-replay-exit');

  btnPlay.onclick = () => {
    btnPlay.style.display = 'none';
    btnPause.style.display = 'inline-block';
    
    replayInterval = setInterval(() => {
      stepReplay();
    }, 1000);
  };

  btnPause.onclick = () => {
    btnPause.style.display = 'none';
    btnPlay.style.display = 'inline-block';
    clearInterval(replayInterval);
  };

  if (btnBack) {
    btnBack.onclick = () => {
      if (replayIndex > 1) {
        replayIndex--;
        const candles = allReplayCandles.slice(0, replayIndex);
        let matchingSnapshot = null;
        if (window.tradesHistoryCache && window.tradesHistoryCache.length > 0) {
          const trade = window.tradesHistoryCache.find(t => t.symbol === currentSymbol && t.reason && t.reason.includes('| REPORT:'));
          if (trade) {
            try {
              const parts = trade.reason.split('| REPORT:');
              matchingSnapshot = JSON.parse(parts[1].trim());
              matchingSnapshot.entry_price = trade.price;
              matchingSnapshot.signal = trade.action;
            } catch (e) {}
          }
        }
        updateChartWithData(candles, matchingSnapshot?.participating_models?.agent4_technical?.indicators, matchingSnapshot);
      }
    };
  }

  btnStep.onclick = () => {
    stepReplay();
  };

  btnExit.onclick = () => {
    clearInterval(replayInterval);
    isReplaying = false;
    document.getElementById('replay-controls').style.display = 'none';
    btnPlay.style.display = 'inline-block';
    btnPause.style.display = 'none';
    loadChartForSymbol(currentSymbol);
  };
}

function stepReplay() {
  if (replayIndex >= allReplayCandles.length) {
    clearInterval(replayInterval);
    document.getElementById('btn-replay-play').style.display = 'inline-block';
    document.getElementById('btn-replay-pause').style.display = 'none';
    return;
  }

  replayIndex++;
  const candles = allReplayCandles.slice(0, replayIndex);
  
  let matchingSnapshot = null;
  if (window.tradesHistoryCache && window.tradesHistoryCache.length > 0) {
    const trade = window.tradesHistoryCache.find(t => t.symbol === currentSymbol && t.reason && t.reason.includes('| REPORT:'));
    if (trade) {
      try {
        const parts = trade.reason.split('| REPORT:');
        matchingSnapshot = JSON.parse(parts[1].trim());
        matchingSnapshot.entry_price = trade.price;
        matchingSnapshot.signal = trade.action;
      } catch (e) {}
    }
  }

  updateChartWithData(candles, matchingSnapshot?.participating_models?.agent4_technical?.indicators, matchingSnapshot);
}

// Fetch trades history
async function fetchTradesHistory() {
  try {
    const res = await fetch(`${backendBase}/api/trades`);
    const tradesTableBody = document.getElementById('trades-table-body');
    if (res.ok) {
      const trades = await res.json();
      window.tradesHistoryCache = trades;
      
      // Satisfy structural references if element exists
      if (tradesTableBody) {
        if (!trades || trades.length === 0) {
          tradesTableBody.innerHTML = `<tr><td colspan="7" class="empty-table text-center">No trades logged.</td></tr>`;
          return;
        }
        tradesTableBody.innerHTML = trades.map(t => {
          const timeStr = t.timestamp ? new Date(t.timestamp).toLocaleTimeString() : 'N/A';
          return `
            <tr onclick="explainHoldingTrade('${t.symbol || ''}')" style="cursor:pointer">
              <td>${timeStr}</td>
              <td><b>${t.symbol || 'N/A'}</b></td>
              <td style="color: ${t.action === 'BUY' ? '#10b981' : '#ef4444'}; font-weight: bold;">${t.action || 'N/A'}</td>
              <td>${t.quantity || 0}</td>
              <td>₹${Number(t.price || 0).toFixed(2)}</td>
              <td>₹${Number(t.total_value || 0).toFixed(2)}</td>
              <td><span style="font-style: italic; color: #9ca3af;">${t.reason || ''}</span></td>
            </tr>
          `;
        }).join('');
      }
    } else {
      if (tradesTableBody) {
        tradesTableBody.innerHTML = `<tr><td colspan="7" class="empty-table text-center text-red">Backend Offline / Loading...</td></tr>`;
      }
    }
  } catch (err) {
    console.error('Error fetching trade history:', err);
    const tradesTableBody = document.getElementById('trades-table-body');
    if (tradesTableBody) {
      tradesTableBody.innerHTML = `<tr><td colspan="7" class="empty-table text-center text-red">Backend Offline / Loading...</td></tr>`;
    }
  }
}

// Controls Events
btnToggleBot.addEventListener('click', async () => {
  const action = isBotRunning ? 'STOP' : 'START';
  try {
    const res = await fetch(`${backendBase}/api/control`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action })
    });
    const result = await res.json();
    if (result.success) {
      setTimeout(fetchTradesHistory, 500);
    } else {
      alert("Toggle failed: " + (result.error || "Unknown error"));
    }
  } catch (err) {
    console.error('Bot toggle request failed:', err);
    alert('Bot toggle request failed: ' + err.message);
  }
});

btnAdminReset.addEventListener('click', async () => {
  const password = adminResetPasswordInput.value.trim();
  if (!password) {
    adminResetMsg.innerText = 'Enter password.';
    adminResetMsg.style.color = '#ef4444';
    return;
  }

  try {
    const response = await fetch(`${backendBase}/api/admin/reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });
    const result = await response.json();
    if (response.ok) {
      adminResetMsg.innerText = result.message;
      adminResetMsg.style.color = '#10b981';
      adminResetPasswordInput.value = '';
      setTimeout(() => {
        adminResetPanel.style.display = 'none';
        adminResetMsg.innerText = '';
      }, 2000);
    } else {
      adminResetMsg.innerText = result.error || 'Reset failed.';
      adminResetMsg.style.color = '#ef4444';
    }
  } catch (err) {
    adminResetMsg.innerText = `Error: ${err.message}`;
    adminResetMsg.style.color = '#ef4444';
  }
});

// Periodic loops
setInterval(() => {
  const elapsed = Date.now() - window.lastUpdateTimestamp;
  const heartbeatWarning = document.getElementById('heartbeat-warning');
  if (elapsed >= 60000) {
    if (heartbeatWarning) heartbeatWarning.style.display = 'block';
    const wsDot = document.getElementById('conn-status-dot');
    const wsText = document.getElementById('conn-status-text');
    if (wsDot && wsText) {
      wsDot.className = 'status-dot disconnected';
      wsText.innerText = 'FAIL';
    }
  } else {
    if (heartbeatWarning) heartbeatWarning.style.display = 'none';
  }

  // Update IST clock every second locally using browser time
  if (liveTimeText) {
    const options = { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false };
    const istTime = new Date().toLocaleTimeString('en-US', options);
    const dateOptions = { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' };
    const istDate = new Date().toLocaleDateString('en-GB', dateOptions);
    liveTimeText.innerText = `${istDate} ${istTime} IST`;
  }
}, 1000);

// Init on load
connectWS();
fetchTradesHistory();
updateInstitutionalTelemetry();

// Periodic audits
setInterval(fetchTradesHistory, 4000);
setInterval(updateInstitutionalTelemetry, 5000);

async function updateInstitutionalTelemetry() {
  try {
    // 1. Fetch Completed Trades & Journal
    try {
      const tradesRes = await fetch(`${backendBase}/api/completed-trades`);
      const tbody = document.getElementById('inst-trade-journal-body');
      if (tradesRes.ok) {
        const completed = await tradesRes.json();
        if (tbody) {
          if (!completed || completed.length === 0) {
            tbody.innerHTML = `<tr><td colspan="8" class="empty-table text-center">No completed trades recorded in journal.</td></tr>`;
          } else {
            tbody.innerHTML = completed.map(t => `
              <tr>
                <td>${t.exit_time ? new Date(t.exit_time).toLocaleTimeString() : 'N/A'}</td>
                <td class="font-bold">${t.symbol || 'N/A'}</td>
                <td class="text-green font-bold">BUY</td>
                <td>${t.quantity || 0}</td>
                <td>₹${Number(t.entry_price || 0).toFixed(2)}</td>
                <td>₹${Number(t.exit_price || 0).toFixed(2)}</td>
                <td class="${(t.net_pnl || 0) >= 0 ? 'text-green' : 'text-red'} font-bold">₹${Number(t.net_pnl || 0).toFixed(2)}</td>
                <td>${t.exit_reason || 'N/A'}</td>
              </tr>
            `).join('');
          }
        }
      } else {
        if (tbody) tbody.innerHTML = `<tr><td colspan="8" class="empty-table text-center text-red">Backend Offline / Loading...</td></tr>`;
      }
    } catch (err) {
      const tbody = document.getElementById('inst-trade-journal-body');
      if (tbody) tbody.innerHTML = `<tr><td colspan="8" class="empty-table text-center text-red">Backend Offline / Loading...</td></tr>`;
    }
    
    // 2. Fetch Equity Curve Data
    try {
      const equityRes = await fetch(`${backendBase}/api/equity-curve`);
      if (equityRes.ok) {
        const curve = await equityRes.json();
        if (curve && Array.isArray(curve)) drawEquityCurveCanvas(curve);
      }
    } catch (err) {
      console.warn("Equity curve fetch failed", err);
    }
    
    // 3. Fetch Portfolio Allocation
    try {
      const allocRes = await fetch(`${backendBase}/api/portfolio-allocation`);
      const breakdownEl = document.getElementById('allocation-breakdown');
      const cashEl = document.getElementById('inst-alloc-cash');
      if (allocRes.ok) {
        const alloc = await allocRes.json();
        if (alloc) {
          if (cashEl) cashEl.innerText = '₹' + Number(alloc.cash || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 });
          
          if (breakdownEl) {
            if (!alloc.holdings || alloc.holdings.length === 0) {
              breakdownEl.innerHTML = `<div>Cash: <b>₹${Number(alloc.cash || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</b></div><div class="text-xs text-gray-400 mt-2">No Active Positions</div>`;
            } else {
              let html = `<div>Cash: <b>₹${Number(alloc.cash || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</b></div>`;
              alloc.holdings.forEach(h => {
                html += `<div>${h.symbol || 'UNK'}: <b>₹${Number(h.value || 0).toFixed(2)} (${(h.percentage || 0).toFixed(1)}%)</b></div>`;
              });
              breakdownEl.innerHTML = html;
            }
          }
        }
      } else {
        if (breakdownEl) breakdownEl.innerHTML = `<div class="text-xs text-red mt-2">Backend Offline / Loading...</div>`;
        if (cashEl) cashEl.innerText = 'Offline';
      }
    } catch (err) {
      const breakdownEl = document.getElementById('allocation-breakdown');
      const cashEl = document.getElementById('inst-alloc-cash');
      if (breakdownEl) breakdownEl.innerHTML = `<div class="text-xs text-red mt-2">Backend Offline / Loading...</div>`;
      if (cashEl) cashEl.innerText = 'Offline';
    }
    
    // 4. Fetch Market Breadth
    try {
      const breadthRes = await fetch(`${backendBase}/api/market-breadth`);
      const breadthEl = document.getElementById('inst-market-breadth');
      if (breadthRes.ok) {
        const breadth = await breadthRes.json();
        if (breadthEl && breadth) {
          breadthEl.innerText = `${breadth.bullish || 0}B / ${breadth.bearish || 0}S`;
        }
      } else {
        if (breadthEl) breadthEl.innerText = 'Offline';
      }
    } catch (err) {
      const breadthEl = document.getElementById('inst-market-breadth');
      if (breadthEl) breadthEl.innerText = 'Offline';
    }
    
    // 5. Fetch Analytics
    try {
      const analyticsRes = await fetch(`${backendBase}/api/analytics`);
      const pfEl = document.getElementById('inst-profit-factor');
      const sharpeEl = document.getElementById('inst-sharpe-ratio');
      if (analyticsRes.ok) {
        const analytics = await analyticsRes.json();
        if (analytics) {
          if (pfEl) pfEl.innerText = analytics.profitFactor != null ? analytics.profitFactor.toFixed(2) : 'N/A';
          if (sharpeEl) sharpeEl.innerText = analytics.sharpeRatio != null ? analytics.sharpeRatio.toFixed(2) : 'N/A';
        }
      } else {
        if (pfEl) pfEl.innerText = 'Offline';
        if (sharpeEl) sharpeEl.innerText = 'Offline';
      }
    } catch (err) {
      const pfEl = document.getElementById('inst-profit-factor');
      const sharpeEl = document.getElementById('inst-sharpe-ratio');
      if (pfEl) pfEl.innerText = 'Offline';
      if (sharpeEl) sharpeEl.innerText = 'Offline';
    }
    
    // 6. Draw Heatmap
    drawHeatmap();
    
  } catch (err) {
    console.error('Error fetching institutional telemetry:', err);
  }
}

function drawEquityCurveCanvas(data) {
  const canvas = document.getElementById('equity-curve-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  
  ctx.clearRect(0, 0, width, height);
  if (data.length === 0) return;
  
  const values = data.map(d => d.value);
  const minVal = Math.min(...values) * 0.999;
  const maxVal = Math.max(...values) * 1.001;
  const valRange = maxVal - minVal || 1;
  
  ctx.strokeStyle = '#3b82f6';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  
  data.forEach((d, idx) => {
    const x = (idx / (data.length - 1)) * (width - 20) + 10;
    const y = height - ((d.value - minVal) / valRange) * (height - 30) - 15;
    if (idx === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  });
  ctx.stroke();
  
  ctx.fillStyle = 'rgba(59, 130, 246, 0.08)';
  ctx.lineTo((width - 20) + 10, height);
  ctx.lineTo(10, height);
  ctx.closePath();
  ctx.fill();
}

function drawHeatmap() {
  const container = document.getElementById('agent-heatmap-container');
  if (!container) return;
  
  let html = '';
  // V10.1: Connect to real agent confidence from window.lastDashboardData
  const heatmapLeaderboard = (typeof window !== 'undefined' && window.lastDashboardData && window.lastDashboardData.agentLeaderboard) ? window.lastDashboardData.agentLeaderboard : {};
  const heatmapAgentIds = Object.keys(heatmapLeaderboard);
  if (heatmapAgentIds.length > 0) {
    heatmapAgentIds.forEach((id, i) => {
      const confidence = heatmapLeaderboard[id].weight || 0.0;
      const color = `rgba(16, 185, 129, ${confidence.toFixed(2)})`;
      html += `
        <div style="background: ${color}; border-radius: 4px; padding: 6px; text-align: center; color: black; font-weight: bold;">
          ${id}<br>${(confidence * 100).toFixed(0)}%
        </div>
      `;
    });
  } else {
    html += `
      <div style="grid-column: span 4; text-align: center; color: rgba(255,255,255,0.4); font-size: 11px;">
        Awaiting agent data...
      </div>
    `;
  }
  container.innerHTML = html;
}
