function calculateICS(params) {
  let score = 0;
  score += (params.marketStructureScore || 50) * 0.15;
  score += (params.volumeScore || 50) * 0.10;
  score += (params.momentumScore || 50) * 0.10;
  score += (params.vwapPosition === 'above' ? 85 : 30) * 0.10;
  score += (params.emaAligned ? 90 : 40) * 0.10;
  score += (params.breakoutScore || 50) * 0.10;
  score += (params.srScore || 50) * 0.10;
  const rrScore = params.riskReward >= 2.0 ? 95 : (params.riskReward >= 1.5 ? 75 : 30);
  score += rrScore * 0.10;
  score += (params.consensusStrength * 100) * 0.15;
  
  let finalScore = Math.max(0, Math.min(100, Math.round(score)));
  let label = 'Reject';
  if (finalScore >= 80) label = 'Strong Buy';
  else if (finalScore >= 70) label = 'Buy';
  else if (finalScore >= 60) label = 'Watch';
  else if (finalScore >= 50) label = 'Weak';
  else label = 'Reject';
  
  return { score: finalScore, label, confidence: finalScore / 100 };
}

console.log(calculateICS({
  marketStructureScore: 85,
  volumeScore: 11,
  momentumScore: 80,
  vwapPosition: 'above', // 1374.51 < price
  emaAligned: true,
  breakoutScore: 50,
  srScore: 70,
  riskReward: 1.222,
  consensusStrength: 0.537 // Consensus score from the DB for ACC
}));
