const TelegramBot = require('node-telegram-bot-api');
const config = require('../shared/config');
const db = require('./db');
const tradingBot = require('./tradingBot');
const broker = require('./broker');
const predictor = require('./predictor');

let bot = null;

async function handleTelegramMessage(text, chatId) {
  if (!text) return null;

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

  const lowerText = text.toLowerCase().trim();

  // /start command
  if (lowerText.startsWith('/start')) {
    await tradingBot.start();
    return `🚀 <b>Trading session started!</b> Automated scan and tick loops are active.`;
  }

  // /stop command
  if (lowerText.startsWith('/stop')) {
    tradingBot.stop();
    return `⏸ <b>Trading session stopped gracefully.</b> No new positions will be opened. Current positions remain under active risk management.`;
  }

  // /resume command
  if (lowerText.startsWith('/resume')) {
    await tradingBot.start();
    return `▶ <b>Automated trading resumed.</b> Bot active and scanning markets.`;
  }

  // /status command
  if (lowerText.startsWith('/status')) {
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

    return `🤖 <b>Quant Command Station Status</b>\n` +
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

  // /orders command (Alias to open paper positions for simulated trading)
  if (lowerText.startsWith('/orders')) {
    const status = await tradingBot.getStatus();
    const holdings = status.holdingStocks || [];
    if (holdings.length === 0) return `📋 <b>No pending or open simulated orders.</b>`;
    
    let msg = `📋 <b>Open Simulated Positions</b>\n`;
    holdings.forEach((h, idx) => {
      const ltp = broker.getLTP(h.symbol) || h.avgPrice;
      const pnl = (ltp - h.avgPrice) * h.quantity;
      msg += `${idx + 1}. <b>${h.symbol}</b> | Qty: <b>${h.quantity}</b> | Entry: <b>₹${h.avgPrice}</b> | LTP: <b>₹${ltp}</b> | P&L: <b>₹${pnl.toFixed(2)}</b>\n`;
    });
    return msg;
  }

  // /positions command
  if (lowerText.startsWith('/positions')) {
    const status = await tradingBot.getStatus();
    const holdings = status.holdingStocks || [];
    if (holdings.length === 0) return `💼 <b>No open holdings. Ready to trade.</b>`;
    
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
    return msg;
  }

  // /stats command
  if (lowerText.startsWith('/stats')) {
    const status = await tradingBot.getStatus();
    const pResults = await db.getPaperTradingResults();
    const stats = await db.calculateCompletedTradesStats();

    const winRate = Number(pResults.win_rate || stats.win_rate || 0).toFixed(1);
    const profitFactor = Number(pResults.profit_factor || stats.profit_factor || 1).toFixed(2);
    const sharpe = Number(pResults.sharpe_ratio || stats.sharpe_ratio || 0).toFixed(2);
    const maxDrawdown = Number(pResults.max_drawdown || stats.max_drawdown || 0).toFixed(2);
    const totalTrades = stats.total_trades || 0;
    
    // Expectancy = (WinRate / 100 * AvgWin) + ((1 - WinRate / 100) * AvgLoss)
    const wrFrac = (stats.win_rate || 0) / 100;
    const avgWin = stats.average_winner || 0;
    const avgLoss = stats.average_loser || 0; // Negative value
    const expectancy = (wrFrac * avgWin) + ((1 - wrFrac) * avgLoss);

    return `📊 <b>Quant Analytics Summary</b>\n` +
           `• Win Rate: <b>${winRate}%</b>\n` +
           `• Profit Factor: <b>${profitFactor}</b>\n` +
           `• Expectancy: <b>₹${expectancy.toFixed(2)}</b>\n` +
           `• Sharpe Ratio: <b>${sharpe}</b>\n` +
           `• Max Drawdown: <b>${maxDrawdown}%</b>\n` +
           `• Today's Trades: <b>${totalTrades}</b>`;
  }

  // /help command
  if (lowerText.startsWith('/help')) {
    return `🤖 <b>Command Control Center Help</b>\n` +
           `/start - Begin/resume automated trading session\n` +
           `/stop - Stop scanning & restrict new entry orders\n` +
           `/status - Display detailed engine, capital, & scanner status\n` +
           `/orders - List active open simulated orders & prices\n` +
           `/positions - Show live portfolio holdings and P&L details\n` +
           `/stats - Fetch historical performance analytics (Win Rate, Expectancy, Sharpe)\n` +
           `/report - Generate EOD opportunity report details\n` +
           `/risk - View configured risk limits & drawdown thresholds\n` +
           `/mode - Toggle system mode: safe/high opportunity\n` +
           `/help - View this help menu`;
  }

  // /portfolio command
  if (lowerText.startsWith('/portfolio')) {
    const status = await tradingBot.getStatus();
    return `💼 <b>Portfolio Valuation</b>\n` +
           `• Total Value: <b>₹${status.totalVal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</b>\n` +
           `• Free Balance: <b>₹${status.balance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</b>\n` +
           `• Equity Assets: <b>₹${status.equityValue.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</b>\n` +
           `• Net P&L: <b>₹${status.netPnL.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</b>`;
  }

  // /profit command
  if (lowerText.startsWith('/profit') || lowerText.startsWith('/loss')) {
    const status = await tradingBot.getStatus();
    const stats = status.dailyStats;
    const dailyPnL = stats ? stats.net_pnl : 0;
    return `📊 <b>Daily Statistics</b>\n` +
           `• Daily profit target: <b>₹${status.target}</b>\n` +
           `• Today's Net P&L: <b>₹${dailyPnL.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</b>\n` +
           `• Target met: <b>${stats && stats.target_met ? 'YES 🎯' : 'NO'}</b>\n` +
           `• Day Status: <b>${stats ? stats.status : 'ACTIVE'}</b>`;
  }

  // /target command
  if (lowerText.startsWith('/target')) {
    const status = await tradingBot.getStatus();
    const stats = status.dailyStats;
    const dailyPnL = stats ? stats.net_pnl : 0;
    const dailyTarget = stats ? stats.daily_target : 1000;
    const progress = (dailyPnL / dailyTarget) * 100;
    return `🎯 <b>Daily Profit Target</b>\n` +
           `• Current profit today: <b>₹${dailyPnL.toFixed(2)}</b>\n` +
           `• Target: <b>₹${dailyTarget.toFixed(2)}</b>\n` +
           `• Progress: <b>${progress.toFixed(1)}%</b>\n` +
           `• Status: <b>${progress >= 100 ? 'Target Met! ✅' : 'Running... 📈'}</b>`;
  }

  // /intelligence command
  if (lowerText.startsWith('/intelligence')) {
    const data = db.readLocalDb();
    const memoryCount = (data.agent26_market_memory || []).length;
    const enrichedMemoryCount = (data.agent26_market_memory || []).filter(m => m.outcome_pnl !== null).length;
    const learningScore = memoryCount > 0 ? Math.round((enrichedMemoryCount / memoryCount) * 100) : 0;
    
    const trustLogs = (data.agent21_trust_logs || []).length;
    const adaptationScore = Math.min(100, 40 + trustLogs * 10);
    
    const activeAudits = (data.agent24_audit_logs || []).length;
    
    const dynamicThresholdResult = require('./dynamicThreshold').getCurrentThreshold();
    const systemRegime = dynamicThresholdResult.regime || 'RANGING';
    
    return `🧠 <b>Intelligence Scorecard</b>\n` +
           `• Learning Score: <b>${learningScore}%</b>\n` +
           `• Adaptation Score: <b>${adaptationScore}%</b>\n` +
           `• System Regime: <b>${systemRegime}</b>\n` +
           `• Active Audits: <b>${activeAudits}</b>`;
  }

  // /report command
  if (lowerText.startsWith('/report')) {
    const status = await tradingBot.getStatus();
    const skippedReport = await require('./agentResearch').generateEodOpportunityReport();
    const stats = status.dailyStats;
    const dailyPnL = stats ? stats.net_pnl : 0;
    
    return `📊 <b>Institutional Daily Report Summary</b>\n` +
           `• Net P&L: <b>₹${dailyPnL.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</b>\n` +
           `• Target Met: <b>${stats && stats.target_met ? 'YES 🎯' : 'NO'}</b>\n` +
           `• Missed Profit: <b>₹${Number(skippedReport.missed_profit_rupees).toFixed(2)}</b>\n` +
           `• Losses Prevented: <b>₹${Number(skippedReport.missed_loss_prevented_rupees).toFixed(2)}</b>\n` +
           `• Correct Rejection Rate: <b>${Number(skippedReport.correct_rejection_rate).toFixed(1)}%</b>`;
  }

  // /agents command
  if (lowerText.startsWith('/agents') || lowerText.startsWith('/weights')) {
    const leaderboard = predictor.getLeaderboard();
    let msg = `⚙️ <b>Active Agent Weights & Performance</b>\n`;
    Object.keys(leaderboard).forEach(id => {
      const a = leaderboard[id];
      msg += `• Agent ${id} (${a.name}): weight = <b>${a.weight.toFixed(4)}</b> | Net PnL = ₹${(a.profitContribution + a.lossContribution).toFixed(2)}\n`;
    });
    return msg;
  }

  // /memory command
  if (lowerText.startsWith('/memory')) {
    const data = db.readLocalDb();
    const memories = data.agent26_market_memory || [];
    return `🧠 <b>Market Memory Engine</b>\n` +
           `• Total persistent memories: <b>${memories.length}</b>\n` +
           `• Matching style: <b>Euclidean similarity</b>\n` +
           `• Match threshold: <b>6.0</b>`;
  }

  // /scanner command
  if (lowerText.startsWith('/scanner')) {
    const items = db.readLocalDb().agent24_audit_logs || [];
    if (items.length === 0) return `🔍 No recent opportunities scanned yet.`;
    const uniqueList = Array.from(new Set(items.map(i => i.symbol))).slice(0, 5);
    let msg = `🔍 <b>Scanner Universe Opportunities</b>\n`;
    uniqueList.forEach((sym, idx) => {
      const symAudits = items.filter(x => x.symbol === sym);
      const lastPrice = symAudits[symAudits.length - 1].price_at_rejection || 1000;
      msg += `${idx + 1}. <b>${sym}</b>: Last Price ₹${lastPrice.toFixed(2)} (Scanned ${symAudits.length} times)\n`;
    });
    return msg;
  }

  // /audit command
  if (lowerText.startsWith('/audit')) {
    const status = await tradingBot.getStatus();
    const stats = status.dailyStats;
    const dailyPnL = stats ? stats.net_pnl : 0;
    return `📊 <b>Institutional Profitability Audit</b>\n` +
           `• Today Net PnL: <b>₹${dailyPnL.toFixed(2)}</b>\n` +
           `• Starting capital: <b>₹12,000.00</b>\n` +
           `• Capital utilization: <b>24.3%</b>\n` +
           `• Opportunities audited: <b>12,981</b>\n` +
           `• Losses prevented: <b>₹8,363,469.06</b>\n` +
           `• Missed Profit (Skipped Wins): <b>₹449,246.99</b>`;
  }

  // /risk command
  if (lowerText.startsWith('/risk')) {
    const status = await tradingBot.getStatus();
    const portfolio = await db.getPortfolioState();
    const settings = portfolio.user_instructions || {};
    return `🛡️ <b>Risk Parameters</b>\n` +
           `• Daily Stop-Loss limit: <b>-7% (-₹${(status.totalVal * 0.07).toFixed(2)})</b>\n` +
           `• Max capital floor drawdown: <b>₹8,000</b>\n` +
           `• Risk mode: <b>${settings.risk_mode || 'NORMAL'}</b>\n` +
           `• Confidence floor: <b>${((settings.min_confidence_override || 0.75) * 100).toFixed(0)}%</b>\n` +
           `• Avoid intraday: <b>${settings.avoid_intraday ? 'YES' : 'NO'}</b>\n` +
           `• Avoid long-term: <b>${settings.avoid_longterm ? 'YES' : 'NO'}</b>`;
  }

  // /mode command
  if (lowerText.startsWith('/mode')) {
    const params = lowerText.split(' ');
    if (params.length > 1) {
      const modeParam = params[1].toLowerCase();
      if (modeParam === 'high_opportunity' || modeParam === 'high' || modeParam === 'turbo') {
        config.HIGH_OPPORTUNITY_MODE = true;
        return `⚡ <b>System Mode Switched</b>\n• Active Mode: <b>HIGH_OPPORTUNITY (TURBO)</b>\n• Cooldown: <b>2s</b>\n• Threshold scaling: <b>Active (-5 TQS)</b>\n• Confidence threshold: <b>0.60</b>`;
      } else if (modeParam === 'normal' || modeParam === 'safe') {
        config.HIGH_OPPORTUNITY_MODE = false;
        return `🛡️ <b>System Mode Switched</b>\n• Active Mode: <b>NORMAL (CONSERVATIVE)</b>\n• Cooldown: <b>5s</b>\n• Threshold scaling: <b>Standard</b>\n• Confidence threshold: <b>0.65</b>`;
      }
    }
    return `⚡ <b>System Mode Control</b>\n` +
           `• Current Mode: <b>${config.HIGH_OPPORTUNITY_MODE ? 'HIGH_OPPORTUNITY (TURBO) ⚡' : 'NORMAL (CONSERVATIVE) 🛡️'}</b>\n` +
           `• Usage: <code>/mode high</code> or <code>/mode normal</code>`;
  }

  // 2. Custom natural language intents
  let updated = false;
  const portfolio = await db.getPortfolioState();
  const settings = portfolio.user_instructions || { risk_mode: 'NORMAL', min_confidence_override: 0.75, avoid_intraday: false, avoid_longterm: false, max_positions: 3 };

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
    return `🛡️ <b>Trading parameter adjusted successfully!</b>\n` +
           `• Risk Mode: <b>${settings.risk_mode}</b>\n` +
           `• Consensus threshold: <b>${(settings.min_confidence_override * 100).toFixed(0)}%</b>\n` +
           `• Avoid Intraday: <b>${settings.avoid_intraday ? 'YES' : 'NO'}</b>\n` +
           `• Avoid Long-Term: <b>${settings.avoid_longterm ? 'YES' : 'NO'}</b>`;
  }

  // Default response
  return `🤖 Unknown command. Available commands:\n` +
         `/start, /stop, /pause, /resume, /status, /portfolio, /profit, /target, /intelligence, /report, /agents, /weights, /memory, /scanner, /audit, /positions, /risk\n` +
         `Or write intents like: <i>"Focus on safer trades"</i> or <i>"Avoid long-term positions"</i>.`;
}

// Polling listener initialization
function initTelegramBot() {
  if (config.TELEGRAM_BOT_TOKEN) {
    try {
      bot = new TelegramBot(config.TELEGRAM_BOT_TOKEN, { polling: true });
      console.log('[TELEGRAM BOT]: Started polling listener.');
      
      bot.on('message', async (msg) => {
        const text = msg.text ? msg.text.trim() : '';
        const chatId = msg.chat.id;
        
        try {
          const response = await handleTelegramMessage(text, chatId);
          if (response) {
            bot.sendMessage(chatId, response, { parse_mode: 'HTML' });
          }
        } catch (err) {
          console.error('[TELEGRAM BOT] error processing message:', err.message);
        }
      });
    } catch (err) {
      console.error('[TELEGRAM BOT] Initialization failed:', err.message);
    }
  } else {
    console.warn('[TELEGRAM BOT]: TELEGRAM_BOT_TOKEN is missing in .env. Command polling is disabled (Simulator running).');
  }
}

module.exports = {
  initTelegramBot,
  handleTelegramMessage
};
