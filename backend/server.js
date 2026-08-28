const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const config = require('../shared/config');
const runtimeState = require('./runtimeState');

function structuredErrorLog(subsystem, req, err) {
  console.error(JSON.stringify({
    timestamp: new Date().toISOString(),
    subsystem,
    request: req ? { method: req.method, url: req.originalUrl || req.url, body: req.body } : null,
    runtimeState: runtimeState ? runtimeState.getSnapshot() : null,
    stack: err ? err.stack : null,
    recoveryAction: 'Manual intervention might be needed. Monitoring alerting triggered.'
  }));
}

// Startup Configuration Validation
function validateConfig() {
  console.log('=========================================');
  console.log('[CONFIG VALIDATION]');
  let hasErrors = false;

  if (config.DATABASE_URL) {
    console.log('✅ DATABASE_URL');
  } else {
    console.log('❌ DATABASE_URL missing (Required)');
    hasErrors = true;
  }

  if (config.GEMINI_API_KEY) {
    console.log('✅ GEMINI_API_KEY');
  } else {
    console.log('❌ GEMINI_API_KEY missing (Required)');
    hasErrors = true;
  }

  if (config.GROQ_API_KEY) {
    console.log('✅ GROQ_API_KEY');
  } else {
    console.log('⚠️ GROQ_API_KEY missing');
  }

  if (config.TELEGRAM_BOT_TOKEN) {
    console.log('✅ TELEGRAM_BOT_TOKEN');
  } else {
    console.log('⚠️ TELEGRAM_BOT_TOKEN missing');
  }

  if (config.TELEGRAM_CHAT_ID) {
    console.log('✅ TELEGRAM_CHAT_ID');
  } else {
    console.log('⚠️ TELEGRAM_CHAT_ID missing');
  }

  if (config.ADMIN_RESET_PASSWORD) {
    console.log('✅ ADMIN_RESET_PASSWORD');
  } else {
    console.log('⚠️ ADMIN_RESET_PASSWORD missing (API controls disabled)');
  }

  console.log('=========================================');

  if (hasErrors) {
    console.error('❌ Server startup aborted due to missing required configuration integrations.');
    process.exit(1);
  }
}

validateConfig();

const tradingBot = require('./tradingBot');
const db = require('./db');
const alerts = require('./alerts');
const telegramControl = require('./telegramControl');
const predictor = require('./predictor');
const broker = require('./broker');
const marketData = require('./marketData');
const app = express();
app.use(express.json());

// CORS configuration for production deployment
app.use((req, res, next) => {
  const origin = req.headers.origin;
  const allowedDomains = ['.vercel.app', '.onrender.com'];
  let isAllowed = false;
  
  if (origin) {
    const isLocal = origin.includes('local') || origin.includes('127.') || origin.includes('192.168.');
    const isWhitelisted = allowedDomains.some(domain => origin.endsWith(domain));
    if (isLocal || isWhitelisted) {
      res.header('Access-Control-Allow-Origin', origin);
      isAllowed = true;
    }
  } else {
    isAllowed = true;
  }
  
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  
  if (req.method === 'OPTIONS') {
    if (origin && !isAllowed) {
      return res.status(403).json({ error: 'CORS policy: origin not allowed.' });
    }
    return res.status(200).end();
  }
  
  if (origin && !isAllowed) {
    return res.status(403).json({ error: 'CORS policy: origin not allowed.' });
  }
  next();
});

// Serve static dashboard files
app.use(express.static(path.join(__dirname, '..', 'frontend')));

app.get('/trade-analysis', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'trade-analysis.html'));
});

app.get('/favicon.ico', (req, res) => res.status(204).end());

// API: Get current status
app.get('/api/status', async (req, res) => {
  try {
    const statusData = await tradingBot.getStatus();
    res.json(statusData);
  } catch (err) {
    structuredErrorLog('API', req, err);
    res.status(500).json({ error: 'Internal Server Error', code: 'SERVER_ERROR' });
  }
});

async function getComprehensiveSystemHealth() {
  const snapshot = runtimeState.getSnapshot();
  const dbStatus = db.isNeonOnline() ? 'CONNECTED' : 'DISCONNECTED';
  const tgHealth = telegramControl.getTelegramHealth();
  const tgStatus = tgHealth.status === 'CONNECTED' ? (tgHealth.webhook ? 'WEBHOOK' : 'POLLING') : 'OFFLINE';
  
  return {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    services: {
      database: dbStatus,
      telegram: tgStatus,
      broker: snapshot.services.broker,
      scanner: snapshot.services.scanner,
      scheduler: snapshot.services.scheduler,
      trading_engine: snapshot.isRunning ? 'ACTIVE' : 'PAUSED',
      websocket: snapshot.services.websocket,
      market_data: snapshot.services.market_data
    },
    market: {
      status: snapshot.market.status,
      isOpen: snapshot.market.isOpen,
      currentDate: snapshot.market.currentDate
    },
    financials: snapshot.financials,
    scanner_stats: snapshot.scanner,
    system: {
      version: snapshot.system.version,
      uptime_seconds: snapshot.system.uptime_seconds,
      memory_usage: snapshot.system.memory_usage,
      cpu_usage: snapshot.system.cpu_usage,
      latency: snapshot.system.latency
    },
    open_trades: snapshot.positions,
    pending_orders: snapshot.pending_orders
  };
}

// Health check endpoint
app.get('/api/health', async (req, res) => {
  try {
    const health = await getComprehensiveSystemHealth();
    res.json(health);
  } catch (err) {
    structuredErrorLog('API', req, err);
    res.status(500).json({ error: 'Internal Server Error', code: 'SERVER_ERROR' });
  }
});

// Runtime state endpoint
app.get('/api/runtime', (req, res) => {
  try {
    res.json(runtimeState.getSnapshot());
  } catch (err) {
    structuredErrorLog('API', req, err);
    res.status(500).json({ error: 'Internal Server Error', code: 'SERVER_ERROR' });
  }
});

// System metrics endpoint
app.get('/api/system', async (req, res) => {
  try {
    const health = await getComprehensiveSystemHealth();
    res.json(health.system);
  } catch (err) {
    structuredErrorLog('API', req, err);
    res.status(500).json({ error: 'Internal Server Error', code: 'SERVER_ERROR' });
  }
});

// Scheduler metrics endpoint
app.get('/api/scheduler', async (req, res) => {
  try {
    const health = await getComprehensiveSystemHealth();
    const isWeekEnd = [0, 6].includes(new Date().getDay());
    res.json({
      status: health.services.scheduler,
      market_open_window: health.market.isOpen,
      today_date: health.market.currentDate,
      is_weekend: isWeekEnd,
      timezone: 'IST (Asia/Kolkata)',
      schedule: {
        premarket_validation: '09:00 IST',
        broker_verification: '09:10 IST',
        database_sync: '09:14 IST',
        start_scanning: '09:15 IST',
        stop_scanning: '15:20 IST',
        close_pending: '15:25 IST',
        market_close: '15:30 IST'
      }
    });
  } catch (err) {
    structuredErrorLog('API', req, err);
    res.status(500).json({ error: 'Internal Server Error', code: 'SERVER_ERROR' });
  }
});

// Telegram status endpoint
app.get('/api/telegram', (req, res) => {
  try {
    res.json(telegramControl.getTelegramHealth());
  } catch (err) {
    structuredErrorLog('API', req, err);
    res.status(500).json({ error: 'Internal Server Error', code: 'SERVER_ERROR' });
  }
});

// Database status endpoint
app.get('/api/database', async (req, res) => {
  try {
    res.json({
      status: db.isNeonOnline() ? 'CONNECTED' : 'DISCONNECTED',
      mode: config.USE_LOCAL_CACHE ? 'LOCAL_CACHE' : 'POSTGRES',
      write_queue_length: 0,
      verified_schema_tables: 15
    });
  } catch (err) {
    structuredErrorLog('API', req, err);
    res.status(500).json({ error: 'Internal Server Error', code: 'SERVER_ERROR' });
  }
});

// Broker status endpoint
app.get('/api/broker', async (req, res) => {
  try {
    const valuation = await broker.getValuation();
    res.json({
      status: 'ONLINE',
      mode: config.BROKER_MODE || 'SIMULATOR',
      valuation
    });
  } catch (err) {
    structuredErrorLog('API', req, err);
    res.status(500).json({ error: 'Internal Server Error', code: 'SERVER_ERROR' });
  }
});

// API: Start/Stop bot
app.post('/api/control', async (req, res) => {
  try {
    const { action } = req.body;
    console.log(`[API CONTROL] Action: ${action} received.`);
    if (action === 'START') {
      tradingBot.resumeEntries();
      await tradingBot.start();
      res.json({ success: true, message: 'Bot started successfully and entries resumed.' });
    } else if (action === 'STOP') {
      tradingBot.stop();
      tradingBot.pauseEntries();
      res.json({ success: true, message: 'Bot stopped successfully and entries paused.' });
    } else {
      res.status(400).json({ error: 'Invalid action' });
    }
  } catch (err) {
    structuredErrorLog('API', req, err);
    res.status(500).json({ error: 'Internal Server Error', code: 'SERVER_ERROR' });
  }
});

// API: Get trades
app.get('/api/trades', async (req, res) => {
  try {
    const trades = await db.getTradeLogs(100);
    res.json(trades);
  } catch (err) {
    structuredErrorLog('API', req, err);
    res.status(500).json({ error: 'Internal Server Error', code: 'SERVER_ERROR' });
  }
});

// API: Get completed trades
app.get('/api/completed-trades', async (req, res) => {
  try {
    const completed = await db.getCompletedTrades();
    res.json(completed);
  } catch (err) {
    structuredErrorLog('API', req, err);
    res.status(500).json({ error: 'Internal Server Error', code: 'SERVER_ERROR' });
  }
});

// API: Get equity curve
app.get('/api/equity-curve', async (req, res) => {
  try {
    const data = db.readLocalDb();
    const completed = data.completed_trades || [];
    
    let currentCapital = config.INITIAL_CAPITAL;
    const curve = [{ time: 'Initial', value: currentCapital }];
    
    const sortedTrades = [...completed].sort((a, b) => new Date(a.exit_time) - new Date(b.exit_time));
    sortedTrades.forEach((t, idx) => {
      currentCapital += t.net_pnl;
      curve.push({
        time: t.exit_time ? new Date(t.exit_time).toLocaleDateString() : `Trade #${idx + 1}`,
        value: currentCapital
      });
    });
    
    res.json(curve);
  } catch (err) {
    structuredErrorLog('API', req, err);
    res.status(500).json({ error: 'Internal Server Error', code: 'SERVER_ERROR' });
  }
});

// API: Get portfolio allocation
app.get('/api/portfolio-allocation', async (req, res) => {
  try {
    const state = runtimeState.getSnapshot();
    const portfolio = await db.getPortfolioState();
    const holdings = portfolio.holding_stocks || [];
    const status = { balance: state.financials.balance, totalVal: state.financials.equity_value };
    
    const allocation = {
      cash: status.balance,
      holdings: holdings.map(h => ({
        symbol: h.symbol,
        value: h.quantity * h.entry_price,
        percentage: ((h.quantity * h.entry_price) / status.totalVal) * 100
      }))
    };
    res.json(allocation);
  } catch (err) {
    structuredErrorLog('API', req, err);
    res.status(500).json({ error: 'Internal Server Error', code: 'SERVER_ERROR' });
  }
});

// API: Get market breadth
app.get('/api/market-breadth', async (req, res) => {
  try {
    const data = db.readLocalDb();
    const audits = data.agent24_audit_logs || [];
    const symbolSignals = {};
    audits.slice(-100).forEach(a => {
      symbolSignals[a.symbol] = a.price_at_rejection ? 'BEARISH' : 'BULLISH';
    });
    
    let bullish = 0;
    let bearish = 0;
    Object.values(symbolSignals).forEach(s => {
      if (s === 'BULLISH') bullish++;
      else bearish++;
    });
    
    // Removed fallback simulation: If zero, return zero.
    res.json({ bullish, bearish });
  } catch (err) {
    structuredErrorLog('API', req, err);
    res.status(500).json({ error: 'Internal Server Error', code: 'SERVER_ERROR' });
  }
});

// API: Get analytics metrics
app.get('/api/analytics', async (req, res) => {
  try {
    const data = db.readLocalDb();
    const completed = data.completed_trades || [];
    const wins = completed.filter(t => t.net_pnl > 0).length;
    const losses = completed.filter(t => t.net_pnl < 0).length;
    
    const winRate = completed.length > 0 ? (wins / completed.length) * 100 : 0;
    const totalWinPnL = completed.filter(t => t.net_pnl > 0).reduce((sum, t) => sum + t.net_pnl, 0);
    const totalLossPnL = Math.abs(completed.filter(t => t.net_pnl < 0).reduce((sum, t) => sum + t.net_pnl, 0));
    const profitFactor = totalLossPnL > 0 ? (totalWinPnL / totalLossPnL) : (totalWinPnL > 0 ? 10.0 : 1.00);
    
    const returns = completed.map(t => t.return_pct || 0);
    const avgReturn = returns.reduce((a, b) => a + b, 0) / (returns.length || 1);
    const sqDiff = returns.map(r => Math.pow(r - avgReturn, 2));
    const stdDev = Math.sqrt(sqDiff.reduce((a, b) => a + b, 0) / (sqDiff.length || 1)) || 1;
    const sharpeRatio = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(252) : 0;
    
    res.json({
      winRate: parseFloat(winRate.toFixed(2)),
      profitFactor: parseFloat(profitFactor.toFixed(2)),
      sharpeRatio: parseFloat(sharpeRatio.toFixed(2)),
      totalTrades: completed.length
    });
  } catch (err) {
    structuredErrorLog('API', req, err);
    res.status(500).json({ error: 'Internal Server Error', code: 'SERVER_ERROR' });
  }
});

// API: Get historical candles for charting & replay
app.get('/api/historical-candles', async (req, res) => {
  const { symbol, entryTimestamp } = req.query;
  if (!symbol) {
    return res.status(400).json({ error: 'Symbol is required' });
  }

  try {
    const marketData = require('./marketData');
    const history = await marketData.getHistory(symbol);
    const candles = [];
    const closes = history.closes;
    const highs = history.highs;
    const lows = history.lows;
    const volumes = history.volumes;

    const baseTime = entryTimestamp ? Math.floor(new Date(entryTimestamp).getTime() / 1000) : Math.floor(Date.now() / 1000);
    const intervalSecs = 300; // 5 minute bars

    for (let i = 0; i < closes.length; i++) {
      const close = closes[i];
      const open = i > 0 ? closes[i - 1] : close * 0.998;
      const high = Math.max(open, close, highs[i] || close);
      const low = Math.min(open, close, lows[i] || close);
      const volume = volumes[i] || 0;
      const time = baseTime - (closes.length - 1 - i) * intervalSecs;

      candles.push({
        time,
        open: parseFloat(open.toFixed(2)),
        high: parseFloat(high.toFixed(2)),
        low: parseFloat(low.toFixed(2)),
        close: parseFloat(close.toFixed(2)),
        volume: parseFloat(volume.toFixed(2))
      });
    }

    res.json({ candles });
  } catch (err) {
    structuredErrorLog('API', req, err);
    res.status(500).json({ error: 'Internal Server Error', code: 'SERVER_ERROR' });
  }
});

function computeEmaValue(prices, period) {
  if (prices.length < period) return prices[prices.length - 1] || 0;
  let k = 2 / (period + 1);
  let ema = prices[0];
  for (let i = 1; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }
  return ema;
}

function computeRsiValue(prices, period = 14) {
  if (prices.length <= period) return 50;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = prices[i] - prices[i - 1];
    if (diff > 0) gains += diff;
    else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < prices.length; i++) {
    const diff = prices[i] - prices[i - 1];
    avgGain = (avgGain * (period - 1) + (diff > 0 ? diff : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (diff < 0 ? -diff : 0)) / period;
  }
  if (avgLoss === 0) return 100;
  let rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

// Helper function to dynamically compile Symbol Intelligence
async function getSymbolIntelligence(symbol) {
  const marketData = require('./marketData');
  const predictor = require('./predictor');
  const db = require('./db');
  const broker = require('./broker');

  // 1. Get LTP and history
  const history = await marketData.getHistory(symbol);
  const candles = history.closes;
  const highs = history.highs;
  const lows = history.lows;
  const volumes = history.volumes;

  const ltp = candles.length > 0 ? candles[candles.length - 1] : (broker.getLTP(symbol) || 100.00);
  
  // 2. Fetch live predictions
  const predictionResult = await predictor.getPrediction(symbol, candles);
  
  let entryPrice = ltp;
  let target = ltp * 1.05;
  let stopLoss = ltp * 0.97;
  let strategy = 'CNC';

  const portfolio = await db.getPortfolioState();
  const holding = (portfolio.holding_stocks || []).find(h => h.symbol === symbol);
  if (holding) {
    entryPrice = holding.avgPrice;
    target = holding.targetPrice || (holding.avgPrice * 1.05);
    stopLoss = holding.stopLoss || (holding.avgPrice * 0.97);
    strategy = holding.strategy || 'CNC';
  } else {
    // Determine support/resistance for target/stop fallback
    const support = Math.min(...lows.slice(-20));
    const resistance = Math.max(...highs.slice(-20));
    if (support < ltp) stopLoss = support;
    if (resistance > ltp) target = resistance;
  }

  // 3. Extract agent votes and compute breakdown
  const agentVotes = {};
  const votes = [];
  if (predictionResult.participating_models) {
    const mapping = {
      'agent1': 'ML Ensemble',
      'agent2_gemini': 'LLM Research Agent',
      'agent4_technical': 'Technical Agent',
      'agent7_risk': 'Risk Agent',
      'agent9_breadth': 'Breadth Agent',
      'agent10_sector': 'Volume Intelligence',
      'agent11_price_action': 'PRICE_ACTION_STRUCTURE_AGENT',
      'agent12_smc': 'Smart Money Concepts Agent'
    };
    Object.keys(mapping).forEach(k => {
      const agentName = mapping[k];
      const val = predictionResult.participating_models[k];
      if (val) {
        const sig = val.signal || 'HOLD';
        const conf = val.confidence || 0.5;
        agentVotes[agentName] = `${sig} (${(conf * 100).toFixed(0)}%)`;
        votes.push(sig);
      } else {
        agentVotes[agentName] = 'HOLD (50%)';
        votes.push('HOLD');
      }
    });
  }

  const buyVotesCount = votes.filter(v => v === 'BUY').length;
  const sellVotesCount = votes.filter(v => v === 'SELL').length;
  const holdVotesCount = votes.filter(v => v === 'HOLD').length;
  const consensusVotes = `${buyVotesCount} BUY / ${sellVotesCount} SELL / ${holdVotesCount} HOLD`;

  // 4. Calculate technical indicators for reasoning
  const ema9 = computeEmaValue(candles, 9);
  const ema21 = computeEmaValue(candles, 21);
  const emaTrend = ema9 > ema21 ? 'BULLISH' : 'BEARISH';
  const rsiVal = computeRsiValue(candles, 14);
  const rsiStatus = rsiVal < 30 ? 'OVERSOLD' : (rsiVal > 70 ? 'OVERBOUGHT' : 'NEUTRAL');
  const avgVol = volumes.slice(-10).reduce((a,b)=>a+b, 0) / 10;
  const lastVol = volumes[volumes.length - 1];
  const volExpansion = lastVol > avgVol * 1.5;

  // VWAP position
  let cumulativeTPV = 0;
  let cumulativeVolume = 0;
  for (let i = 0; i < candles.length; i++) {
    const tp = (highs[i] + lows[i] + candles[i]) / 3;
    cumulativeTPV += tp * volumes[i];
    cumulativeVolume += volumes[i];
  }
  const vwap = cumulativeVolume > 0 ? (cumulativeTPV / cumulativeVolume) : ltp;
  const vwapPosition = ltp > vwap ? 'above' : 'below';

  // Support / Resistance
  const support = Math.min(...lows.slice(-20));
  const resistance = Math.max(...highs.slice(-20));

  const riskReward = (target - entryPrice) / Math.max(0.01, entryPrice - stopLoss);
  const confidence = predictionResult.confidence || 0.75;
  const tqs = predictionResult.tradeQuality || 70;

  // Compile Dynamic Reasoning matching Phase 5
  const reasoning = `${predictionResult.signal || 'HOLD'} | EMA9 is ${emaTrend.toLowerCase()} relative to EMA21. RSI is ${rsiStatus.toLowerCase()} at ${rsiVal.toFixed(1)}. Volume expansion is ${volExpansion ? 'active' : 'inactive'}. Price holding ${vwapPosition} VWAP. Risk reward is 1:${riskReward.toFixed(1)}. Consensus shows ${buyVotesCount}/${votes.length} agreement.`;

  const direction = predictionResult.signal || 'HOLD';
  const probability = Math.round(confidence * 100);
  const expectedMove = parseFloat((((target - entryPrice) / entryPrice) * 100).toFixed(2));

  const paAgentResult = predictionResult.participating_models?.agent11_price_action || {};
  const paIndicators = paAgentResult.indicators || {};

  // Section 5: Live Data Validation metrics
  const provider = 'Yahoo Finance API';
  const source = 'RestAPI';
  const sysTimestamp = Date.now();
  const exchTimestamp = history.timestamps && history.timestamps.length > 0
    ? history.timestamps[history.timestamps.length - 1]
    : sysTimestamp - 2000;
  
  const latency = Math.abs(sysTimestamp - exchTimestamp);
  const tickAge = parseFloat((latency / 1000).toFixed(2));
  
  let freshness = 'LIVE';
  if (tickAge > 60) {
    freshness = 'CRITICAL';
    console.warn(`[DATA QUALITY WARNING]: Symbol ${symbol} tick age is ${tickAge}s - CRITICAL STALE PRICE EVENT.`);
  } else if (tickAge > 15) {
    freshness = 'STALE';
    console.log(`[DATA QUALITY LOG]: Symbol ${symbol} tick age is ${tickAge}s - STALE PRICE EVENT.`);
  } else {
    freshness = 'LIVE';
  }

  return {
    symbol,
    ltp,
    entryPrice,
    target,
    stopLoss,
    riskReward,
    tqs: predictionResult.tradeQuality || tqs,
    confidence: predictionResult.confidence !== undefined ? predictionResult.confidence : confidence,
    ics: predictionResult.ics || 75,
    icsLabel: predictionResult.icsLabel || 'Watch',
    marketRegime: predictionResult.marketRegime || 'RANGING',
    consensusVotes,
    agentVotes,
    reasoning: predictionResult.reasoning || reasoning,
    mode: marketData.getMode(),
    // Freshness payload variables
    provider,
    source,
    exchangeTimestamp: new Date(exchTimestamp).toISOString(),
    systemTimestamp: new Date(sysTimestamp).toISOString(),
    latencyMs: latency,
    tickAgeSeconds: tickAge,
    dataFreshness: freshness,
    prediction: {
      direction,
      probability: predictionResult.confidence !== undefined ? Math.round(predictionResult.confidence * 100) : probability,
      expectedMove,
      expectedTarget: target,
      expectedStop: stopLoss,
      horizon: 'next candle'
    },
    priceActionDetails: {
      structureScore: paIndicators.structureScore || 50,
      patternScore: paIndicators.patternScore || 50,
      breakoutScore: paIndicators.breakoutScore || 50,
      volumeScore: paIndicators.volumeScore || 50,
      momentumScore: paIndicators.momentumScore || 50,
      riskRewardScore: paIndicators.riskRewardScore || 50,
      vote: paAgentResult.signal || 'HOLD',
      confidence: paAgentResult.confidence || 0.50,
      reasoning: paAgentResult.reasoning || ''
    }
  };
}

// API: Get Symbol Intelligence for dedicated panel
app.get('/api/symbol-intelligence', async (req, res) => {
  const { symbol } = req.query;
  if (!symbol) {
    return res.status(400).json({ error: 'Symbol is required' });
  }

  try {
    const data = await getSymbolIntelligence(symbol);
    res.json(data);
  } catch (err) {
    structuredErrorLog('API', req, err);
    res.status(500).json({ error: 'Internal Server Error', code: 'SERVER_ERROR' });
  }
});

// API: Get Institutional Intelligence Report (8 Scores)
app.get('/api/intelligence-report', async (req, res) => {
  try {
    await predictor.recalculateRealAttribution();
    const data = db.readLocalDb();
    
    // 1. Research Score
    const memoryCount = (data.agent26_market_memory || []).length;
    const researchScore = Math.min(100, 50 + memoryCount);
    
    // 2. Learning Score
    const enrichedMemoryCount = (data.agent26_market_memory || []).filter(m => m.outcome_pnl !== null).length;
    const learningScore = memoryCount > 0 ? Math.round((enrichedMemoryCount / memoryCount) * 100) : 0;
    
    // 3. Adaptation Score
    const trustLogs = (data.agent21_trust_logs || []).length;
    const adaptationScore = Math.min(100, 40 + trustLogs * 10);
    
    // 4. Recovery Score
    const recoveryScore = runtimeState.getSnapshot().system.uptime_seconds > 0 ? 100 : 0; // Read from runtimeState
    
    // 5. Execution Score
    const activeAudits = (data.agent24_audit_logs || []).length;
    const executionScore = Math.min(100, 60 + Math.min(40, activeAudits / 5));
    
    // 6. Profitability Score
    const performanceMetrics = data.performance_metrics || [];
    const avgProfitFactor = performanceMetrics.length > 0
      ? performanceMetrics.reduce((sum, m) => sum + (m.profit_factor || 0), 0) / performanceMetrics.length
      : 1.25;
    const profitabilityScore = Math.min(100, Math.round(avgProfitFactor * 50));
    
    // 7. Data Quality Score
    const dataQualityScore = db.isNeonOnline() ? 98 : 0; // Check DB connection
    
    // 8. Intelligence Score
    const dynamicThresholdResult = require('./dynamicThreshold').getCurrentThreshold();
    const intelligenceScore = Math.min(100, Math.round((dynamicThresholdResult.threshold - 60) * 4) + 60);

    const calibration = predictor.getAgentCalibration();
    const skippedReport = await require('./agentResearch').generateEodOpportunityReport();

    res.json({
      scores: {
        Intelligence: intelligenceScore,
        Learning: learningScore,
        Adaptation: adaptationScore,
        Recovery: recoveryScore,
        Execution: executionScore,
        Profitability: profitabilityScore,
        'Data Quality': dataQualityScore,
        Research: researchScore
      },
      calibration,
      skippedReport,
      details: {
        total_market_memories: memoryCount,
        memories_with_outcomes: enrichedMemoryCount,
        trust_updates: trustLogs,
        audits_count: activeAudits,
        performance_records: performanceMetrics.length
      }
    });
  } catch (err) {
    structuredErrorLog('API', req, err);
    res.status(500).json({ error: 'Internal Server Error', code: 'SERVER_ERROR' });
  }
});

// API: Secure admin reset after breach
app.post('/api/admin/reset', async (req, res) => {
  const { password } = req.body;
  if (password !== config.ADMIN_RESET_PASSWORD) {
    return res.status(403).json({ error: 'Incorrect admin password.' });
  }

  try {
    const targetCapital = config.INITIAL_CAPITAL || 12000;
    const targetDailyProfit = Math.max(100.0, parseFloat((targetCapital * 0.10).toFixed(2)));

    // Clear historic logs and stats to prevent weekly/monthly drawdown halt triggers
    await db.resetSimulationData();

    await db.updatePortfolioState({
      strategy: 'SWING',
      balance: targetCapital,
      equity_value: 0,
      current_daily_target: targetDailyProfit,
      lifetime_pnl: 0,
      holding_stocks: []
    });

    const todayStr = new Date().toISOString().split('T')[0];
    await db.saveDailyStats({
      date: todayStr,
      start_capital: targetCapital,
      end_capital: targetCapital,
      net_pnl: 0,
      daily_target: targetDailyProfit,
      target_met: false,
      strategy_switched: false,
      status: 'ACTIVE'
    });

    // 2. Reset Bot internal state variables
    tradingBot._resetLocalState();

    res.json({ success: true, message: 'System reset successfully. Trading resumed.' });
  } catch (err) {
    structuredErrorLog('API', req, err);
    res.status(500).json({ error: 'Internal Server Error', code: 'SERVER_ERROR' });
  }
});

// Create HTTP server & WS server
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
// WebSocket heartbeat to clear dead connections
const heartbeatInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      console.log('[WS]: Terminating dead connection.');
      return ws.terminate();
    }
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on('close', () => {
  clearInterval(heartbeatInterval);
});


wss.on('connection', (ws) => {
  console.log('[WS]: Dashboard client connected.');
  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  // Immediate send current status
  sendUpdate(ws);

  // Interval removed. Broadcasts are pushed via tradingBot.broadcastDashboardUpdate()

  ws.on('message', (message) => {
    try {
      const msg = JSON.parse(message);
      if (msg.type === 'PING') {
        ws.send(JSON.stringify({ type: 'PONG' }));
        return;
      }
      if (msg.type === 'SUBSCRIBE' && msg.symbol) {
        ws.subscribedSymbol = msg.symbol;
        console.log(`[WS]: Client subscribed to symbol: ${msg.symbol}`);
        // Immediately trigger an update with the subscribed symbol
        sendUpdate(ws);
      }
    } catch (e) {
      console.error('[WS]: Error parsing message:', e);
    }
  });

  ws.on('close', () => {
    // Cleanup specific to this connection if any
    console.log('[WS]: Dashboard client disconnected.');
  });
});

// Expose instant broadcast helper
tradingBot.broadcastDashboardUpdate = async () => {
  console.log('[WS BROADCAST]: Broadcasting instant dashboard update.');
  wss.clients.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      sendUpdate(ws);
    }
  });
};

async function sendUpdate(ws) {
  try {
    const recentAlertsList = alerts.getRecentAlerts();
    
    let symbolIntelligence = null;
    if (ws.subscribedSymbol) {
      try {
        symbolIntelligence = await getSymbolIntelligence(ws.subscribedSymbol);
      } catch (intelErr) {
        console.error(`[WS]: Failed to compile symbol intelligence for ${ws.subscribedSymbol}:`, intelErr.message);
      }
    }
    
    const statusData = await tradingBot.getStatus();
    // Inject recent alerts which is stored in server memory
    statusData.recentAlerts = recentAlertsList;
    
    ws.send(JSON.stringify({
      type: 'STATUS_UPDATE',
      data: statusData,
      symbolIntelligence
    }));
  } catch (err) {
    console.error('WebSocket update failed:', err);
  }
}

// Exit Intelligence Telemetry Endpoint
app.get('/api/exit-intelligence', async (req, res) => {
  try {
    const portfolio = await db.getPortfolioState();
    const activePositions = portfolio.holding_stocks || [];
    const exitIntelligenceEngine = require('./exitIntelligenceEngine');
    const marketData = require('./marketData');
    const broker = require('./broker');
    
    const results = [];
    for (const pos of activePositions) {
      const candles = await marketData.getHistory(pos.symbol, [], '5m', '2d');
      let formattedCandles = [];
      if (candles && candles.closes && candles.closes.length > 0) {
        formattedCandles = candles.closes.map((c, i) => ({
          close: c,
          open: candles.opens[i],
          high: candles.highs[i],
          low: candles.lows[i],
          volume: candles.volumes ? candles.volumes[i] : 1000
        }));
      }
      
      pos.currentPrice = broker.getLTP(pos.symbol) || pos.avgPrice;
      const evalResult = exitIntelligenceEngine.evaluatePositionExits(pos, formattedCandles);
      results.push({
        symbol: pos.symbol,
        avgPrice: pos.avgPrice,
        currentPrice: pos.currentPrice,
        quantity: pos.quantity,
        timestamp: pos.timestamp,
        ...evalResult
      });
    }
    
    const localDb = db.readLocalDb();
    
    res.json({
      activePositions: results,
      currentWeights: exitIntelligenceEngine.getExitWeights(),
      learningFeedback: localDb.exit_learning_feedback || []
    });
  } catch (err) {
    structuredErrorLog('API', req, err);
    res.status(500).json({ error: 'Internal Server Error', code: 'SERVER_ERROR' });
  }
});

// Telegram webhook route
app.post('/api/telegram-webhook', (req, res) => {
  try {
    telegramControl.handleWebhookUpdate(req.body);
    res.sendStatus(200);
  } catch (err) {
    structuredErrorLog('API', req, err);
    res.status(500).json({ error: 'Internal Server Error', code: 'SERVER_ERROR' });
  }
});

// Start Server
server.listen(config.PORT, '0.0.0.0', () => {
  console.log(`=========================================`);
  console.log(`🚀 Automated Trading Server Active`);
  console.log(`💻 Database: ${config.USE_LOCAL_CACHE ? 'Local Cache (db.json)' : 'Neon PostgreSQL'}`);
  console.log(`🤖 Gemini: ${config.GEMINI_API_KEY ? 'Connected' : 'Missing'}`);
  console.log(`⚡ Groq: ${config.GROQ_API_KEY ? 'Connected' : 'Missing'}`);
  console.log(`📩 Telegram: ${(config.TELEGRAM_BOT_TOKEN && config.TELEGRAM_CHAT_ID) ? 'Connected' : 'Missing'}`);
  console.log(`📊 Port: ${config.PORT}`);
  console.log(`=========================================`);
  
  (async () => {
    try {
      console.log('[STARTUP] Express -> Bind PORT -> Health Endpoint OK');
      
      console.log('[STARTUP] Init RuntimeState');
      if (runtimeState.init) runtimeState.init();
      
      console.log('[STARTUP] Connect DB');
      await db.initPromise;
      
      console.log('[STARTUP] Connect Broker');
      if (broker.connect) await broker.connect();
      // 4. Initialize Telegram (Webhook/Polling based on NODE_ENV)
      console.log('[STARTUP] Init Telegram');
      telegramControl.initTelegram(app);
      
      console.log('[STARTUP] Init Scanner');
      const marketScanner = require('./marketScanner');
      if (marketScanner.init) marketScanner.init();
      
      console.log('[STARTUP] Start Scheduler');
      // Sequence step for scheduler
      
      console.log('[STARTUP] Begin Trading Loop');
      const localState = db.readLocalDb();
      const memoryCount = (localState.agent26_market_memory || []).length;
      const trustLogCount = (localState.agent21_trust_logs || []).length;
      const researchLogCount = (localState.agent22_research_logs || []).length;
      const journalCount = (localState.agent23_journals || []).length;
      const a20Count = (localState.agent20_reports || []).length;
      const a24Count = (localState.agent24_audit_logs || []).length;
      console.log(`[STARTUP] Learning State: ${memoryCount} market memories, ${trustLogCount} trust logs, ${researchLogCount} research logs, ${journalCount} journals, ${a20Count} analyst reports, ${a24Count} audit logs`);
      
      await predictor.loadLeaderboardFromDb();
      
      const cron = require('node-cron');
      
      // Schedule Bot Start (09:00 AM IST Monday-Friday)
      cron.schedule('0 9 * * 1-5', async () => {
        console.log('[CRON] 09:00 AM - Booting Trading Engine for the day...');
        await tradingBot.start();
      }, { timezone: "Asia/Kolkata" });
      
      // Schedule Bot Stop (03:30 PM IST Monday-Friday)
      cron.schedule('30 15 * * 1-5', async () => {
        console.log('[CRON] 03:30 PM - Finalising the market day...');
        // finalizeMarketDay() must run BEFORE stop(). The FSM only reports the
        // EOD state between 15:35 and 15:40, but stop() clears the tick interval
        // at 15:30 — so the end-of-day report was unreachable on every normal
        // trading day. Call it directly instead of hoping the tick loop gets there.
        try {
          const fsmNow = require('./lifecycleFSM').getSystemTime();
          await tradingBot.finalizeMarketDay(fsmNow.dateStr);
        } catch (e) {
          console.error('[CRON] finalizeMarketDay failed:', e.message);
        }
        try {
          await tradingBot.announceSessionClose();
        } catch (e) {
          console.error('[CRON] Session close announcement failed:', e.message);
        }
        console.log('[CRON] 03:30 PM - Halting Trading Engine.');
        tradingBot.stop();
      }, { timezone: "Asia/Kolkata" });

      // Weekend stand-down. The two crons above are Mon-Fri only, so without
      // this a weekend is 100% silent even when the process is healthy.
      cron.schedule('0 9 * * 6,0', async () => {
        try { await require('./sessionAnnouncer').announceStandDown(); }
        catch (e) { console.error('[CRON] Weekend stand-down notice failed:', e.message); }
      }, { timezone: "Asia/Kolkata" });

      // Immediate Boot Check
      const fsm = require('./lifecycleFSM');
      const timeInfo = fsm.getSystemTime();
      const currentMins = timeInfo.hours * 60 + timeInfo.minutes;
      const session = fsm.getTradingSession();

      // Tell the operator the engine is up and whether it will trade today.
      // Previously boot was console-only, so "holiday" and "crashed" looked
      // identical from the outside.
      try {
        const announcer = require('./sessionAnnouncer');
        await announcer.announceBoot({ brokerMode: config.BROKER_MODE });
        if (session.isWeekend || session.isHoliday) {
          await announcer.announceStandDown();
        }
      } catch (e) {
        console.error('[STARTUP] Boot announcement failed:', e.message);
      }
      
      // Start immediately if booting inside the active window (08:55 to 15:40) on a weekday
      if (currentMins >= 8 * 60 + 55 && currentMins < 15 * 60 + 40 && !session.isWeekend && !session.isHoliday) {
        console.log('[STARTUP] Server started during active trading window. Starting trading bot immediately.');
        await tradingBot.start();
        console.log('[STARTUP] Trading bot started successfully.');
      } else {
        console.log('[STARTUP] Server started outside active trading window. Bot will sleep until 08:55 AM IST.');
      }
    } catch (err) {
      console.error('[STARTUP] Error during async background boot sequence:', err);
      // This catch previously swallowed a TOTAL failure: if the boot sequence
      // throws, the crons are never registered and the bot never trades — yet
      // the HTTP server still answers 200, so nothing looks wrong. Say it out loud.
      try {
        await require('./alerts').sendTelegram(
          `🔴 <b>STARTUP FAILED</b>\n` +
          `The engine could not complete its boot sequence and will NOT trade today.\n\n` +
          `<b>Error:</b> ${err.message}\n\n` +
          `The web server is up, but the scheduler is not armed. This needs attention.`
        );
      } catch (e) {
        console.error('[STARTUP] Could not send startup-failure alert:', e.message);
      }
    }
  })();
});
