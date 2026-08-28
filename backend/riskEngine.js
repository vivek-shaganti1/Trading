// Advanced Sizing & Portfolio Risk Engine (Phase 19 Upgrade)
const db = require('./db');
const config = require('../shared/config');

const riskEngine = {
  // Check if target transaction complies with risk metrics and calculate dynamic sizing
  async evaluateTradeRisk({
    symbol,
    sector = 'OTHER',
    allocationPct = 10,
    portfolioValue = 100000,
    currentHoldings = [],
    posteriorWinProbability = 0.55,
    riskReward = 1.5,
    expectedDrawdown = 10,
    winningStreak = 0,
    losingStreak = 0,
    marketState = 'RANGING',
    volatility = 1.0,
    portfolioHeat = 0,
    correlation = 0.20,
    executionScore = 1.0,
    entryPrice = null,
    stopLossPrice = null
  }) {
    // 1. Enforce Daily Loss / Drawdown Limits
    const portfolio = await db.getPortfolioState();
    const balance = Number(portfolio.balance || config.INITIAL_CAPITAL);

    // 2. Kelly Criterion Sizing (Fractional Kelly)
    // Kelly Formula: f* = p - (1 - p) / b
    const b = Math.max(0.5, riskReward);
    const p = Math.max(0.1, Math.min(0.95, posteriorWinProbability));
    const rawKelly = p - (1 - p) / b;
    
    // Half-Kelly or Quarter-Kelly for conservative institutional risk management
    const fractionalFactor = 0.25; 
    let kellyFraction = Math.max(0.005, rawKelly * fractionalFactor); // min 0.5% risk
    
    // 3. Streak Adjustments (Drawdown Defense)
    let streakMultiplier = 1.0;
    if (losingStreak >= 2) {
      streakMultiplier = Math.max(0.3, 1 - 0.20 * losingStreak); // Reduce risk by 20% per consecutive loss
    } else if (winningStreak >= 3) {
      streakMultiplier = Math.min(1.3, 1 + 0.10 * winningStreak); // Scale up slightly during hot streak
    }

    // 4. Volatility Scaling
    let volatilityMultiplier = 1.0;
    if (volatility > 1.5) {
      volatilityMultiplier = 0.70; // High volatility reduces size
    } else if (volatility < 0.6) {
      volatilityMultiplier = 1.10; // Low volatility / stable regimes increase size slightly
    }

    // 5. Portfolio Heat & Correlation Dampening
    let heatMultiplier = 1.0;
    const maxHeat = 6.0; // max 6% combined risk
    if (portfolioHeat > 4.0) {
      heatMultiplier = 0.50; // Scale down risk when portfolio heat is high
    } else if (portfolioHeat > 2.0) {
      heatMultiplier = 0.80;
    }

    // Calculate final capital risk fraction
    let finalRiskFraction = kellyFraction * streakMultiplier * volatilityMultiplier * heatMultiplier * executionScore;
    
    // Cap risk per trade at 2.0% of portfolio capital (Standard institutional cap)
    const MAX_CAPITAL_RISK = 0.02;
    finalRiskFraction = Math.min(MAX_CAPITAL_RISK, Math.max(0.002, finalRiskFraction));

    // Convert risk fraction to allocation size (assuming distance to Stop Loss defines size)
    let adjustedSize = (finalRiskFraction / 0.02) * 20; // Default fallback
    if (entryPrice && stopLossPrice && entryPrice > stopLossPrice) {
      const slDistPct = (entryPrice - stopLossPrice) / entryPrice;
      // Size = finalRiskFraction / slDistPct
      adjustedSize = (finalRiskFraction / Math.max(0.005, slDistPct)) * 100;
    }
    adjustedSize = Math.max(5, Math.min(25, adjustedSize));

    // 6. Sector Exposure Constraints (Cap at 30% for Phase 19)
    const sectorExposure = currentHoldings
      .filter(h => h.symbol !== symbol)
      .reduce((sum, h) => {
        const hSector = h.sector || 'OTHER';
        if (hSector === sector) return sum + (h.allocationPct || 20);
        return sum;
      }, 0);

    const maxSectorAllocation = 30.0;
    if (sectorExposure + adjustedSize > maxSectorAllocation) {
      // Scale down to meet sector limits
      adjustedSize = maxSectorAllocation - sectorExposure;
      if (adjustedSize < 5) {
        return {
          approved: false,
          adjustedSize: 0,
          reason: `Sector ${sector} exposure limit exceeded (${(sectorExposure).toFixed(1)}% current, max: ${maxSectorAllocation}%).`
        };
      }
    }

    // 7. Max Portfolio Positions cap (Cap at 5 positions)
    if (currentHoldings.length >= 5) {
      return {
        approved: false,
        adjustedSize: 0,
        reason: `Maximum positions limit (5) reached.`
      };
    }

    return {
      approved: true,
      adjustedSize: parseFloat(adjustedSize.toFixed(2)),
      riskPercent: parseFloat((finalRiskFraction * 100).toFixed(3)),
      reason: 'Risk constraints approved with dynamic Kelly sizing.'
    };
  },

  // Emergency Panic Squared Off Trigger
  //
  // Previously called broker.placeOrder(), which does not exist on the broker
  // module (the method is executeOrder). Every iteration threw TypeError, the
  // error was swallowed, and the code then UNCONDITIONALLY cleared
  // holding_stocks — reporting a flat book while every real position was still
  // open at the broker. Now: sell via the real API, and only drop the positions
  // that actually sold.
  async triggerEmergencySquareOff(broker, activeHoldings = []) {
    console.warn('[RISK ENGINE] ⚠️ EMERGENCY PANIC SWITCH ACTIVATED! LIQUIDATING ALL POSITIONS.');
    const db = require('./db');

    const succeeded = [];
    const failed = [];

    for (const holding of activeHoldings) {
      const qty = holding.quantity;
      if (!qty || qty <= 0) continue;
      let sold = false;
      // Market orders can be rejected transiently (circuit limits, freeze
      // quantity, momentary auth failure). Retry before giving up — an
      // un-squared intraday position is a real financial exposure.
      for (let attempt = 1; attempt <= 3 && !sold; attempt++) {
        try {
          console.log(`[RISK ENGINE] Squaring off ${holding.symbol} (Qty: ${qty}) attempt ${attempt}/3...`);
          await broker.executeOrder(
            holding.symbol,
            'SELL',
            qty,
            holding.strategy || 'DAY_TRADING',
            'Emergency square-off'
          );
          sold = true;
        } catch (err) {
          console.error(`[RISK ENGINE] Square-off attempt ${attempt} failed for ${holding.symbol}: ${err.message}`);
          if (attempt < 3) await new Promise(r => setTimeout(r, 1500));
        }
      }
      if (sold) succeeded.push(holding.symbol);
      else failed.push(holding.symbol);
    }

    // executeOrder already removes filled positions from holding_stocks.
    // Never blank the ledger wholesale: anything that failed to sell is still a
    // live position and MUST stay on the book so the operator and the next tick
    // can see it.
    if (failed.length > 0) {
      const msg = `[RISK ENGINE] ❌ SQUARE-OFF INCOMPLETE. Still holding: ${failed.join(', ')}. Manual intervention required.`;
      console.error(msg);
      try {
        await db.logAlert('CRITICAL', msg);
        const alerts = require('./alerts');
        await alerts.sendTelegram(`🚨 <b>SQUARE-OFF FAILED</b>\nUnsold positions: <b>${failed.join(', ')}</b>\nThese are still open at the broker. Manual action required.`);
      } catch (e) {
        console.error('[RISK ENGINE] Failed to raise square-off alert:', e.message);
      }
    }

    console.log(`[RISK ENGINE] Emergency square-off complete. Sold: ${succeeded.length}, Failed: ${failed.length}.`);
    return { success: failed.length === 0, sold: succeeded, unsold: failed };
  }
};

module.exports = riskEngine;
