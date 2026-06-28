// Institutional Confluence Score (ICS) Engine
function calculateICS({
  marketStructureScore, // 0-100
  volumeScore,          // 0-100
  momentumScore,        // 0-100
  vwapPosition,         // 'above' or 'below'
  emaAligned,           // boolean
  breakoutScore,        // 0-100
  srScore,              // 0-100 (support holds / resistance holds score)
  riskReward,           // float ratio
  consensusStrength,    // float 0.0 to 1.0 (agreement)
  marketRegime          // string (TRENDING_UP, TRENDING_DOWN, etc.)
}) {
  let score = 0;

  // 1. Market Structure (15% weight)
  score += (marketStructureScore || 50) * 0.15;

  // 2. Volume (10% weight)
  score += (volumeScore || 50) * 0.10;

  // 3. Momentum (10% weight)
  score += (momentumScore || 50) * 0.10;

  // 4. VWAP (10% weight)
  const vwapScore = vwapPosition === 'above' ? 85 : 30;
  score += vwapScore * 0.10;

  // 5. EMA Alignment (10% weight)
  const emaScore = emaAligned ? 90 : 40;
  score += emaScore * 0.10;

  // 6. Breakout Quality (10% weight)
  score += (breakoutScore || 50) * 0.10;

  // 7. Support Resistance holds (10% weight)
  score += (srScore || 50) * 0.10;

  // 8. Risk Reward (10% weight)
  const rrScore = riskReward >= 2.0 ? 95 : (riskReward >= 1.5 ? 75 : 30);
  score += rrScore * 0.10;

  // 9. Consensus Strength (15% weight)
  score += (consensusStrength * 100) * 0.15;

  // Round final score
  let finalScore = Math.max(0, Math.min(100, Math.round(score)));

  // Label interpretation mapping
  let label = 'Reject';
  if (finalScore >= 90) {
    label = 'Strong Buy';
  } else if (finalScore >= 80) {
    label = 'Buy';
  } else if (finalScore >= 70) {
    label = 'Watch';
  } else if (finalScore >= 60) {
    label = 'Weak';
  } else {
    label = 'Reject';
  }

  return {
    score: finalScore,
    label
  };
}

module.exports = {
  calculateICS
};
