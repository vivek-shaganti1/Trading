/**
 * Dynamic TQS Threshold Engine
 * 
 * Calculates an optimal Trade Quality Score (TQS) threshold that adapts based on:
 * 1. Market regime (trending vs ranging) - from recent consensus_decisions
 * 2. Recent volatility - from scanner_rankings price spreads
 * 3. Sector strength - from agent24_audit_logs return data
 * 4. Recent performance - from trade_logs win/loss streak
 * 
 * Default starting threshold: 65 (based on audit data showing TQS 60-64 had +0.81% avg return)
 * Allowed range: [60, 85]
 */

const db = require('./db');

// ─── Constants ───────────────────────────────────────────────────────────────
const BASE_THRESHOLD = 65;
const MIN_THRESHOLD = 60;
const MAX_THRESHOLD = 85;
const REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// Adjustment magnitudes
const TRENDING_BONUS = -3;        // Lower threshold to capture more in trends
const VOLATILE_PENALTY = 5;       // Raise threshold during high volatility
const WIN_STREAK_BONUS = -2;      // Lower threshold while on a hot streak
const LOSE_STREAK_PENALTY = 5;    // Tighten threshold during drawdown
const SECTOR_STRENGTH_BONUS = -2; // Lower threshold for strong sectors

// Streak thresholds
const WIN_STREAK_MIN = 3;
const LOSE_STREAK_MIN = 2;

// Lookback windows
const CONSENSUS_LOOKBACK = 20;    // Last N consensus decisions to analyze
const AUDIT_LOOKBACK = 50;        // Last N audit logs for sector strength
const TRADE_LOOKBACK = 20;        // Last N trades for streak detection

// ─── Cached State ────────────────────────────────────────────────────────────
let cachedResult = null;
let lastRefreshTime = 0;

// ─── Analysis Functions ──────────────────────────────────────────────────────

/**
 * Determine market regime from recent consensus decisions.
 * TRENDING = >60% of recent consensuses show directional signals (BUY/SELL).
 * RANGING  = otherwise.
 */
function analyzeMarketRegime(consensusDecisions) {
  if (!consensusDecisions || consensusDecisions.length === 0) {
    return { regime: 'UNKNOWN', directionalPct: 0, sampleSize: 0 };
  }

  const recent = consensusDecisions.slice(-CONSENSUS_LOOKBACK);
  const directionalSignals = recent.filter(cd => {
    const decision = (cd.decision || '').toUpperCase();
    return decision === 'BUY' || decision === 'SELL' ||
           decision === 'STRONG_BUY' || decision === 'STRONG_SELL' ||
           decision.includes('LONG') || decision.includes('SHORT');
  });

  const directionalPct = (directionalSignals.length / recent.length) * 100;

  return {
    regime: directionalPct > 60 ? 'TRENDING' : 'RANGING',
    directionalPct: Math.round(directionalPct * 10) / 10,
    sampleSize: recent.length
  };
}

/**
 * Analyze volatility from scanner_rankings price spreads.
 * Looks at the spread between top and bottom ranked stocks.
 * VOLATILE = wide spreads, CALM = narrow spreads.
 */
function analyzeVolatility(scannerRankings) {
  if (!scannerRankings) {
    return { level: 'UNKNOWN', avgSpread: 0 };
  }

  const longs = scannerRankings.longs || [];
  const shorts = scannerRankings.shorts || [];
  const allEntries = [...longs, ...shorts];

  if (allEntries.length < 2) {
    return { level: 'UNKNOWN', avgSpread: 0 };
  }

  // Calculate price spreads from scanner data
  let totalSpread = 0;
  let spreadCount = 0;

  for (const entry of allEntries) {
    // Scanner entries may have high/low or price_change fields
    const high = Number(entry.high || entry.price_high || 0);
    const low = Number(entry.low || entry.price_low || 0);
    const price = Number(entry.price || entry.current_price || entry.ltp || 0);
    const change = Number(entry.change_pct || entry.pct_change || entry.change || 0);

    if (high > 0 && low > 0 && low !== high) {
      // Intraday range as percentage
      const spread = ((high - low) / low) * 100;
      totalSpread += Math.abs(spread);
      spreadCount++;
    } else if (Math.abs(change) > 0) {
      // Use absolute change as a volatility proxy
      totalSpread += Math.abs(change);
      spreadCount++;
    }
  }

  const avgSpread = spreadCount > 0 ? totalSpread / spreadCount : 0;

  // > 3% average spread = volatile market
  return {
    level: avgSpread > 3 ? 'VOLATILE' : 'CALM',
    avgSpread: Math.round(avgSpread * 100) / 100
  };
}

/**
 * Analyze sector strength from agent24_audit_logs.
 * HIGH = average return_pct > 1% across recent audits.
 */
function analyzeSectorStrength(auditLogs) {
  if (!auditLogs || auditLogs.length === 0) {
    return { strength: 'UNKNOWN', avgReturn: 0, sampleSize: 0 };
  }

  const recent = auditLogs.slice(-AUDIT_LOOKBACK);
  const withReturns = recent.filter(log =>
    log.return_pct !== null && log.return_pct !== undefined && !isNaN(Number(log.return_pct))
  );

  if (withReturns.length === 0) {
    return { strength: 'UNKNOWN', avgReturn: 0, sampleSize: 0 };
  }

  const avgReturn = withReturns.reduce((sum, log) => sum + Number(log.return_pct), 0) / withReturns.length;

  return {
    strength: avgReturn > 1 ? 'HIGH' : (avgReturn > 0 ? 'MODERATE' : 'WEAK'),
    avgReturn: Math.round(avgReturn * 100) / 100,
    sampleSize: withReturns.length
  };
}

/**
 * Detect win/loss streak from recent trade_logs.
 * Looks at sequential BUY→SELL pairs to determine P&L.
 */
function analyzePerformanceStreak(tradeLogs) {
  if (!tradeLogs || tradeLogs.length === 0) {
    return { winStreak: 0, loseStreak: 0, recentTrades: 0 };
  }

  // Get the most recent trades, sorted chronologically
  const recent = tradeLogs.slice(-TRADE_LOOKBACK);

  // Build trade outcomes from sequential BUY/SELL pairs
  const outcomes = [];
  const buyMap = {}; // symbol → last buy price

  for (const trade of recent) {
    const action = (trade.action || '').toUpperCase();
    const symbol = trade.symbol;
    const price = Number(trade.price || 0);

    if (action === 'BUY' && price > 0) {
      buyMap[symbol] = price;
    } else if (action === 'SELL' && price > 0 && buyMap[symbol]) {
      const buyPrice = buyMap[symbol];
      const pnlPct = ((price - buyPrice) / buyPrice) * 100;
      outcomes.push(pnlPct > 0 ? 'WIN' : 'LOSS');
      delete buyMap[symbol];
    }
  }

  if (outcomes.length === 0) {
    return { winStreak: 0, loseStreak: 0, recentTrades: 0 };
  }

  // Count current streak from the end
  let winStreak = 0;
  let loseStreak = 0;

  for (let i = outcomes.length - 1; i >= 0; i--) {
    if (outcomes[i] === 'WIN') {
      if (loseStreak > 0) break; // Streak broken
      winStreak++;
    } else {
      if (winStreak > 0) break; // Streak broken
      loseStreak++;
    }
  }

  return {
    winStreak,
    loseStreak,
    recentTrades: outcomes.length
  };
}

// ─── Core Threshold Calculation ──────────────────────────────────────────────

/**
 * Calculate the dynamic threshold from cached local DB data.
 * This is designed to be fast and synchronous — reads from the local JSON cache.
 */
function calculateThreshold() {
  const data = db.readLocalDb();

  // 1. Market regime analysis
  const regimeAnalysis = analyzeMarketRegime(data.consensus_decisions);

  // 2. Volatility analysis
  const volatilityAnalysis = analyzeVolatility(data.scanner_rankings);

  // 3. Sector strength analysis
  const sectorAnalysis = analyzeSectorStrength(data.agent24_audit_logs);

  // 4. Performance streak analysis
  const streakAnalysis = analyzePerformanceStreak(data.trade_logs);

  // ─── Build threshold based on state-based overrides ───
  let threshold = 65; // Default: Ranging market (TQS 65+)
  let state = 'RANGING';

  if (regimeAnalysis.regime === 'TRENDING') {
    threshold = 80; // Trending market (TQS 80+)
    state = 'TRENDING';
  }

  // Apply state overrides (Sector Strength and Volatility)
  if (sectorAnalysis.strength === 'HIGH') {
    threshold = 70; // Strong sector momentum override (TQS 70+)
    state = 'STRONG_SECTOR';
  }
  if (volatilityAnalysis.level === 'VOLATILE') {
    threshold = 75; // High volatility override to protect capital (TQS 75+)
    state = 'VOLATILE';
  }

  const clampedThreshold = Math.max(MIN_THRESHOLD, Math.min(MAX_THRESHOLD, threshold));

  const reasoning = `State: ${state} | Threshold: ${clampedThreshold} | Regime: ${regimeAnalysis.regime} | Volatility: ${volatilityAnalysis.level} | Sector: ${sectorAnalysis.strength}`;

  return {
    threshold: clampedThreshold,
    reasoning,
    regime: regimeAnalysis.regime,
    components: {
      base: threshold,
      marketRegime: regimeAnalysis,
      volatility: volatilityAnalysis,
      sectorStrength: sectorAnalysis,
      performanceStreak: streakAnalysis
    }
  };
}

// ─── Exported API ────────────────────────────────────────────────────────────

/**
 * Get the current dynamic threshold.
 * Uses a 5-minute cache for performance — safe to call synchronously from the bot tick loop.
 * 
 * @returns {{ threshold: Number, reasoning: String, regime: String, components: Object }}
 */
function getCurrentThreshold() {
  const now = Date.now();

  if (cachedResult && (now - lastRefreshTime) < REFRESH_INTERVAL_MS) {
    return cachedResult;
  }

  cachedResult = calculateThreshold();
  lastRefreshTime = now;

  return cachedResult;
}

/**
 * Save a threshold decision snapshot to the local db cache (and postgres if available).
 * Call this periodically (e.g., every tick or when threshold changes) for audit trail.
 * 
 * @returns {Promise<Object>} The saved history entry
 */
async function saveThresholdSnapshot() {
  const current = getCurrentThreshold();

  const entry = {
    threshold: current.threshold,
    regime: current.regime,
    volatility: current.components.volatility.level,
    sector_strength: current.components.sectorStrength.strength,
    reasoning: current.reasoning
  };

  return await db.saveThresholdHistory(entry);
}

/**
 * Force a refresh of the cached threshold (bypass the 5-minute cache).
 * Useful after significant market events or manual recalculation requests.
 * 
 * @returns {{ threshold: Number, reasoning: String, regime: String, components: Object }}
 */
function forceRefresh() {
  lastRefreshTime = 0;
  return getCurrentThreshold();
}

/**
 * Daily Learning Loop: Auto-adjust TQS thresholds based on completed trade profitability.
 * Groups completed trades by TQS bucket, calculates win rate & expectancy per bucket,
 * and adjusts the effective base threshold accordingly.
 * 
 * Rules:
 * - If a bucket has >= 5 trades and NEGATIVE expectancy, raise threshold above that bucket.
 * - If a bucket has >= 5 trades and POSITIVE expectancy, ensure threshold allows that bucket.
 * - Minimum 10 total completed trades required before any adjustment.
 * 
 * @returns {{ adjustedBase: Number, reasoning: String, bucketAnalysis: Object } | null}
 */
function learnFromCompletedTrades() {
  const data = db.readLocalDb();
  const completed = data.completed_trades || [];
  
  if (completed.length < 10) {
    return { adjustedBase: BASE_THRESHOLD, reasoning: `Insufficient data (${completed.length}/10 trades). Using default base ${BASE_THRESHOLD}.`, bucketAnalysis: {} };
  }

  const buckets = {
    '60-70': { trades: 0, wins: 0, totalPnL: 0, totalReturn: 0 },
    '70-80': { trades: 0, wins: 0, totalPnL: 0, totalReturn: 0 },
    '80-90': { trades: 0, wins: 0, totalPnL: 0, totalReturn: 0 },
    '90+':   { trades: 0, wins: 0, totalPnL: 0, totalReturn: 0 }
  };

  completed.forEach(t => {
    const tqs = Number(t.tqs || 65);
    let bucket = '60-70';
    if (tqs >= 90) bucket = '90+';
    else if (tqs >= 80) bucket = '80-90';
    else if (tqs >= 70) bucket = '70-80';

    buckets[bucket].trades++;
    if (t.net_pnl > 0) buckets[bucket].wins++;
    buckets[bucket].totalPnL += Number(t.net_pnl || 0);
    buckets[bucket].totalReturn += Number(t.return_pct || 0);
  });

  // Calculate expectancy per bucket
  const analysis = {};
  Object.keys(buckets).forEach(b => {
    const bkt = buckets[b];
    analysis[b] = {
      trades: bkt.trades,
      winRate: bkt.trades > 0 ? (bkt.wins / bkt.trades * 100).toFixed(1) : '0.0',
      expectancy: bkt.trades > 0 ? (bkt.totalPnL / bkt.trades).toFixed(2) : '0.00',
      totalPnL: bkt.totalPnL.toFixed(2),
      avgReturn: bkt.trades > 0 ? (bkt.totalReturn / bkt.trades).toFixed(2) : '0.00'
    };
  });

  // Determine optimal threshold
  const adjustments = [];
  let newBase = BASE_THRESHOLD;

  // Check from lowest to highest bucket
  const bucketRanges = [
    { key: '60-70', min: 60, max: 70 },
    { key: '70-80', min: 70, max: 80 },
    { key: '80-90', min: 80, max: 90 },
    { key: '90+',   min: 90, max: 100 }
  ];

  for (const range of bucketRanges) {
    const bkt = buckets[range.key];
    if (bkt.trades >= 5) {
      const expectancy = bkt.totalPnL / bkt.trades;
      if (expectancy < 0) {
        // This bucket is a loser — raise threshold above it
        if (range.max > newBase) {
          adjustments.push(`Bucket ${range.key} has negative expectancy (\u20b9${expectancy.toFixed(2)}), raising threshold to ${range.max}`);
          newBase = Math.max(newBase, range.max);
        }
      } else if (expectancy > 0) {
        // This bucket is profitable — ensure threshold captures it
        if (range.min < newBase) {
          adjustments.push(`Bucket ${range.key} is profitable (expectancy \u20b9${expectancy.toFixed(2)}), lowering threshold to ${range.min}`);
          newBase = Math.min(newBase, range.min);
        }
      }
    }
  }

  // Clamp
  newBase = Math.max(MIN_THRESHOLD, Math.min(MAX_THRESHOLD, newBase));
  
  const reasoning = adjustments.length > 0
    ? `Daily Learning: ${adjustments.join('; ')} → New effective base: ${newBase}`
    : `Daily Learning: No bucket has enough trades (5+) with clear edge. Keeping base at ${BASE_THRESHOLD}.`;

  // Persist the learned adjustment to the local db
  try {
    const dbData = db.readLocalDb();
    dbData.learned_base_threshold = newBase;
    dbData.learned_threshold_reasoning = reasoning;
    dbData.learned_threshold_updated = new Date().toISOString();
    db.writeLocalDb(dbData);
  } catch (e) {
    console.error('[DYNAMIC THRESHOLD] Failed to persist learned threshold:', e.message);
  }

  console.log(`[DYNAMIC THRESHOLD LEARNING] ${reasoning}`);
  console.log(`[DYNAMIC THRESHOLD LEARNING] Bucket Analysis:`, JSON.stringify(analysis, null, 2));

  // Force a cache refresh to pick up the new base
  lastRefreshTime = 0;

  return { adjustedBase: newBase, reasoning, bucketAnalysis: analysis };
}

module.exports = {
  getCurrentThreshold,
  saveThresholdSnapshot,
  forceRefresh,
  learnFromCompletedTrades,
  // Expose analysis functions for testing/debugging
  _internals: {
    analyzeMarketRegime,
    analyzeVolatility,
    analyzeSectorStrength,
    analyzePerformanceStreak,
    calculateThreshold,
    learnFromCompletedTrades,
    BASE_THRESHOLD,
    MIN_THRESHOLD,
    MAX_THRESHOLD
  }
};
