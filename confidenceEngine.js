// Confidence Calibration Engine
function calibrateConfidence({
  confidence,
  tqs,
  consensusAgreement, // float 0.0 to 1.0 representing proportion of agreement
  riskScore, // float 0.0 to 1.0 (higher is riskier)
  marketRegime, // string (e.g., VOLATILE, RANGING, TRENDING_UP)
  patternReliability = 1.0 // float 0.0 to 1.0
}) {
  let calibrated = confidence;

  // 1. TQS Constraint
  if (tqs < 75 && calibrated > 0.82) {
    calibrated = 0.82;
  }

  // 2. Consensus Constraint
  if (consensusAgreement < 0.70 && calibrated > 0.80) {
    calibrated = 0.80;
  }

  // 3. Risk Penalty
  if (riskScore > 0.60) {
    // Reduce confidence by up to 20% for high risk
    const penalty = (riskScore - 0.60) * 0.5; 
    calibrated -= penalty;
  }

  // 4. Market Regime Adjustments
  if (marketRegime === 'VOLATILE') {
    calibrated *= 0.85; // 15% reduction in volatile regimes
  } else if (marketRegime === 'LOW_VOLUME') {
    calibrated *= 0.90; // 10% reduction in low volume regimes
  }

  // 5. Pattern Reliability weight
  calibrated *= (0.8 + 0.2 * patternReliability);

  // Ensure bounds [0.0, 1.0]
  return Math.max(0.10, Math.min(1.00, parseFloat(calibrated.toFixed(4))));
}

module.exports = {
  calibrateConfidence
};
