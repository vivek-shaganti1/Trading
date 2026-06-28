/**
 * Institutional Stop & Target Engine for AGY-Trader (Phase 21 Rebuild)
 * Calculates logical invalidation levels (stops) and multiple targets based on structure and liquidity.
 */

function calculateStopsAndTargets({
  direction,
  entryPrice,
  structure,
  smcData,
  atr
}) {
  const isBuy = direction === 'BUY';
  const atrVal = atr || (entryPrice * 0.01); // fallback 1% ATR

  // Initialize candidates
  let stopCandidates = [];
  const obs = smcData?.orderBlocks || [];
  const fvgs = smcData?.fvgs || [];
  const liquidityPools = structure?.liquidityPools || [];
  const swings = structure?.swings || { highs: [], lows: [] };

  if (isBuy) {
    // Stop Loss candidates
    if (swings.lows && swings.lows.length > 0) {
      stopCandidates.push(swings.lows[swings.lows.length - 1].price);
    }
    obs.forEach(ob => {
      if (ob.type === 'BULLISH' && ob.price < entryPrice) stopCandidates.push(ob.price);
    });
    fvgs.forEach(fvg => {
      if (fvg.type === 'BULLISH' && fvg.low < entryPrice) stopCandidates.push(fvg.low);
    });

    const minStopDist = entryPrice * 0.005; // min 0.5% stop
    const maxStopDist = atrVal * 3.0; // max 3 ATR stop

    const validStops = stopCandidates.filter(p => p < entryPrice - minStopDist);
    let selectedStop = entryPrice - atrVal * 1.5;

    if (validStops.length > 0) {
      validStops.sort((a, b) => b - a); // nearest first
      selectedStop = validStops[0];
    }

    selectedStop = selectedStop - atrVal * 0.2; // apply buffer

    // Clamps
    if (entryPrice - selectedStop > maxStopDist) selectedStop = entryPrice - maxStopDist;
    if (entryPrice - selectedStop < minStopDist) selectedStop = entryPrice - minStopDist;

    const riskDistance = entryPrice - selectedStop;

    // Define multiple targets (Section 10)
    const target1 = entryPrice + riskDistance * 1.0;
    const target2 = entryPrice + riskDistance * 2.0;
    const target3 = entryPrice + riskDistance * 3.0;

    const calculatedRR = riskDistance > 0 ? (target2 - entryPrice) / riskDistance : 2.0;

    return {
      stopLoss: parseFloat(selectedStop.toFixed(2)),
      target: parseFloat(target2.toFixed(2)), // legacy field mapping
      target1: parseFloat(target1.toFixed(2)),
      target2: parseFloat(target2.toFixed(2)),
      target3: parseFloat(target3.toFixed(2)),
      riskReward: parseFloat(calculatedRR.toFixed(2))
    };

  } else {
    // Stop Loss candidates for SELL
    if (swings.highs && swings.highs.length > 0) {
      stopCandidates.push(swings.highs[swings.highs.length - 1].price);
    }
    obs.forEach(ob => {
      if (ob.type === 'BEARISH' && ob.price > entryPrice) stopCandidates.push(ob.price);
    });
    fvgs.forEach(fvg => {
      if (fvg.type === 'BEARISH' && fvg.high > entryPrice) stopCandidates.push(fvg.high);
    });

    const minStopDist = entryPrice * 0.005;
    const maxStopDist = atrVal * 3.0;

    const validStops = stopCandidates.filter(p => p > entryPrice + minStopDist);
    let selectedStop = entryPrice + atrVal * 1.5;

    if (validStops.length > 0) {
      validStops.sort((a, b) => a - b); // nearest first
      selectedStop = validStops[0];
    }

    selectedStop = selectedStop + atrVal * 0.2; // apply buffer

    // Clamps
    if (selectedStop - entryPrice > maxStopDist) selectedStop = entryPrice + maxStopDist;
    if (selectedStop - entryPrice < minStopDist) selectedStop = entryPrice + minStopDist;

    const riskDistance = selectedStop - entryPrice;

    // Define multiple targets
    const target1 = entryPrice - riskDistance * 1.0;
    const target2 = entryPrice - riskDistance * 2.0;
    const target3 = entryPrice - riskDistance * 3.0;

    const calculatedRR = riskDistance > 0 ? (entryPrice - target2) / riskDistance : 2.0;

    return {
      stopLoss: parseFloat(selectedStop.toFixed(2)),
      target: parseFloat(target2.toFixed(2)), // legacy mapping
      target1: parseFloat(target1.toFixed(2)),
      target2: parseFloat(target2.toFixed(2)),
      target3: parseFloat(target3.toFixed(2)),
      riskReward: parseFloat(calculatedRR.toFixed(2))
    };
  }
}

module.exports = {
  calculateStopsAndTargets
};
