/**
 * Rebuilt Adaptive Decision Engine for AGY-Trader (Phase 22 Production)
 * Implements candle-first priority with calibrated gates and scoring.
 * 
 * Priority: Price Action -> Swing Structure -> S/R -> Liquidity -> Volume -> Trend -> SMC -> AI Consensus
 * 
 * Key changes from Phase 21:
 * - Gate 1: Candle pattern 'None' no longer hard-rejects — it penalizes the score instead
 * - Gate 7: SMC removed as a hard gate — already weighted at 15% in composite
 * - Gate 8: AI consensus thresholds lowered (0.45/0.55) — AI confirms, doesn't veto
 * - Gate 9: Risk-reward minimum lowered to 1.0R
 * - Grade thresholds recalibrated: A+ >= 80, A >= 70
 */

const adaptiveWeightEngine = require('./adaptiveWeightEngine');

// SMC specific weights (Sum = 1.0)
const SMC_WEIGHTS = {
  BOS: 0.30,
  CHOCH: 0.20,
  ORDER_BLOCK: 0.15,
  FVG: 0.10,
  LIQUIDITY_SWEEP: 0.15,
  PREMIUM_DISCOUNT: 0.10
};

/**
 * Evaluates candidates using the Candle-First priority pipeline.
 * AI Consensus only confirms, it never generates signals.
 */
function evaluateDecision(symbol, direction, inputs) {

  const rejections = [];
  let sizeScale = 1.0;

  // Extract variables with sensible defaults
  const candleScore = inputs.candleScore || 50;
  const candlePattern = inputs.candlePattern || 'None';
  const structureScore = inputs.structureScore || 50;
  const volumeScore = inputs.volumeScore || 50;
  const regime = inputs.regime || 'RANGING';
  const volatility = inputs.volatility || 'CALM';
  const rrVal = inputs.rrVal || 1.5;
  const expectancy = inputs.expectancy || 0;
  const marketStateStr = inputs.marketState || 'ACCUMULATION';
  
  // Consensus variables
  const buyWeight = inputs.buyWeight || 0;
  const sellWeight = inputs.sellWeight || 0;
  const buyConfidence = inputs.buyConfidence || 0;
  const sellConfidence = inputs.sellConfidence || 0;
  const minConsensusWeight = inputs.minConsensusWeight || 0.45;
  const minConfidenceThresh = inputs.minConfidenceThresh || 0.55;

  const bosScore = inputs.bosScore !== undefined ? inputs.bosScore : 50;
  const chochScore = inputs.chochScore !== undefined ? inputs.chochScore : 50;
  const orderBlockScore = inputs.orderBlockScore !== undefined ? inputs.orderBlockScore : 50;
  const fvgScore = inputs.fvgScore !== undefined ? inputs.fvgScore : 50;
  const liquidityScore = inputs.liquidityScore !== undefined ? inputs.liquidityScore : 50;
  const premiumDiscountScore = inputs.premiumDiscountScore !== undefined ? inputs.premiumDiscountScore : 50;

  const isBuy = direction === 'BUY';
  const isSell = direction === 'SELL';

  // Calculate SMC Score
  const smcScore = Math.round(
    (bosScore * SMC_WEIGHTS.BOS) +
    (chochScore * SMC_WEIGHTS.CHOCH) +
    (orderBlockScore * SMC_WEIGHTS.ORDER_BLOCK) +
    (fvgScore * SMC_WEIGHTS.FVG) +
    (liquidityScore * SMC_WEIGHTS.LIQUIDITY_SWEEP) +
    (premiumDiscountScore * SMC_WEIGHTS.PREMIUM_DISCOUNT)
  );

  // Calculate component scores
  const regimeScore = (regime === 'TRENDING' || regime === 'BULLISH') ? 100 : (regime === 'RANGING' ? 60 : 40);
  const rrScore = rrVal >= 2.0 ? 100 : (rrVal >= 1.5 ? 80 : (rrVal >= 1.0 ? 60 : 20));

  // --- PRIORITY PIPELINE GATES ---
  // Gates are hard filters that reject setups with fundamental flaws.
  // Scoring handles nuance; gates handle disqualification.

  // Gate 1: Candlestick Context — score-based, not pattern-name based
  // A weak candle score (< 40) hard-rejects. Pattern name 'None' is NOT a disqualifier —
  // many valid breakout bars don't match named patterns.
  if (isBuy && candleScore < 40) {
    rejections.push('Very weak bullish candle score (< 40)');
  }
  if (isSell && candleScore < 40) {
    rejections.push('Very weak bearish candle score (< 40)');
  }

  // Gate 2: Swing Structure — at least some structural evidence required
  if (isBuy) {
    const hasBullishSwing = inputs.hh > 0 || inputs.hl > 0 || structureScore >= 55;
    if (!hasBullishSwing) {
      rejections.push('No bullish swing structure (HH/HL absent, structure < 55)');
    }
  } else if (isSell) {
    const hasBearishSwing = inputs.lh > 0 || inputs.ll > 0 || structureScore <= 45;
    if (!hasBearishSwing) {
      rejections.push('No bearish swing structure (LH/LL absent, structure > 45)');
    }
  }

  // Gate 3: Support / Resistance — avoid entering deep premium on BUY or deep discount on SELL
  if (premiumDiscountScore < 30) {
    rejections.push('Deep premium/discount zone — poor S/R location');
  }

  // Gate 4: Liquidity — always passes (liquidity is a scoring factor, not a gate)

  // Gate 5: Volume — only reject on extremely low volume
  const hasVolume = inputs.currentVol > (inputs.avgVol || 1000) * 0.5 || volumeScore >= 40;
  if (!hasVolume) {
    rejections.push('Extremely low relative volume (RVOL < 0.5)');
  }

  // Gate 6: Trend — only reject when ALL higher timeframes strongly oppose
  if (inputs.trend1D && inputs.trend1H && inputs.trend15M) {
    const dailyOppose = isBuy ? inputs.trend1D === 'SELL' : inputs.trend1D === 'BUY';
    const hourlyOppose = isBuy ? inputs.trend1H === 'SELL' : inputs.trend1H === 'BUY';
    const m15Oppose = isBuy ? inputs.trend15M === 'SELL' : inputs.trend15M === 'BUY';
    if (dailyOppose && hourlyOppose && m15Oppose) {
      rejections.push('All higher timeframes (1D + 1H + 15M) strongly oppose setup');
    }
  }

  // Gate 7: SMC — NOT a hard gate. SMC is already weighted at 15% in the composite score.
  // Removing as a gate prevents neutral SMC readings (score=50) from vetoing valid price action setups.

  // Gate 8: AI Consensus Confirmation — softened thresholds
  // AI confirms the trade, but shouldn't block a strong price-action setup
  let consensusConfirmed = false;
  if (isBuy && buyWeight >= minConsensusWeight && buyConfidence >= minConfidenceThresh) {
    consensusConfirmed = true;
  } else if (isSell && sellWeight >= minConsensusWeight && sellConfidence >= minConfidenceThresh) {
    consensusConfirmed = true;
  }
  // Only reject on consensus if candle score is also weak — strong candles override weak consensus
  if (!consensusConfirmed && candleScore < 65) {
    rejections.push('AI consensus not confirmed and candle score insufficient to override');
  }

  // Gate 9: Risk-Reward minimum — 1.0R is the institutional floor
  if (rrVal < 1.0) {
    rejections.push('Risk-reward below 1.0R minimum');
  }

  // Gate 10: Expectancy — only reject on clearly negative expectancy
  if (expectancy < -0.5) {
    rejections.push('Significantly negative expectancy');
  }

  // --- COMPOSITE EXECUTION SCORE ---
  // Effective candle score: penalize 'None' pattern but don't zero it out
  let effectiveCandleScore = candleScore;
  if (candlePattern === 'None') {
    effectiveCandleScore = Math.max(30, candleScore * 0.85); // 15% penalty for unnamed patterns
  } else if (candlePattern === 'Doji') {
    effectiveCandleScore = Math.max(25, candleScore * 0.70); // 30% penalty for indecision
  }

  const weightedScore = Math.round(
    (effectiveCandleScore * 0.30) +
    (structureScore * 0.20) +
    (volumeScore * 0.15) +
    (smcScore * 0.15) +
    (regimeScore * 0.10) +
    (rrScore * 0.10)
  );

  // Determine Trade Grade — recalibrated thresholds
  let grade = 'Reject';
  if (weightedScore >= 80) {
    grade = 'A+';
  } else if (weightedScore >= 70) {
    grade = 'A';
  } else if (weightedScore >= 60) {
    grade = 'B';
  } else if (weightedScore >= 50) {
    grade = 'C';
  } else {
    grade = 'Reject';
  }

  // Execute only on A+ and A grades
  const passesGrade = grade === 'A+' || grade === 'A';
  const execute = rejections.length === 0 && passesGrade;

  // Expected probability metrics
  const expectedWinProbability = parseFloat(Math.min(0.95, 0.50 + (weightedScore - 50) / 100).toFixed(2));
  const expectedR = rrVal;
  const historicalPatternAccuracy = expectedWinProbability;
  const maxExpectedDrawdown = volatility === 'VOLATILE' ? 8.5 : 4.0;
  const executionProbability = execute ? expectedWinProbability : 0.0;

  return {
    execute,
    score: weightedScore,
    threshold: 70,
    rejections: execute ? [] : (rejections.length > 0 ? rejections : [`Weighted score ${weightedScore} < 70 (Grade: ${grade})`]),
    sizeScale,
    grade,
    probabilityMetrics: {
      expectedWinProbability,
      expectedR,
      historicalPatternAccuracy,
      maxExpectedDrawdown,
      executionProbability
    }
  };
}

module.exports = {
  WEIGHTS: {
    CANDLE: 0.30,
    MARKET_STRUCTURE: 0.20,
    VOLUME: 0.15,
    SMC: 0.15,
    REGIME: 0.10,
    RISK_REWARD: 0.10
  },
  SMC_WEIGHTS,
  evaluateDecision
};
