/**
 * Portfolio Manager Module for AGY-Trader (Phase 19)
 * Calculates portfolio-level metrics including VaR, CVaR, Expected Return, and risk budgets.
 */

const { evaluateCorrelation, STOCK_BETAS } = require('./portfolioCorrelationEngine');

/**
 * Evaluates whether adding a new trade to the portfolio worsens portfolio efficiency.
 * 
 * @param {Object} newTrade - { symbol, sector, expectedWinProb, riskReward, riskAmount }
 * @param {Array} currentPositions - Current open positions
 * @returns {Object} Evaluation report
 */
function evaluatePortfolioAddition(newTrade, currentPositions = []) {
  // Combine existing positions with the new one
  const allPositions = [...currentPositions, newTrade];

  // 1. Calculate Expected Return for each position
  // Return expectation is measured in R-units (scaled by riskAmount)
  const calculateExpectedReturn = (pos) => {
    const winProb = pos.expectedWinProb || 0.55;
    const rr = pos.riskReward || 1.5;
    const risk = pos.riskAmount || 1.0;
    // Expectancy per trade = (WinProb * RR - LossProb * 1) * riskAmount
    return ((winProb * rr) - ((1 - winProb) * 1.0)) * risk;
  };

  const currentExpectedReturn = currentPositions.reduce((sum, pos) => sum + calculateExpectedReturn(pos), 0);
  const newExpectedReturn = allPositions.reduce((sum, pos) => sum + calculateExpectedReturn(pos), 0);

  // 2. Calculate Portfolio Volatility & Value at Risk (VaR)
  // Let's assume standard asset vol based on Beta. Daily Volatility estimate = Beta * 1.5%
  const getAssetVol = (symbol) => {
    const symBase = symbol.split('.')[0];
    const beta = STOCK_BETAS[symBase] || 1.0;
    return beta * 0.015; // 1.5% daily vol standard deviation
  };

  // Compute portfolio variance using weights and sector correlations
  let portfolioVariance = 0;
  allPositions.forEach((p1) => {
    allPositions.forEach((p2) => {
      const vol1 = getAssetVol(p1.symbol);
      const vol2 = getAssetVol(p2.symbol);
      const w1 = p1.riskAmount || 1.0;
      const w2 = p2.riskAmount || 1.0;
      
      // Correlation coefficient
      let corr = 0.20;
      if (p1.symbol === p2.symbol) {
        corr = 1.0;
      } else if (p1.sector === p2.sector) {
        corr = 0.70;
      }
      
      portfolioVariance += w1 * w2 * vol1 * vol2 * corr;
    });
  });

  const portfolioVol = Math.sqrt(portfolioVariance);

  // Compute VaR at 95% confidence level (z = 1.645)
  // Parametric VaR = Volatility * 1.645
  const VaR_95 = portfolioVol * 1.645;

  // Compute Conditional VaR (CVaR) at 95% (average loss in worst 5% tails)
  // CVaR = Volatility * (pdf(z) / 0.05) where pdf(z) is standard normal density
  // For z = 1.645, CVaR coefficient is ~2.06 * Volatility
  const CVaR_95 = portfolioVol * 2.062;

  // 3. Measure portfolio efficiency (Sharpe proxy = Expected Return / VaR)
  const currentVol = currentPositions.length > 0 ? getPortfolioVol(currentPositions) : 0;
  const currentVaR = currentVol * 1.645;
  const currentEfficiency = currentVaR > 0 ? currentExpectedReturn / currentVaR : 0;
  const newEfficiency = VaR_95 > 0 ? newExpectedReturn / VaR_95 : 0;

  // 4. Sector Diversification Budget
  const sectorRiskBudget = {};
  allPositions.forEach(pos => {
    const sec = pos.sector || 'OTHER';
    sectorRiskBudget[sec] = (sectorRiskBudget[sec] || 0) + (pos.riskAmount || 1.0);
  });

  // Verify that the new trade doesn't degrade efficiency significantly if portfolio is large
  // Allow initial trades to form the portfolio, but once there are >= 2 trades, we watch efficiency.
  let approved = true;
  let reason = 'Portfolio efficiency and risk budget verified';

  if (currentPositions.length >= 2 && newEfficiency < currentEfficiency * 0.90) {
    approved = false;
    reason = `Trade reduces portfolio risk-adjusted return efficiency from ${currentEfficiency.toFixed(2)} to ${newEfficiency.toFixed(2)}`;
  }

  // Value at Risk threshold check (Max portfolio VaR allowed is 8% of portfolio)
  if (VaR_95 > 8.0) {
    approved = false;
    reason = `Value at Risk (95% VaR: ${VaR_95.toFixed(2)}%) exceeds risk tolerance limit of 8.0%`;
  }

  return {
    approved,
    expectedPortfolioReturn: parseFloat(newExpectedReturn.toFixed(4)),
    portfolioVolatility: parseFloat(portfolioVol.toFixed(4)),
    valueAtRisk: parseFloat(VaR_95.toFixed(4)),
    conditionalVaR: parseFloat(CVaR_95.toFixed(4)),
    efficiencyBefore: parseFloat(currentEfficiency.toFixed(4)),
    efficiencyAfter: parseFloat(newEfficiency.toFixed(4)),
    sectorRiskBudget,
    reason
  };
}

// Helper to compute volatility of current holdings
function getPortfolioVol(positions) {
  let variance = 0;
  const getAssetVol = (symbol) => {
    const symBase = symbol.split('.')[0];
    const beta = STOCK_BETAS[symBase] || 1.0;
    return beta * 0.015;
  };

  positions.forEach((p1) => {
    positions.forEach((p2) => {
      const vol1 = getAssetVol(p1.symbol);
      const vol2 = getAssetVol(p2.symbol);
      const w1 = p1.riskAmount || 1.0;
      const w2 = p2.riskAmount || 1.0;
      
      let corr = 0.20;
      if (p1.symbol === p2.symbol) corr = 1.0;
      else if (p1.sector === p2.sector) corr = 0.70;
      
      variance += w1 * w2 * vol1 * vol2 * corr;
    });
  });

  return Math.sqrt(variance);
}

module.exports = {
  evaluatePortfolioAddition
};
