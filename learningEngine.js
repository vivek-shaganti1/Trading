/**
 * Self-Learning Statistical Database Module for AGY-Trader (Phase 19)
 * Logs trade metrics, calculates rolling performance statistics, and updates probabilities.
 */

const db = require('./db');

/**
 * Records a trade outcome and updates rolling metrics.
 * @param {Object} trade - Complete trade object
 */
function recordTradeOutcome(trade) {
  try {
    const data = db.readLocalDb();
    data.learning_db = data.learning_db || { outcomes: [], stats: {} };
    
    // Add to outcomes list
    const outcome = {
      timestamp: new Date().toISOString(),
      symbol: trade.symbol,
      pattern: trade.candle_pattern || 'None',
      marketState: trade.market_state || 'RANGING',
      trend: trade.trend || 'NEUTRAL',
      volumeProfile: trade.volume_state || 'ACCUMULATION',
      smcFeatures: trade.smc_features || {},
      rr: Number(trade.risk_reward || 1.5),
      holdingTime: Number(trade.holding_minutes || 0),
      exitReason: trade.exit_reason || 'unknown',
      pnl: Number(trade.net_pnl || 0),
      rMultiple: Number(trade.r_multiple || 0),
      mfe: Number(trade.mfe || 0),
      mae: Number(trade.mae || 0)
    };
    
    data.learning_db.outcomes.push(outcome);
    
    // Recalculate stats for this setup key (pattern + marketState + trend combo)
    const setupKey = `${outcome.pattern}_${outcome.marketState}_${outcome.trend}`.toUpperCase();
    const related = data.learning_db.outcomes.filter(o => 
      o.pattern === outcome.pattern && 
      o.marketState === outcome.marketState && 
      o.trend === outcome.trend
    );
    
    const count = related.length;
    const wins = related.filter(o => o.pnl > 0).length;
    const winRate = count > 0 ? wins / count : 0.5;
    
    let totalWinSum = 0;
    let totalLossSum = 0;
    related.forEach(o => {
      if (o.pnl > 0) totalWinSum += o.pnl;
      else totalLossSum += Math.abs(o.pnl);
    });
    
    const profitFactor = totalLossSum > 0 ? totalWinSum / totalLossSum : totalWinSum;
    const expectancy = (winRate * (wins > 0 ? totalWinSum / wins : 0)) - ((1 - winRate) * (count - wins > 0 ? totalLossSum / (count - wins) : 0));
    const avgHoldingTime = related.reduce((sum, o) => sum + o.holdingTime, 0) / count;
    const avgRMultiple = related.reduce((sum, o) => sum + o.rMultiple, 0) / count;
    
    data.learning_db.stats[setupKey] = {
      pattern: outcome.pattern,
      marketState: outcome.marketState,
      trend: outcome.trend,
      sampleSize: count,
      winRate,
      profitFactor,
      expectancy,
      avgHoldingTime,
      avgRMultiple
    };
    
    db.writeLocalDb(data);
    console.log(`[LEARNING ENGINE] Logged trade outcome for ${trade.symbol}. Setup: ${setupKey} (sample: ${count}, winRate: ${(winRate*100).toFixed(1)}%, expectancy: ₹${expectancy.toFixed(2)})`);
  } catch (err) {
    console.error('[LEARNING ENGINE] Error recording trade outcome:', err.message);
  }
}

/**
 * Retrieves rolling stats for a specific setup pattern and context.
 * @param {string} pattern - Candle pattern name
 * @param {string} marketState - Classified market state
 * @param {string} trend - Active trend direction
 * @returns {Object} Setup statistics
 */
function getSetupStats(pattern, marketState, trend) {
  try {
    const data = db.readLocalDb();
    const setupKey = `${pattern || 'None'}_${marketState || 'RANGING'}_${trend || 'NEUTRAL'}`.toUpperCase();
    if (data.learning_db && data.learning_db.stats && data.learning_db.stats[setupKey]) {
      return data.learning_db.stats[setupKey];
    }
  } catch (e) {}
  
  // Default fallbacks if no history exists yet
  return {
    pattern: pattern || 'None',
    marketState: marketState || 'RANGING',
    trend: trend || 'NEUTRAL',
    sampleSize: 0,
    winRate: 0.55,
    profitFactor: 1.25,
    expectancy: 15.0,
    avgHoldingTime: 45.0,
    avgRMultiple: 0.15
  };
}

module.exports = {
  recordTradeOutcome,
  getSetupStats
};
