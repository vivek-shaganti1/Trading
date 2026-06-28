/**
 * Bayesian Confidence Calibration Engine for AGY-Trader (Phase 19)
 * Calculates posterior win probabilities using prior history and contextual market evidence.
 */

const learningEngine = require('./learningEngine');

/**
 * Computes the Bayesian posterior win probability and expected outcomes.
 * 
 * @param {Object} params
 * @param {string} params.pattern - Candlestick pattern name
 * @param {Object} params.marketState - Output from marketStateClassifier
 * @param {Object} params.structure - Output from marketStructureHierarchy
 * @param {Object} params.context - Object containing RVOL, distances, session, etc.
 * @param {number} params.riskReward - Target risk-reward ratio (R)
 * @returns {Object} Bayesian confidence metrics
 */
function calculateBayesianConfidence({
  pattern,
  marketState,
  structure,
  context,
  riskReward = 1.5
}) {
  // 1. Retrieve prior from learning database
  const stats = learningEngine.getSetupStats(
    pattern, 
    marketState ? marketState.state : 'RANGING', 
    structure ? structure.internalTrend : 'NEUTRAL'
  );
  
  // Set prior win rate. Default is 0.55 if no sample size. Clamp prior to reasonable range.
  let priorWinRate = stats.sampleSize >= 3 ? stats.winRate : 0.55;
  priorWinRate = Math.max(0.35, Math.min(0.85, priorWinRate));
  
  // Prior Odds = P(Win) / P(Loss)
  let priorOdds = priorWinRate / (1 - priorWinRate);
  
  // 2. Compute Likelihood Ratios (LRs) based on current context
  let lrMarketState = 1.0;
  let lrStructure = 1.0;
  let lrLiquidity = 1.0;
  let lrVolume = 1.0;

  const isBuy = context.direction === 'LONG' || context.direction === 'BUY';

  // Market State Likelihood Ratio
  if (marketState) {
    const isPreferred = (isBuy && marketState.preferredStrategy === 'TREND_FOLLOWING' && structure?.internalTrend === 'BULLISH') ||
                        (!isBuy && marketState.preferredStrategy === 'TREND_FOLLOWING' && structure?.internalTrend === 'BEARISH') ||
                        (marketState.preferredStrategy === 'MEAN_REVERSION' && context.distanceFromVwap > 0.015);
                        
    const isProhibited = (isBuy && marketState.prohibitedStrategy === 'TREND_FOLLOWING' && structure?.internalTrend === 'BULLISH') ||
                         (!isBuy && marketState.prohibitedStrategy === 'TREND_FOLLOWING' && structure?.internalTrend === 'BEARISH');
    
    if (isPreferred) {
      lrMarketState = 1.35 * (0.5 + 0.5 * marketState.confidence);
    } else if (isProhibited) {
      lrMarketState = 0.50 / (0.5 + 0.5 * marketState.confidence);
    } else {
      lrMarketState = 1.0;
    }
  }

  // Market Structure Likelihood Ratio
  if (structure) {
    const trendAligned = (isBuy && structure.internalTrend === 'BULLISH') || (!isBuy && structure.internalTrend === 'BEARISH');
    const extTrendAligned = (isBuy && structure.externalTrend === 'BULLISH') || (!isBuy && structure.externalTrend === 'BEARISH');
    
    if (trendAligned && extTrendAligned) {
      lrStructure = 1.30;
    } else if (trendAligned) {
      lrStructure = 1.15;
    } else if (!trendAligned && !extTrendAligned) {
      lrStructure = 0.65;
    } else {
      lrStructure = 0.85;
    }

    // Swing strength & BOS/CHOCH confirm
    if (isBuy && structure.swings?.lastBOS === 'BULLISH') lrStructure *= 1.15;
    if (!isBuy && structure.swings?.lastBOS === 'BEARISH') lrStructure *= 1.15;
  }

  // Liquidity Context Likelihood Ratio
  if (context) {
    // Proximity to discount / premium zones
    if (isBuy) {
      if (context.isAtDiscount) {
        lrLiquidity = 1.35; // bullish entry at discount
      } else if (context.isAtPremium) {
        lrLiquidity = 0.70; // entering bullish at premium is risky
      }
    } else {
      if (context.isAtPremium) {
        lrLiquidity = 1.35;
      } else if (context.isAtDiscount) {
        lrLiquidity = 0.70;
      }
    }

    // Liquidity sweep confirmation
    if (context.liquiditySweepDetected) {
      lrLiquidity *= 1.25;
    }
  }

  // Volume Context Likelihood Ratio
  if (context && context.rvol !== undefined) {
    if (context.rvol > 2.0) {
      lrVolume = 1.25; // high volume confirmation
    } else if (context.rvol < 0.6) {
      lrVolume = 0.75; // thin volume breakout is often false
    }
    
    if (marketState?.state === 'COMPRESSION' && context.volatilityContraction) {
      lrVolume *= 1.15;
    }
  }

  // 3. Compute Posterior Odds & Posterior Win Probability
  let posteriorOdds = priorOdds * lrMarketState * lrStructure * lrLiquidity * lrVolume;
  
  // Convert Odds back to Probability: P = Odds / (1 + Odds)
  let posteriorWinProbability = posteriorOdds / (1 + posteriorOdds);
  posteriorWinProbability = Math.max(0.15, Math.min(0.95, posteriorWinProbability));

  // 4. Confidence Interval Calculation
  // Standard Error = sqrt( p*(1-p) / N ). If N is small, use 30 as a default sample denominator.
  const N = Math.max(15, stats.sampleSize || 20);
  const standardError = Math.sqrt((posteriorWinProbability * (1 - posteriorWinProbability)) / N);
  const zScore = 1.96; // 95% Confidence Level
  const marginOfError = zScore * standardError;
  const confidenceInterval = [
    Math.max(0.10, parseFloat((posteriorWinProbability - marginOfError).toFixed(4))),
    Math.min(0.98, parseFloat((posteriorWinProbability + marginOfError).toFixed(4)))
  ];

  // 5. Expected Win Probability (smoothed with prior, minimum 0.4 weight on live posterior metrics)
  const weight = Math.max(0.4, Math.min(0.8, stats.sampleSize / 30)); 
  const expectedWinProbability = (posteriorWinProbability * weight) + (priorWinRate * (1 - weight));

  // 6. Expected R Multiple (Expectancy)
  // Expectancy = (P(Win) * RR) - (P(Loss) * 1.0)
  const expectedR = (expectedWinProbability * riskReward) - ((1 - expectedWinProbability) * 1.0);

  // 7. Expected Drawdown Estimate
  // Estimate based on winning/losing probabilities and consecutive losses
  // Simple formula: MDD estimate = Risk_Per_Trade * ln(0.01) / ln(1 - ExpectedWinProb)
  // Let's assume standard 1% risk per trade.
  const ruinLosingStreak = Math.log(0.01) / Math.log(1 - expectedWinProbability);
  const expectedDrawdown = parseFloat((1.0 * ruinLosingStreak).toFixed(2)); // estimated max losing streak in % drawdown

  return {
    historicalPatternAccuracy: parseFloat(priorWinRate.toFixed(4)),
    posteriorWinProbability: parseFloat(posteriorWinProbability.toFixed(4)),
    confidenceInterval,
    expectedWinProbability: parseFloat(expectedWinProbability.toFixed(4)),
    expectedR: parseFloat(expectedR.toFixed(4)),
    expectedDrawdown: Math.min(30.0, expectedDrawdown) // cap estimated drawdown reporting to 30%
  };
}

module.exports = {
  calculateBayesianConfidence
};
