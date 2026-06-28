/**
 * Adaptive Weight Engine for AGY-Trader (Phase 19)
 * Dynamically rebalances and normalizes component weights based on the active market state.
 */

const STATES = {
  TRENDING_EXPANSION: 'TRENDING_EXPANSION',
  TRENDING_PULLBACK: 'TRENDING_PULLBACK',
  ACCUMULATION: 'ACCUMULATION',
  DISTRIBUTION: 'DISTRIBUTION',
  BREAKOUT: 'BREAKOUT',
  FALSE_BREAKOUT: 'FALSE_BREAKOUT',
  VOLATILITY_EXPANSION: 'VOLATILITY_EXPANSION',
  VOLATILITY_CONTRACTION: 'VOLATILITY_CONTRACTION',
  MEAN_REVERSION: 'MEAN_REVERSION',
  COMPRESSION: 'COMPRESSION',
  LIQUIDITY_SWEEP: 'LIQUIDITY_SWEEP',
  OPENING_AUCTION: 'OPENING_AUCTION',
  MIDDAY_DRIFT: 'MIDDAY_DRIFT',
  CLOSING_AUCTION: 'CLOSING_AUCTION',
  NEWS_DRIVEN: 'NEWS_DRIVEN'
};

/**
 * Returns normalized weight profile for a given market state.
 * @param {string} state - The active market state
 * @returns {Object} normalized weights summing to 1.0
 */
function getWeightsForState(state) {
  let weights = {
    CANDLE: 0.25,
    MARKET_STRUCTURE: 0.20,
    SMC: 0.20,
    VOLUME: 0.15,
    REGIME: 0.10,
    RISK_REWARD: 0.10
  };

  switch (state) {
    case STATES.TRENDING_EXPANSION:
    case STATES.TRENDING_PULLBACK:
      // Trend: 35%, Momentum (Regime): 20%, Market Structure: 20%, SMC: 10%, Candles: 10%, Volume: 5%
      weights = {
        CANDLE: 0.10,
        MARKET_STRUCTURE: 0.20,
        SMC: 0.10,
        VOLUME: 0.05,
        REGIME: 0.35, // Trend/Regime dominates
        RISK_REWARD: 0.20 // Momentum/RR
      };
      break;

    case STATES.ACCUMULATION:
    case STATES.DISTRIBUTION:
    case STATES.MEAN_REVERSION:
    case STATES.LIQUIDITY_SWEEP:
    case STATES.MIDDAY_DRIFT:
      // RANGING style: Candles: 30%, Liquidity (Structure): 25%, SMC: 20%, Volume: 15%, Trend (Regime): 10%
      weights = {
        CANDLE: 0.30,
        MARKET_STRUCTURE: 0.25,
        SMC: 0.20,
        VOLUME: 0.15,
        REGIME: 0.10,
        RISK_REWARD: 0.00
      };
      break;

    case STATES.BREAKOUT:
    case STATES.FALSE_BREAKOUT:
    case STATES.VOLATILITY_EXPANSION:
    case STATES.OPENING_AUCTION:
    case STATES.CLOSING_AUCTION:
    case STATES.NEWS_DRIVEN:
      // BREAKOUT style: Volume: 25%, Breakout Quality (Structure): 25%, SMC: 20%, Momentum (Regime): 15%, Candles: 10%, Risk (RR): 5%
      weights = {
        CANDLE: 0.10,
        MARKET_STRUCTURE: 0.25,
        SMC: 0.20,
        VOLUME: 0.25,
        REGIME: 0.15,
        RISK_REWARD: 0.05
      };
      break;

    case STATES.COMPRESSION:
    case STATES.VOLATILITY_CONTRACTION:
      // COMPRESSION style: Volume Compression: 30%, Structure: 25%, Candles: 20%, SMC: 15%, Momentum (Risk/Reward): 10%
      weights = {
        CANDLE: 0.20,
        MARKET_STRUCTURE: 0.25,
        SMC: 0.15,
        VOLUME: 0.30,
        REGIME: 0.00,
        RISK_REWARD: 0.10
      };
      break;
  }

  // Double check and enforce normalization to exactly 1.0 (100%)
  const sum = Object.values(weights).reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 1.0) > 0.0001) {
    const keys = Object.keys(weights);
    keys.forEach(k => {
      weights[k] = parseFloat((weights[k] / sum).toFixed(4));
    });
    
    // Adjust any small rounding error on the first key
    const finalSum = Object.values(weights).reduce((a, b) => a + b, 0);
    const diff = 1.0 - finalSum;
    if (diff !== 0) {
      weights[keys[0]] = parseFloat((weights[keys[0]] + diff).toFixed(4));
    }
  }

  return weights;
}

module.exports = {
  STATES,
  getWeightsForState
};
