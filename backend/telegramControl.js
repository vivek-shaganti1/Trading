const TelegramBot = require('node-telegram-bot-api');
const config = require('../shared/config');
const db = require('./db');
const tradingBot = require('./tradingBot');
const broker = require('./broker');
const predictor = require('./predictor');
const exitIntelligenceEngine = require('./exitIntelligenceEngine');
const marketData = require('./marketData');
const runtimeState = require('./runtimeState');

let bot = null;
let isInitialized = false;
let pollingRetryTimeout = null;
let lastCommand = {
  text: 'None',
  timestamp: null,
  chatId: null,
  username: null,
  success: true,
  latency: 0
};
let lastUpdateTimestamp = null;

async function handleTelegramMessage(text, chatId, username = 'N/A') {
  if (!text) return null;
  const startTime = Date.now();
  lastUpdateTimestamp = Date.now();

  const lowerText = text.toLowerCase().trim();

  // Enforce authorized chat ID
  if (!config.TELEGRAM_CHAT_ID || String(chatId) !== String(config.TELEGRAM_CHAT_ID)) {
    console.warn(`[TELEGRAM UNAUTHORIZED ATTEMPT] Chat ID: ${chatId} | Username: @${username} | Command: ${text}`);
    const latency = Date.now() - startTime;
    lastCommand = {
      text: text,
      timestamp: Date.now(),
      chatId: chatId,
      username: username,
      success: false,
      latency: latency
    };
    
    // Structured print format
    console.log(`
COMMAND RECEIVED
Time: ${new Date().toISOString()}
Chat: ${chatId}
User: @${username}
Command: ${text}
Latency: ${latency}ms
Status: UNAUTHORIZED
`);

    return `❌ <b>Unauthorized Access.</b> Chat ID ${chatId} is not configured as the admin.`;
  }

  // Log telegram command to Neon/local fallback
  try {
    await db.logTelegramCommand({
      command: text,
      parameters: { chatId },
      applied: true
    });
  } catch (errCmd) {
    console.error('Error logging telegram command:', errCmd);
  }

  let response = '';
  let success = true;

  try {
    // /start command
    if (lowerText.startsWith('/start')) {
      tradingBot.resumeEntries(); // Enable entries
      await tradingBot.start();   // Start scanning loop
      response = `🚀 <b>Trading session started!</b> Automated scan and tick loops are active.`;
    }
    // /stopbot or /stop command
    else if (lowerText.startsWith('/stopbot') || lowerText.startsWith('/stop')) {
      tradingBot.stop();          // Stop scan intervals
      tradingBot.pauseEntries();   // Pause new executions
      response = `🛑 <b>Bot Loop Stopped.</b> Scheduler and scanning halted, new entries paused. Existing holdings remain untouched.`;
    }
    // /resume command
    else if (lowerText.startsWith('/resume')) {
      tradingBot.resumeEntries();
      await tradingBot.start();
      response = `▶ <b>Automated trading resumed.</b> Bot active, scanning markets, and new entries enabled.`;
    }
    // /pause command
    else if (lowerText.startsWith('/pause')) {
      tradingBot.pauseEntries();
      response = `⏸️ <b>Entries Paused.</b> Existing positions will still be managed for stop-loss and targets, but no new trades will be entered.`;
    }
    // /status command
    else if (lowerText.startsWith('/status')) {
      const status = await tradingBot.getStatus();
      const stats = status.dailyStats;
      const dailyPnL = stats ? stats.net_pnl : 0;
      const dailyTarget = stats ? stats.daily_target : 1000;
      const marketStatus = status.isMarketOpen ? 'OPEN 🟢' : 'CLOSED 🔴';
      const runningStatus = status.isRunning ? 'RUNNING 🟢' : 'PAUSED ⏸';
      const lastScanTime = status.debugData.lastApiResponseTimestamp !== 'None'
        ? new Date(status.debugData.lastApiResponseTimestamp).toLocaleTimeString()
        : 'None';
      const currentSymbol = status.prediction?.symbol || 'None';
      const scannerHealth = status.isRunning ? 'STABLE (ACTIVE)' : 'PAUSED';

      response = `🤖 <b>Quant Command Station Status</b>\n` +
                 `• Engine Status: <b>${runningStatus}</b>\n` +
                 `• Market Status: <b>${marketStatus}</b>\n` +
                 `• Capital: <b>₹${status.totalVal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</b>\n` +
                 `• Cash: <b>₹${status.balance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</b>\n` +
                 `• Open Positions: <b>${(status.holdingStocks || []).length}</b>\n` +
                 `• Today's P&L: <b>₹${dailyPnL.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</b>\n` +
                 `• Daily Target: <b>₹${dailyTarget.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</b>\n` +
                 `• Last Scan: <b>${lastScanTime}</b>\n` +
                 `• Current Symbol: <b>${currentSymbol}</b>\n` +
                 `• Scanner Health: <b>${scannerHealth}</b>`;
    }
    // /orders command
    else if (lowerText.startsWith('/orders')) {
      const status = await tradingBot.getStatus();
      const holdings = status.holdingStocks || [];
      if (holdings.length === 0) {
        response = `📋 <b>No pending or open simulated orders.</b>`;
      } else {
        let msg = `📋 <b>Open Simulated Positions</b>\n`;
        holdings.forEach((h, idx) => {
          const ltp = broker.getLTP(h.symbol) || h.avgPrice;
          const pnl = (ltp - h.avgPrice) * h.quantity;
          msg += `${idx + 1}. <b>${h.symbol}</b> | Qty: <b>${h.quantity}</b> | Entry: <b>₹${h.avgPrice}</b> | LTP: <b>₹${ltp}</b> | P&L: <b>₹${pnl.toFixed(2)}</b>\n`;
        });
        response = msg;
      }
    }
    // /positions command
    else if (lowerText.startsWith('/positions')) {
      const status = await tradingBot.getStatus();
      const holdings = status.holdingStocks || [];
      if (holdings.length === 0) {
        response = `💼 <b>No open holdings. Ready to trade.</b>`;
      } else {
        let msg = `💼 <b>Live Holdings</b>\n`;
        holdings.forEach((h, idx) => {
          const ltp = broker.getLTP(h.symbol) || h.avgPrice;
          const curVal = ltp * h.quantity;
          const entryVal = h.avgPrice * h.quantity;
          const pnl = curVal - entryVal;
          msg += `${idx + 1}. <b>${h.symbol}</b> (${h.strategy})\n` +
                 `   • Qty: <b>${h.quantity}</b>\n` +
                 `   • Avg Entry: <b>₹${h.avgPrice}</b> | LTP: <b>₹${ltp}</b>\n` +
                 `   • Value: <b>₹${curVal.toFixed(2)}</b>\n` +
                 `   • P&L: <b>₹${pnl.toFixed(2)}</b>\n`;
        });
        response = msg;
      }
    }
    // /stats command
    else if (lowerText.startsWith('/stats')) {
      const status = await tradingBot.getStatus();
      const pResults = await db.getPaperTradingResults();
      const stats = await db.calculateCompletedTradesStats();

      const winRate = Number(pResults.win_rate || stats.win_rate || 0).toFixed(1);
      const profitFactor = Number(pResults.profit_factor || stats.profit_factor || 1).toFixed(2);
      const sharpe = Number(pResults.sharpe_ratio || stats.sharpe_ratio || 0).toFixed(2);
      const maxDrawdown = Number(pResults.max_drawdown || stats.max_drawdown || 0).toFixed(2);
      const totalTrades = stats.total_trades || 0;
      
      const wrFrac = (stats.win_rate || 0) / 100;
      const avgWin = stats.average_winner || 0;
      const avgLoss = stats.average_loser || 0;
      const expectancy = (wrFrac * avgWin) + ((1 - wrFrac) * avgLoss);

      response = `📊 <b>Quant Analytics Summary</b>\n` +
                 `• Win Rate: <b>${winRate}%</b>\n` +
                 `• Profit Factor: <b>${profitFactor}</b>\n` +
                 `• Expectancy: <b>₹${expectancy.toFixed(2)}</b>\n` +
                 `• Sharpe Ratio: <b>${sharpe}</b>\n` +
                 `• Max Drawdown: <b>${maxDrawdown}%</b>\n` +
                 `• Today's Trades: <b>${totalTrades}</b>`;
    }
    // /help command
    else if (lowerText.startsWith('/help')) {
      response = `🤖 <b>AGY-Trader Command Help</b>\n` +
                 `/start - Start trading bot execution loop & scan\n` +
                 `/stopbot - Stop scheduler, stop scanning, and pause entries\n` +
                 `/pause - Pause new entry orders only (risk management active)\n` +
                 `/resume - Resume new entry orders & start execution loop\n` +
                 `/status - View live bot status, cash balance, and open holdings\n` +
                 `/positions - View current holdings and real-time open PnL\n` +
                 `/orders - View pending execution queue/orders\n` +
                 `/stats - Fetch win rate, profit factor, and Sharpe analytics\n` +
                 `/health - System health, DB connection status, memory RSS, and uptime\n` +
                 `/performance - Summarize total trades, win rate, and total net PnL\n` +
                 `/logs - Fetch the last 10 system log/alert entries\n` +
                 `/today - View today's completed trades list and total realized PnL\n` +
                 `/report - Generate institutional daily EOD report summary\n` +
                 `/exitanalysis - Inspect detailed exit intelligence parameters\n` +
                 `/holdreason - Display explanation for active position hold\n` +
                 `/exitconfidence - View exit score confidence percentage\n` +
                 `/tradehealth - Assess drawdown, time decay, and position risk health\n` +
                 `/agents - Inspect active AI agent weights and historical performance\n` +
                 `/risk - Display risk limits and portfolio protection rules\n` +
                 `/mode - Switch strategy modes (safe / high opportunity)\n` +
                 `/restart - Restart bot loop (stop & start execution)`;
    }
    // /portfolio command
    else if (lowerText.startsWith('/portfolio')) {
      const status = await tradingBot.getStatus();
      response = `💼 <b>Portfolio Valuation</b>\n` +
                 `• Total Value: <b>₹${status.totalVal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</b>\n` +
                 `• Free Balance: <b>₹${status.balance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</b>\n` +
                 `• Equity Assets: <b>₹${status.equityValue.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</b>\n` +
                 `• Net P&L: <b>₹${status.netPnL.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</b>`;
    }
    // /pnl or /profit or /loss command
    else if (lowerText.startsWith('/pnl') || lowerText.startsWith('/profit') || lowerText.startsWith('/loss')) {
      const status = await tradingBot.getStatus();
      const stats = status.dailyStats;
      const dailyPnL = stats ? stats.net_pnl : 0;
      response = `📊 <b>Daily Statistics</b>\n` +
                 `• Daily profit target: <b>₹${status.target}</b>\n` +
                 `• Today's Net P&L: <b>₹${dailyPnL.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</b>\n` +
                 `• Target met: <b>${stats && stats.target_met ? 'YES 🎯' : 'NO'}</b>\n` +
                 `• Day Status: <b>${stats ? stats.status : 'ACTIVE'}</b>`;
    }
    // /target command
    else if (lowerText.startsWith('/target')) {
      const status = await tradingBot.getStatus();
      const stats = status.dailyStats;
      const dailyPnL = stats ? stats.net_pnl : 0;
      const dailyTarget = stats ? stats.daily_target : 1000;
      const progress = (dailyPnL / dailyTarget) * 100;
      response = `🎯 <b>Daily Profit Target</b>\n` +
                 `• Current profit today: <b>₹${dailyPnL.toFixed(2)}</b>\n` +
                 `• Target: <b>₹${dailyTarget.toFixed(2)}</b>\n` +
                 `• Progress: <b>${progress.toFixed(1)}%</b>\n` +
                 `• Status: <b>${progress >= 100 ? 'Target Met! ✅' : 'Running... 📈'}</b>`;
    }
    // /intelligence command
    else if (lowerText.startsWith('/intelligence')) {
      const data = db.readLocalDb();
      const memoryCount = (data.agent26_market_memory || []).length;
      const enrichedMemoryCount = (data.agent26_market_memory || []).filter(m => m.outcome_pnl !== null).length;
      const learningScore = memoryCount > 0 ? Math.round((enrichedMemoryCount / memoryCount) * 100) : 0;
      
      const trustLogs = (data.agent21_trust_logs || []).length;
      const adaptationScore = Math.min(100, 40 + trustLogs * 10);
      
      const activeAudits = (data.agent24_audit_logs || []).length;
      
      const dynamicThresholdResult = require('./dynamicThreshold').getCurrentThreshold();
      const systemRegime = dynamicThresholdResult.regime || 'RANGING';
      
      response = `🧠 <b>Intelligence Scorecard</b>\n` +
                 `• Learning Score: <b>${learningScore}%</b>\n` +
                 `• Adaptation Score: <b>${adaptationScore}%</b>\n` +
                 `• System Regime: <b>${systemRegime}</b>\n` +
                 `• Active Audits: <b>${activeAudits}</b>`;
    }
    // /report command
    else if (lowerText.startsWith('/report')) {
      const status = await tradingBot.getStatus();
      const skippedReport = await require('./agentResearch').generateEodOpportunityReport();
      const stats = status.dailyStats;
      const dailyPnL = stats ? stats.net_pnl : 0;
      
      response = `📊 <b>Institutional Daily Report Summary</b>\n` +
                 `• Net P&L: <b>₹${dailyPnL.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</b>\n` +
                 `• Target Met: <b>${stats && stats.target_met ? 'YES 🎯' : 'NO'}</b>\n` +
                 `• Missed Profit: <b>₹${Number(skippedReport.missed_profit_rupees).toFixed(2)}</b>\n` +
                 `• Losses Prevented: <b>₹${Number(skippedReport.missed_loss_prevented_rupees).toFixed(2)}</b>\n` +
                 `• Correct Rejection Rate: <b>${Number(skippedReport.correct_rejection_rate).toFixed(1)}%</b>`;
    }
    // /agents command
    else if (lowerText.startsWith('/agents') || lowerText.startsWith('/weights')) {
      const leaderboard = predictor.getLeaderboard();
      let msg = `⚙️ <b>Active Agent Weights & Performance</b>\n`;
      Object.keys(leaderboard).forEach(id => {
        const a = leaderboard[id];
        msg += `• Agent ${id} (${a.name}): weight = <b>${a.weight.toFixed(4)}</b> | Net PnL = ₹${(a.profitContribution + a.lossContribution).toFixed(2)}\n`;
      });
      response = msg;
    }
    // /memory command
    else if (lowerText.startsWith('/memory')) {
      const data = db.readLocalDb();
      const memories = data.agent26_market_memory || [];
      response = `🧠 <b>Market Memory Engine</b>\n` +
                 `• Total persistent memories: <b>${memories.length}</b>\n` +
                 `• Matching style: <b>Euclidean similarity</b>\n` +
                 `• Match threshold: <b>6.0</b>`;
    }
    // /scanner command
    else if (lowerText.startsWith('/scanner')) {
      const items = db.readLocalDb().agent24_audit_logs || [];
      if (items.length === 0) {
        response = `🔍 No recent opportunities scanned yet.`;
      } else {
        const uniqueList = Array.from(new Set(items.map(i => i.symbol))).slice(0, 5);
        let msg = `🔍 <b>Scanner Universe Opportunities</b>\n`;
        uniqueList.forEach((sym, idx) => {
          const symAudits = items.filter(x => x.symbol === sym);
          const lastPrice = symAudits[symAudits.length - 1].price_at_rejection || 1000;
          msg += `${idx + 1}. <b>${sym}</b>: Last Price ₹${lastPrice.toFixed(2)} (Scanned ${symAudits.length} times)\n`;
        });
        response = msg;
      }
    }
    // /audit command
    else if (lowerText.startsWith('/audit')) {
      const status = await tradingBot.getStatus();
      const stats = status.dailyStats;
      const dailyPnL = stats ? stats.net_pnl : 0;
      const runtime = status.runtime || {};
      const auditLogs = db.readLocalDb().agent24_audit_logs || [];
      const totalAudited = auditLogs.length;
      // Compute real losses prevented and missed profit from audit records
      let lossesPrevented = 0;
      let missedProfit = 0;
      auditLogs.forEach(log => {
        const priceMoveRupees = (log.actual_move_pct || 0) / 100 * (log.price_at_rejection || 0) * (log.suggested_quantity || 1);
        if (priceMoveRupees < 0) {
          lossesPrevented += Math.abs(priceMoveRupees);
        } else if (priceMoveRupees > 0) {
          missedProfit += priceMoveRupees;
        }
      });
      const capitalUtil = runtime.financials
        ? runtime.financials.capital_utilization.toFixed(1)
        : ((status.totalVal - status.balance) / status.totalVal * 100).toFixed(1);
      response = `📊 <b>Institutional Profitability Audit</b>\n` +
                 `• Today Net PnL: <b>₹${dailyPnL.toFixed(2)}</b>\n` +
                 `• Starting capital: <b>₹${(stats ? stats.start_capital : status.totalVal).toFixed(2)}</b>\n` +
                 `• Capital utilization: <b>${capitalUtil}%</b>\n` +
                 `• Opportunities audited: <b>${totalAudited.toLocaleString()}</b>\n` +
                 `• Losses prevented: <b>₹${lossesPrevented.toFixed(2)}</b>\n` +
                 `• Missed Profit (Skipped Wins): <b>₹${missedProfit.toFixed(2)}</b>`;
    }
    // /risk command
    else if (lowerText.startsWith('/risk')) {
      const status = await tradingBot.getStatus();
      const portfolioState = await db.getPortfolioState();
      const settings = portfolioState.user_instructions || {};
      response = `🛡️ <b>Risk Parameters</b>\n` +
                 `• Daily Stop-Loss limit: <b>-7% (-₹${(status.totalVal * 0.07).toFixed(2)})</b>\n` +
                 `• Max capital floor drawdown: <b>₹8,000</b>\n` +
                 `• Risk mode: <b>${settings.risk_mode || 'NORMAL'}</b>\n` +
                 `• Confidence floor: <b>${((settings.min_confidence_override || 0.75) * 100).toFixed(0)}%</b>\n` +
                 `• Avoid intraday: <b>${settings.avoid_intraday ? 'YES' : 'NO'}</b>\n` +
                 `• Avoid long-term: <b>${settings.avoid_longterm ? 'YES' : 'NO'}</b>`;
    }
    // /mode command
    else if (lowerText.startsWith('/mode')) {
      const params = lowerText.split(' ');
      if (params.length > 1) {
        const modeParam = params[1].toLowerCase();
        if (modeParam === 'high_opportunity' || modeParam === 'high' || modeParam === 'turbo') {
          config.HIGH_OPPORTUNITY_MODE = true;
          response = `⚡ <b>System Mode Switched</b>\n• Active Mode: <b>HIGH_OPPORTUNITY (TURBO)</b>\n• Cooldown: <b>2s</b>\n• Threshold scaling: <b>Active (-5 TQS)</b>\n• Confidence threshold: <b>0.60</b>`;
        } else if (modeParam === 'normal' || modeParam === 'safe') {
          config.HIGH_OPPORTUNITY_MODE = false;
          response = `🛡️ <b>System Mode Switched</b>\n• Active Mode: <b>NORMAL (CONSERVATIVE)</b>\n• Cooldown: <b>5s</b>\n• Threshold scaling: <b>Standard</b>\n• Confidence threshold: <b>0.65</b>`;
        }
      } else {
        response = `⚡ <b>System Mode Control</b>\n` +
                   `• Current Mode: <b>${config.HIGH_OPPORTUNITY_MODE ? 'HIGH_OPPORTUNITY (TURBO) ⚡' : 'NORMAL (CONSERVATIVE) 🛡️'}</b>\n` +
                   `• Usage: <code>/mode high</code> or <code>/mode normal</code>`;
      }
    }
    // /health command
    else if (lowerText.startsWith('/health')) {
      const status = await tradingBot.getStatus();
      const dbStatus = db.initPromise ? 'CONNECTED' : 'DISCONNECTED';
      response = `🏥 <b>System Health Check</b>\n` +
                 `• Engine Status: <b>${status.isRunning ? 'RUNNING 🟢' : 'PAUSED 🔴'}</b>\n` +
                 `• Database Status: <b>${dbStatus === 'CONNECTED' ? 'CONNECTED 🟢' : 'DISCONNECTED 🔴'}</b>\n` +
                 `• Scanner status: <b>${status.isRunning ? 'SCANNING 🟢' : 'PAUSED 🔴'}</b>\n` +
                 `• Memory RSS: <b>${(process.memoryUsage().rss / 1024 / 1024).toFixed(1)} MB</b>\n` +
                 `• Uptime: <b>${Math.floor(process.uptime() / 60)} minutes</b>`;
    }
    // /runtime command
    else if (lowerText.startsWith('/runtime')) {
      const snapshot = runtimeState.getSnapshot();
      response = `⚡ <b>System Runtime Snapshot</b>\n` +
                 `• Version: <b>${snapshot.system.version}</b>\n` +
                 `• Engine State: <b>${snapshot.isRunning ? 'ACTIVE 🟢' : 'PAUSED ⏸'}</b>\n` +
                 `• Entries Paused: <b>${snapshot.entriesPaused ? 'YES ⏸' : 'NO 🟢'}</b>\n` +
                 `• Market State: <b>${snapshot.market.status} (${snapshot.market.isOpen ? 'OPEN' : 'CLOSED'})</b>\n` +
                 `• Uptime: <b>${Math.floor(snapshot.system.uptime_seconds / 60)} minutes</b>\n` +
                 `• Memory Usage: <b>${(snapshot.system.memory_usage.rss / 1024 / 1024).toFixed(1)} MB (RSS)</b>\n` +
                 `• Open Positions Count: <b>${snapshot.positions.length}</b>\n` +
                 `• Pending Orders Count: <b>${snapshot.pending_orders.length}</b>`;
    }
    // /performance command
    else if (lowerText.startsWith('/performance')) {
      const data = db.readLocalDb();
      const completed = data.completed_trades || [];
      const wins = completed.filter(t => t.net_pnl > 0).length;
      const winRate = completed.length > 0 ? (wins / completed.length * 100).toFixed(1) : '0.0';
      const totalPnL = completed.reduce((sum, t) => sum + t.net_pnl, 0);
      response = `🏆 <b>Performance Analysis</b>\n` +
                 `• Total Trades: <b>${completed.length}</b>\n` +
                 `• Win Rate: <b>${winRate}%</b>\n` +
                 `• Net P&L: <b>₹${totalPnL.toFixed(2)}</b>`;
    }
    // /logs command
    else if (lowerText.startsWith('/logs')) {
      const data = db.readLocalDb();
      const alertsList = (data.alerts || []).slice(-10);
      if (alertsList.length === 0) {
        response = `📋 <b>System Logs:</b> No recent logs found.`;
      } else {
        response = `📋 <b>System Logs (Last 10)</b>\n` +
                   alertsList.map(a => `• [${new Date(a.timestamp).toLocaleTimeString()}] [${a.type}] ${a.message}`).join('\n');
      }
    }
    // /exitanalysis command
    else if (lowerText.startsWith('/exitanalysis')) {
      const status = await tradingBot.getStatus();
      const holdings = status.holdingStocks || [];
      if (holdings.length === 0) {
        response = `💼 <b>No open holdings to analyze.</b>`;
      } else {
        let msg = `🔍 <b>Institutional Exit Analysis</b>\n\n`;
        for (const h of holdings) {
          const candles = await marketData.getHistory(h.symbol, [], '5m', '2d');
          let formattedCandles = [];
          if (candles && candles.closes) {
            formattedCandles = candles.closes.map((c, i) => ({
              close: c,
              open: candles.opens[i],
              high: candles.highs[i],
              low: candles.lows[i],
              volume: candles.volumes ? candles.volumes[i] : 1000
            }));
          }
          h.currentPrice = broker.getLTP(h.symbol) || h.avgPrice;
          const evalResult = exitIntelligenceEngine.evaluatePositionExits(h, formattedCandles);
          msg += `<b>Symbol: ${h.symbol}</b>\n` +
                 `• Exit Confidence: <b>${evalResult.exitConfidence}/100</b>\n` +
                 `• Recommendation: <b>${evalResult.recommendedMode}</b>\n` +
                 `• Reason: <i>${evalResult.reason}</i>\n` +
                 `• Scores: MS: ${evalResult.components.marketStructure || 0} | SMC: ${evalResult.components.smc || 0} | Wyckoff: ${evalResult.components.wyckoff || 0} | Vol: ${evalResult.components.volume || 0} | Mom: ${evalResult.components.momentum || 0} | Trend: ${evalResult.components.trend || 0} | Volatility: ${evalResult.components.volatility || 0} | Candle: ${evalResult.components.candlestick || 0} | MTF: ${evalResult.components.mtf || 0} | Risk: ${evalResult.components.risk || 0}\n\n`;
        }
        response = msg;
      }
    }
    // /holdreason command
    else if (lowerText.startsWith('/holdreason')) {
      const status = await tradingBot.getStatus();
      const holdings = status.holdingStocks || [];
      if (holdings.length === 0) {
        response = `💼 <b>No open holdings.</b>`;
      } else {
        let msg = `🛡️ <b>Hold Reasons</b>\n\n`;
        for (const h of holdings) {
          const candles = await marketData.getHistory(h.symbol, [], '5m', '2d');
          let formattedCandles = [];
          if (candles && candles.closes) {
            formattedCandles = candles.closes.map((c, i) => ({
              close: c,
              open: candles.opens[i],
              high: candles.highs[i],
              low: candles.lows[i],
              volume: candles.volumes ? candles.volumes[i] : 1000
            }));
          }
          h.currentPrice = broker.getLTP(h.symbol) || h.avgPrice;
          const evalResult = exitIntelligenceEngine.evaluatePositionExits(h, formattedCandles);
          msg += `<b>Symbol: ${h.symbol}</b>\n` +
                 `• Action: <b>${evalResult.shouldExit ? 'EXIT (' + evalResult.recommendedMode + ')' : 'HOLD'}</b>\n` +
                 `• Explanation: ${evalResult.reason}\n\n`;
        }
        response = msg;
      }
    }
    // /exitconfidence command
    else if (lowerText.startsWith('/exitconfidence')) {
      const status = await tradingBot.getStatus();
      const holdings = status.holdingStocks || [];
      if (holdings.length === 0) {
        response = `💼 <b>No open holdings.</b>`;
      } else {
        let msg = `📈 <b>Exit Confidence Scores</b>\n\n`;
        for (const h of holdings) {
          const candles = await marketData.getHistory(h.symbol, [], '5m', '2d');
          let formattedCandles = [];
          if (candles && candles.closes) {
            formattedCandles = candles.closes.map((c, i) => ({
              close: c,
              open: candles.opens[i],
              high: candles.highs[i],
              low: candles.lows[i],
              volume: candles.volumes ? candles.volumes[i] : 1000
            }));
          }
          h.currentPrice = broker.getLTP(h.symbol) || h.avgPrice;
          const evalResult = exitIntelligenceEngine.evaluatePositionExits(h, formattedCandles);
          msg += `• <b>${h.symbol}</b>: Exit Confidence <b>${evalResult.exitConfidence}%</b> [Threshold: ${h.exitThresholdOverride || 70}%]\n`;
        }
        response = msg;
      }
    }
    // /tradehealth command
    else if (lowerText.startsWith('/tradehealth')) {
      const status = await tradingBot.getStatus();
      const holdings = status.holdingStocks || [];
      if (holdings.length === 0) {
        response = `💼 <b>No open holdings.</b>`;
      } else {
        let msg = `❤️ <b>Trade Health Status</b>\n\n`;
        for (const h of holdings) {
          const candles = await marketData.getHistory(h.symbol, [], '5m', '2d');
          let formattedCandles = [];
          if (candles && candles.closes) {
            formattedCandles = candles.closes.map((c, i) => ({
              close: c,
              open: candles.opens[i],
              high: candles.highs[i],
              low: candles.lows[i],
              volume: candles.volumes ? candles.volumes[i] : 1000
            }));
          }
          h.currentPrice = broker.getLTP(h.symbol) || h.avgPrice;
          const evalResult = exitIntelligenceEngine.evaluatePositionExits(h, formattedCandles);
          
          const returnPct = ((h.currentPrice - h.avgPrice) / h.avgPrice) * 100;
          const peakPrice = h.maxPrice || h.currentPrice;
          const givebackPct = ((peakPrice - h.currentPrice) / peakPrice) * 100;
          
          const healthStatus = evalResult.components.risk >= 75 ? 'DANGER 🔴' : (evalResult.components.risk >= 55 ? 'WARNING 🟡' : 'HEALTHY 🟢');
          
          msg += `<b>Symbol: ${h.symbol}</b> [${healthStatus}]\n` +
                 `   • Return: <b>${returnPct.toFixed(2)}%</b>\n` +
                 `   • Peak Price: ₹${peakPrice.toFixed(2)}\n` +
                 `   • Pullback: <b>${givebackPct.toFixed(2)}%</b>\n` +
                 `   • Risk Score: <b>${evalResult.components.risk || 0}/100</b>\n` +
                 `   • Mode: <b>${evalResult.recommendedMode}</b>\n\n`;
        }
        response = msg;
      }
    }
    // /restart command
    else if (lowerText.startsWith('/restart')) {
      await tradingBot.stop();
      await tradingBot.start();
      response = `🔄 <b>Bot loop restarted!</b> Tick scan started.`;
    }
    // /today command
    else if (lowerText.startsWith('/today')) {
      const data = db.readLocalDb();
      const completed = data.completed_trades || [];
      const todayStr = new Date().toISOString().split('T')[0];
      const todayTrades = completed.filter(t => t.exit_time && t.exit_time.startsWith(todayStr));
      if (todayTrades.length === 0) {
        response = `📅 <b>Today's Trades:</b> No trades completed today yet.`;
      } else {
        const todayPnL = todayTrades.reduce((sum, t) => sum + t.net_pnl, 0);
        response = `📅 <b>Today's Completed Trades</b>\n` +
                   todayTrades.map(t => `• ${t.symbol}: ₹${t.net_pnl.toFixed(2)} (${t.return_pct.toFixed(2)}%) - ${t.exit_reason}`).join('\n') +
                   `\n\n💰 <b>Today's Net P&L:</b> ₹${todayPnL.toFixed(2)}`;
      }
    }
    // NLP parameters update or other custom requests
    else {
      let updated = false;
      const portfolioState = await db.getPortfolioState();
      const settings = portfolioState.user_instructions || { risk_mode: 'NORMAL', min_confidence_override: 0.75, avoid_intraday: false, avoid_longterm: false, max_positions: 3 };

      if (lowerText.includes('focus on safer trades') || lowerText.includes('reduce risk')) {
        settings.risk_mode = 'SAFE';
        settings.min_confidence_override = 0.85; // Raise consensus bar
        updated = true;
      } else if (lowerText.includes('increase confidence threshold') || lowerText.includes('increase confidence')) {
        settings.min_confidence_override = 0.80;
        updated = true;
      } else if (lowerText.includes('avoid long-term positions') || lowerText.includes('avoid long term')) {
        settings.avoid_longterm = true;
        updated = true;
      } else if (lowerText.includes('avoid intraday positions') || lowerText.includes('avoid intraday') || lowerText.includes('avoid day trades')) {
        settings.avoid_intraday = true;
        updated = true;
      }

      if (updated) {
        await db.updatePortfolioState({
          user_instructions: settings
        });
        response = `🛡️ <b>Trading parameter adjusted successfully!</b>\n` +
                   `• Risk Mode: <b>${settings.risk_mode}</b>\n` +
                   `• Consensus threshold: <b>${(settings.min_confidence_override * 100).toFixed(0)}%</b>\n` +
                   `• Avoid Intraday: <b>${settings.avoid_intraday ? 'YES' : 'NO'}</b>\n` +
                   `• Avoid Long-Term: <b>${settings.avoid_longterm ? 'YES' : 'NO'}</b>`;
      } else {
        response = `🤖 Unknown command. Available commands:\n` +
                   `/start, /stop, /pause, /resume, /status, /portfolio, /pnl, /target, /intelligence, /report, /exitanalysis, /holdreason, /exitconfidence, /tradehealth, /agents, /weights, /memory, /scanner, /audit, /positions, /risk, /health, /performance, /logs, /restart, /today\n` +
                   `Or write intents like: <i>"Focus on safer trades"</i> or <i>"Avoid long-term positions"</i>.`;
      }
    }
  } catch (cmdErr) {
    console.error(`[TELEGRAM CMD ERROR]:`, cmdErr);
    response = `❌ <b>Error executing command:</b> ${cmdErr.message}`;
    success = false;
  }

  const latency = Date.now() - startTime;
  lastCommand = {
    text: text,
    timestamp: Date.now(),
    chatId: chatId,
    username: username,
    success: success,
    latency: latency
  };

  // Structured console log exactly matching requirement 5
  console.log(`
COMMAND RECEIVED
Time: ${new Date().toISOString()}
Chat: ${chatId}
User: @${username}
Command: ${text}
Latency: ${latency}ms
Status: ${success ? 'SUCCESS' : 'FAILED'}
`);

  return response;
}

// Webhook / Polling listener initialization
function initTelegramBot() {
  if (isInitialized) {
    console.warn('[TELEGRAM BOT]: initTelegramBot() called but already initialized. Guarding against duplicates.');
    return;
  }
  if (!config.TELEGRAM_BOT_TOKEN) {
    console.warn('[TELEGRAM BOT]: TELEGRAM_BOT_TOKEN is missing in .env. Command polling is disabled (Simulator running).');
    return;
  }

  isInitialized = true;
  console.log('[TELEGRAM BOT]: Telegram initialized.');

  try {
    const renderUrl = process.env.RENDER_EXTERNAL_URL;
    if (renderUrl) {
      // Production webhook mode
      bot = new TelegramBot(config.TELEGRAM_BOT_TOKEN, { polling: false });
      bot.deleteWebHook().then(() => {
        console.log('[TELEGRAM BOT]: Webhook removed (preparing new webhook registration).');
        return bot.setWebHook(`${renderUrl}/api/telegram-webhook`);
      }).then(() => {
        console.log(`[TELEGRAM BOT]: Webhook registered successfully at ${renderUrl}/api/telegram-webhook`);
      }).catch(err => {
        console.error('[TELEGRAM BOT]: Webhook setup failed:', err.message);
      });
    } else {
      // Local polling mode - explicitly delete webhook first to prevent conflict on restart
      bot = new TelegramBot(config.TELEGRAM_BOT_TOKEN, { polling: false });
      bot.deleteWebHook().then(() => {
        console.log('[TELEGRAM BOT]: Webhook removed. Starting polling...');
        return bot.startPolling();
      }).then(() => {
        console.log('[TELEGRAM BOT]: Polling started.');
      }).catch(err => {
        console.error('[TELEGRAM BOT]: Polling startup failed:', err.message);
      });
    }

    // Register message handler
    bot.on('message', async (msg) => {
      const text = msg.text ? msg.text.trim() : '';
      const chatId = msg.chat.id;
      const username = msg.from ? msg.from.username : 'N/A';
      
      console.log(`[TELEGRAM UPDATE] Chat ID: ${chatId} | Username: @${username} | Command: ${text}`);

      try {
        const response = await handleTelegramMessage(text, chatId, username);
        if (response) {
          bot.sendMessage(chatId, response, { parse_mode: 'HTML' });
        }
      } catch (err) {
        console.error('[TELEGRAM BOT] Error processing message:', err.message);
      }
    });

    // Polling error listener
    bot.on('polling_error', (error) => {
      console.error(`[TELEGRAM BOT POLLING ERROR]: Code: ${error.code} | Message: ${error.message}`);
      if (error.message && error.message.includes('409 Conflict')) {
        console.warn('[TELEGRAM BOT]: Detected 409 Conflict. Stopping current polling instance.');
        bot.stopPolling().then(() => {
          console.warn('[TELEGRAM BOT]: Polling stopped. Scheduling retry in 30 seconds to allow the conflict to resolve...');
          if (pollingRetryTimeout) clearTimeout(pollingRetryTimeout);
          pollingRetryTimeout = setTimeout(() => {
            console.log('[TELEGRAM BOT]: Retrying polling start after conflict delay...');
            bot.startPolling().then(() => {
              console.log('[TELEGRAM BOT]: Polling resumed successfully.');
            }).catch(err => {
              console.error('[TELEGRAM BOT]: Failed to resume polling after retry:', err.message);
            });
          }, 30000);
        }).catch(err => {
          console.error('[TELEGRAM BOT]: Failed to stop polling cleanly:', err.message);
        });
      }
    });

  } catch (err) {
    console.error('[TELEGRAM BOT] Initialization failed:', err.message);
    isInitialized = false;
  }
}

function handleWebhookUpdate(update) {
  if (bot) {
    bot.processUpdate(update);
  }
}

function getTelegramHealth() {
  const isWebhook = !!process.env.RENDER_EXTERNAL_URL;
  return {
    mode: isWebhook ? 'webhook' : 'polling',
    webhook: isWebhook,
    polling: !isWebhook,
    lastCommand: lastCommand,
    lastUpdate: lastUpdateTimestamp,
    pendingUpdates: 0,
    authorizedUsers: config.TELEGRAM_CHAT_ID ? [config.TELEGRAM_CHAT_ID] : [],
    webhookUrl: isWebhook ? `${process.env.RENDER_EXTERNAL_URL}/api/telegram-webhook` : null,
    status: isInitialized ? 'CONNECTED' : 'DISCONNECTED'
  };
}

module.exports = {
  initTelegramBot,
  handleTelegramMessage,
  handleWebhookUpdate,
  getTelegramHealth
};
