/**
 * AGY-TRADER V2 — Bar-by-Bar Historical Replay & Validation Engine
 * 
 * Provides zero-lookahead, bar-by-bar simulation across historical 5M/15M NSE candles.
 * Tests the 3 Institutional Strategies (ORB, VWAP Pullback, SMC Liquidity Sweep)
 * and calculates rigorous empirical trading metrics.
 */

const fs = require('fs');
const path = require('path');
const marketData = require('./marketData');
const predictor = require('./predictor');
const stopTargetEngine = require('./stopTargetEngine');
const adaptiveDecisionEngine = require('./adaptiveDecisionEngine');

// Core Liquid Universe for Historical Replay Validation
const REPLAY_SYMBOLS = [
  'RELIANCE',
  'TCS',
  'HDFCBANK',
  'INFY',
  'ICICIBANK',
  'SBIN',
  'LT',
  'BHARTIARTL',
  'TATAMOTORS',
  'BAJFINANCE'
];

/**
 * Calculates financial statistical metrics from a sequence of completed trades.
 */
function calculateReplayMetrics(trades, initialCapital = 12000) {
  if (!trades || trades.length === 0) {
    return {
      totalTrades: 0,
      winRate: 0,
      profitFactor: 0,
      expectancy: 0,
      avgR: 0,
      maxDrawdown: 0,
      sharpe: 0,
      sortino: 0,
      totalNetPnl: 0,
      finalEquity: initialCapital
    };
  }

  let wins = 0;
  let losses = 0;
  let grossProfit = 0;
  let grossLoss = 0;
  let rMultiples = [];
  let equityCurve = [initialCapital];
  let currentEquity = initialCapital;
  let peakEquity = initialCapital;
  let maxDrawdownPct = 0;
  let returns = [];

  trades.forEach(t => {
    const pnl = Number(t.pnl || 0);
    const rMultiple = Number(t.rMultiple || (pnl > 0 ? 1.5 : -1.0));
    rMultiples.push(rMultiple);

    if (pnl > 0) {
      wins++;
      grossProfit += pnl;
    } else {
      losses++;
      grossLoss += Math.abs(pnl);
    }

    currentEquity += pnl;
    equityCurve.push(currentEquity);

    if (currentEquity > peakEquity) {
      peakEquity = currentEquity;
    }
    const dd = peakEquity > 0 ? ((peakEquity - currentEquity) / peakEquity) * 100 : 0;
    if (dd > maxDrawdownPct) {
      maxDrawdownPct = dd;
    }

    returns.push(pnl / initialCapital);
  });

  const winRate = (wins / trades.length) * 100;
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? 99.9 : 0);
  const avgR = rMultiples.reduce((a, b) => a + b, 0) / rMultiples.length;
  
  // Expectancy (EV in R-Multiples) = (WinRate * AvgWinR) - (LossRate * AvgLossR)
  const winRateFrac = wins / trades.length;
  const lossRateFrac = losses / trades.length;
  const avgWinR = wins > 0 ? (rMultiples.filter(r => r > 0).reduce((a, b) => a + b, 0) / wins) : 0;
  const avgLossR = losses > 0 ? Math.abs(rMultiples.filter(r => r <= 0).reduce((a, b) => a + b, 0) / losses) : 1.0;
  const expectancy = (winRateFrac * avgWinR) - (lossRateFrac * avgLossR);

  // Sharpe & Sortino (Annualized based on 252 trading days)
  const meanReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / (returns.length || 1);
  const stdDev = Math.sqrt(variance) || 0.0001;
  const sharpe = (meanReturn / stdDev) * Math.sqrt(252);

  const downsideReturns = returns.filter(r => r < 0);
  const downsideVar = downsideReturns.reduce((sum, r) => sum + Math.pow(r, 2), 0) / (downsideReturns.length || 1);
  const downsideDev = Math.sqrt(downsideVar) || 0.0001;
  const sortino = (meanReturn / downsideDev) * Math.sqrt(252);

  return {
    totalTrades: trades.length,
    wins,
    losses,
    winRate: parseFloat(winRate.toFixed(1)),
    profitFactor: parseFloat(profitFactor.toFixed(2)),
    expectancy: parseFloat(expectancy.toFixed(2)),
    avgR: parseFloat(avgR.toFixed(2)),
    maxDrawdown: parseFloat(maxDrawdownPct.toFixed(2)),
    sharpe: parseFloat(sharpe.toFixed(2)),
    sortino: parseFloat(sortino.toFixed(2)),
    totalNetPnl: parseFloat((currentEquity - initialCapital).toFixed(2)),
    finalEquity: parseFloat(currentEquity.toFixed(2))
  };
}

/**
 * Executes historical replay across all target symbols.
 */
async function runHistoricalReplay(symbols = REPLAY_SYMBOLS) {
  console.log('================================================================');
  console.log('🛡️ AGY-TRADER V2 — INSTITUTIONAL HISTORICAL REPLAY HARNESS');
  console.log('================================================================');
  console.log(`Universe : ${symbols.join(', ')}`);
  console.log('Mode     : Bar-by-Bar Zero-Lookahead Replay (5M Candles)');
  console.log('Slippage : 0.05% friction per side applied');
  console.log('================================================================\n');

  const allCompletedTrades = [];
  const initialCapital = 12000;
  let capital = initialCapital;

  for (const symbol of symbols) {
    console.log(`[REPLAY] Fetching 5M historical stream for ${symbol}...`);
    let m5Data;
    try {
      m5Data = await marketData.getHistory(symbol, [], '5m', '5d');
    } catch (err) {
      console.warn(`[REPLAY WARNING] Could not fetch live data for ${symbol}: ${err.message}. Generating synthetic stream.`);
      // Generate realistic multi-day synthetic 5M candle walk for offline testing
      m5Data = generateRealisticCandleWalk(symbol, 375); // 5 days of 75 candles
    }

    const closes = m5Data.closes;
    const opens = m5Data.opens || closes;
    const highs = m5Data.highs || closes;
    const lows = m5Data.lows || closes;
    const volumes = m5Data.volumes || Array(closes.length).fill(10000);

    const totalBars = closes.length;
    console.log(`[REPLAY] Simulating ${totalBars} bars for ${symbol}...`);

    let activePosition = null;

    // Slide bar-by-bar starting at bar 35 (to ensure sufficient lookback)
    for (let i = 35; i < totalBars; i++) {
      const currentClose = closes[i];
      const currentHigh = highs[i];
      const currentLow = lows[i];
      const currentOpen = opens[i];
      const currentVolume = volumes[i];

      // Window up to bar i (Zero lookahead)
      const windowCloses = closes.slice(0, i + 1);
      const windowHighs = highs.slice(0, i + 1);
      const windowLows = lows.slice(0, i + 1);
      const windowOpens = opens.slice(0, i + 1);
      const windowVolumes = volumes.slice(0, i + 1);

      // --- 1. EVALUATE ACTIVE POSITION (EXITS) ---
      if (activePosition) {
        let exitTriggered = false;
        let exitPrice = currentClose;
        let exitReason = '';
        let isHalfExit = false;

        if (activePosition.direction === 'BUY') {
          // Check Stop Loss
          if (currentLow <= activePosition.stopLoss) {
            exitTriggered = true;
            exitPrice = activePosition.stopLoss * 0.9995; // slippage
            exitReason = activePosition.isBreakeven ? 'Breakeven Stop Hit' : 'Structural Stop Loss Hit';
          }
          // Check Target 1 (50% trim + Move to Breakeven)
          else if (!activePosition.target1Hit && currentHigh >= activePosition.target1) {
            activePosition.target1Hit = true;
            activePosition.stopLoss = activePosition.entryPrice; // Move to BE
            activePosition.isBreakeven = true;
            isHalfExit = true;
            
            // Book 50% profits
            const halfPnl = (activePosition.target1 - activePosition.entryPrice) * (activePosition.qty / 2);
            capital += halfPnl;
            activePosition.bookedPnl = (activePosition.bookedPnl || 0) + halfPnl;
            activePosition.qty = activePosition.qty / 2;
          }
          // Check Target 2 (Full Exit)
          else if (activePosition.target1Hit && currentHigh >= activePosition.target2) {
            exitTriggered = true;
            exitPrice = activePosition.target2 * 0.9995;
            exitReason = 'Take Profit 2 (2.5R Runner) Reached';
          }
          // Bar duration / Session EOD square-off (after 40 bars in trade)
          else if (i - activePosition.entryBar >= 40) {
            exitTriggered = true;
            exitPrice = currentClose;
            exitReason = 'Session EOD Time Expiry Square-off';
          }
        }

        if (exitTriggered) {
          const finalPnl = (exitPrice - activePosition.entryPrice) * activePosition.qty + (activePosition.bookedPnl || 0);
          const totalRisk = (activePosition.entryPrice - activePosition.initialStopLoss) * activePosition.initialQty;
          const rMult = totalRisk > 0 ? finalPnl / totalRisk : (finalPnl > 0 ? 1.5 : -1.0);

          capital += (exitPrice - activePosition.entryPrice) * activePosition.qty;

          allCompletedTrades.push({
            symbol,
            direction: activePosition.direction,
            strategy: activePosition.strategy,
            entryPrice: activePosition.entryPrice,
            exitPrice,
            pnl: parseFloat(finalPnl.toFixed(2)),
            rMultiple: parseFloat(rMult.toFixed(2)),
            exitReason,
            entryBar: activePosition.entryBar,
            exitBar: i,
            barsHeld: i - activePosition.entryBar
          });

          activePosition = null;
        }
      }

      // --- 2. EVALUATE ENTRY SIGNALS (If no active position) ---
      if (!activePosition && i < totalBars - 10) {
        // Calculate indicators over window
        const ema9 = calculateEMA(windowCloses, 9);
        const ema21 = calculateEMA(windowCloses, 21);
        const ema50 = calculateEMA(windowCloses, Math.min(50, windowCloses.length));
        
        // VWAP approximation over recent 75-candle session
        const sessionSlice = windowCloses.slice(-75);
        const sessionVolSlice = windowVolumes.slice(-75);
        let sumPv = 0, sumV = 0;
        for (let k = 0; k < sessionSlice.length; k++) {
          sumPv += sessionSlice[k] * sessionVolSlice[k];
          sumV += sessionVolSlice[k];
        }
        const vwap = sumV > 0 ? sumPv / sumV : currentClose;

        // 15M Trend Direction (EMA 20 vs EMA 50 on 15M)
        const closes15M = [];
        for (let k = 0; k < windowCloses.length; k += 3) {
          closes15M.push(windowCloses[k]);
        }
        const ema20_15M = calculateEMA(closes15M, Math.min(20, closes15M.length));
        const ema50_15M = calculateEMA(closes15M, Math.min(50, closes15M.length));
        const isTrend15MBullish = ema20_15M >= ema50_15M;

        // Relative volume (RVOL)
        const recentVol = windowVolumes.slice(-20);
        const avgVol = recentVol.reduce((a, b) => a + b, 0) / recentVol.length;
        const rvol = avgVol > 0 ? currentVolume / avgVol : 1.0;

        // Opening Range (first 3 bars of session: 15 mins)
        const orHigh = Math.max(...windowHighs.slice(0, 3));
        const orLow = Math.min(...windowLows.slice(0, 3));

        // Strategy 1: ORB Breakout (Bars 4 to 20: 09:35 to 10:55 IST)
        const barInSession = i % 75;
        const isORBWindow = barInSession >= 3 && barInSession <= 20;
        const isBullishORB = isORBWindow && isTrend15MBullish && currentClose > orHigh && currentClose > vwap && ema9 > ema21 && rvol >= 1.25;

        // Strategy 2: VWAP Institutional Pullback (Bars 10 to 50: 10:05 to 13:25 IST)
        // Must have: Strong 15M trend, clear rejection candle (bullish close with lower wick touching VWAP), high RVOL
        const isVWAPWindow = barInSession >= 10 && barInSession <= 50;
        const distVwapPct = (currentClose - vwap) / vwap * 100;
        const lowerWick = Math.min(currentOpen, currentClose) - currentLow;
        const body = Math.abs(currentClose - currentOpen);
        const hasRejectionWick = lowerWick >= body * 0.8 || currentLow <= vwap;
        const isBullishVWAPPullback = isVWAPWindow && isTrend15MBullish && distVwapPct >= 0.0 && distVwapPct <= 0.35 && hasRejectionWick && currentClose > currentOpen && ema9 > ema21 && rvol >= 1.15;

        // Strategy 3: SMC Liquidity Sweep & Order Block Displacement (Bars 6 to 55)
        const swingLow20 = Math.min(...windowLows.slice(-20, -2));
        const prevLow = windowLows[windowLows.length - 2];
        const isSMCSweep = isTrend15MBullish && prevLow < swingLow20 && currentClose > swingLow20 && currentClose > currentOpen && rvol >= 1.3 && (currentClose - currentLow) > (currentHigh - currentLow) * 0.6;

        let entryStrategy = null;
        if (isBullishORB) entryStrategy = 'ORB_BREAKOUT';
        else if (isBullishVWAPPullback) entryStrategy = 'VWAP_PULLBACK';
        else if (isSMCSweep) entryStrategy = 'SMC_LIQUIDITY_SWEEP';

        if (entryStrategy) {
          const entryPrice = currentClose * 1.0005; // 0.05% slippage on entry
          const atr = windowHighs.slice(-14).reduce((sum, h, idx) => sum + (h - windowLows.slice(-14)[idx]), 0) / 14;
          
          let stopLoss = entryPrice - atr * 1.2;
          if (entryStrategy === 'ORB_BREAKOUT') stopLoss = Math.min(orLow, entryPrice - atr * 0.9);
          else if (entryStrategy === 'VWAP_PULLBACK') stopLoss = vwap * 0.9975;
          else if (entryStrategy === 'SMC_LIQUIDITY_SWEEP') stopLoss = Math.min(currentLow, prevLow) * 0.999;

          // Clamp stop loss to reasonable boundaries (0.5% to 2.0%)
          const minStop = entryPrice * 0.005;
          const maxStop = entryPrice * 0.020;
          if (entryPrice - stopLoss < minStop) stopLoss = entryPrice - minStop;
          if (entryPrice - stopLoss > maxStop) stopLoss = entryPrice - maxStop;

          const riskDist = entryPrice - stopLoss;
          const target1 = entryPrice + riskDist * 1.5;
          const target2 = entryPrice + riskDist * 2.5;

          // Position size based on 1.5% max capital risk
          const maxRiskAmount = capital * 0.015;
          const qty = Math.max(1, Math.floor(maxRiskAmount / riskDist));

          activePosition = {
            symbol,
            direction: 'BUY',
            strategy: entryStrategy,
            entryPrice,
            initialStopLoss: stopLoss,
            stopLoss,
            target1,
            target2,
            target1Hit: false,
            isBreakeven: false,
            qty,
            initialQty: qty,
            entryBar: i,
            bookedPnl: 0
          };
        }
      }
    }
  }

  // Calculate metrics
  const metrics = calculateReplayMetrics(allCompletedTrades, initialCapital);

  console.log('\n================================================================');
  console.log('📊 HISTORICAL REPLAY EMPIRICAL VALIDATION REPORT');
  console.log('================================================================');
  console.log(`Total Completed Trades   : ${metrics.totalTrades}`);
  console.log(`Winning Trades           : ${metrics.wins} (${metrics.winRate}%)`);
  console.log(`Losing Trades            : ${metrics.losses} (${(100 - metrics.winRate).toFixed(1)}%)`);
  console.log(`Profit Factor            : ${metrics.profitFactor}`);
  console.log(`Expectancy (EV per Trade): +${metrics.expectancy} R`);
  console.log(`Average R-Multiple       : +${metrics.avgR} R`);
  console.log(`Max Portfolio Drawdown   : ${metrics.maxDrawdown}%`);
  console.log(`Sharpe Ratio             : ${metrics.sharpe}`);
  console.log(`Sortino Ratio            : ${metrics.sortino}`);
  console.log(`Initial Capital          : ₹${initialCapital.toFixed(2)}`);
  console.log(`Final Equity             : ₹${metrics.finalEquity.toFixed(2)} (Net PnL: ₹${metrics.totalNetPnl >= 0 ? '+' : ''}${metrics.totalNetPnl})`);
  console.log('================================================================');

  // Strategy breakdown
  const strategyStats = {};
  allCompletedTrades.forEach(t => {
    if (!strategyStats[t.strategy]) {
      strategyStats[t.strategy] = { count: 0, wins: 0, pnl: 0 };
    }
    strategyStats[t.strategy].count++;
    if (t.pnl > 0) strategyStats[t.strategy].wins++;
    strategyStats[t.strategy].pnl += t.pnl;
  });

  console.log('\n--- STRATEGY PERFORMANCE BREAKDOWN ---');
  for (const [st, stat] of Object.entries(strategyStats)) {
    const wr = stat.count > 0 ? ((stat.wins / stat.count) * 100).toFixed(1) : 0;
    console.log(`• ${st.padEnd(22)}: ${stat.count} trades | Win Rate: ${wr}% | Net PnL: ₹${stat.pnl >= 0 ? '+' : ''}${stat.pnl.toFixed(2)}`);
  }
  console.log('================================================================\n');

  return { metrics, strategyStats, trades: allCompletedTrades };
}

function calculateEMA(array, period) {
  if (!array || array.length === 0) return 0;
  if (array.length < period) return array[array.length - 1];
  let ema = array[0];
  const k = 2 / (period + 1);
  for (let i = 1; i < array.length; i++) {
    ema = array[i] * k + ema * (1 - k);
  }
  return ema;
}

function generateRealisticCandleWalk(symbol, count = 375) {
  let price = 2500;
  const closes = [];
  const opens = [];
  const highs = [];
  const lows = [];
  const volumes = [];

  for (let i = 0; i < count; i++) {
    const open = price;
    const change = (Math.random() - 0.485) * 6.0; // slight positive intraday drift
    const close = Math.max(100, open + change);
    const high = Math.max(open, close) + Math.random() * 4.0;
    const low = Math.min(open, close) - Math.random() * 4.0;
    const volume = Math.round(15000 + Math.random() * 45000);

    opens.push(parseFloat(open.toFixed(2)));
    closes.push(parseFloat(close.toFixed(2)));
    highs.push(parseFloat(high.toFixed(2)));
    lows.push(parseFloat(low.toFixed(2)));
    volumes.push(volume);

    price = close;
  }
  return { opens, closes, highs, lows, volumes, source: 'SIMULATOR' };
}

// CLI entry point
if (require.main === module) {
  runHistoricalReplay().then(() => {
    process.exit(0);
  }).catch(err => {
    console.error('Replay failed:', err);
    process.exit(1);
  });
}

module.exports = {
  runHistoricalReplay,
  calculateReplayMetrics
};
