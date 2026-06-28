/**
 * Execution Quality Engine for AGY-Trader (Phase 19)
 * Evaluates market friction, spread, latency, and expected slippage before executing orders.
 */

/**
 * Evaluates the execution quality for an upcoming order.
 * 
 * @param {Object} params
 * @param {string} params.symbol - Stock symbol
 * @param {number} params.bid - Current bid price
 * @param {number} params.ask - Current ask price
 * @param {number} params.avgVolume - Average daily volume
 * @param {number} params.orderSize - Intended quantity of shares to buy/sell
 * @param {number} params.latencyMs - Measured execution latency in milliseconds
 * @param {boolean} params.isGapOpen - True if trading near gap openings
 * @returns {Object} Execution evaluation report
 */
function evaluateExecutionQuality({
  symbol,
  bid,
  ask,
  avgVolume = 1000000,
  orderSize = 100,
  latencyMs = 85,
  isGapOpen = false
}) {
  if (!bid || !ask) {
    return {
      approved: false,
      score: 0,
      spreadPct: 0,
      expectedSlippagePct: 0,
      latencyScore: 0,
      fillProbability: 0,
      reason: 'No bid/ask quotes available'
    };
  }

  const mid = (bid + ask) / 2;
  const spread = ask - bid;
  const spreadPct = (spread / mid) * 100;

  // 1. Spread Score (lower is better, institutional threshold: spread < 0.20%)
  let spreadScore = 1.0;
  if (spreadPct > 0.01) {
    spreadScore = Math.max(0, 1 - (spreadPct / 0.30)); // 0 at 0.30% spread
  }

  // 2. Liquidity & Slippage (order size compared to daily volume)
  // Institutional rule: Order size should not exceed 1% of the 5-min volume or 0.05% of daily volume.
  const volumeParticipation = orderSize / avgVolume;
  let liquidityScore = 1.0 - (volumeParticipation * 10); // Penalty increases with participation rate
  liquidityScore = Math.max(0.1, Math.min(1.0, liquidityScore));

  const expectedSlippagePct = (spreadPct / 2) + (volumeParticipation * 0.5);

  // 3. Gap Risk & Timing
  let gapScore = 1.0;
  if (isGapOpen) {
    gapScore = 0.5; // High gap risk reduces quality score
  }

  // 4. Latency Score
  let latencyScore = 1.0;
  if (latencyMs > 500) {
    latencyScore = 0.2;
  } else if (latencyMs > 200) {
    latencyScore = 0.6;
  } else if (latencyMs > 100) {
    latencyScore = 0.85;
  }

  // 5. Fill Probability (depends on liquidity, spread, and latency)
  let fillProbability = 1.0 - (spreadPct * 1.5) - (latencyMs / 1000);
  fillProbability = Math.max(0.1, Math.min(1.0, fillProbability));

  // 6. Execution Cost (spread + commissions, estimated at 0.05% flat for premium broker)
  const estimatedCostPct = spreadPct + 0.05;

  // Compute final execution score (weighted average)
  const executionScore = (spreadScore * 0.35) + (liquidityScore * 0.30) + (latencyScore * 0.20) + (gapScore * 0.15);

  // Minimum threshold is 0.70 for institutional execution
  const approved = executionScore >= 0.70 && spreadPct < 0.25;

  let reason = 'Execution quality within limits';
  if (!approved) {
    if (spreadPct >= 0.25) {
      reason = `Spread too wide: ${spreadPct.toFixed(3)}% (limit: 0.25%)`;
    } else {
      reason = `Execution score too low: ${executionScore.toFixed(2)} (threshold: 0.70)`;
    }
  }

  return {
    approved,
    score: parseFloat(executionScore.toFixed(3)),
    spreadPct: parseFloat(spreadPct.toFixed(4)),
    expectedSlippagePct: parseFloat(expectedSlippagePct.toFixed(4)),
    latencyScore: parseFloat(latencyScore.toFixed(3)),
    fillProbability: parseFloat(fillProbability.toFixed(3)),
    estimatedCostPct: parseFloat(estimatedCostPct.toFixed(4)),
    reason
  };
}

module.exports = {
  evaluateExecutionQuality
};
