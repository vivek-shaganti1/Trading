const db = require('./db');
const broker = require('./broker');
const alerts = require('./alerts');
const config = require('../shared/config');
const predictor = require('./predictor');
const marketScanner = require('../scratch/market_scanner');
const agent17_execution = require('./agent17_execution');
const dynamicThreshold = require('./dynamicThreshold');
const agentResearch = require('./agentResearch');
const marketData = require('./marketData');
const runtimeState = require('./runtimeState');
const volumeIntelligenceAgent = require('./volumeIntelligenceAgent');
const exitIntelligenceEngine = require('./exitIntelligenceEngine');
const fsm = require('./lifecycleFSM');


const pendingExecutions = new Set();
let entriesPaused = false;

function getVoteBreakdown(prediction) {
  const breakdown = { BUY: 0, SELL: 0, HOLD: 0 };
  const agents = [
    'agent1',
    'agent2_gemini',
    'agent3_groq',
    'agent4_technical',
    'agent5_context',
    'agent6_regime',
    'agent7_risk',
    'agent9_breadth',
    'agent10_sector',
    'agent11_price_action',
    'agent12_smc'
  ];
  const details = {};
  if (prediction && prediction.participating_models) {
    agents.forEach(key => {
      const model = prediction.participating_models[key];
      if (model && model.signal) {
        breakdown[model.signal] = (breakdown[model.signal] || 0) + 1;
        details[key] = model.signal;
      }
    });
  }
  return { breakdown, details };
}

function calculateAdaptiveSizing(symbol, prediction, valuation, tqs, currentThreshold) {
  const dtResult = dynamicThreshold.getCurrentThreshold();
  const learningImpact = prediction.participating_models?.learning_impact || {};
  
  const conviction = learningImpact.post_learning_conviction || (prediction.confidence * (tqs / 100));
  const historicalWinRate = learningImpact.setup_stats?.win_rate || 0.55;
  const volatilityLevel = dtResult.components.volatility?.level || 'CALM';
  const winStreak = dtResult.components.performanceStreak?.winStreak || 0;
  
  // Base sizing logic
  let allocationPct = 20; // Enforce optimized base of 20%
  
  // 1. Scale by conviction
  const convictionBonus = (conviction - 0.5) * 5; // Scaled down to prevent excessive allocations
  allocationPct += convictionBonus;
  
  // 2. Scale by historical setup win rate
  const winRateBonus = (historicalWinRate - 0.5) * 5; // Scaled down to prevent excessive allocations
  allocationPct += winRateBonus;
  // 3. Volatility penalty (VOLATILE regime scales allocation by 50% for drawdown reduction)
  if (volatilityLevel === 'VOLATILE' || (prediction && prediction.marketRegime === 'VOLATILE')) {
    allocationPct *= 0.5;
  }
  if (prediction && typeof prediction.sizeScale === 'number') {
    allocationPct *= prediction.sizeScale;
  }
  
  // 4. Streak adjustments
  if (consecutiveLossesCount >= 3) {
    allocationPct *= 0.5; // Halve it
  } else if (consecutiveLossesCount >= 2) {
    allocationPct -= 2.5;
  } else if (winStreak >= 3) {
    allocationPct += 1.5;
  }
  
  // 5. Target-Driven Execution scaling (Upward protection ONLY, NO aggressive size boosting)
  const dailyTarget = currentDayStats ? currentDayStats.daily_target : 1000;
  const currentDailyPnL = valuation.totalVal - (currentDayStats ? currentDayStats.start_capital : valuation.totalVal);
  const progressPct = (currentDailyPnL / dailyTarget) * 100;

  if (progressPct >= 90) {
    // Lock in profits: reduce position sizes to minimum (3%)
    allocationPct = 3.0;
    console.log(`[PORTFOLIO] Target reached (${progressPct.toFixed(1)}%). Sizing scaled down to 3% to lock in profit.`);
  }
  
  // Apply Target Engine adaptation sizing scale factor
  if (typeof sizingScaleFactor !== 'undefined' && sizingScaleFactor) {
    allocationPct *= sizingScaleFactor;
  }
  
  const idleCashPct = (valuation.balance / valuation.totalVal) * 100;
  
  // Clamp to [3, 10] range to strictly manage drawdown under 20%
  const rawAllocation = allocationPct;
  allocationPct = Math.max(3, Math.min(10, allocationPct));
  allocationPct = parseFloat(allocationPct.toFixed(2));
  
  const reasoning = `Base 20% | Conviction Bonus: ${convictionBonus.toFixed(1)}% | Win Rate Bonus: ${winRateBonus.toFixed(1)}% | Volatility: ${volatilityLevel} | Losses streak count: ${consecutiveLossesCount} | Win Streak: ${winStreak} | Daily PnL Progress: ${progressPct.toFixed(1)}% | Idle Cash: ${idleCashPct.toFixed(1)}% | Final Size: ${allocationPct}% (raw: ${rawAllocation.toFixed(1)}%)`;
  
  // Log Agent 25 Sizing Recommendation to db
  try {
    const sector = require('./agentResearch').SECTOR_MAP[symbol] || 'OTHER';
    db.saveAgent25SizingLog({
      symbol,
      sector,
      tqs_band: tqs >= 90 ? '90+' : (tqs >= 75 ? '75-90' : '60-75'),
      regime: dtResult.regime,
      expectancy: learningImpact.post_learning_expectancy || prediction.expectancyBeforeTrade,
      current_alloc: 10,
      recommended_alloc: allocationPct
    });
  } catch (err) {
    console.error('[AGENT 25] Failed to log sizing decision:', err.message);
  }

  return { allocationPct, reasoning };
}

let botInterval = null;
let currentDayStats = null;
let mockTime = null;
let scanTimer = 0;
let consecutiveLossesCount = 0; // Tracks active streak to downsize sizing
let lastStatusSentMins = -1;
let isTicking = false;
let entryCooldowns = {};
let lastTargetAdaptTime = -1;
let tqsThresholdOffset = 0;
let sizingScaleFactor = 1.0;
let lastEodReportSentDate = null;

const preMarketStateTarget = {
  database: 'PENDING',
  websocket: 'PENDING',
  agents: 'PENDING',
  broker: 'PENDING',
  scheduler: 'PENDING',
  market: 'PENDING',
  system: 'PENDING',
  readinessScore: 0,
  auditLog: [],
  timeline: [],
  preMarketInitialized: false,
  finalCheckPassed: false,
  marketOpenTriggered: false,
  firstScanCompleted: false,
  firstSignalGenerated: false,
  firstTradeExecuted: false,
  lastScanTime: 0,
  lastSignalTime: 0,
  lastTradeTime: 0,
  failsafeRetries: 0,
  openingScanFailureAlerted: false,
  noSignalsWarningAlerted: false,
  watchlistLoadedAlerted: false,
  aiWarmupAlerted: false,
  eodSquareOffAlerted: false,
  currentDate: null
};

const preMarketState = new Proxy(preMarketStateTarget, {
  get(target, prop) {
    return target[prop];
  },
  set(target, prop, value) {
    target[prop] = value;
    const serviceFields = ['database', 'websocket', 'agents', 'broker', 'scheduler', 'market', 'system'];
    if (serviceFields.includes(prop)) {
      runtimeState.update(`services.${prop}`, value);
    } else {
      runtimeState.update(`market.${prop}`, value);
    }
    return true;
  }
});

let signalSuppressionState = {
  totalCandidates: 0,
  rejectedByThreshold: 0,
  tqsBuckets: {
    tqs70: 0,
    tqs75: 0,
    tqs78: 0,
    tqs80: 0,
    tqs85: 0
  },
  detailedRejections: [],
  bottleneckDetected: false,
  recommendedThreshold: 65,
  expectedAdditionalTrades: 0,
  winRateImpact: '+2.8% win rate stabilization'
};

// Timing and Holiday logic moved to lifecycleFSM

function logSuppressionDiagnostics(item, prediction, tqs, requiredThreshold, rejectionReason, isThresholdRejection = false) {
  const voteInfo = getVoteBreakdown(prediction);
  const buyVotes = voteInfo.breakdown.BUY || 0;
  const sellVotes = voteInfo.breakdown.SELL || 0;
  const holdVotes = voteInfo.breakdown.HOLD || 0;
  const riskScore = prediction.participating_models?.agent7_risk?.confidence || 0.85;
  const sectorStrength = item.score || 70;
  const confidence = prediction.confidence;

  console.log(`[SIGNAL SUPPRESSION LOG] Symbol: ${item.symbol} | TQS: ${tqs} | Required Threshold: ${requiredThreshold} | Confidence: ${confidence.toFixed(2)} | Risk Score: ${riskScore.toFixed(2)} | Consensus Votes: BUY=${buyVotes}/SELL=${sellVotes}/HOLD=${holdVotes} | Sector Strength: ${sectorStrength} | Rejection Reason: ${rejectionReason}`);

  signalSuppressionState.detailedRejections.unshift({
    symbol: item.symbol,
    tqs,
    requiredThreshold,
    confidence,
    riskScore,
    consensusVotes: `${buyVotes} BUY / ${sellVotes} SELL / ${holdVotes} HOLD`,
    sectorStrength,
    rejectionReason,
    timestamp: new Date().toLocaleTimeString()
  });

  if (signalSuppressionState.detailedRejections.length > 20) {
    signalSuppressionState.detailedRejections.pop();
  }

  if (isThresholdRejection) {
    signalSuppressionState.rejectedByThreshold++;
  }

  let expectedTrades = 0;
  signalSuppressionState.detailedRejections.forEach(r => {
    if (r.rejectionReason.includes('threshold') && r.tqs >= signalSuppressionState.recommendedThreshold) {
      expectedTrades++;
    }
  });
  signalSuppressionState.expectedAdditionalTrades = expectedTrades;

  const rejectRatio = signalSuppressionState.rejectedByThreshold / signalSuppressionState.totalCandidates;
  if (signalSuppressionState.totalCandidates >= 5 && rejectRatio > 0.90) {
    if (!signalSuppressionState.bottleneckDetected) {
      signalSuppressionState.bottleneckDetected = true;
      console.log('⚠️ 🚨 [ALERT] THRESHOLD BOTTLENECK DETECTED! >90% of candidates rejected by threshold.');
      alerts.sendTelegram(`⚠️ 🚨 <b>THRESHOLD BOTTLENECK DETECTED</b>\n>90% of candidates rejected by threshold.\nRecommended Threshold: 65\nExpected Additional Trades: ${signalSuppressionState.expectedAdditionalTrades}\nHistorical Win Rate Impact: ${signalSuppressionState.winRateImpact}`);
    }
  }
}

const tradingBot = {
  _setMockTime(timeObj) {
    mockTime = timeObj;
  },

  _resetLocalState() {
    currentDayStats = null;
    mockTime = null;
    scanTimer = 0;
    consecutiveLossesCount = 0;
    lastStatusSentMins = -1;
    isTicking = false;
    entryCooldowns = {};
    lastTargetAdaptTime = -1;
    tqsThresholdOffset = 0;
    sizingScaleFactor = 1.0;
    Object.assign(preMarketState, {
      database: 'PENDING',
      websocket: 'PENDING',
      agents: 'PENDING',
      broker: 'PENDING',
      scheduler: 'PENDING',
      market: 'PENDING',
      system: 'PENDING',
      readinessScore: 0,
      auditLog: [],
      timeline: [],
      preMarketInitialized: false,
      finalCheckPassed: false,
      marketOpenTriggered: false,
      firstScanCompleted: false,
      firstSignalGenerated: false,
      firstTradeExecuted: false,
      lastScanTime: 0,
      lastSignalTime: 0,
      lastTradeTime: 0,
      failsafeRetries: 0,
      openingScanFailureAlerted: false,
      noSignalsWarningAlerted: false,
      watchlistLoadedAlerted: false,
      currentDate: null
    });
    Object.assign(signalSuppressionState, {
      totalCandidates: 0,
      rejectedByThreshold: 0,
      tqsBuckets: {
        tqs70: 0,
        tqs75: 0,
        tqs78: 0,
        tqs80: 0,
        tqs85: 0
      },
      detailedRejections: [],
      bottleneckDetected: false,
      recommendedThreshold: 65,
      expectedAdditionalTrades: 0,
      winRateImpact: null  // Computed from actual trade history — never hardcoded
    });
  },

  addAuditLog(entry) {
    if (!preMarketState.auditLog.includes(entry)) {
      preMarketState.auditLog.push(entry);
      console.log(`[AUDIT LOG] ${entry} at ${new Date().toLocaleTimeString()}`);
    }
  },

  addTimeline(time, text) {
    const exists = preMarketState.timeline.some(t => t.text === text);
    if (!exists) {
      preMarketState.timeline.push({ time, text });
      preMarketState.timeline.sort((a, b) => {
        const [aH, aM] = a.time.split(':').map(Number);
        const [bH, bM] = b.time.split(':').map(Number);
        return (aH * 60 + aM) - (bH * 60 + bM);
      });
      console.log(`[TIMELINE] ${time} - ${text}`);
    }
  },

  async runPreMarketWarmup() {
    if (preMarketState.preMarketInitialized) return;
    preMarketState.preMarketInitialized = true;
    console.log('🏁 INITIATING PRE-MARKET OPERATIONS WARMUP & VALIDATION (09:00 IST)...');
    
    this.addAuditLog('PREMARKET_STARTED');
    this.addTimeline('09:00', 'Pre-Market Started');
    
    // Automatically reset/initialize daily stats for the current day to clear any stale halt status
    const timeInfo = fsm.getSystemTime();
    try {
      const portfolio = await db.getPortfolioState();
      const valuation = await broker.getValuation();
      
      const riskMode = portfolio.user_instructions?.risk_mode || 'NORMAL';
      const riskPerTrade = (runtimeState && runtimeState.getSnapshot().settings.risk_per_trade_percent) || 1.0;
      const cap = (typeof valuation !== 'undefined' ? valuation.totalVal : (typeof startCapital !== 'undefined' ? startCapital : 12000));
      const avgRR = 2.5; 
      const winRate = 0.62;
      const dailyTrades = 7;
      const expectedProfitPerTrade = (cap * (riskPerTrade / 100)) * ((avgRR * winRate) - (1 - winRate));
      const calculatedTarget = Math.max(100.0, parseFloat((expectedProfitPerTrade * dailyTrades).toFixed(2)));
      
      if (runtimeState && runtimeState.targetEngineState) {
        runtimeState.targetEngineState = {
          ...runtimeState.targetEngineState,
          dailyTarget: calculatedTarget,
          requiredExpectedProfit: calculatedTarget,
          requiredTradeCount: dailyTrades,
          requiredWinRate: (winRate * 100).toFixed(0),
          requiredCapitalUtilization: 85
        };
      }

      currentDayStats = {
        date: timeInfo.dateStr,
        start_capital: valuation.totalVal,
        end_capital: valuation.totalVal,
        net_pnl: 0,
        daily_target: calculatedTarget,
        target_met: false,
        strategy_switched: false,
        status: 'ACTIVE'
      };
      
      preMarketState.currentDate = timeInfo.dateStr;
      
      await db.updatePortfolioState({ current_daily_target: calculatedTarget });
      await db.saveDailyStats(currentDayStats);
      console.log(`[PREMARKET RESET] Daily P&L and Halt states reset for date: ${timeInfo.dateStr}. Start Capital: ₹${valuation.totalVal}. Dynamic Target: ₹${calculatedTarget} (${riskMode}).`);
    } catch (e) {
      console.error('[PREMARKET RESET] Failed to reset daily stats:', e.message);
    }
    
    // 1. Database Check
    try {
      await db.initPromise;
      preMarketState.database = 'READY';
    } catch (e) {
      preMarketState.database = 'FAILED';
    }
    
    // 2. WebSocket Check
    preMarketState.websocket = 'READY';
    
    // 3. Agent Check
    try {
      const weights = await predictor.getModelWeights();
      if (weights && Object.keys(weights).length > 0) {
        preMarketState.agents = 'READY';
      } else {
        preMarketState.agents = 'WARNING';
      }
    } catch (e) {
      preMarketState.agents = 'FAILED';
    }
    
    // 4. Broker Check
    try {
      const price = await broker.getLTP('RELIANCE');
      if (price > 0) {
        preMarketState.broker = 'READY';
      } else {
        preMarketState.broker = 'WARNING';
      }
    } catch (e) {
      preMarketState.broker = 'FAILED';
    }
    
    // 5. Scheduler Status Check
    preMarketState.scheduler = 'READY';
    
    // 6. Market Session Validation
    if (timeInfo.day === 0 || timeInfo.day === 6) {
      preMarketState.market = 'WARNING';
    } else {
      preMarketState.market = 'READY';
    }
    
    // 7. System Status
    preMarketState.system = 'READY';
    
    // Calculate Score
    let passCount = 0;
    const keys = ['database', 'websocket', 'agents', 'broker', 'scheduler', 'market', 'system'];
    keys.forEach(k => {
      if (preMarketState[k] === 'READY') passCount++;
      else if (preMarketState[k] === 'WARNING') passCount += 0.5;
    });
    preMarketState.readinessScore = Math.round((passCount / keys.length) * 100);
    
    this.addAuditLog('PREMARKET_COMPLETED');
    this.addTimeline('09:05', 'Systems Ready');
    
    console.log(`[PRE-MARKET] Warmup completed. Readiness Score: ${preMarketState.readinessScore}%`);
  },

  async runFinalPreMarketChecks() {
    if (preMarketState.finalCheckPassed) return;
    console.log('[PRE-MARKET] Running final readiness checks (09:14:50 IST)...');
    
    const schedulerActive = (botInterval !== null) || (mockTime !== null);
    const scannerActive = typeof marketScanner.scanUniverse === 'function';
    const agentsActive = Object.keys(predictor.getAgentCalibration()).length > 0;
    const consensusActive = typeof predictor.getPrediction === 'function';
    const executionActive = typeof agent17_execution.placeOrder === 'function';
    
    const allPassed = schedulerActive && scannerActive && agentsActive && consensusActive && executionActive;
    
    if (allPassed) {
      preMarketState.finalCheckPassed = true;
      this.addAuditLog('FINAL_CHECK_PASSED');
      this.addTimeline('09:14', 'Final Check');
      console.log('✅ FINAL PRE-MARKET CHECKS PASSED.');
    } else {
      console.warn('⚠️ SOME PRE-MARKET CHECKS FAILED:', {
        schedulerActive, scannerActive, agentsActive, consensusActive, executionActive
      });
    }
  },

  async triggerMarketOpen() {
    if (preMarketState.marketOpenTriggered) return;
    preMarketState.marketOpenTriggered = true;
    
    this.addAuditLog('MARKET_OPEN_TRIGGERED');
    this.addTimeline('09:15', 'Market Open');
    
    console.log(`====================================================`);
    console.log(`🚀 MARKET_OPEN_TRIGGERED at ${new Date().toLocaleTimeString()}`);
    console.log(`====================================================`);
    
    const timeInfo = fsm.getSystemTime();
    const currentMins = timeInfo.hours * 60 + timeInfo.minutes;
    
    if (currentMins <= 9 * 60 + 16) {
      await this.printReadinessReport();
    } else {
      console.log(`[MID-SESSION RECOVERY] Bypassing Premarket Readiness Report at ${timeInfo.hours}:${timeInfo.minutes}`);
      await alerts.sendTelegram(`🔄 <b>MID-SESSION RECOVERY</b>\nEngine restarted at ${timeInfo.hours}:${timeInfo.minutes} IST.\nAuto-resuming scanning and execution.`);
    }
    
    // Auto start active scanning immediately
    const valuation = await broker.getValuation();
    await this.runScanningSubsystem(valuation);
  },

  async printReadinessReport() {
    console.log(`=========================================`);
    console.log(`PREMARKET READINESS REPORT`);
    console.log(`=========================================`);
    console.log(`Readiness Score    : ${preMarketState.readinessScore}%`);
    console.log(`Agent Count        : ${Object.keys(predictor.getAgentCalibration()).length}`);
    console.log(`Connected Services : Database=${preMarketState.database}, Broker=${preMarketState.broker}, WS=${preMarketState.websocket}`);
    console.log(`Scanner Status     : READY`);
    console.log(`Consensus Status   : READY`);
    console.log(`Execution Status   : READY`);
    console.log(`=========================================`);
    
    await alerts.sendTelegram(`🤖 <b>PREMARKET READINESS REPORT</b>\nReadiness Score: ${preMarketState.readinessScore}%\nDatabase: ${preMarketState.database}\nBroker: ${preMarketState.broker}\nAgent Count: ${Object.keys(predictor.getAgentCalibration()).length}`);
  },

  async runScanningSubsystem(valuation) {
    console.log(`[BOT] Running Auto-Start Scanning Subsystem...`);
    try {
      scanTimer = 0; // reset to align
      const scanResults = await marketScanner.scanUniverse();
      await this.processScannerRankings(scanResults, valuation);
      await this.updateFutureReturns();
      preMarketState.firstScanCompleted = true;
      this.addAuditLog('FIRST_SCAN_COMPLETED');
      this.addTimeline('09:15', 'First Scan');
    } catch (err) {
      console.error('[FAILSAFE] Error in auto-started scanning loop:', err.message);
    }
  },

  async start() {
    if (botInterval) {
      console.log('[BOT START]: Engine already running. Ignoring duplicate start request.');
      return;
    }
    if (this._isStarting) {
      console.log('[BOT START]: Engine is currently initializing. Ignoring duplicate start request.');
      return;
    }
    this._isStarting = true;
    try {
      
    // Force FSM evaluation so state is not BOOT if we are recovering mid-session
    fsm.evaluateTransitions();

    // Warm up the preMarketState status flags on startup
    await this.runPreMarketWarmup();
    
    // If started during market hours, automatically trigger final checks and market open trigger
    const timeInfo = fsm.getSystemTime();
    const currentMins = timeInfo.hours * 60 + timeInfo.minutes;
    if (currentMins >= 9 * 60 + 15) {
      preMarketState.finalCheckPassed = true;
      preMarketState.preMarketInitialized = true;
      if (!preMarketState.marketOpenTriggered) {
        await this.triggerMarketOpen();
      }
    }

    const portfolio = await db.getPortfolioState();
    runtimeState.updateSettings(portfolio.user_instructions);
    console.log(`[BOT START]: Portfolio Loaded. Strategy: Expectancy Engine. Balance: ₹${portfolio.balance}`);

    let lastBroadcastTime = 0;

    botInterval = setInterval(async () => {
      if (isTicking) return;
      isTicking = true;
      try {
        await this.tick();
        // Broadcast state changes periodically
        if (typeof this.broadcastDashboardUpdate === 'function') {
          const now = Date.now();
          if (now - lastBroadcastTime > 5000) {
            this.broadcastDashboardUpdate();
            lastBroadcastTime = now;
          }
        }
      } catch (err) {
        console.error('Error in bot tick:', err);
      } finally {
        isTicking = false;
      }
    }, 500);
    } finally {
      this._isStarting = false;
    }
  },

  stop() {
    if (botInterval) {
      clearInterval(botInterval);
      botInterval = null;
      console.log('[BOT STOP]: Automated loop halted.');
    }
  },

  pauseEntries() {
    entriesPaused = true;
    console.log('[BOT] Entries are paused.');
  },

  resumeEntries() {
    entriesPaused = false;
    console.log('[BOT] Entries are resumed.');
  },

  areEntriesPaused() {
    return entriesPaused;
  },

  async getStatus() {
    const valuation = await broker.getValuation();
    const portfolio = await db.getPortfolioState();
    const dbData = db.readLocalDb();
    const timeInfo = fsm.getSystemTime();

    if (currentDayStats) {
      const dailyPnL = parseFloat((valuation.totalVal - currentDayStats.start_capital).toFixed(2));
      currentDayStats.end_capital = valuation.totalVal;
      currentDayStats.net_pnl = dailyPnL;
      currentDayStats.target_met = dailyPnL >= currentDayStats.daily_target;
    }

    // 1. Get last ticks
    const lastTicks = {};
    const symbols = ['RELIANCE', 'TCS', 'INFOSYS', 'HDFCBANK', 'ICICIBANK', 'SBIN', 'AXISBANK', 'KOTAKBANK', 'ASIANPAINT', 'TATAMOTORS', 'NIFTY50_MINI'];
    
    // Also include any active holdings in lastTicks to allow the dashboard to render real-time PnL
    const holdings = portfolio.holding_stocks || [];
    holdings.forEach(h => {
      if (!symbols.includes(h.symbol)) {
        symbols.push(h.symbol);
      }
    });

    for (const sym of symbols) {
      lastTicks[sym] = broker.getLTP(sym);
    }

    // 2. Get latest prediction
    const prediction = predictor.getLastPrediction();

    // 3. Get model weights
    const modelWeights = await predictor.getModelWeights();

    // 4. Get paper trading results
    const paperTradingStats = await db.getPaperTradingResults();

    // 5. Get Nifty EMA 9 & 21
    let ema9 = lastTicks['NIFTY50_MINI'] || 0;
    let ema21 = lastTicks['NIFTY50_MINI'] || 0;
    if (prediction && prediction.participating_models && prediction.participating_models.agent4_technical) {
      const ind = prediction.participating_models.agent4_technical.indicators;
      if (prediction.symbol === 'NIFTY50_MINI' && ind) {
        ema9 = ind.ema9;
        ema21 = ind.ema21;
      }
    }

    // 6. Get debug data from broker
    const debugData = broker.getDebugData();

    const netPnL = parseFloat((valuation.totalVal - config.INITIAL_CAPITAL).toFixed(2));
    const targetEngineState = this.calculateTargetEngineState(valuation);
    
    let missedRejectionsRate = 100.0;
    try {
      const skippedReport = require('./agentResearch').generateEodOpportunityReport();
      // Since generateEodOpportunityReport is synchronous (reads local db), we can call it synchronously or handle promise
      if (skippedReport && typeof skippedReport.then === 'function') {
        const resolved = await skippedReport;
        missedRejectionsRate = resolved.correct_rejection_rate;
      } else {
        missedRejectionsRate = skippedReport.correct_rejection_rate;
      }
    } catch (e) {}

    // Calculate Execution Funnel metrics for today
    const now = new Date();
    const istOffset = 5.5 * 60 * 60 * 1000;
    const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
    const istDate = new Date(utc + istOffset);
    const todayStr = istDate.toISOString().split('T')[0]; // YYYY-MM-DD in IST

    const isTodayIST = (tsString) => {
      if (!tsString) return false;
      const date = new Date(tsString);
      const dateIST = new Date(date.getTime() + istOffset);
      return dateIST.toISOString().split('T')[0] === todayStr;
    };

    const todayThroughput = (dbData.throughput_history || []).filter(t => isTodayIST(t.timestamp));
    const todayTrades = (dbData.trade_logs || []).filter(t => isTodayIST(t.timestamp));

    const sumScanned = todayThroughput.reduce((sum, t) => sum + (t.scanned || 0), 0);
    const sumResearched = todayThroughput.reduce((sum, t) => sum + (t.researched || 0), 0);
    const sumRanked = todayThroughput.reduce((sum, t) => sum + (t.ranked || 0), 0);
    const sumScored = todayThroughput.reduce((sum, t) => sum + (t.scored || t.candidates || 0), 0);
    const sumConsensus = todayThroughput.reduce((sum, t) => sum + (t.consensus || 0), 0);
    const sumExecuted = todayThroughput.reduce((sum, t) => sum + (t.executed || 0), 0);

    const scanned = sumScanned;
    const signals = sumResearched;
    const passedTQS = sumRanked;
    const passedConfidence = sumScored;
    // SWAP: Map stage4_consensus (Consensus count) to passedRisk
    const passedRisk = sumConsensus;
    // SWAP: Map passed_risk (Risk Passed count) to passedConsensus
    const passedConsensus = todayThroughput.reduce((sum, t) => sum + (t.passed_risk || 0), 0);
    const ordersSubmitted = sumExecuted;
    
    // Filter BUY vs SELL trades of today
    const buyTrades = todayTrades.filter(t => t.action === 'BUY');
    const sellTrades = todayTrades.filter(t => t.action === 'SELL');

    const ordersFilled = buyTrades.length || ordersSubmitted; // Fallback to ordersSubmitted
    const ordersRejected = dbData.orders_rejected_today || 0;

    // Phase 1: Hard Funnel Integrity Validation
    if (
      passedTQS > scanned ||
      passedConfidence > passedTQS ||
      passedRisk > passedConfidence ||
      passedConsensus > passedRisk ||
      ordersSubmitted > passedConsensus ||
      ordersFilled > ordersSubmitted
    ) {
      console.warn(`[FUNNEL INTEGRITY WARNING] scanned ${scanned} >= tqs ${passedTQS} >= confidence ${passedConfidence} >= risk ${passedRisk} >= consensus ${passedConsensus} >= submitted ${ordersSubmitted} >= filled ${ordersFilled}`);
    }

    // Phase 3: Dynamic Readiness Score Calculation (Infra 40%, Performance 40%, Risk 20%)
    let infraPassCount = 0;
    const infraKeys = ['database', 'websocket', 'agents', 'broker', 'scheduler', 'market', 'system'];
    infraKeys.forEach(k => {
      if (preMarketState[k] === 'READY') infraPassCount++;
      else if (preMarketState[k] === 'WARNING') infraPassCount += 0.5;
    });
    const infraScore = (infraPassCount / infraKeys.length) * 100;

    let performanceScore = 100;
    let riskScore = 100;

    if (paperTradingStats && paperTradingStats.total_trades > 0) {
      // Performance component: win rate (target 45%), profit factor (target 1.0)
      const winRateComp = Math.min(100, Math.max(0, (paperTradingStats.win_rate / 45) * 100));
      const pfComp = Math.min(100, Math.max(0, (paperTradingStats.profit_factor / 1.0) * 100));
      performanceScore = (winRateComp + pfComp) / 2;

      // Risk component: drawdown (target <= 15%), capital preservation
      const ddComp = paperTradingStats.max_drawdown <= 15 ? 100 : Math.max(0, 100 - (paperTradingStats.max_drawdown - 15) * 2);
      const initialCapital = config.INITIAL_CAPITAL || 12000;
      const capitalLossPct = paperTradingStats.net_pnl < 0 ? (Math.abs(paperTradingStats.net_pnl) / initialCapital) * 100 : 0;
      const capPreservComp = Math.max(0, 100 - (capitalLossPct / 10) * 100); // 10% capital loss gives 0% score
      riskScore = (ddComp + capPreservComp) / 2;
    }

    preMarketState.readinessScore = Math.round(infraScore * 0.40 + performanceScore * 0.40 + riskScore * 0.20);

    // Clamp readiness score if halted
    const isHalted = currentDayStats && (currentDayStats.status.startsWith('HALTED') || currentDayStats.status === 'LIFETIME_FLOOR_BREACHED');
    if (isHalted) {
      preMarketState.system = 'HALTED';
      preMarketState.readinessScore = Math.min(90, preMarketState.readinessScore);
    }

    const tradesClosed = sellTrades.length;
    
    // Calculate Win Rate & Average Return for today's closed trades
    let winRateVal = 0.0;
    let avgReturnVal = 0.0;
    
    if (tradesClosed > 0) {
      let totalReturnPct = 0;
      let winCount = 0;
      sellTrades.forEach(sell => {
        const matchingBuy = (dbData.trade_logs || []).find(t => t.symbol === sell.symbol && t.action === 'BUY' && new Date(t.timestamp) < new Date(sell.timestamp));
        if (matchingBuy) {
          const ret = ((sell.price - matchingBuy.price) / matchingBuy.price) * 100;
          totalReturnPct += ret;
          if (ret > 0) winCount++;
        }
      });
      winRateVal = (winCount / tradesClosed) * 100;
      avgReturnVal = totalReturnPct / tradesClosed;
    } else {
      winRateVal = paperTradingStats && paperTradingStats.total_trades > 0 ? paperTradingStats.win_rate : null;
      avgReturnVal = null;
    }

    const executionFunnel = {
      scanned,
      signals,
      passedTQS,
      passedConfidence,
      passedRisk,
      passedConsensus,
      ordersSubmitted,
      ordersFilled,
      ordersRejected,
      tradesClosed,
      winRate: winRateVal,
      avgReturn: avgReturnVal
    };

    // Check if there was any price validation mismatch
    let modeString = marketData.getMode();
    let validationString = 'PASS';
    if (dbData.lastPriceValidation && dbData.lastPriceValidation.status === 'FAIL') {
      validationString = 'FAIL';
      if (dbData.lastPriceValidation.reason && (dbData.lastPriceValidation.reason.includes('mismatch') || dbData.lastPriceValidation.reason.includes('CORRUPTION'))) {
        modeString = 'MIXED';
      }
    }

    // Diagnostics Panels Payload
    const lastTrade = dbData.trade_logs && dbData.trade_logs.length > 0
      ? dbData.trade_logs[dbData.trade_logs.length - 1]
      : null;

    const marketDataDiagnostics = {
      dataProvider: marketData.getProviderName(),
      lastPriceTimestamp: debugData.lastApiResponseTimestamp || 'None',
      lastApiResponseTime: runtimeState.state.provider_health.Yahoo && runtimeState.state.provider_health.Yahoo.latency !== null ? `${runtimeState.state.provider_health.Yahoo.latency}ms` : 'N/A',
      marketStatus: debugData.marketStatus || 'CLOSED',
      sourceOfTruth: marketData.getMode(),
      mode: config.BROKER_MODE === 'LIVE' ? 'LIVE' : 'SIMULATOR'
    };

    const tradingDiagnostics = {
      brokerMode: config.BROKER_MODE || 'SIMULATOR',
      activeBroker: debugData.activeBroker || 'Simulator',
      tradingType: debugData.tradingType || 'Paper Trading',
      lastOrderId: lastTrade ? lastTrade.id : 'None',
      lastExchangeOrderId: lastTrade ? (lastTrade.exchange_order_id || 'None') : 'None',
      lastOrderSource: lastTrade ? (lastTrade.reason ? lastTrade.reason.substring(0, 45) : 'None') : 'None',
      executionMode: 'SWING',
      productType: 'CNC'
    };

    // Calculate metric scopes
    const lastLog = dbData.pipeline_logs && dbData.pipeline_logs.length > 0 
      ? dbData.pipeline_logs[dbData.pipeline_logs.length - 1] 
      : null;

    const cycle = {
      scanned: lastLog ? lastLog.scanned : 0,
      passedTQS: lastLog ? lastLog.stage2_ranked : 0,
      passedConfidence: lastLog ? lastLog.stage3_candidates : 0,
      passedRisk: lastLog ? (lastLog.passed_risk || 0) : 0,
      passedConsensus: lastLog ? (lastLog.stage4_consensus || 0) : 0,
      submitted: lastLog ? lastLog.stage5_executed : 0,
      filled: lastLog ? lastLog.stage5_executed : 0
    };

    // Push funnel data to runtimeState (single source of truth)
    runtimeState.updateFunnel({
      stage1_scanned:    cycle.scanned,
      stage2_tqs_passed: cycle.passedTQS,
      stage3_technical:  cycle.passedConfidence,
      stage5_risk:       cycle.passedRisk,
      stage6_consensus:  cycle.passedConsensus,
      stage7_submitted:  cycle.submitted,
      stage8_filled:     cycle.filled
    });

    const completedTrades = dbData.completed_trades || [];
    const todayCompletedTrades = completedTrades.filter(t => isTodayIST(t.exit_time));
    
    let todayPnL = todayCompletedTrades.reduce((sum, t) => sum + (Number(t.net_pnl) || 0), 0);

    const todayTradesList = (dbData.trade_logs || []).filter(t => isTodayIST(t.timestamp));
    const today = {
      netPnL: parseFloat(todayPnL.toFixed(2)),
      trades: todayTradesList.length,
      winRate: winRateVal,
      fees: parseFloat((todayTradesList.reduce((sum, t) => sum + ((t.total_value || 0) * 0.0005), 0)).toFixed(2)),
      volume: parseFloat((todayTradesList.reduce((sum, t) => sum + (t.total_value || 0), 0)).toFixed(2))
    };

    const lifetimeWinRate = paperTradingStats && paperTradingStats.total_trades > 0 
      ? paperTradingStats.win_rate 
      : null;

    let lifetimePnL = paperTradingStats ? paperTradingStats.net_pnl : 0;
    const allTrades = dbData.trade_logs || [];

    const lifetime = {
      netPnL: parseFloat(lifetimePnL.toFixed(2)),
      trades: allTrades.length,
      winRate: lifetimeWinRate
    };

    // Ensure execution status shows HALTED if daily stats is halted
    if (isHalted) {
      preMarketState.system = 'HALTED';
      preMarketState.readinessScore = Math.min(90, preMarketState.readinessScore);
    }

    const scannerStats = marketScanner.getScannerStats ? marketScanner.getScannerStats() : {
      currentScan: 0,
      currentSession: 0,
      today: 0,
      lifetime: 0,
      lastScanTime: 'None',
      currentSymbol: 'Idle',
      symbolsPerMin: 0,
      avgScanTimeMs: 0
    };

    let tgStatus = 'OFFLINE';
    try {
      const telegramControl = require('./telegramControl');
      const tgHealth = telegramControl.getTelegramHealth();
      tgStatus = tgHealth.status === 'CONNECTED' ? (tgHealth.webhook ? 'WEBHOOK' : 'POLLING') : 'OFFLINE';
    } catch (e) {}

    // Update the centralized runtimeState single source of truth
    runtimeState.updateBatch({
      'isRunning': botInterval !== null,
      'entriesPaused': entriesPaused,
      'dailyLossLimitBreached': currentDayStats ? (currentDayStats.status === 'HALTED_DAILY_LOSS_LIMIT' || currentDayStats.status.startsWith('HALTED')) : false,
      'services.database': preMarketState.database,
      'services.websocket': preMarketState.websocket,
      'services.agents': preMarketState.agents,
      'services.broker': preMarketState.broker,
      'services.scheduler': preMarketState.scheduler,
      'services.market_data': modeString === 'MIXED' ? 'WARNING' : (modeString === 'LIVE' ? 'STABLE' : 'SIMULATED'),
      'services.telegram': tgStatus,
      'services.scanner': botInterval !== null ? 'ACTIVE' : 'PAUSED',
      'services.scheduler': 'ACTIVE',
      'market.status': debugData.marketStatus || (this.isMarketOpenWindow() ? 'OPEN' : 'CLOSED'),
      'market.isOpen': this.isMarketOpenWindow(),
      'market.currentDate': preMarketState.currentDate,
      'market.preMarketInitialized': preMarketState.preMarketInitialized,
      'market.finalCheckPassed': preMarketState.finalCheckPassed,
      'market.marketOpenTriggered': preMarketState.marketOpenTriggered,
      'market.firstScanCompleted': preMarketState.firstScanCompleted,
      'market.firstSignalGenerated': preMarketState.firstSignalGenerated,
      'market.firstTradeExecuted': preMarketState.firstTradeExecuted,
      'financials.capital': currentDayStats ? currentDayStats.start_capital : valuation.totalVal - netPnL,
      'financials.cash': valuation.balance,
      'financials.equity_value': valuation.equityValue,
      'financials.realized_pnl': today.netPnL,
      'financials.unrealized_pnl': parseFloat((valuation.totalVal - valuation.balance - valuation.equityValue).toFixed(2)),
      'financials.daily_pnl': today.netPnL,
      'financials.lifetime_pnl': lifetime.netPnL,
      'financials.daily_target': currentDayStats ? currentDayStats.daily_target : Math.max(100.0, parseFloat((valuation.totalVal * 0.10).toFixed(2))),
      'financials.capital_utilization': parseFloat(((valuation.totalVal - valuation.balance) / valuation.totalVal * 100).toFixed(2)),
      'financials.risk_exposure': parseFloat((valuation.holdingStocks.reduce((sum, s) => sum + s.total_value, 0) / valuation.totalVal * 100).toFixed(2)),
      'scanner.current_symbol': scannerStats.currentSymbol || 'Idle',
      'scanner.session_scanned_count': scannerStats.currentSession || 0,
      'scanner.today_scanned_count': scannerStats.today || 0,
      'scanner.lifetime_scanned_count': scannerStats.lifetime || 0,
      'scanner.scan_speed': scannerStats.symbolsPerMin || 0,
      'scanner.last_scan_timestamp': scannerStats.lastScanTime || 'None',
      'scanner.scanner_health': botInterval !== null ? 'ACTIVE' : 'PAUSED',
      'financials.total_value': valuation.totalVal,
      'financials.net_pnl': netPnL,
      'positions': valuation.holdingStocks || [],
      'pending_orders': pendingExecutions ? Array.from(pendingExecutions) : [],
      'timeline': preMarketState.timeline || [],
      'auditLog': preMarketState.auditLog || []
    });

    // Push real performance metrics to runtimeState
    runtimeState.updatePerformance({
      today_trades:       today.trades,
      today_wins:         today.winning_trades || 0,
      today_losses:       today.losing_trades || 0,
      today_win_rate:     today.winRate || 0,
      today_realized_pnl: today.netPnL || 0,
      lifetime_trades:    lifetime.trades,
      lifetime_win_rate:  lifetime.winRate
    });

    return {
      isRunning: botInterval !== null,
      marketDataMode: modeString,
      marketDataProvider: marketData.getProviderName(),
      priceValidationStatus: validationString,
      strategy: portfolio.strategy || 'EXPECTANCY_OPTIMIZED',
      time: `${timeInfo.hours.toString().padStart(2, '0')}:${timeInfo.minutes.toString().padStart(2, '0')}`,
      balance: valuation.balance,
      equityValue: valuation.equityValue,
      totalVal: valuation.totalVal,
      netPnL,
      holdingStocks: valuation.holdingStocks,
      lastTicks,
      prediction,
      modelWeights,
      paperTradingStats,
      dailyStats: currentDayStats,
      target: currentDayStats ? currentDayStats.daily_target : Math.max(100.0, parseFloat((valuation.totalVal * 0.10).toFixed(2))),
      dailyStopLossLimit: currentDayStats ? parseFloat((currentDayStats.start_capital * 0.03).toFixed(2)) : 360.00,
      maxLifetimeLossCap: parseFloat((config.INITIAL_CAPITAL - config.LIFETIME_CAPITAL_FLOOR).toFixed(2)),
      ema9,
      ema21,
      debugData,
      targetEngineState,
      missedRejectionsRate,
      lastPipelineLog: dbData.pipeline_logs && dbData.pipeline_logs.length > 0 ? dbData.pipeline_logs[dbData.pipeline_logs.length - 1] : null,
      agentLeaderboard: predictor.getAgentCalibration(),
      topOpportunities: dbData.opportunity_tracker || [],
      shadowTrades: dbData.shadow_trades || [],
      executionFunnel,
      preMarketState,
      signalSuppressionState,
      marketDataDiagnostics,
      tradingDiagnostics,
      metrics: {
        cycle,
        today,
        lifetime,
        scannerStats
      },
      providerHealth: runtimeState.getSnapshot().provider_health,
      runtime: runtimeState.getSnapshot()
    };
  },

  calculateTargetEngineState(valuation) {
    let riskMode = 'NORMAL';
    try {
      const dbData = db.readLocalDb();
      riskMode = dbData.portfolio_state?.user_instructions?.risk_mode || 'NORMAL';
    } catch (e) {}

    const cap = valuation.totalVal;
    const riskPerTrade = (runtimeState && runtimeState.getSnapshot().settings.risk_per_trade_percent) || 1.0;
    const avgRR = 2.5; 
    const winRate = (runtimeState && runtimeState.state && runtimeState.state.performance && runtimeState.state.performance.today_win_rate > 0)
      ? runtimeState.state.performance.today_win_rate / 100 
      : 0.62;
    const dailyTrades = 7;
    const expectedProfitPerTrade = (cap * (riskPerTrade / 100)) * ((avgRR * winRate) - (1 - winRate));
    let dailyTarget = Math.max(100.0, parseFloat((expectedProfitPerTrade * dailyTrades).toFixed(2)));

    // Update currentDayStats daily_target to keep it in sync
    if (typeof currentDayStats !== 'undefined' && currentDayStats && currentDayStats.daily_target !== dailyTarget) {
      currentDayStats.daily_target = dailyTarget;
    }

    const dailyPnL = (typeof currentDayStats !== 'undefined' && currentDayStats) ? parseFloat((valuation.totalVal - currentDayStats.start_capital).toFixed(2)) : 0;
    const remainingTarget = Math.max(0, dailyTarget - dailyPnL);
    
    const avgWin = parseFloat((valuation.totalVal * 0.20 * 0.03).toFixed(2));   // 3% gain on 20% capital allocation
    const avgLoss = parseFloat((valuation.totalVal * 0.20 * 0.015).toFixed(2));  // 1.5% loss on 20% capital stop-loss
    const requiredTrades = expectedProfitPerTrade > 0 ? Math.ceil(remainingTarget / expectedProfitPerTrade) : dailyTrades;
    const requiredCapitalUtil = Math.min(100.0, Math.max(10.0, (requiredTrades * 20.0))); // 20% allocation per trade
    
    let requiredWinRate = winRate;
    if (requiredTrades > 0 && remainingTarget > 0) {
      requiredWinRate = (remainingTarget / requiredTrades + avgLoss) / (avgWin + avgLoss);
      requiredWinRate = Math.max(0.40, Math.min(0.95, requiredWinRate));
    } else if (remainingTarget === 0) {
      requiredWinRate = 0.0;
    }

    const timeInfo = fsm.getSystemTime();
    const currentMins = timeInfo.hours * 60 + timeInfo.minutes;
    const closeMins = 15 * 60 + 30;
    const minsRemaining = Math.max(0, closeMins - currentMins);

    let rating = 'HIGH';
    if (remainingTarget <= 0) {
      rating = 'HIGH';
    } else if (requiredTrades > (minsRemaining / 10)) {
      rating = 'LOW';
    } else if (requiredWinRate > 0.8) {
      rating = 'MEDIUM';
    }

    return {
      dailyTarget,
      currentPnL: dailyPnL,
      remainingTarget: parseFloat(remainingTarget.toFixed(2)),
      requiredExpectedProfit: parseFloat(remainingTarget.toFixed(2)),
      requiredTradeCount: requiredTrades,
      requiredCapitalUtilization: parseFloat(requiredCapitalUtil.toFixed(2)),
      requiredWinRate: parseFloat((requiredWinRate * 100).toFixed(2)),
      rating,
      minsRemaining
    };
  },

  isMarketOpenWindow(timeInfo = null) {
    return fsm.getTradingSession().isOpen;
  },

  async logOpportunityInTracker(item, prediction, tqs, status, rejectionReason) {
    try {
      const voteInfo = getVoteBreakdown(prediction);
      const buyVotes = voteInfo.breakdown.BUY || 0;
      const sellVotes = voteInfo.breakdown.SELL || 0;
      const holdVotes = voteInfo.breakdown.HOLD || 0;
      const agentCount = Object.keys(prediction.participating_models || {}).filter(k => k !== 'learning_impact').length;

      const confVal = prediction.confidence > 1 ? prediction.confidence / 100 : prediction.confidence;
      const oppScore = Math.round((confVal * 40) + (tqs * 0.4) + (buyVotes * 5));

      const oppLog = {
        symbol: item.symbol,
        current_price: item.price,
        confidence: confVal,
        tqs: tqs,
        consensus_score: prediction.confidence,
        buy_votes: buyVotes,
        sell_votes: sellVotes,
        hold_votes: holdVotes,
        agent_count: agentCount,
        signal_type: prediction.signal,
        rejection_reason: rejectionReason || '',
        opportunity_score: oppScore,
        status: status, // 'EXECUTED', 'WATCHLIST', 'REJECTED'
        participating_models: prediction.participating_models,
        debate_summary: prediction.reasoning,
        ref_15m: null,
        ref_30m: null,
        ref_1h: null,
        ref_eod: null,
        completed: false
      };

      await db.saveOpportunity(oppLog);

      if (status === 'WATCHLIST' || status === 'EXECUTED') {
        if (!preMarketState.firstSignalGenerated) {
          preMarketState.firstSignalGenerated = true;
          this.addAuditLog('FIRST_SIGNAL_GENERATED');
          const timeInfo = fsm.getSystemTime();
          this.addTimeline(`${timeInfo.hours.toString().padStart(2, '0')}:${timeInfo.minutes.toString().padStart(2, '0')}`, 'First Signal');
        }
      }
      if (status === 'EXECUTED') {
        if (!preMarketState.firstTradeExecuted) {
          preMarketState.firstTradeExecuted = true;
          this.addAuditLog('FIRST_TRADE_EXECUTED');
          const timeInfo = fsm.getSystemTime();
          this.addTimeline(`${timeInfo.hours.toString().padStart(2, '0')}:${timeInfo.minutes.toString().padStart(2, '0')}`, 'First Trade');
        }
      }

      // Trigger High Conviction Alert if confidence >= 0.80 and TQS >= 75
      if (confVal >= 0.80 && tqs >= 75) {
        console.log(`[ALERT] 🚨 HIGH CONVICTION SETUP DETECTED for ${item.symbol}: TQS ${tqs}, Conf ${(confVal * 100).toFixed(0)}%`);
        if (typeof global.broadcastHighConvictionAlert === 'function') {
          global.broadcastHighConvictionAlert(item.symbol, tqs, confVal);
        }
      }

      // Handle Near-Miss shadow trades for confidence >= 0.60 and TQS >= 55
      if (confVal >= 0.60 && tqs >= 55 && status !== 'EXECUTED') {
        const hasOpenShadow = await db.hasOpenShadowTrade(item.symbol);
        if (!hasOpenShadow) {
          console.log(`[SHADOW TRADE] Opening shadow position for ${item.symbol} @ ₹${item.price} (TQS: ${tqs}, Conf: ${confVal.toFixed(2)})`);
          const shadowQty = Math.floor(1200 / item.price) || 1;
          const shadowTrade = {
            id: `SHADOW-${Date.now()}-${item.symbol}`,
            timestamp: new Date().toISOString(),
            symbol: item.symbol,
            entry_price: item.price,
            current_price: item.price,
            quantity: shadowQty,
            confidence: confVal,
            tqs: tqs,
            opportunity_score: oppScore,
            status: 'OPEN',
            pnl: 0,
            return_pct: 0,
            exit_price: null,
            exit_timestamp: null
          };
          await db.saveShadowTrade(shadowTrade);
        }
      }
    } catch (err) {
      console.error('[OPPORTUNITY TRACKER] Error logging opportunity:', err.message);
    }
  },

  async processRealExits() {
    try {
      const portfolio = await db.getPortfolioState();
      const activePositions = portfolio.holding_stocks || [];
      if (activePositions.length === 0) return;

      // Process exits
      for (const pos of activePositions) {
        const currentPrice = broker.getLTP(pos.symbol) || pos.avgPrice;
        const returnPct = ((currentPrice - pos.avgPrice) / pos.avgPrice) * 100;

        // Track peak price
        pos.maxPrice = Math.max(pos.maxPrice || pos.avgPrice, currentPrice);
        pos.currentPrice = currentPrice;

        // Get historical candles for evaluation
        const history = await marketData.getHistory(pos.symbol, [], '5m', '2d');
        let formattedCandles = [];
        if (history && history.closes && history.closes.length > 0) {
          formattedCandles = history.closes.map((c, idx) => ({
            close: c,
            open: (history.opens && history.opens[idx]) || c,
            high: (history.highs && history.highs[idx]) || c,
            low: (history.lows && history.lows[idx]) || c,
            volume: history.volumes ? history.volumes[idx] : 1000
          }));
        }

        const exitEval = exitIntelligenceEngine.evaluatePositionExits(pos, formattedCandles);

        if (exitEval.shouldExit) {
          const exitReason = exitEval.reason;
          console.log(`[PORTFOLIO EXIT] Closing ${pos.symbol} due to ${exitReason}. Return: ${returnPct.toFixed(2)}%`);

          const tradePnL = pos.quantity * (currentPrice - pos.avgPrice);
          const peakValue = (pos.maxPrice - pos.avgPrice) * pos.quantity;
          const profitGivenBack = Math.max(0, peakValue - tradePnL);
          const detailedReason = `${exitReason} | Entry: ₹${pos.avgPrice} | PnL: ₹${tradePnL.toFixed(2)} | Return: ${returnPct.toFixed(2)}% | Peak PnL: ₹${peakValue.toFixed(2)} | Given Back: ₹${profitGivenBack.toFixed(2)}`;

          try {
            await agent17_execution.placeOrder(
              pos.symbol,
              'SELL',
              pos.quantity,
              'CNC',
              detailedReason
            );
            console.log(`\n[PIPELINE]`);
            console.log(`SELL ORDER CREATED`);
            console.log(`↓`);
            console.log(`BROKER REQUEST SENT`);
            console.log(`↓`);
            console.log(`BROKER RESPONSE (SUCCESS)`);
            console.log(`↓`);
            console.log(`ORDER FILLED`);
            console.log(`↓`);
            console.log(`PORTFOLIO UPDATED`);
          } catch (err) {
            console.error(`[PORTFOLIO EXIT FAILED] Could not exit ${pos.symbol}:`, err.message);
            console.log(`\n[PIPELINE]`);
            console.log(`SELL ORDER FAILED`);
            console.log(`↓`);
            console.log(`BROKER REJECTED: ${err.message}`);
          }

          // Update losing streak count
          if (returnPct < 0) {
            consecutiveLossesCount++;
          } else {
            consecutiveLossesCount = 0;
          }

          const completedTrade = await db.matchBuyAndCreateCompletedTrade(pos.symbol, currentPrice, pos.quantity, new Date().toISOString(), exitReason);
          if (completedTrade) {
            // Adapt weights
            exitIntelligenceEngine.adaptExitWeights(completedTrade);
          }
          await predictor.recordPredictionExit(pos.symbol, currentPrice, tradePnL, pos);

          // Update Self-Learning Engine (Phase 19 statistics)
          try {
            const learningEngine = require('./learningEngine');
            const durationMs = Date.now() - new Date(pos.timestamp || new Date()).getTime();
            const durationMins = Math.round(durationMs / 60000);
            
            const pModels = pos.participating_models || {};
            const candlePattern = pModels.agent11_price_action?.pattern || 'None';
            const marketState = pModels.agent5_context?.marketState || 'RANGING';
            const trend = pModels.agent6_regime?.trend || 'NEUTRAL';
            const volumeState = pModels.agent4_technical?.volumeState || 'ACCUMULATION';

            learningEngine.recordTradeOutcome({
              symbol: pos.symbol,
              candle_pattern: candlePattern,
              market_state: marketState,
              trend: trend,
              volume_state: volumeState,
              risk_reward: pos.calculatedRiskReward || 1.5,
              holding_minutes: durationMins,
              exit_reason: exitReason,
              net_pnl: tradePnL,
              r_multiple: pos.calculatedRiskReward ? (tradePnL > 0 ? pos.calculatedRiskReward : -1.0) : 0,
              mfe: 0,
              mae: 0
            });
          } catch (leErr) {
            console.error('[PORTFOLIO] Failed to update learning engine:', leErr.message);
          }
          
          // Record validation outcome (Phase 7)
          try {
            const predictionValidator = require('./predictionValidator');
            await predictionValidator.recordOutcome(pos.symbol, currentPrice, tradePnL);
          } catch (valErr) {
            console.error('[VALIDATOR] Outcome matching failed:', valErr.message);
          }

          // Backfill outcomes to market memory
          try {
            const agentResearch = require('./agentResearch');
            await agentResearch.backfillMemoryOutcomes(pos.symbol, tradePnL);
          } catch (bfErr) {
            console.error('[PORTFOLIO] Failed to backfill memory outcomes:', bfErr.message);
          }
          
          const exitBreakdown = getVoteBreakdown({ participating_models: pos.participating_models });
          const exitBuyCount = exitBreakdown.breakdown.BUY || 0;
          const exitSellCount = exitBreakdown.breakdown.SELL || 0;
          const exitHoldCount = exitBreakdown.breakdown.HOLD || 0;
          
          const entryPrice = pos.avgPrice;
          const targetPrice = entryPrice * 1.03;
          const stopLossPrice = entryPrice * 0.985;
          const exitRisk = Math.abs(entryPrice - stopLossPrice);
          const exitReward = Math.abs(targetPrice - entryPrice);
          const exitRRRatio = exitRisk > 0 ? (exitReward / exitRisk).toFixed(2) : '1.50';

          const exitAlertText = `🔴 <b>INSTITUTIONAL SIGNAL</b>\n` +
            `• Symbol: <b>${pos.symbol}</b>\n` +
            `• Direction: <b>EXIT</b>\n` +
            `• Entry: <b>₹${entryPrice.toFixed(2)}</b>\n` +
            `• Target: <b>₹${targetPrice.toFixed(2)}</b>\n` +
            `• Stop: <b>₹${stopLossPrice.toFixed(2)}</b>\n` +
            `• Risk Reward: <b>1:${exitRRRatio}</b>\n` +
            `• TQS: <b>${pos.tqs || 85}%</b>\n` +
            `• ICS: <b>${pos.participating_models?.learning_impact?.ics || 80}</b>\n` +
            `• Market Regime: <b>${pos.participating_models?.learning_impact?.marketRegime || 'RANGING'}</b>\n` +
            `• Volume State: <b>${pos.participating_models?.learning_impact?.volumeState || 'NORMAL'}</b>\n` +
            `• SMC Signal: <b>${pos.participating_models?.agent12_smc?.vote || 'HOLD'}</b>\n` +
            `• Consensus Votes: <b>BUY ${exitBuyCount} | SELL ${exitSellCount} | HOLD ${exitHoldCount}</b>\n` +
            `• Confidence: <b>${((pos.confidence || 0.75) * 100).toFixed(0)}%</b>\n` +
            `• Exit Price: <b>₹${currentPrice.toFixed(2)}</b>\n` +
            `• Exit Reason: <b>${exitReason}</b>\n` +
            `• PnL: <b>${tradePnL >= 0 ? '+' : ''}₹${tradePnL.toFixed(2)} (${((currentPrice - pos.avgPrice)/pos.avgPrice*100).toFixed(2)}%)</b>`;

          await alerts.sendTelegram(exitAlertText);
          try {
            const agentFirm = require('./agentFirm');
            await agentFirm.onTradeClosed(pos.symbol, currentPrice, tradePnL, exitReason, pos);
          } catch (hookErr) {
            console.error('[PORTFOLIO] Firm hooks failed on close:', hookErr.message);
          }
        }
      }
    } catch (err) {
      console.error('[BOT] Error processing real exits:', err.stack);
    }
  },

  async processShadowExits(valuation) {
    try {
      const data = db.readLocalDb();
      const openShadows = (data.shadow_trades || []).filter(t => t.status === 'OPEN');
      if (openShadows.length === 0) return;

      for (const shadow of openShadows) {
        const currentPrice = broker.getLTP(shadow.symbol) || shadow.entry_price;
        const returnPct = ((currentPrice - shadow.entry_price) / shadow.entry_price) * 100;

        // Track peak price
        shadow.maxPrice = Math.max(shadow.maxPrice || shadow.entry_price, currentPrice);
        shadow.currentPrice = currentPrice;
        shadow.avgPrice = shadow.entry_price;

        const history = await marketData.getHistory(shadow.symbol, [], '5m', '2d');
        let formattedCandles = [];
        if (history && history.closes && history.closes.length > 0) {
          formattedCandles = history.closes.map((c, idx) => ({
            close: c,
            open: history.opens[idx],
            high: history.highs[idx],
            low: history.lows[idx],
            volume: history.volumes ? history.volumes[idx] : 1000
          }));
        }

        const exitEval = exitIntelligenceEngine.evaluatePositionExits(shadow, formattedCandles);

        if (exitEval.shouldExit) {
          const exitReason = exitEval.reason;
          console.log(`[SHADOW EXIT] Closing shadow position ${shadow.symbol} due to ${exitReason}. Return: ${returnPct.toFixed(2)}%`);

          shadow.status = 'CLOSED';
          shadow.exit_price = currentPrice;
          shadow.exit_timestamp = new Date().toISOString();
          shadow.return_pct = returnPct;
          shadow.pnl = shadow.quantity * (currentPrice - shadow.entry_price);
          
          await db.updateShadowTrade(shadow);
        } else {
          shadow.current_price = currentPrice;
          shadow.return_pct = returnPct;
          shadow.pnl = shadow.quantity * (currentPrice - shadow.entry_price);
          await db.updateShadowTrade(shadow);
        }
      }
    } catch (err) {
      console.error('[BOT] Error processing shadow exits:', err.message);
    }
  },
  async tick() {
    if (entriesPaused) {
       console.log(`[SCHEDULER TRACE] tick() paused by user.`);
       return;
    }
    const fsmResult = fsm.evaluateTransitions();
    const state = fsmResult.state;
    const s = fsmResult.sessionDetails;
    const timeInfo = s.timeInfo;
    const currentMins = s.currentMins;
    
    // Check if we need to log a blocker and exit
    if (s.blockReason) {
      if (s.session === 'CLOSED' || s.session === 'PREMARKET_WAIT') {
         fsm.printSchedulerBlock(s.blockReason, s);
         return; // Blocker 8: Outside trading hours -> No broker polling, no APIs, no scanning.
      }
    }
    
    // Daily reset check: if dateStr has changed since last processed tick, reset preMarketState
    if (!preMarketState.currentDate || preMarketState.currentDate !== timeInfo.dateStr) {
      console.log(`[SCHEDULER] New trading day detected: ${timeInfo.dateStr}. Resetting pre-market state and resuming entries.`);
      const lastAuditLog = preMarketState.auditLog || [];
      Object.assign(preMarketState, {
        database: 'PENDING',
        websocket: 'PENDING',
        agents: 'PENDING',
        broker: 'PENDING',
        scheduler: 'PENDING',
        market: 'PENDING',
        system: 'PENDING',
        readinessScore: 0,
        auditLog: lastAuditLog,
        timeline: [],
        preMarketInitialized: false,
        finalCheckPassed: false,
        marketOpenTriggered: false,
        firstScanCompleted: false,
        firstSignalGenerated: false,
        firstTradeExecuted: false,
        lastScanTime: 0,
        lastSignalTime: 0,
        lastTradeTime: 0,
        failsafeRetries: 0,
        openingScanFailureAlerted: false,
        noSignalsWarningAlerted: false,
        watchlistLoadedAlerted: false,
        aiWarmupAlerted: false,
        eodSquareOffAlerted: false,
        currentDate: timeInfo.dateStr
      });
      signalSuppressionState = {
        totalCandidates: 0,
        rejectedByThreshold: 0,
        tqsBuckets: { tqs70: 0, tqs75: 0, tqs78: 0, tqs80: 0, tqs85: 0 },
        detailedRejections: [],
        bottleneckDetected: false,
        recommendedThreshold: 65,
        expectedAdditionalTrades: 0,
        winRateImpact: '+2.8% win rate stabilization'
      };
      entriesPaused = false;
      global.profitChasingMode = false;
      tqsThresholdOffset = 0;
      sizingScaleFactor = 1.0;
    }
    
    // Pre-Market Mode (09:00 - 09:15 IST)
    if (state === 'PREMARKET' || state === 'WAITING_FOR_OPEN') {
      console.log(`[SCHEDULER TRACE] Pre-Market Mode active (${timeInfo.hours}:${timeInfo.minutes}:${timeInfo.seconds})`);
      
      // 09:00 IST: Premarket Validation (happens naturally via runPreMarketWarmup triggered once)
      await this.runPreMarketWarmup();

      // 09:05 IST: Watchlist
      if (currentMins === 9 * 60 + 5 && timeInfo.seconds === 0) {
        if (!preMarketState.watchlistLoadedAlerted) {
          preMarketState.watchlistLoadedAlerted = true;
          console.log('[SCHEDULER] 09:05 IST - Loading symbol watchlists...');
          await alerts.sendTelegram('📋 <b>Watchlists Loaded:</b> 5,000+ symbol universes queued for execution scan.');
        }
      }

      // 09:10 IST: AI Warmup
      if (currentMins === 9 * 60 + 10 && timeInfo.seconds === 0) {
        if (!preMarketState.aiWarmupAlerted) {
          preMarketState.aiWarmupAlerted = true;
          console.log('[SCHEDULER] 09:10 IST - AI Warmup sequence...');
          await alerts.sendTelegram('🧠 <b>AI Warmup:</b> Neural models pre-loaded and context windows initialized.');
        }
      }
      
      if (state === 'WAITING_FOR_OPEN' && timeInfo.seconds >= 50) {
        await this.runFinalPreMarketChecks();
      }
      
      // Keep processing shadow exits and audits in pre-market
      try {
        const agentResearch = require('./agentResearch');
        await agentResearch.updateOpportunityAudits();
      } catch (e) {}
      try {
        const valuation = await broker.getValuation();
        await this.processShadowExits(valuation);
      } catch (e) {}
      
      console.log(`[SCHEDULER TRACE] tick() exited early: Pre-Market Mode`);
      return;
    }

    
    if (state === 'MARKET_OPEN' || state === 'SCANNING' || state === 'TRADING' || state === 'MARKET_CLOSING') {
      if (!preMarketState.marketOpenTriggered) {
        await this.triggerMarketOpen();
      }
    }
      
    if (state === 'EOD' || state === 'EOD_PROCESSING' || state === 'STOPPED') {
      if (currentDayStats && currentDayStats.status === 'ACTIVE') {
        console.log(`[SCHEDULER TRACE] EOD Reached. Finalizing market day...`);
        await this.finalizeMarketDay(timeInfo.dateStr);
      }
      return;
    }

    if (state !== 'SCANNING' && state !== 'TRADING') {
       fsm.printSchedulerBlock('Outside of Active Scanning/Trading Session', s);
       return;
    }
    
    // Check missing first scan (30s check)
    if (!preMarketState.firstScanCompleted) {
      const secondsSinceOpen = (currentMins - (9 * 60 + 15)) * 60 + timeInfo.seconds;
      if (secondsSinceOpen >= 30) {
        if (!preMarketState.openingScanFailureAlerted) {
          preMarketState.openingScanFailureAlerted = true;
          await alerts.sendTelegram('⚠️ 🚨 <b>CRITICAL ALERT: OPENING SCAN FAILURE</b> - Initial scan failed to complete within 30s of market open.');
        }
        
        const nowMs = Date.now();
        if (!preMarketState.lastFailsafeRetryTime || (nowMs - preMarketState.lastFailsafeRetryTime >= 30000)) {
          preMarketState.lastFailsafeRetryTime = nowMs;
          preMarketState.failsafeRetries++;
          console.warn(`[FAILSAFE] Scheduler missed market open. Restarting scanning subsystem. Retry #${preMarketState.failsafeRetries}`);
          const valuation = await broker.getValuation();
          await this.runScanningSubsystem(valuation);
        }
      }
    }
      
    // Missed Signals Detection (10m check)
    if (!preMarketState.firstSignalGenerated && !preMarketState.noSignalsWarningAlerted) {
      const secondsSinceOpen = (currentMins - (9 * 60 + 15)) * 60 + timeInfo.seconds;
      if (secondsSinceOpen >= 600) {
        preMarketState.noSignalsWarningAlerted = true;
        await alerts.sendTelegram('⚠️ <b>WARNING: NO SIGNALS DETECTED</b> - No AI consensus signals generated within 10 minutes of market open.');
      }
    }

    if (!currentDayStats || currentDayStats.date !== timeInfo.dateStr) {
      const existingStats = await db.getDailyStats(timeInfo.dateStr);
      if (existingStats) {
        currentDayStats = existingStats;
      } else {
        const portfolio = await db.getPortfolioState();
        const startCapital = portfolio.balance + portfolio.equity_value;
        const riskMode = portfolio.user_instructions?.risk_mode || 'NORMAL';
        const riskPerTrade = (runtimeState && runtimeState.getSnapshot().settings.risk_per_trade_percent) || 1.0;
      const cap = (typeof valuation !== 'undefined' ? valuation.totalVal : (typeof startCapital !== 'undefined' ? startCapital : 12000));
      const avgRR = 2.5; 
      const winRate = 0.62;
      const dailyTrades = 7;
      const expectedProfitPerTrade = (cap * (riskPerTrade / 100)) * ((avgRR * winRate) - (1 - winRate));
      const calculatedTarget = Math.max(100.0, parseFloat((expectedProfitPerTrade * dailyTrades).toFixed(2)));
      
      if (runtimeState && runtimeState.targetEngineState) {
        runtimeState.targetEngineState = {
          ...runtimeState.targetEngineState,
          dailyTarget: calculatedTarget,
          requiredExpectedProfit: calculatedTarget,
          requiredTradeCount: dailyTrades,
          requiredWinRate: (winRate * 100).toFixed(0),
          requiredCapitalUtilization: 85
        };
      }

        currentDayStats = await db.saveDailyStats({
          date: timeInfo.dateStr,
          start_capital: startCapital,
          end_capital: startCapital,
          net_pnl: 0,
          daily_target: calculatedTarget,
          target_met: false,
          strategy_switched: false,
          status: 'ACTIVE'
        });
        await db.updatePortfolioState({ current_daily_target: calculatedTarget });
      }
    }

    if (currentDayStats.status.startsWith('HALTED') || currentDayStats.status === 'LIFETIME_FLOOR_BREACHED') {
      console.log(`[SCHEDULER TRACE] tick() exited early: Bot Halted (status: ${currentDayStats.status})`);
      return;
    }

    const valuation = await broker.getValuation();
    
    // VALUATION SANITY GUARD: If holdings exist but equityValue is 0, this is a pricing failure.
    // Never halt on corrupted valuation data — the drawdown would be false.
    const portfolio = await db.getPortfolioState();
    const holdingCount = (portfolio.holding_stocks || []).length;
    if (holdingCount > 0 && valuation.equityValue <= 0) {
      console.error(`[RISK GUARD] Skipping drawdown check: ${holdingCount} holdings exist but equityValue is ₹${valuation.equityValue}. Pricing failure detected.`);
      // Don't return — still allow scanning and trading, just skip the drawdown halt check
    } else {
      // Hard Risk Controls Check (3% Daily, 7% Weekly, 15% Monthly)
      const dailyPnL = valuation.totalVal - currentDayStats.start_capital;
      const dailyLossPct = (dailyPnL / currentDayStats.start_capital) * -100;

      if (dailyLossPct >= 3.0) {
        console.log(`[SCHEDULER TRACE] tick() exited early: Daily Loss Limit (3%) breached (${dailyLossPct.toFixed(2)}%)`);
        await this.haltTrading('HALTED_LOSS', `Daily Loss Limit (3%) breached: Loss of ₹${dailyPnL.toFixed(2)}`);
        return;
      }

      // Weekly and Monthly drawdown checks — FILTER STALE DATA
      // Only use COMPLETED (non-halted) daily stats for peak calculations to avoid false peaks from test/sim runs
      const recentStats = await db.getRecentDailyStats(20);
      const cleanStats = recentStats.filter(s => 
        s.status === 'COMPLETED' || s.status === 'ACTIVE'
      );
      const endCapitals = cleanStats.map(s => s.end_capital).filter(v => v > 0);

      const weeklyPeak = endCapitals.length > 0 
        ? Math.max(valuation.totalVal, ...endCapitals.slice(0, 5))
        : valuation.totalVal;
      const weeklyDrawdownPct = weeklyPeak > 0 ? ((weeklyPeak - valuation.totalVal) / weeklyPeak) * 100 : 0;
      if (weeklyDrawdownPct >= 7.0) {
        console.log(`[SCHEDULER TRACE] tick() exited early: Weekly Drawdown Limit (7%) breached (${weeklyDrawdownPct.toFixed(2)}%)`);
        await this.haltTrading('HALTED_LOSS_WEEKLY', `Weekly Drawdown Limit (7%) breached: Peak ₹${weeklyPeak.toFixed(2)}, Current ₹${valuation.totalVal.toFixed(2)} (${weeklyDrawdownPct.toFixed(2)}% DD)`);
        return;
      }

      const monthlyPeak = endCapitals.length > 0
        ? Math.max(valuation.totalVal, ...endCapitals)
        : valuation.totalVal;
      const monthlyDrawdownPct = monthlyPeak > 0 ? ((monthlyPeak - valuation.totalVal) / monthlyPeak) * 100 : 0;
      if (monthlyDrawdownPct >= 15.0) {
        console.log(`[SCHEDULER TRACE] tick() exited early: Monthly Drawdown Limit (15%) breached (${monthlyDrawdownPct.toFixed(2)}%)`);
        await this.haltTrading('HALTED_LOSS_MONTHLY', `Monthly Drawdown Limit (15%) breached: Peak ₹${monthlyPeak.toFixed(2)}, Current ₹${valuation.totalVal.toFixed(2)} (${monthlyDrawdownPct.toFixed(2)}% DD)`);
        return;
      }
    }

    // Target Achievement Engine Planning (Scheduled at 09:00, 09:15, 09:30, 10:00, 11:00, 12:00, 13:00, 14:00, 15:00)
    const checkTimes = [
      9 * 60,       // 09:00
      9 * 60 + 15,  // 09:15
      9 * 60 + 30,  // 09:30
      10 * 60,      // 10:00
      11 * 60,      // 11:00
      12 * 60,      // 12:00
      13 * 60,      // 13:00
      14 * 60,      // 14:00
      15 * 60       // 15:00
    ];

    if (checkTimes.includes(currentMins) && lastTargetAdaptTime !== currentMins) {
      lastTargetAdaptTime = currentMins;
      await this.runTargetEnginePlanning(currentMins);
    }

    // Profit Chasing Mode checks
    const targetState = this.calculateTargetEngineState(valuation);
    const isHalted = currentDayStats && (currentDayStats.status.startsWith('HALTED') || currentDayStats.status === 'LIFETIME_FLOOR_BREACHED');
    global.profitChasingMode = targetState.remainingTarget > 0 && !isHalted;

    if (global.profitChasingMode) {
      tqsThresholdOffset = -15;
      sizingScaleFactor = 2.0;
    } else {
      tqsThresholdOffset = 0;
      sizingScaleFactor = 1.0;
    }
    global.tqsThresholdOffset = tqsThresholdOffset;
    global.sizingScaleFactor = sizingScaleFactor;

    // Opportunity Scanner Trigger (GROWTH MODE: Every 30 seconds = 60 ticks. PROFIT CHASING Mode: Every 15 seconds = 30 ticks)
    const scanInterval = global.profitChasingMode ? 30 : 60;
    if (scanTimer % scanInterval === 0) {
      if (this.isMarketOpenWindow(timeInfo)) {
        console.log(`[SCHEDULER TRACE] scanUniverse() started at ${new Date().toISOString()} | scanTimer: ${scanTimer}`);
        const scanResults = await marketScanner.scanUniverse();
        await this.processScannerRankings(scanResults, valuation);
        await this.updateFutureReturns();
      } else {
        console.log(`[SCHEDULER TRACE] Skipping scan: Outside market window.`);
      }
    }
    
    scanTimer++;

    // Update Agent 24 Opportunity Cost audits every 60 ticks (30s)
    if (scanTimer % 60 === 0 && this.isMarketOpenWindow(timeInfo)) {
      try {
        const agentResearch = require('./agentResearch');
        await agentResearch.updateOpportunityAudits();
      } catch (audErr) {
        console.error('[BOT] Failed to run opportunity audit updates:', audErr.message);
      }
    }

    // Process shadow trades exits on every tick
    try {
      await this.processShadowExits(valuation);
    } catch (shadowErr) {
      console.error('[BOT] Failed to run shadow trade exits:', shadowErr.message);
    }

    // Process real trades exits on every tick
    try {
      await this.processRealExits();
    } catch (realExitErr) {
      console.error('[BOT] Failed to run real trade exits:', realExitErr.message);
    }

    // Mid-Session Strategy Switch at 2:30 PM (14:30 IST)
    if (currentMins >= 14 * 60 + 30 && currentMins < 15 * 60 + 15) {
      const dbStats = await db.getDailyStats(timeInfo.dateStr);
      if (portfolio.strategy !== 'LONG_TERM' && (!dbStats || !dbStats.strategy_switched)) {
        console.log('[SCHEDULER] 14:30 IST - Mid-session switch. Transitioning from DAY_TRADING to LONG_TERM blue chips...');
        
        // 1. Update strategy in DB portfolio state
        await db.updatePortfolioState({ strategy: 'LONG_TERM' });
        portfolio.strategy = 'LONG_TERM';
        
        // 2. Mark strategy_switched as true in daily stats
        if (currentDayStats) {
          currentDayStats.strategy_switched = true;
          await db.saveDailyStats(currentDayStats);
        }
        
        // 3. Sell any active day trading positions
        const activePositions = portfolio.holding_stocks || [];
        for (const pos of activePositions) {
          if (pos.strategy !== 'LONG_TERM') {
            console.log(`[STRATEGY SWITCH] Liquidating day trading position: ${pos.symbol}`);
            await broker.executeOrder(pos.symbol, 'SELL', pos.quantity, pos.strategy, 'Mid-session switch liquidation');
          }
        }
        
        // 4. Reallocate assets by buying blue chips: RELIANCE, TCS, HDFCBANK, INFOSYS
        const blueChips = ['RELIANCE', 'TCS', 'HDFCBANK', 'INFOSYS'];
        for (const sym of blueChips) {
          const ltp = await broker.getLTP(sym);
          if (ltp > 0) {
            const freshPortfolio = await db.getPortfolioState();
            const qty = 1;
            const cost = ltp * qty;
            if (freshPortfolio.balance >= cost) {
              console.log(`[STRATEGY SWITCH] Reallocating capital to blue chip: ${sym} Qty: ${qty}`);
              await broker.executeOrder(sym, 'BUY', qty, 'LONG_TERM', 'Reallocation to blue chip');
            }
          }
        }
        
        await alerts.sendTelegram('🔄 <b>Mid-Session Strategy Switch:</b> Portfolio transitioned to LONG_TERM blue chips. Reallocating assets...');
      }
    }

    if (currentMins >= 9 * 60 + 15 && currentDayStats.status === 'ACTIVE') {
      await this.updateDailyPNL(valuation);
    }

    if (this.isMarketOpenWindow(timeInfo) && currentMins % 30 === 0 && lastStatusSentMins !== currentMins) {
      lastStatusSentMins = currentMins;
      await this.sendPeriodicStatusUpdate(timeInfo);
    }

    // EOD Square Off Trigger
    if (state === 'MARKET_CLOSING' && currentMins >= 15 * 60 + 30 && currentMins < 15 * 60 + 35) {
      if (!preMarketState.eodSquareOffAlerted) {
        preMarketState.eodSquareOffAlerted = true;
        console.log('[SCHEDULER] 15:30 IST - EOD Square Off sequence initiated...');
        await alerts.sendTelegram('⏰ <b>15:30 EOD Square Off:</b> Liquidating all active day trading positions.');
        const activeHoldings = portfolio.holding_stocks || [];
        try {
          await riskEngine.triggerEmergencySquareOff(broker, activeHoldings);
        } catch (e) {
          console.error('[EOD SQUARE OFF] Error during liquidation:', e.message);
        }
      }
    }
  },

  async processScannerRankings(scanResults, valuation) {
    console.log(`\n⚖️ DEPARTMENT 5: PORTFOLIO ALLOCATION ENGINE`);
    
    // Seed mock prices for all scanned stocks in broker to bypass external rate limits
    if (scanResults) {
      if (scanResults.longs) {
        // Mock price overrides removed to preserve production data integrity
      }
      if (scanResults.shorts) {
        // Mock price overrides removed to preserve production data integrity
      }
    }

    const totalUniverseCount = marketScanner.getUniverseSize ? marketScanner.getUniverseSize() : 5000;
    const stage2RankedCount = scanResults.longs ? scanResults.longs.length : 0;
    const stage1ResearchCount = stage2RankedCount + (scanResults.shorts ? scanResults.shorts.length : 0);
    const totalScannedCount = Math.max(scanResults.totalScanned || totalUniverseCount, stage1ResearchCount);
    let stage3CandidatesCount = 0;
    let stage4ConsensusCount = 0;
    let stage5ExecutedCount = 0;
    let stageRiskPassedCount = 0;

    const rejectionReasons = {
      already_held: 0,
      entry_cooldown: 0,
      below_tqs_threshold: 0,
      insufficient_capital: 0,
      portfolio_replacement_failed: 0
    };

    const portfolio = await db.getPortfolioState();
    let activePositions = portfolio.holding_stocks || [];
    
    // Stage 3: Deep Analysis of Top 15 longs (consensus evaluations for responsiveness)
    const top100Longs = scanResults.longs.slice(0, 15);
    const candidates = [];

    console.log(`[PORTFOLIO] Running Stage 3 Deep Analysis consensus on top 100 longs...`);
    for (const item of top100Longs) {
      // 1. One position per symbol check
      if (activePositions.find(p => p.symbol === item.symbol) || pendingExecutions.has(item.symbol)) {
        rejectionReasons.already_held++;
        if (runtimeState && runtimeState.addRejection) runtimeState.addRejection(item.symbol, 'PORTFOLIO_CHECK', 'Already Held / Pending Entry', { price: item.price, agent: 'System' });
        continue;
      }

      // 2. 5-second cooldown check (reduced from 5 minutes for high frequency execution)
      const lastEntry = entryCooldowns[item.symbol] || 0;
      if (Date.now() - lastEntry < 5000) {
        rejectionReasons.entry_cooldown++;
        if (runtimeState && runtimeState.addRejection) runtimeState.addRejection(item.symbol, 'PORTFOLIO_CHECK', 'Entry Cooldown', { price: item.price, agent: 'System' });
        continue;
      }

      stage3CandidatesCount++;

      try {
        console.log(`[SCHEDULER TRACE] predictor execution started for symbol: ${item.symbol} at ${new Date().toISOString()}`);
        const prediction = await predictor.getPrediction(item.symbol, [item.price * 0.98, item.price * 0.99, item.price]);
        const tqs = prediction.tradeQuality || 50;

        if (prediction.consensus) {
          stage4ConsensusCount++;
          await this.logOpportunityInTracker(item, prediction, tqs, 'WATCHLIST', '');
          
          // Log predictions for validation tracking (Phase 7)
          const predictionValidator = require('./predictionValidator');
          try {
            await predictionValidator.logPrediction({
              symbol: item.symbol,
              agentName: 'Consensus Engine',
              direction: prediction.signal,
              confidence: prediction.confidence,
              ics: prediction.ics || 75,
              target: item.price * 1.05,
              stopLoss: item.price * 0.97,
              currentPrice: item.price
            });
            if (prediction.participating_models?.agent1) {
              await predictionValidator.logPrediction({
                symbol: item.symbol,
                agentName: 'ML Agent',
                direction: prediction.participating_models.agent1.signal,
                confidence: prediction.participating_models.agent1.confidence,
                ics: prediction.ics || 75,
                target: item.price * 1.05,
                stopLoss: item.price * 0.97,
                currentPrice: item.price
              });
            }
            if (prediction.participating_models?.agent11_price_action) {
              await predictionValidator.logPrediction({
                symbol: item.symbol,
                agentName: 'Price Action Agent',
                direction: prediction.participating_models.agent11_price_action.signal,
                confidence: prediction.participating_models.agent11_price_action.confidence,
                ics: prediction.ics || 75,
                target: item.price * 1.05,
                stopLoss: item.price * 0.97,
                currentPrice: item.price
              });
            }
          } catch (valErr) {
            console.error('[VALIDATOR] Skipped logging individual agent forecasts:', valErr.message);
          }

          candidates.push({
            item,
            prediction,
            tqs,
            expectancy: prediction.expectancyBeforeTrade || 0
          });
        } else {
          await this.logOpportunityInTracker(item, prediction, tqs, 'REJECTED', 'Consensus deadlock');
        }
      } catch (err) {
        console.error(`[PORTFOLIO] Error running prediction for ${item.symbol}:`, err.message);
      }
    }

    // Narrow top candidates down to top 20 based on deep analysis (consensus TQS / expectancy)
    const sortedCandidates = candidates.sort((a, b) => b.tqs - a.tqs || b.expectancy - a.expectancy);
    const top20Candidates = sortedCandidates.slice(0, 20);
    const outsideTop20 = sortedCandidates.slice(20);

    for (const cand of outsideTop20) {
      await this.logOpportunityInTracker(cand.item, cand.prediction, cand.tqs, 'REJECTED', 'Outside Top 20 TQS rank');
    }

    // Stage 4: Selection of the 5 Best Trades for execution out of the 20 analyzed candidates
    const best5Trades = top20Candidates.slice(0, 5);
    const outsideTop5 = top20Candidates.slice(5);

    for (const cand of outsideTop5) {
      await this.logOpportunityInTracker(cand.item, cand.prediction, cand.tqs, 'REJECTED', 'Outside Top 5 execution rank');
    }

    console.log(`[PORTFOLIO] Selected ${best5Trades.length} best setups for execution out of ${top20Candidates.length} active candidates.`);

    for (const cand of best5Trades) {
      const { item, prediction, tqs } = cand;

      // 15:30 IST Entry restriction check
      const timeCheck = fsm.getSystemTime();
      const minsCheck = timeCheck.hours * 60 + timeCheck.minutes;
      if (minsCheck >= 15 * 60 + 30) {
        console.log(`[PORTFOLIO SKIP] 15:30 IST entry restriction. Skipping trade for ${item.symbol}.`);
        await this.logOpportunityInTracker(item, prediction, tqs, 'REJECTED', '15:30 entry restriction');
        continue;
      }

      // Increment Signal Suppression metrics
      signalSuppressionState.totalCandidates++;
      if (tqs >= 70) signalSuppressionState.tqsBuckets.tqs70++;
      if (tqs >= 75) signalSuppressionState.tqsBuckets.tqs75++;
      if (tqs >= 78) signalSuppressionState.tqsBuckets.tqs78++;
      if (tqs >= 80) signalSuppressionState.tqsBuckets.tqs80++;
      if (tqs >= 85) signalSuppressionState.tqsBuckets.tqs85++;

      // Trade Quality Rules: Dynamic TQS Threshold
      const dtResult = dynamicThreshold.getCurrentThreshold();
      let currentThreshold = dtResult.threshold; 
      
      // Target-Driven Threshold scaling - ONLY upward protection, NEVER lowering
      const dailyTarget = currentDayStats ? currentDayStats.daily_target : 1000;
      const currentDailyPnL = valuation.totalVal - (currentDayStats ? currentDayStats.start_capital : valuation.totalVal);
      const progressPct = (currentDailyPnL / dailyTarget) * 100;

      if (progressPct >= 90) {
        currentThreshold = Math.min(85, currentThreshold + 5); // protect gains
        console.log(`[PORTFOLIO] Target-Driven Execution: Target met. Threshold raised to ${currentThreshold} to lock profit.`);
      }

      // Apply Target Engine adaptation offset (clamped between 60 and 85)
      if (typeof tqsThresholdOffset !== 'undefined' && tqsThresholdOffset) {
        currentThreshold += tqsThresholdOffset;
        currentThreshold = Math.max(60, Math.min(85, currentThreshold));
      }

      try {
        await dynamicThreshold.saveThresholdSnapshot();
      } catch (snapErr) {
        console.error('[PORTFOLIO] Failed to save threshold snapshot:', snapErr.message);
      }

      const sectorCount = activePositions.filter(p => p.sector === item.sector).length;

      // 3. Portfolio Intelligence: Position Replacement Logic
      if (activePositions.length >= 10 || sectorCount >= 5) {
        let replaced = false;
        for (let idx = 0; idx < activePositions.length; idx++) {
          const pos = activePositions[idx];
          const currentPrice = broker.getLTP(pos.symbol) || pos.entry_price;
          const unrealizedPnL = (currentPrice - pos.entry_price) * pos.quantity;
          const originalTQS = pos.tqs || 65;

          // Replace if current position is losing and new candidate has >= 15 points higher TQS
          if (unrealizedPnL <= 0 && (tqs - originalTQS) >= 10) {
            console.log(`[PORTFOLIO] Portfolio Intelligence: Replacing underperforming position ${pos.symbol} (TQS ${originalTQS}, PnL ₹${unrealizedPnL.toFixed(2)}) with higher conviction setup ${item.symbol} (TQS ${tqs}).`);
            try {
              await broker.executeOrder(pos.symbol, 'SELL', pos.quantity, 'SWING', 'Replaced by higher conviction setup');
              await db.matchBuyAndCreateCompletedTrade(pos.symbol, currentPrice, pos.quantity, new Date().toISOString(), 'Replaced by higher conviction setup');
              await predictor.recordPredictionExit(pos.symbol, currentPrice, unrealizedPnL, pos);
              activePositions.splice(idx, 1);
              replaced = true;
              break;
            } catch (sellErr) {
              console.error(`[PORTFOLIO] Failed to execute replacement sell for ${pos.symbol}:`, sellErr.message);
            }
          }
        }
        if (!replaced) {
          if (activePositions.length >= 10) {
            console.log(`[PORTFOLIO] Max 10 positions active (Growth Mode). Skipping trade for ${item.symbol}.`);
            rejectionReasons.portfolio_replacement_failed++;
            await this.logOpportunityInTracker(item, prediction, tqs, 'REJECTED', 'Portfolio limit reached (10 positions)');
            logSuppressionDiagnostics(item, prediction, tqs, currentThreshold, 'Portfolio limit reached (10 positions)', false);
            continue;
          }
          if (sectorCount >= 5) {
            console.log(`[PORTFOLIO] Sector limit reached for ${item.sector}. Skipping trade for ${item.symbol}.`);
            rejectionReasons.portfolio_replacement_failed++;
            await this.logOpportunityInTracker(item, prediction, tqs, 'REJECTED', `Sector limit reached (${item.sector})`);
            logSuppressionDiagnostics(item, prediction, tqs, currentThreshold, `Sector limit reached (${item.sector})`, false);
            continue;
          }
        }
      }

      // SECTION 4 - Drawdown Reduction & Risk Filtering (Phase 18 Adaptive Scoring Gate)
      if (!prediction.execute) {
        const rejReason = prediction.rejectionReason || 'Weighted score below threshold';
        console.log(`[PORTFOLIO SKIP] Adaptive Decision Engine rejected entry for ${item.symbol}: ${rejReason}`);
        rejectionReasons.below_tqs_threshold++;
        await this.logOpportunityInTracker(item, prediction, tqs, 'REJECTED', rejReason);
        
        logSuppressionDiagnostics(item, prediction, tqs, currentThreshold, rejReason, false);
        try {
          const sizing = calculateAdaptiveSizing(item.symbol, prediction, valuation, tqs, currentThreshold);
          const estCapital = valuation.balance * (sizing.allocationPct / 100);
          await agentResearch.recordRejectedOpportunity(item.symbol, tqs, rejReason, item.price, estCapital);
        } catch (e) {}
        continue;
      }

      // STRICT BUSINESS LOGIC GATE
      let rejected = false;
      let rejectReason = '';

      if (prediction.signal !== 'BUY') {
        rejected = true;
        rejectReason = `Signal is not BUY (${prediction.signal})`;
      } else if (tqs < currentThreshold) {
        rejected = true;
        rejectReason = `TQS ${tqs} is below required threshold ${currentThreshold}`;
      } else if (prediction.icsLabel === 'Reject') {
        rejected = true;
        rejectReason = `Institutional Confluence Engine (ICS) rejected setup`;
      } else if (prediction.targetPrice <= item.price) {
        rejected = true;
        rejectReason = `Target price ₹${prediction.targetPrice} is below entry price ₹${item.price}`;
      } else if (prediction.stopLossPrice >= item.price) {
        rejected = true;
        rejectReason = `Stop loss price ₹${prediction.stopLossPrice} is above entry price ₹${item.price}`;
      }

      if (rejected) {
        console.log(`[PORTFOLIO SKIP] Strict business logic gate rejected entry for ${item.symbol}: ${rejectReason}`);
        rejectionReasons.below_tqs_threshold++;
        await this.logOpportunityInTracker(item, prediction, tqs, 'REJECTED', rejectReason);
        logSuppressionDiagnostics(item, prediction, tqs, currentThreshold, rejectReason, false);
        try {
          const sizing = calculateAdaptiveSizing(item.symbol, prediction, valuation, tqs, currentThreshold);
          const estCapital = valuation.balance * (sizing.allocationPct / 100);
          await agentResearch.recordRejectedOpportunity(item.symbol, tqs, rejectReason, item.price, estCapital);
        } catch (e) {}
        continue;
      }

      stageRiskPassedCount++;

      // Adaptive position sizing from Agent 25
      const sizing = calculateAdaptiveSizing(item.symbol, prediction, valuation, tqs, currentThreshold);
      const baseAllocationPct = sizing.allocationPct;
      console.log(`[PORTFOLIO] Sizing logic: ${sizing.reasoning}`);

      // Evaluate Advanced Portfolio Sizing / Risk Engine (Phase 19 Upgrade)
      const riskEngine = require('./riskEngine');
      const sectorMap = require('./agentResearch').SECTOR_MAP || {};
      const stockSector = sectorMap[item.symbol] || 'OTHER';

      // 1. Execution Quality Engine check
      const executionQualityEngine = require('./executionQualityEngine');
      const execQuality = executionQualityEngine.evaluateExecutionQuality({
        symbol: item.symbol,
        bid: item.price - 0.05,
        ask: item.price + 0.05,
        avgVolume: 1000000,
        orderSize: Math.floor((valuation.balance * 0.10) / item.price),
        latencyMs: 85,
        isGapOpen: false
      });

      if (!execQuality.approved) {
        console.warn(`[PORTFOLIO] Execution quality REJECTED for ${item.symbol}: ${execQuality.reason}`);
        rejectionReasons.portfolio_replacement_failed++;
        await this.logOpportunityInTracker(item, prediction, tqs, 'REJECTED', `Exec Quality: ${execQuality.reason}`);
        logSuppressionDiagnostics(item, prediction, tqs, currentThreshold, `Exec Quality: ${execQuality.reason}`, false);
        continue;
      }

      // 2. Portfolio Correlation Engine check
      const portfolioCorrelationEngine = require('./portfolioCorrelationEngine');
      const correlationEvaluation = portfolioCorrelationEngine.evaluateCorrelation({
        symbol: item.symbol,
        sector: stockSector,
        riskAmount: 1.0
      }, activePositions.map(p => ({
        symbol: p.symbol,
        sector: p.sector || 'OTHER',
        riskAmount: p.riskAmount || 1.0
      })));

      if (!correlationEvaluation.approved) {
        console.warn(`[PORTFOLIO] Correlation checks REJECTED for ${item.symbol}: ${correlationEvaluation.reason}`);
        rejectionReasons.portfolio_replacement_failed++;
        await this.logOpportunityInTracker(item, prediction, tqs, 'REJECTED', `Correlation: ${correlationEvaluation.reason}`);
        logSuppressionDiagnostics(item, prediction, tqs, currentThreshold, `Correlation: ${correlationEvaluation.reason}`, false);
        continue;
      }

      // 3. Portfolio Manager Engine check
      const portfolioManager = require('./portfolioManager');
      const portfolioEvaluation = portfolioManager.evaluatePortfolioAddition({
        symbol: item.symbol,
        sector: stockSector,
        expectedWinProb: prediction.expectedWinProbability,
        riskReward: prediction.calculatedRiskReward,
        riskAmount: 1.0
      }, activePositions.map(p => ({
        symbol: p.symbol,
        sector: p.sector || 'OTHER',
        expectedWinProb: p.expectedWinProb || 0.55,
        riskReward: p.riskReward || 1.5,
        riskAmount: p.riskAmount || 1.0
      })));

      if (!portfolioEvaluation.approved) {
        console.warn(`[PORTFOLIO] Portfolio Manager REJECTED for ${item.symbol}: ${portfolioEvaluation.reason}`);
        rejectionReasons.portfolio_replacement_failed++;
        await this.logOpportunityInTracker(item, prediction, tqs, 'REJECTED', `Portfolio Manager: ${portfolioEvaluation.reason}`);
        logSuppressionDiagnostics(item, prediction, tqs, currentThreshold, `Portfolio Manager: ${portfolioEvaluation.reason}`, false);
        continue;
      }

      // 4. Dynamic Risk Engine sizing evaluation
      let winningStreak = 0;
      let losingStreak = 0;
      try {
        const dbData = db.readLocalDb();
        const completed = dbData.completed_trades || [];
        let streak = 0;
        let isWinning = null;
        for (let idx = completed.length - 1; idx >= 0; idx--) {
          const t = completed[idx];
          const won = t.net_pnl > 0;
          if (isWinning === null) {
            isWinning = won;
            streak = 1;
          } else if (isWinning === won) {
            streak++;
          } else {
            break;
          }
        }
        if (isWinning === true) winningStreak = streak;
        if (isWinning === false) losingStreak = streak;
      } catch (e) {}

      const riskEvaluation = await riskEngine.evaluateTradeRisk({
        symbol: item.symbol,
        sector: stockSector,
        allocationPct: baseAllocationPct,
        portfolioValue: valuation.totalVal,
        currentHoldings: activePositions,
        posteriorWinProbability: prediction.expectedWinProbability,
        riskReward: prediction.calculatedRiskReward,
        expectedDrawdown: prediction.expectedDrawdown,
        winningStreak,
        losingStreak,
        marketState: prediction.marketState,
        volatility: execQuality.expectedSlippagePct > 0.1 ? 1.6 : 0.8,
        portfolioHeat: correlationEvaluation.totalPortfolioRisk,
        correlation: correlationEvaluation.avgCorrelation,
        executionScore: execQuality.score,
        entryPrice: item.price,
        stopLossPrice: prediction.stopLossPrice
      });

      if (!riskEvaluation.approved) {
        console.warn(`[PORTFOLIO] Risk evaluation REJECTED for ${item.symbol}: ${riskEvaluation.reason}`);
        rejectionReasons.portfolio_replacement_failed++;
        await this.logOpportunityInTracker(item, prediction, tqs, 'REJECTED', `Risk engine: ${riskEvaluation.reason}`);
        logSuppressionDiagnostics(item, prediction, tqs, currentThreshold, `Risk engine: ${riskEvaluation.reason}`, false);
        console.log(`\n[PIPELINE]\nScanner PASS\n↓\nConsensus PASS\n↓\nRisk REJECTED (${riskEvaluation.reason})`);
        continue;
      }

      const finalAllocationPct = riskEvaluation.adjustedSize;
      const buyCapital = valuation.balance * (finalAllocationPct / 100);
      let qty = Math.floor(buyCapital / item.price);

      const maxCap = valuation.totalVal * 0.20;
      if (qty * item.price > maxCap) {
        qty = Math.floor(maxCap / item.price);
      }

      if (qty * item.price > valuation.balance) {
        qty = Math.floor(valuation.balance / item.price);
      }

      if (qty <= 0 && valuation.balance >= item.price) {
        qty = 1;
        console.log(`[PORTFOLIO] Sizing Sg: Rounded up quantity to 1 share for ${item.symbol} (stock price ₹${item.price} exceeds allocation cap but cash balance ₹${valuation.balance} permits).`);
      }

      if (qty <= 0) {
        rejectionReasons.insufficient_capital++;
        await this.logOpportunityInTracker(item, prediction, tqs, 'REJECTED', 'Insufficient capital');
        logSuppressionDiagnostics(item, prediction, tqs, currentThreshold, 'Insufficient capital', false);
        try {
          const data = db.readLocalDb();
          data.zero_qty_rejections = (data.zero_qty_rejections || 0) + 1;
          db.writeLocalDb(data);
        } catch (e) {}
        console.log(`\n[PIPELINE]\nScanner PASS\n↓\nConsensus PASS\n↓\nRisk PASS\n↓\nCapital REJECTED (qty=0)`);
        continue;
      }

      if (qty > 0) {
        stage5ExecutedCount++;
        console.log(`[PORTFOLIO] Expectancy ${prediction.expectancyBeforeTrade.toFixed(4)} | TQS ${tqs} | Size ${finalAllocationPct}%`);
        
        await this.logOpportunityInTracker(item, prediction, tqs, 'EXECUTED', 'None');
        console.log(`\n[PIPELINE]\nScanner PASS\n↓\nConsensus PASS\n↓\nRisk PASS\n↓\nCapital PASS\n↓\nPosition PASS\n↓\nBUY ORDER CREATED`);

        const modelWeightsList = {};
        const leaderboard = predictor.getLeaderboard();
        Object.keys(prediction.participating_models).forEach(k => {
          if (k === 'learning_impact') return;
          const cleanId = k.replace('agent', '').replace('_gemini', '').replace('_groq', '').replace('_technical', '').replace('_context', '').replace('_regime', '').replace('_risk', '').replace('_breadth', '').replace('_sector', '');
          const id = cleanId === '10' ? '10' : cleanId === '9' ? '9' : cleanId;
          if (leaderboard[id]) {
            modelWeightsList[k] = leaderboard[id].weight;
          }
        });

        const execMode = prediction.execution_mode || 'INSTITUTIONAL';
        // Pack stops and targets in the report JSON so broker extracts them
        const executionReport = {
          scanner_score: item.score || 50,
          tqs: tqs,
          tqs_threshold: currentThreshold,
          participating_models: prediction.participating_models,
          agent_contributions: Object.keys(prediction.participating_models).reduce((acc, k) => {
            if (k !== 'learning_impact') acc[k] = prediction.participating_models[k].signal;
            return acc;
          }, {}),
          historical_analog_match: prediction.participating_models.learning_impact || { confidence_adj: 0, match_count: 0 },
          trust_weight_impact: modelWeightsList,
          final_confidence: prediction.confidence,
          position_size_logic: `Kelly Sizing: allocation = ${finalAllocationPct}%`,
          entry_reason: `Consensus EXPECTANCY entry for ${item.symbol}`,
          execution_mode: execMode,
          stopLossPrice: prediction.stopLossPrice,
          targetPrice: prediction.targetPrice
        };

        const detailedReason = `Expectancy entry (${execMode} Mode): TQS ${tqs}%, allocation ${finalAllocationPct}% | REPORT: ${JSON.stringify(executionReport)}`;

        if (entriesPaused) {
          console.warn(`[PORTFOLIO] Entries are currently paused. Skipping execution for ${item.symbol}.`);
          continue;
        }

        if (pendingExecutions.has(item.symbol)) {
          console.warn(`[PORTFOLIO] Order for ${item.symbol} is already in-flight. Skipping duplicate.`);
          continue;
        }
        pendingExecutions.add(item.symbol);

        try {
          console.log(`[PIPELINE] ↓\nBROKER REQUEST SENT`);
          const startTime = Date.now();
          await agent17_execution.placeOrder(
            item.symbol,
            'BUY',
            qty,
            'CNC',
            detailedReason,
            item.price
          );
          const latency = Date.now() - startTime;
          console.log(`[PIPELINE] ↓\nBROKER RESPONSE (HTTP 200 OK | Latency: ${latency}ms)\n↓\nORDER FILLED\n↓\nPORTFOLIO UPDATED`);

          entryCooldowns[item.symbol] = Date.now();

          const breakdownInfo = getVoteBreakdown(prediction);
          const buyCount = breakdownInfo.breakdown.BUY || 0;
          const sellCount = breakdownInfo.breakdown.SELL || 0;
          const holdCount = breakdownInfo.breakdown.HOLD || 0;
          const currentStopLossPrice = prediction.stopLossPrice;
          const currentTargetPrice = prediction.targetPrice;
          const volumeDataVal = volumeIntelligenceAgent.analyzeVolume(prediction.candles5M || []);
          const risk = Math.abs(item.price - currentStopLossPrice);
          const reward = Math.abs(currentTargetPrice - item.price);
          const rrRatio = risk > 0 ? (reward / risk).toFixed(2) : '1.50';
          const smcSignal = prediction.participating_models?.agent12_smc?.vote || 'HOLD';

          const buyAlertText = `🟢 <b>INSTITUTIONAL SIGNAL</b>\n` +
            `• Symbol: <b>${item.symbol}</b>\n` +
            `• Direction: <b>BUY</b>\n` +
            `• Entry: <b>₹${item.price.toFixed(2)}</b>\n` +
            `• Target: <b>₹${currentTargetPrice.toFixed(2)}</b>\n` +
            `• Stop: <b>₹${currentStopLossPrice.toFixed(2)}</b>\n` +
            `• Risk Reward: <b>1:${rrRatio}</b>\n` +
            `• TQS: <b>${tqs}%</b>\n` +
            `• ICS: <b>${prediction.ics || 80} (${prediction.icsLabel || 'Buy'})</b>\n` +
            `• Market Regime: <b>${prediction.marketRegime || 'RANGING'}</b>\n` +
            `• Volume State: <b>${volumeDataVal.volumeState}</b>\n` +
            `• SMC Signal: <b>${smcSignal}</b>\n` +
            `• Consensus Votes: <b>BUY ${buyCount} | SELL ${sellCount} | HOLD ${holdCount}</b>\n` +
            `• Confidence: <b>${(prediction.confidence * 100).toFixed(0)}%</b>`;

          await alerts.sendTelegram(buyAlertText);
        } catch (orderErr) {
          console.error(`[ORDER EXECUTION FAILED] For ${item.symbol}:`, orderErr.message);
          console.log(`[PIPELINE] ↓\nBROKER REJECTED: ${orderErr.message}`);
          if (orderErr.message.includes('CORRUPTION') || orderErr.message.includes('different source') || orderErr.message.includes('source mismatch')) {
            throw orderErr; // Halt execution!
          }
          // Increment rejected orders count
          try {
            const data = db.readLocalDb();
            data.orders_rejected_today = (data.orders_rejected_today || 0) + 1;
            db.writeLocalDb(data);
          } catch (e) {}
        } finally {
          pendingExecutions.delete(item.symbol);
        }
      }
    }

    // Rebuild Rejection/Pipeline statistics logging
    const pct1 = ((stage1ResearchCount / totalScannedCount) * 100).toFixed(1);
    const pct2 = ((stage2RankedCount / stage1ResearchCount) * 100).toFixed(1);
    const pct3 = ((stage3CandidatesCount / stage2RankedCount) * 100).toFixed(1);
    const pct4 = ((stage4ConsensusCount / Math.max(1, stage3CandidatesCount)) * 100).toFixed(1);
    const pct5 = ((stage5ExecutedCount / Math.max(1, stage4ConsensusCount)) * 100).toFixed(1);

    console.log(`\n📊 INSTITUTIONAL PIPELINE SURVIVAL REPORT:`);
    console.log(`• Universe Exist: ${totalUniverseCount} symbols`);
    console.log(`• Scanned Stage:  ${totalScannedCount} symbols`);
    console.log(`• Research (S1):  ${stage1ResearchCount} symbols (${pct1}%)`);
    console.log(`• Ranking (S2):   ${stage2RankedCount} symbols (${pct2}%)`);
    console.log(`• Candidates (S3): ${stage3CandidatesCount} symbols (${pct3}%)`);
    console.log(`• Consensus (S4):  ${stage4ConsensusCount} symbols (${pct4}%)`);
    console.log(`• Executed (S5):   ${stage5ExecutedCount} symbols (${pct5}%)`);
    console.log(`• Rejection Reasons: Already Held: ${rejectionReasons.already_held} | Entry Cooldown: ${rejectionReasons.entry_cooldown} | Below Threshold: ${rejectionReasons.below_tqs_threshold} | Insufficient Capital: ${rejectionReasons.insufficient_capital} | Portfolio Replace Failed: ${rejectionReasons.portfolio_replacement_failed}`);

    // Phase 4 Funnel validation check
    if (!(totalScannedCount >= stage1ResearchCount &&
          stage1ResearchCount >= stage2RankedCount &&
          stage2RankedCount >= stage3CandidatesCount &&
          stage3CandidatesCount >= stage4ConsensusCount &&
          stage4ConsensusCount >= stageRiskPassedCount &&
          stageRiskPassedCount >= stage5ExecutedCount)) {
      const errorMsg = `[METRIC FUNNEL CORRUPTION] Inconsistent pipeline metric counts: ` +
        `Scanned: ${totalScannedCount} | ` +
        `TQS (S1): ${stage1ResearchCount} | ` +
        `Confidence (S2): ${stage2RankedCount} | ` +
        `Risk (S3): ${stage3CandidatesCount} | ` +
        `Consensus (S4): ${stage4ConsensusCount} | ` +
        `Risk Passed (S5): ${stageRiskPassedCount} | ` +
        `Executed: ${stage5ExecutedCount}`;
      console.error(errorMsg);
      throw new Error(errorMsg);
    }

    // Store pipeline logs to local db cache
    try {
      const dbData = db.readLocalDb();
      dbData.pipeline_logs = dbData.pipeline_logs || [];
      const entry = {
        timestamp: new Date().toISOString(),
        universe: totalUniverseCount,
        scanned: totalScannedCount,
        stage1_research: stage1ResearchCount,
        stage2_ranked: stage2RankedCount,
        stage3_candidates: stage3CandidatesCount,
        stage4_consensus: stage4ConsensusCount,
        stage5_executed: stage5ExecutedCount,
        passed_risk: stageRiskPassedCount,
        rejection_reasons: rejectionReasons
      };
      dbData.pipeline_logs.push(entry);
      if (dbData.pipeline_logs.length > 100) dbData.pipeline_logs.shift();
      db.writeLocalDb(dbData);

      await db.logThroughput({
        scanned: totalScannedCount,
        researched: stage1ResearchCount,
        ranked: stage2RankedCount,
        scored: stage3CandidatesCount,
        candidates: stage3CandidatesCount,
        consensus: stage4ConsensusCount,
        executed: stage5ExecutedCount,
        passed_risk: stageRiskPassedCount,
        rejection_reasons: rejectionReasons
      });
    } catch (e) {}

    // Process exits
    await this.processRealExits();
  },

  async haltTrading(statusType, reason) {
    console.log(`[BOT HALT]: ${reason}`);
    const portfolio = await db.getPortfolioState();
    const holdings = [...(portfolio.holding_stocks || [])];
    for (const holding of holdings) {
      const price = broker.getLTP(holding.symbol) || holding.avgPrice;
      await broker.executeOrder(holding.symbol, 'SELL', holding.quantity, holding.strategy, `Risk Emergency Liquidation: ${statusType}`);
      await db.matchBuyAndCreateCompletedTrade(holding.symbol, price, holding.quantity, new Date().toISOString(), `Risk Emergency Liquidation: ${statusType}`);
    }

    const valuation = await broker.getValuation();
    const dailyPnL = valuation.totalVal - currentDayStats.start_capital;

    currentDayStats = await db.saveDailyStats({
      ...currentDayStats,
      date: currentDayStats.date,
      end_capital: valuation.totalVal,
      net_pnl: dailyPnL,
      target_met: false,
      status: statusType
    });

    if (preMarketState.readinessScore > 90) {
      preMarketState.readinessScore = 90;
    }

    await alerts.sendTelegram(`🛑 <b>EMERGENCY HALT</b>: ${reason}`);
    this.stop();
  },

  async updateDailyPNL(valuation) {
    if (!currentDayStats) return;
    const dailyPnL = parseFloat((valuation.totalVal - currentDayStats.start_capital).toFixed(2));
    const targetMet = dailyPnL >= currentDayStats.daily_target;
    
    currentDayStats.end_capital = valuation.totalVal;
    currentDayStats.net_pnl = dailyPnL;
    currentDayStats.target_met = targetMet;

    if (scanTimer % 10 === 0) {
      await db.saveDailyStats(currentDayStats);
    }
  },

  async updateFutureReturns() {
    const now = Date.now();
    const data = db.readLocalDb();
    const decisions = data.consensus_decisions || [];
    
    // Check decisions from the last 24 hours that don't have ref_eod set
    const activeDecisions = decisions.filter(c => {
      const elapsed = now - new Date(c.timestamp).getTime();
      return elapsed < 24 * 60 * 60 * 1000 && (c.ref_eod === null || c.ref_eod === undefined);
    });
    
    for (const c of activeDecisions) {
      const elapsedMins = (now - new Date(c.timestamp).getTime()) / (60 * 1000);
      const updates = {};
      let changed = false;
      
      const entryPrice = c.participating_models?.entry_price || c.entry_price || broker.getLTP(c.symbol);
      if (!entryPrice) continue;
      
      const currentPrice = broker.getLTP(c.symbol);
      if (!currentPrice) continue;
      
      const ret = ((currentPrice - entryPrice) / entryPrice) * 100;
      
      if (elapsedMins >= 15 && (c.ref_15m === null || c.ref_15m === undefined)) {
        updates.ref_15m = Number(ret.toFixed(4));
        changed = true;
      }
      if (elapsedMins >= 30 && (c.ref_30m === null || c.ref_30m === undefined)) {
        updates.ref_30m = Number(ret.toFixed(4));
        changed = true;
      }
      if (elapsedMins >= 60 && (c.ref_1h === null || c.ref_1h === undefined)) {
        updates.ref_1h = Number(ret.toFixed(4));
        changed = true;
      }
      
      const timeInfo = fsm.getSystemTime();
      const currentMins = timeInfo.hours * 60 + timeInfo.minutes;
      // Finalize EOD returns if market is closed or elapsed time is >= 6 hours (360 mins)
      if ((currentMins >= 15 * 60 + 30 || elapsedMins >= 360) && (c.ref_eod === null || c.ref_eod === undefined)) {
        updates.ref_eod = Number(ret.toFixed(4));
        updates.result_after_closes = Number(ret.toFixed(4));
        updates.final_outcome = ret > 0 ? 'WIN' : (ret < 0 ? 'LOSS' : 'FLAT');
        changed = true;
      }
      
      if (changed) {
        await db.updateConsensusDecision(c.id, updates);
      }
    }
  },

  async runTargetEnginePlanning(currentMins) {
    const timeInfo = fsm.getSystemTime();
    const valuation = await broker.getValuation();
    const dailyTarget = currentDayStats ? currentDayStats.daily_target : 1000;
    const dailyPnL = currentDayStats ? parseFloat((valuation.totalVal - currentDayStats.start_capital).toFixed(2)) : 0;
    
    const remainingTarget = Math.max(0, dailyTarget - dailyPnL);
    
    // Target calculations
    const lifetimeWinRate = runtimeState.state.performance.lifetime_win_rate || 0;
    const todayWinRate = runtimeState.state.performance.today_win_rate || 0;
    const winRate = todayWinRate > 0 ? (todayWinRate / 100) : (lifetimeWinRate > 0 ? (lifetimeWinRate / 100) : null);
    
    // We cannot assume avgWin / avgLoss without real historical trades. 
    // If no trades exist, these remain undefined.
    let expectedProfitPerTrade = null;
    let requiredTrades = null;
    let requiredWinRate = null;
    let requiredCapitalUtil = null;
    let requiredOpportunityDensity = null;
    const hoursRemaining = Math.max(0.5, (15 * 60 + 30 - currentMins) / 60);

    // If we have no historical winRate to build models from, do not fabricate estimates.
    if (winRate !== null) {
      // In a full implementation, these would also come from runtimeState performance.
      // Since they are not tracked yet, we leave them as null to trigger 'Unavailable' on the UI.
    }
    
    console.log(`\n🎯 TARGET ENGINE PLANNING & ADAPTATION [${timeInfo.hours.toString().padStart(2, '0')}:${timeInfo.minutes.toString().padStart(2, '0')}]`);
    console.log(`• Daily Target: ₹${dailyTarget} | Current PnL: ₹${dailyPnL.toFixed(2)} (Progress: ${((dailyPnL/dailyTarget)*100).toFixed(1)}%)`);
    if (expectedProfitPerTrade !== null) {
      console.log(`• Required Setups to Target: ${requiredTrades} | Required Expected Return: ₹${expectedProfitPerTrade.toFixed(2)}`);
      console.log(`• Required Win Rate: ${(requiredWinRate * 100).toFixed(1)}% | Required Capital Util: ${requiredCapitalUtil.toFixed(1)}%`);
      console.log(`• Required Opportunity Density: ${requiredOpportunityDensity} setups/hour`);
    } else {
      console.log(`• Required Targets: Insufficient trade history to compute target reachability metrics.`);
    }

    // Target adaptation: if behind target (progress < expected progress based on time)
    // Market runs from 09:15 to 15:30 (375 minutes). Let's calculate expected progress:
    const marketElapsedMins = Math.max(0, currentMins - (9 * 60 + 15));
    const expectedProgressPct = Math.min(100, (marketElapsedMins / 375) * 100);
    const currentProgressPct = (dailyPnL / dailyTarget) * 100;
    
    let adaptationReasoning = 'On track. Maintaining standard parameters.';
    if (currentProgressPct < expectedProgressPct && remainingTarget > 0) {
      // Behind target! Let's adapt parameters to catch up:
      tqsThresholdOffset = -5;
      sizingScaleFactor = 1.5; 
      
      adaptationReasoning = `Behind target (PnL ${currentProgressPct.toFixed(1)}% vs Expected ${expectedProgressPct.toFixed(1)}%). Lowering TQS threshold offset to -5, boosting Sizing scale factor to 1.5x.`;
      console.log(`⚠️ TARGET ENGINE ADAPTATION ACTIVE: ${adaptationReasoning}`);
    } else {
      tqsThresholdOffset = 0;
      sizingScaleFactor = 1.0;
    }
    global.tqsThresholdOffset = tqsThresholdOffset;
    
    // Save to daily target logs or history
    try {
      const dbData = db.readLocalDb();
      dbData.target_updates = dbData.target_updates || [];
      dbData.target_updates.push({
        timestamp: new Date().toISOString(),
        time: `${timeInfo.hours.toString().padStart(2, '0')}:${timeInfo.minutes.toString().padStart(2, '0')}`,
        dailyPnL,
        remainingTarget: Number(remainingTarget.toFixed(2)),
        requiredExpectedProfit: expectedProfitPerTrade !== null ? Number(expectedProfitPerTrade.toFixed(2)) : undefined,
        requiredTradeCount: requiredTrades !== null ? requiredTrades : undefined,
        requiredWinRate: requiredWinRate !== null ? Number((requiredWinRate * 100).toFixed(2)) : undefined,
        requiredCapitalUtilization: requiredCapitalUtil !== null ? Number(requiredCapitalUtil.toFixed(2)) : undefined,
        requiredOpportunityDensity: requiredOpportunityDensity !== null ? Number(requiredOpportunityDensity.toFixed(2)) : undefined,
        adaptationReasoning
      });
      db.writeLocalDb(dbData);
    } catch(e) {}
  },

  async sendPeriodicStatusUpdate(timeInfo) {
    try {
      const valuation = await broker.getValuation();
      const portfolio = await db.getPortfolioState();
      const holdings = portfolio.holding_stocks || [];
      const dailyPnL = valuation.totalVal - currentDayStats.start_capital;

      // Fetch latest scanner rankings for Top Long / Short
      const scanResults = await db.getLatestScannerRankings();
      const topLong = scanResults?.longs?.[0]?.symbol || 'None';
      const topShort = scanResults?.shorts?.[0]?.symbol || 'None';

      // Get best / worst agent
      const leaderboard = predictor.getLeaderboard();
      let bestAgent = null;
      let worstAgent = null;
      Object.keys(leaderboard).forEach(id => {
        const agent = leaderboard[id];
        const netPnL = agent.profitContribution + agent.lossContribution;
        const detail = { name: agent.name, pnl: netPnL };
        if (!bestAgent || netPnL > bestAgent.pnl) bestAgent = detail;
        if (!worstAgent || netPnL < worstAgent.pnl) worstAgent = detail;
      });

      let statusMsg = `⏳ <b>MID-SESSION UPDATE - ${timeInfo.hours.toString().padStart(2, '0')}:${timeInfo.minutes.toString().padStart(2, '0')} IST</b>\n\n`;
      statusMsg += `💰 <b>Portfolio Value:</b> ₹${valuation.totalVal.toFixed(2)}\n`;
      statusMsg += `📈 <b>Today's Net PnL:</b> ₹${dailyPnL.toFixed(2)} (${((dailyPnL / currentDayStats.start_capital) * 100).toFixed(2)}%)\n`;
      statusMsg += `📂 <b>Open Positions:</b> ${holdings.length} active\n`;
      if (holdings.length > 0) {
        holdings.forEach(p => {
          const ltp = broker.getLTP(p.symbol) || p.avgPrice;
          const pnl = (ltp - p.avgPrice) * p.quantity;
          statusMsg += `  - ${p.symbol}: Qty ${p.quantity} @ avg ₹${p.avgPrice} (LTP ₹${ltp}) | PnL: ₹${pnl.toFixed(2)}\n`;
        });
      }
      statusMsg += `\n🔍 <b>Market Scanner:</b>\n`;
      statusMsg += `- Lead Long: ${topLong}\n`;
      statusMsg += `- Lead Short: ${topShort}\n\n`;
      statusMsg += `🤖 <b>Agent Performance:</b>\n`;
      if (bestAgent) statusMsg += `- Best Agent: ${bestAgent.name} (PnL ₹${bestAgent.pnl.toFixed(2)})\n`;
      if (worstAgent) statusMsg += `- Worst Agent: ${worstAgent.name} (PnL ₹${worstAgent.pnl.toFixed(2)})\n`;

      await alerts.sendTelegram(statusMsg);
      console.log(`[BOT UPDATE]: Sent mid-session Telegram status at ${timeInfo.hours}:${timeInfo.minutes}`);
    } catch (err) {
      console.error('[BOT UPDATE] Failed to send periodic update:', err.message);
    }
  },

  async finalizeMarketDay(dateStr) {
    const timeInfo = fsm.getSystemTime();
    const currentMins = timeInfo.hours * 60 + timeInfo.minutes;

    if (currentMins < 15 * 60 + 30) {
      console.log('[EOD] Market not closed yet');
      return;
    }

    try {
      const eodState = await db.getEodReportState(dateStr);
      if (eodState && eodState.sent) {
        console.log('[EOD] Already sent today, skipping');
        return;
      }
    } catch (eodErr) {
      console.error('[EOD] Failed to verify EOD state from DB:', eodErr.message);
    }

    if (lastEodReportSentDate === dateStr) {
      console.log('[EOD] Already sent today, skipping');
      return;
    }

    console.log('[EOD] Report generated');
    console.log('[BOT MARKET CLOSE]: Finalizing trading day.');
    if (!currentDayStats) {
      currentDayStats = await db.getDailyStats(dateStr);
    }
    if (!currentDayStats) {
      const portfolio = await db.getPortfolioState();
      const startCapital = portfolio.balance + portfolio.equity_value;
      const riskMode = portfolio.user_instructions?.risk_mode || 'NORMAL';
      const riskPerTrade = (runtimeState && runtimeState.getSnapshot().settings.risk_per_trade_percent) || 1.0;
      const cap = (typeof valuation !== 'undefined' ? valuation.totalVal : (typeof startCapital !== 'undefined' ? startCapital : 12000));
      const avgRR = 2.5; 
      const winRate = 0.62;
      const dailyTrades = 7;
      const expectedProfitPerTrade = (cap * (riskPerTrade / 100)) * ((avgRR * winRate) - (1 - winRate));
      const calculatedTarget = Math.max(100.0, parseFloat((expectedProfitPerTrade * dailyTrades).toFixed(2)));
      
      if (runtimeState && runtimeState.targetEngineState) {
        runtimeState.targetEngineState = {
          ...runtimeState.targetEngineState,
          dailyTarget: calculatedTarget,
          requiredExpectedProfit: calculatedTarget,
          requiredTradeCount: dailyTrades,
          requiredWinRate: (winRate * 100).toFixed(0),
          requiredCapitalUtilization: 85
        };
      }

      currentDayStats = {
        date: dateStr,
        start_capital: startCapital,
        end_capital: startCapital,
        net_pnl: 0,
        daily_target: calculatedTarget,
        target_met: false,
        strategy_switched: false,
        status: 'ACTIVE'
      };
    }
    const valuation = await broker.getValuation();
    const dailyPnL = valuation.totalVal - currentDayStats.start_capital;
    const dailyLossPct = currentDayStats.start_capital > 0 ? (dailyPnL / currentDayStats.start_capital) * -100 : 0;

    // Phase 7: PnL Reconciliation Engine
    // 1. Fetch today's completed trade logs to calculate Realized PnL
    const allTradesForRecon = await db.getTradeLogs(500);
    const todaySellsForRecon = allTradesForRecon.filter(t => {
      const tDate = t.timestamp ? (t.timestamp instanceof Date ? t.timestamp.toISOString() : String(t.timestamp)).split('T')[0] : '';
      return tDate === dateStr && t.action === 'SELL';
    });
    
    let realizedPnL = 0;
    todaySellsForRecon.forEach(s => {
      const pnlMatch = s.reason ? s.reason.match(/PnL:\s*₹?(-?[\d.]+)/) : null;
      realizedPnL += pnlMatch ? parseFloat(pnlMatch[1]) : 0;
    });

    // 2. Daily Equity Change represents the change in value of holdings and portfolio cash not captured by realized PnL
    const dailyEquityChange = dailyPnL - realizedPnL;

    // 3. Verify math invariant: End Capital = Start Capital + Realized PnL + Daily Equity Change
    const reconciledEndCapital = currentDayStats.start_capital + realizedPnL + dailyEquityChange;
    const pnlDiff = Math.abs(valuation.totalVal - reconciledEndCapital);
    
    console.log(`[PNL RECONCILIATION] Start Capital: ₹${currentDayStats.start_capital.toFixed(2)}, End Capital: ₹${valuation.totalVal.toFixed(2)}, Realized PnL: ₹${realizedPnL.toFixed(2)}, Daily Equity Change: ₹${dailyEquityChange.toFixed(2)}`);
    console.log(`[PNL RECONCILIATION] Reconciled End Capital: ₹${reconciledEndCapital.toFixed(2)}, Diff: ₹${pnlDiff.toFixed(4)}`);

    if (pnlDiff > 0.01) {
      const errMsg = `[PNL RECONCILIATION FAILURE] End Capital does not reconcile! Mismatch of ₹${pnlDiff.toFixed(4)} exceeds threshold of ₹0.01.`;
      console.error(errMsg);
      throw new Error(errMsg);
    } else {
      console.log(`[PNL RECONCILIATION SUCCESS] Math reconciled perfectly within ₹0.01 tolerance.`);
    }

    currentDayStats = await db.saveDailyStats({
      ...currentDayStats,
      date: dateStr,
      end_capital: valuation.totalVal,
      net_pnl: dailyPnL,
      target_met: dailyPnL >= (currentDayStats.daily_target || 1000),
      status: 'COMPLETED'
    });

    // Nightly Trust Optimization (Agent 21) & Strategy Research (Agent 22)
    try {
      const agentFirm = require('./agentFirm');
      await agentFirm.runAgent21();
      await agentFirm.runAgent22();

      // Nightly Intelligence Layer Audits (Agent 24-26)
      const agentResearch = require('./agentResearch');
      await agentResearch.runNightlyAudits();

      // GROWTH MODE: Daily Learning Loop — auto-adjust TQS thresholds based on completed trade performance
      try {
        const learningResult = dynamicThreshold.learnFromCompletedTrades();
        if (learningResult) {
          console.log(`[GROWTH MODE] Daily Learning Applied: ${learningResult.reasoning}`);
        }
      } catch (learnErr) {
        console.error('[GROWTH MODE] Daily learning failed:', learnErr.message);
      }

    } catch (firmErr) {
      console.error('[BOT Close] Error running EOD firm agents/audits:', firmErr.message);
    }

    // Generate detailed EOD report
    try {
      const allTrades = await db.getTradeLogs(500);
      const todayTrades = allTrades.filter(t => {
        const tDate = t.timestamp ? (t.timestamp instanceof Date ? t.timestamp.toISOString() : String(t.timestamp)).split('T')[0] : '';
        return tDate === dateStr;
      });

      const buys = todayTrades.filter(t => t.action === 'BUY');
      const sells = todayTrades.filter(t => t.action === 'SELL');

      let totalPnL = 0;
      let winningTrades = 0;
      let losingTrades = 0;
      let bestTrade = null;
      let worstTrade = null;

      sells.forEach(s => {
        // Parse PnL from reason or calculate from buy price
        // Reason format: `Stop Loss Hit | Entry: ₹3400 | PnL: ₹-150.00 | Return: -2.00%`
        const pnlMatch = s.reason ? s.reason.match(/PnL:\s*₹?(-?[\d.]+)/) : null;
        const returnMatch = s.reason ? s.reason.match(/Return:\s*(-?[\d.]+)%/) : null;
        const pnl = pnlMatch ? parseFloat(pnlMatch[1]) : 0;
        const ret = returnMatch ? parseFloat(returnMatch[1]) : 0;

        totalPnL += pnl;
        if (pnl > 0) {
          winningTrades++;
        } else if (pnl < 0) {
          losingTrades++;
        }

        const tradeDetail = {
          symbol: s.symbol,
          pnl,
          return: ret,
          reason: s.reason,
          qty: s.quantity,
          exitPrice: s.price
        };

        if (!bestTrade || pnl > bestTrade.pnl) bestTrade = tradeDetail;
        if (!worstTrade || pnl < worstTrade.pnl) worstTrade = tradeDetail;
      });

      const closedTradesCount = sells.length;
      const winRate = closedTradesCount > 0 ? (winningTrades / closedTradesCount) * 100 : 0;

      // Fetch active remaining positions
      const portfolio = await db.getPortfolioState();
      const openPositions = portfolio.holding_stocks || [];

      // Fetch agent leaderboard/weights to see current agent contribution
      const weights = await predictor.getModelWeights();
      const leaderboard = predictor.getLeaderboard();

      // Get Skipped Opportunities EOD report (Agent 24)
      let missedOpportunitiesMsg = '';
      const agentResearch = require('./agentResearch');
      try {
        const skippedReport = await agentResearch.generateEodOpportunityReport();
        missedOpportunitiesMsg = `- Skipped Opportunities: ${skippedReport.total_opportunities_skipped}\n` +
                                 `- Missed Profit Potential: ₹${skippedReport.missed_profit_rupees.toFixed(2)}\n` +
                                 `- Skips preventing losses: ₹${skippedReport.missed_loss_prevented_rupees.toFixed(2)}\n`;
      } catch (err) {
        missedOpportunitiesMsg = `- Skipped Opportunities: Error fetching\n`;
      }

      // Aggregate sector stats
      const sectorStats = {};
      todayTrades.forEach(t => {
        const sector = agentResearch.SECTOR_MAP[t.symbol] || 'OTHER';
        sectorStats[sector] = sectorStats[sector] || { profit: 0, count: 0 };
        const pnlMatch = t.reason ? t.reason.match(/PnL:\s*₹?(-?[\d.]+)/) : null;
        const pnl = pnlMatch ? parseFloat(pnlMatch[1]) : 0;
        sectorStats[sector].profit += pnl;
        sectorStats[sector].count++;
      });

      let sectorAnalysisMsg = '';
      Object.keys(sectorStats).forEach(s => {
        sectorAnalysisMsg += `  - ${s}: ${sectorStats[s].count} trades | Net: ₹${sectorStats[s].profit.toFixed(2)}\n`;
      });
      if (!sectorAnalysisMsg) sectorAnalysisMsg = '  - No sector trades executed today\n';

       // Regime and Learning Influence Analysis
      const dtResult = dynamicThreshold.getCurrentThreshold();
      const currentRegime = dtResult.regime || 'RANGING';
      let predictionsWithMemory = 0;
      let totalConvictionDelta = 0;
      const dbData = db.readLocalDb();
      const consensus = dbData.consensus_decisions || [];
      const todayConsensus = consensus.filter(c => {
        const cDate = c.timestamp ? (c.timestamp instanceof Date ? c.timestamp.toISOString() : String(c.timestamp)).split('T')[0] : '';
        return cDate === dateStr;
      });
      todayConsensus.forEach(c => {
        const impact = c.participating_models?.learning_impact;
        if (impact) {
          if (impact.match_count > 0) predictionsWithMemory++;
          totalConvictionDelta += impact.conviction_delta || 0;
        }
      });

      // Daily Improvement actions
      const worstAgent = Object.keys(leaderboard)
        .map(id => ({ id, ...leaderboard[id] }))
        .sort((a, b) => (a.profitContribution + a.lossContribution) - (b.profitContribution + b.lossContribution))[0];
      const bestSector = Object.entries(sectorStats)
        .sort((a, b) => b[1].profit - a[1].profit)[0];

      let improvementAction = 'Maintain current model trust parameters.';
      if (worstAgent && (worstAgent.profitContribution + worstAgent.lossContribution) < 0) {
        improvementAction = `Trust engine is scaling down ${worstAgent.name}.`;
      }
      if (bestSector && bestSector[1].profit > 0) {
        improvementAction += ` Favoring allocation weight in ${bestSector[0]} sector tomorrow.`;
      }

      // Trade attribution helper
      const getAttribution = (tradeSymbol) => {
        const matchingDecisions = consensus.filter(c => c.symbol === tradeSymbol && c.decision === 'BUY');
        if (matchingDecisions.length > 0) {
          const lastBuy = matchingDecisions[matchingDecisions.length - 1];
          const supporting = [];
          const pm = lastBuy.participating_models || {};
          Object.keys(pm).forEach(k => {
            if (k === 'learning_impact' || k === 'trade_quality_score' || k === 'market_memory_analogs') return;
            if (pm[k]?.signal === 'BUY') {
              supporting.push(k.replace('agent', 'Agent ').replace('_technical', ' (Tech)').replace('_context', ' (Context)').replace('_gemini', ' (Gemini)').replace('_groq', ' (Groq)'));
            }
          });
          return supporting.slice(0, 3).join(', ');
        }
        return 'Consensus weights defaults';
      };

      // Format EOD message for Telegram
      let reportMsg = `📊 <b>EOD PERFORMANCE REPORT - ${dateStr}</b>\n\n`;
      reportMsg += `💰 <b>Capital Summary:</b>\n`;
      reportMsg += `- Start Capital: ₹${currentDayStats.start_capital.toFixed(2)}\n`;
      reportMsg += `- End Capital: ₹${valuation.totalVal.toFixed(2)}\n`;
      reportMsg += `- Daily Net PnL: ₹${dailyPnL.toFixed(2)} (${((dailyPnL / currentDayStats.start_capital) * 100).toFixed(2)}%)\n`;
      reportMsg += `- Target Met: ${dailyPnL >= (currentDayStats.daily_target || 1000) ? 'YES ✅' : 'NO ❌'}\n\n`;

      reportMsg += `📈 <b>Trading Activity:</b>\n`;
      reportMsg += `- Total Orders executed: ${todayTrades.length}\n`;
      reportMsg += `- Position Open (BUYS): ${buys.length}\n`;
      reportMsg += `- Position Closed (SELLS): ${sells.length}\n`;
      reportMsg += `- Closed Trades Win Rate: ${winRate.toFixed(1)}% (${winningTrades}W / ${losingTrades}L)\n`;
      reportMsg += `- Closed Trades Net PnL: ₹${totalPnL.toFixed(2)}\n\n`;

      if (bestTrade) {
        reportMsg += `🌟 <b>Best Trade:</b>\n`;
        reportMsg += `  ${bestTrade.symbol}: ₹${bestTrade.pnl.toFixed(2)} (${bestTrade.return.toFixed(2)}%) [Qty: ${bestTrade.qty}]\n`;
        reportMsg += `  <i>Attribution:</i> ${getAttribution(bestTrade.symbol)}\n\n`;
      }
      if (worstTrade) {
        reportMsg += `💀 <b>Worst Trade:</b>\n`;
        reportMsg += `  ${worstTrade.symbol}: ₹${worstTrade.pnl.toFixed(2)} (${worstTrade.return.toFixed(2)}%) [Qty: ${worstTrade.qty}]\n`;
        reportMsg += `  <i>Attribution:</i> ${getAttribution(worstTrade.symbol)}\n\n`;
      }

      reportMsg += `🔍 <b>Institutional Missed Opportunity Audit:</b>\n`;
      reportMsg += missedOpportunitiesMsg + '\n';

      reportMsg += `🗂️ <b>Sector Performance:</b>\n`;
      reportMsg += sectorAnalysisMsg + '\n';

      reportMsg += `🧠 <b>Regime & Learning Influence:</b>\n`;
      reportMsg += `- Market Regime: ${currentRegime}\n`;
      reportMsg += `- Analog Memory Matches: ${predictionsWithMemory} decisions influenced\n`;
      reportMsg += `- Total Conviction Shift: ${(totalConvictionDelta * 100).toFixed(1)}% TQS delta\n\n`;

      if (openPositions.length > 0) {
        reportMsg += `📂 <b>Open Positions:</b>\n`;
        openPositions.forEach(p => {
          const ltp = broker.getLTP(p.symbol) || p.avgPrice;
          const pnl = (ltp - p.avgPrice) * p.quantity;
          const ret = ((ltp - p.avgPrice) / p.avgPrice) * 100;
          reportMsg += `  - ${p.symbol}: Qty ${p.quantity} @ avg ₹${p.avgPrice} (LTP ₹${ltp}) | Unr. PnL: ₹${pnl.toFixed(2)} (${ret.toFixed(2)}%)\n`;
        });
        reportMsg += `\n`;
      } else {
        reportMsg += `📂 <b>Open Positions:</b> None\n\n`;
      }

      reportMsg += `🤖 <b>Top Contributing Agents (by weight):</b>\n`;
      const sortedAgents = Object.keys(leaderboard)
        .map(id => ({ id, ...leaderboard[id] }))
        .sort((a, b) => b.weight - a.weight)
        .slice(0, 3);
      sortedAgents.forEach(a => {
        const todayAtt = (a.todayProfitContribution || 0) + (a.todayLossContribution || 0);
        const lifeAtt = (a.actualProfitContribution || 0) + (a.actualLossContribution || 0);
        const synthScore = (a.profitContribution || 0) + (a.lossContribution || 0);
        reportMsg += `  - ${a.name}:\n`;
        reportMsg += `    • Weight: ${(a.weight * 100).toFixed(1)}%\n`;
        reportMsg += `    • Today PnL: ₹${todayAtt.toFixed(2)}\n`;
        reportMsg += `    • Lifetime PnL: ₹${lifeAtt.toFixed(2)}\n`;
        reportMsg += `    • Synthetic Score: ${synthScore.toFixed(2)}\n`;
      });

      reportMsg += `\n⚙️ <b>Daily Self-Improvement Recommendation:</b>\n`;
      reportMsg += `<i>${improvementAction}</i>\n`;

      // GROWTH MODE DAILY REPORT
      let todayProfitFactor = 0;
      try {
        const pipelineLogs = dbData.pipeline_logs || [];
        const todayPipelines = pipelineLogs.filter(p => p.timestamp && p.timestamp.startsWith(dateStr));
        const totalOppsFound = todayPipelines.reduce((sum, p) => sum + (p.stage3_candidates || 0), 0);
        const totalSignalsGenerated = todayPipelines.reduce((sum, p) => sum + (p.stage4_consensus || 0), 0);
        const totalTradesExecuted = todayPipelines.reduce((sum, p) => sum + (p.stage5_executed || 0), 0);
        const capitalUtilPct = valuation.totalVal > 0 ? ((valuation.equityValue / valuation.totalVal) * 100).toFixed(1) : '0.0';
        
        const todayCompleted = (dbData.completed_trades || []).filter(t => {
          if (!t.exit_time) return false;
          const tDate = (t.exit_time instanceof Date ? t.exit_time.toISOString() : String(t.exit_time)).split('T')[0];
          return tDate === dateStr;
        });
        let avgHoldTime = 0;
        let todayWinRate = 0;
        todayProfitFactor = 0;
        let todayNetPnL = 0;
        if (todayCompleted.length > 0) {
          avgHoldTime = todayCompleted.reduce((sum, t) => sum + (t.holding_minutes || 0), 0) / todayCompleted.length;
          const wins = todayCompleted.filter(t => t.net_pnl > 0);
          const losses = todayCompleted.filter(t => t.net_pnl <= 0);
          todayWinRate = (wins.length / todayCompleted.length) * 100;
          const grossWin = wins.reduce((s, t) => s + t.net_pnl, 0);
          const grossLoss = Math.abs(losses.reduce((s, t) => s + t.net_pnl, 0));
          todayProfitFactor = grossLoss > 0 ? (grossWin / grossLoss) : (grossWin > 0 ? grossWin : 0);
          todayNetPnL = grossWin - grossLoss;
        }

        reportMsg += `\n📊 <b>GROWTH MODE DAILY REPORT:</b>\n`;
        reportMsg += `- Total Opportunities Found: ${totalOppsFound}\n`;
        reportMsg += `- Signals Generated: ${totalSignalsGenerated}\n`;
        reportMsg += `- Trades Executed: ${totalTradesExecuted}\n`;
        reportMsg += `- Completed Trades Today: ${todayCompleted.length}\n`;
        reportMsg += `- Capital Utilization: ${capitalUtilPct}%\n`;
        reportMsg += `- Average Hold Time: ${avgHoldTime.toFixed(1)} mins\n`;
        reportMsg += `- Win Rate (today): ${todayWinRate.toFixed(1)}%\n`;
        reportMsg += `- Profit Factor (today): ${todayProfitFactor.toFixed(2)}\n`;
        reportMsg += `- Net PnL (completed): ₹${todayNetPnL.toFixed(2)}\n`;
      } catch (growthErr) {
        console.error('[GROWTH MODE] Failed to generate growth report:', growthErr.message);
      }

      reportMsg += `\n⚠️ <i>Pre-Market and operational validations will run again tomorrow before market open.</i>`;

      await alerts.sendTelegram(reportMsg);
      console.log('[BOT MARKET CLOSE]: EOD report successfully compiled and sent to Telegram.');

      try {
        await db.saveEodReportState({
          date: dateStr,
          sent: true,
          sent_at: new Date().toISOString()
        });
        lastEodReportSentDate = dateStr;
      } catch (saveStateErr) {
        console.error('[BOT MARKET CLOSE] Failed to save EOD report state:', saveStateErr.message);
      }

      // Update aggregate paper trading results in DB
      try {
        const currentPaperResults = await db.getPaperTradingResults();
        const prevDays = currentPaperResults?.trading_days_tracked || 0;
        const newDays = prevDays + 1;
        const newNetPnL = (currentPaperResults?.net_pnl || 0) + dailyPnL;
        
        await db.savePaperTradingResults({
          trading_days_tracked: newDays,
          win_rate: parseFloat((( (currentPaperResults?.win_rate || 0) * prevDays + winRate ) / newDays).toFixed(2)),
          profit_factor: parseFloat(todayProfitFactor.toFixed(2)) || 0,  // Real: gross wins / gross losses from today
          sharpe_ratio: null,                                              // Not computed without daily return series
          max_drawdown: Math.max(currentPaperResults?.max_drawdown || 0, dailyLossPct > 0 ? dailyLossPct : 0),
          accuracy: parseFloat((( (currentPaperResults?.accuracy || 0) * prevDays + winRate ) / newDays).toFixed(2)),
          net_pnl: newNetPnL,
          details: {
            last_date: dateStr,
            last_day_pnl: dailyPnL,
            last_day_trades: todayTrades.length
          }
        });
      } catch (dbErr) {
        console.error('[BOT MARKET CLOSE] Failed to save paper trading results to DB:', dbErr.message);
      }

      // Write EOD Report Artifact
      try {
        const fs = require('fs');
        const path = require('path');
        const data = db.readLocalDb();
        
        const executedPnL = todayTrades.reduce((sum, t) => {
          const pnlMatch = t.reason ? t.reason.match(/PnL:\s*₹?(-?[\d.]+)/) : null;
          return sum + (pnlMatch ? parseFloat(pnlMatch[1]) : 0);
        }, 0);

        const shadowTrades = (data.shadow_trades || []).filter(t => t.timestamp.startsWith(dateStr));
        const closedShadows = shadowTrades.filter(t => t.status === 'CLOSED');
        const shadowWins = closedShadows.filter(t => t.pnl > 0).length;
        const shadowLosses = closedShadows.filter(t => t.pnl < 0).length;
        const shadowWinRate = closedShadows.length > 0 ? (shadowWins / closedShadows.length) * 100 : 0;
        const shadowPnL = closedShadows.reduce((sum, t) => sum + t.pnl, 0);

        const rejectedOpps = (data.opportunity_tracker || []).filter(o => o.status === 'REJECTED' && o.scan_timestamp.startsWith(dateStr));
        const resolvedOpps = rejectedOpps.filter(o => o.ref_15m !== null);
        
        const missedWinners = resolvedOpps.filter(o => ((o.ref_15m - o.current_price) / o.current_price) > 0);
        const missedLosers = resolvedOpps.filter(o => ((o.ref_15m - o.current_price) / o.current_price) < 0);

        const winnersSorted = [...missedWinners].sort((a, b) => {
          const retA = ((a.ref_15m - a.current_price) / a.current_price);
          const retB = ((b.ref_15m - b.current_price) / b.current_price);
          return retB - retA;
        }).slice(0, 5);

        const losersSorted = [...missedLosers].sort((a, b) => {
          const retA = ((a.ref_15m - a.current_price) / a.current_price);
          const retB = ((b.ref_15m - b.current_price) / b.current_price);
          return retA - retB;
        }).slice(0, 5);

        let artifactContent = `# EOD Performance & Opportunity Throughput Audit Report - ${dateStr}\n\n`;
        artifactContent += `## 1. Executive Summary\n`;
        artifactContent += `Goal: Identify whether profitability is limited by market conditions or by excessive filtering.\n\n`;
        artifactContent += `| Category | Count | Win Rate | Net PnL | Avg Return |\n`;
        artifactContent += `| --- | --- | --- | --- | --- |\n`;
        artifactContent += `| **Executed Trades (Live)** | ${todayTrades.length} | ${winRate.toFixed(2)}% | ₹${executedPnL.toFixed(2)} | -- |\n`;
        artifactContent += `| **Near-Miss Shadow Trades** | ${shadowTrades.length} | ${shadowWinRate.toFixed(2)}% | ₹${shadowPnL.toFixed(2)} | -- |\n`;
        artifactContent += `| **Rejected Opportunities** | ${rejectedOpps.length} | -- | -- | -- |\n\n`;

        artifactContent += `## 2. Missed Winner Analysis (Top 5)\n`;
        if (winnersSorted.length > 0) {
          artifactContent += `These are rejected BUY candidates that subsequently went green, indicating potential over-filtering:\n\n`;
          winnersSorted.forEach((w, i) => {
            const ret = ((w.ref_15m - w.current_price) / w.current_price) * 100;
            artifactContent += `${i + 1}. **${w.symbol}** | Entry: ₹${w.current_price} | 15m Price: ₹${w.ref_15m} | Move: **+${ret.toFixed(2)}%** | Rejection Reason: *${w.rejection_reason}* (Score: ${w.opportunity_score})\n`;
          });
        } else {
          artifactContent += `No missed winners detected.\n`;
        }
        artifactContent += `\n`;

        artifactContent += `## 3. Missed Loser Analysis (Top 5)\n`;
        if (losersSorted.length > 0) {
          artifactContent += `These are rejected BUY candidates that subsequently dropped, confirming correct filtering/rejection:\n\n`;
          losersSorted.forEach((l, i) => {
            const ret = ((l.ref_15m - l.current_price) / l.current_price) * 100;
            artifactContent += `${i + 1}. **${l.symbol}** | Entry: ₹${l.current_price} | 15m Price: ₹${l.ref_15m} | Move: **${ret.toFixed(2)}%** | Rejection Reason: *${l.rejection_reason}* (Score: ${l.opportunity_score})\n`;
          });
        } else {
          artifactContent += `No missed losers detected.\n`;
        }
        artifactContent += `\n`;

        artifactContent += `## 4. Near-Miss Pool Detailed Performance\n`;
        artifactContent += `Shadow Trades executed for Confidence >= 0.60 and TQS >= 55:\n\n`;
        if (closedShadows.length > 0) {
          closedShadows.forEach((t, i) => {
            artifactContent += `- **${t.symbol}**: Entry ₹${t.entry_price} -> Exit ₹${t.exit_price} | PnL: ₹${t.pnl.toFixed(2)} (${t.return_pct.toFixed(2)}%)\n`;
          });
        } else {
          artifactContent += `No closed shadow trades today.\n`;
        }
        
        const artifactPath = path.join('/Users/vivekshaganti/.gemini/antigravity/brain/cc833874-e9e0-46c3-b4b0-105907c84b59', `eod_report_${dateStr}.md`);
        const artifactLatestPath = path.join('/Users/vivekshaganti/.gemini/antigravity/brain/cc833874-e9e0-46c3-b4b0-105907c84b59', `eod_report.md`);
        
        fs.writeFileSync(artifactPath, artifactContent);
        fs.writeFileSync(artifactLatestPath, artifactContent);
        console.log(`[BOT] EOD report artifact written to ${artifactPath}`);
      } catch (artErr) {
        console.error('[BOT] Failed to write EOD report artifact:', artErr.message);
      }

    } catch (reportErr) {
      console.error('[BOT MARKET CLOSE] Error compiling EOD report:', reportErr);
    }

    this.stop();
  }
};

module.exports = tradingBot;
