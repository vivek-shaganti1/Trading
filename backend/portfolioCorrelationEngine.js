/**
 * Portfolio Correlation Engine for AGY-Trader (Phase 19)
 * Calculates sector exposure, beta, correlation matrices, and portfolio heat limits.
 */

// Sector correlation mapping (static baseline coefficients between sectors)
const SECTOR_CORRELATION = {
  'BANKING': { 'BANKING': 1.0, 'FINANCE': 0.85, 'IT': 0.35, 'AUTO': 0.50, 'ENERGY': 0.40, 'PHARMA': 0.20, 'FMCG': 0.30, 'METALS': 0.55 },
  'FINANCE': { 'BANKING': 0.85, 'FINANCE': 1.0, 'IT': 0.30, 'AUTO': 0.45, 'ENERGY': 0.35, 'PHARMA': 0.25, 'FMCG': 0.35, 'METALS': 0.50 },
  'IT': { 'BANKING': 0.35, 'FINANCE': 0.30, 'IT': 1.0, 'AUTO': 0.30, 'ENERGY': 0.25, 'PHARMA': 0.40, 'FMCG': 0.45, 'METALS': 0.20 },
  'AUTO': { 'BANKING': 0.50, 'FINANCE': 0.45, 'IT': 0.30, 'AUTO': 1.0, 'ENERGY': 0.45, 'PHARMA': 0.30, 'FMCG': 0.40, 'METALS': 0.60 },
  'ENERGY': { 'BANKING': 0.40, 'FINANCE': 0.35, 'IT': 0.25, 'AUTO': 0.45, 'ENERGY': 1.0, 'PHARMA': 0.15, 'FMCG': 0.25, 'METALS': 0.50 },
  'PHARMA': { 'BANKING': 0.20, 'FINANCE': 0.25, 'IT': 0.40, 'AUTO': 0.30, 'ENERGY': 0.15, 'PHARMA': 1.0, 'FMCG': 0.50, 'METALS': 0.15 },
  'FMCG': { 'BANKING': 0.30, 'FINANCE': 0.35, 'IT': 0.45, 'AUTO': 0.40, 'ENERGY': 0.25, 'PHARMA': 0.50, 'FMCG': 1.0, 'METALS': 0.20 },
  'METALS': { 'BANKING': 0.55, 'FINANCE': 0.50, 'IT': 0.20, 'AUTO': 0.60, 'ENERGY': 0.50, 'PHARMA': 0.15, 'FMCG': 0.20, 'METALS': 1.0 }
};

// Stock beta estimates
const STOCK_BETAS = {
  'RELIANCE': 1.10, 'TCS': 0.80, 'HDFCBANK': 1.15, 'ICICIBANK': 1.25, 'INFY': 0.90,
  'HINDUNILVR': 0.60, 'ITC': 0.65, 'SBIN': 1.30, 'BHARTIARTL': 0.85, 'LTIM': 1.05,
  'TITAN': 0.95, 'NESTLEIND': 0.55, 'BAJAJFINSV': 1.20, 'TECHM': 0.98, 'HDFCLIFE': 0.80,
  'SBILIFE': 0.85, 'DIVISLAB': 0.75, 'APOLLOHOSP': 0.70, 'CIPLA': 0.65, 'GRASIM': 1.10,
  'DRREDDY': 0.60, 'EICHERMOT': 1.05, 'BPCL': 1.00, 'HEROMOTOCO': 0.90, 'TATACONSUM': 0.70,
  'BRITANNIA': 0.55, 'INDUSINDBK': 1.40, 'HINDALCO': 1.35, 'JSWSTEEL': 1.30, 'SHRIRAMFIN': 1.25
};

/**
 * Evaluates the correlation metrics of a proposed trade against current open portfolio positions.
 * 
 * @param {Object} newTrade - Proposed trade: { symbol, sector, riskAmount }
 * @param {Array} currentPositions - Array of current open trades/positions: [ { symbol, sector, riskAmount } ]
 * @param {number} maxSimultaneousRisk - Max allowable concurrent risk (default 6.0%)
 * @returns {Object} Correlation analysis result
 */
function evaluateCorrelation(newTrade, currentPositions = [], maxSimultaneousRisk = 6.0) {
  const newSector = newTrade.sector || 'OTHER';
  const newSymbol = newTrade.symbol || 'UNKNOWN';
  
  // 1. Sector Exposure Check
  const sectorCounts = {};
  let newSectorRisk = newTrade.riskAmount || 1.0;
  let totalPortfolioRisk = newSectorRisk;
  
  sectorCounts[newSector] = newSectorRisk;
  
  currentPositions.forEach(pos => {
    const sec = pos.sector || 'OTHER';
    const r = pos.riskAmount || 1.0;
    sectorCounts[sec] = (sectorCounts[sec] || 0) + r;
    totalPortfolioRisk += r;
  });

  // Limits
  const maxSectorRiskCap = 3.0; // Max 3% risk exposure per sector
  const currentSectorRisk = sectorCounts[newSector] || 0;
  const sectorRiskBreached = currentSectorRisk > maxSectorRiskCap;

  // 2. Portfolio Heat & Max Simultaneous Risk
  const heatBreached = totalPortfolioRisk > maxSimultaneousRisk;

  // 3. Pairwise Position Correlation Matrix
  const correlations = [];
  let sumCorrelation = 0;
  
  currentPositions.forEach(pos => {
    const secA = newSector;
    const secB = pos.sector || 'OTHER';
    let corrVal = 0.20; // default correlation
    
    if (SECTOR_CORRELATION[secA] && SECTOR_CORRELATION[secA][secB] !== undefined) {
      corrVal = SECTOR_CORRELATION[secA][secB];
    } else if (secA === secB) {
      corrVal = 1.0;
    }
    
    // If the exact same stock, correlation is 1.0
    if (newSymbol === pos.symbol) {
      corrVal = 1.0;
    }
    
    correlations.push({ withSymbol: pos.symbol, correlation: corrVal });
    sumCorrelation += corrVal;
  });

  const avgCorrelation = currentPositions.length > 0 ? sumCorrelation / currentPositions.length : 0.0;
  const highCorrelationBreached = avgCorrelation > 0.70; // Reject if average correlation is too high

  // 4. Beta Exposure
  const newBeta = STOCK_BETAS[newSymbol.split('.')[0]] || 1.0;
  let weightedBetaSum = newBeta * newSectorRisk;
  
  currentPositions.forEach(pos => {
    const symBase = pos.symbol.split('.')[0];
    const b = STOCK_BETAS[symBase] || 1.0;
    weightedBetaSum += b * (pos.riskAmount || 1.0);
  });

  const portfolioBeta = totalPortfolioRisk > 0 ? weightedBetaSum / totalPortfolioRisk : 1.0;
  const betaBreached = portfolioBeta > 1.40; // Avoid excessively high beta portfolio exposure (>1.4)

  const approved = !sectorRiskBreached && !heatBreached && !highCorrelationBreached && !betaBreached;
  
  let reason = 'Portfolio correlation and concentration metrics within limits';
  if (!approved) {
    if (heatBreached) reason = `Max portfolio heat limit exceeded: ${(totalPortfolioRisk).toFixed(2)}% risk (max: ${maxSimultaneousRisk}%)`;
    else if (sectorRiskBreached) reason = `Sector concentration limit exceeded for ${newSector}: ${currentSectorRisk.toFixed(2)}% risk (max: ${maxSectorRiskCap}%)`;
    else if (highCorrelationBreached) reason = `Correlated risk limit exceeded: avg correlation ${avgCorrelation.toFixed(2)} (max: 0.70)`;
    else if (betaBreached) reason = `Portfolio beta limit exceeded: ${portfolioBeta.toFixed(2)} (max: 1.40)`;
  }

  return {
    approved,
    totalPortfolioRisk: parseFloat(totalPortfolioRisk.toFixed(4)),
    portfolioBeta: parseFloat(portfolioBeta.toFixed(3)),
    avgCorrelation: parseFloat(avgCorrelation.toFixed(3)),
    sectorExposures: sectorCounts,
    correlationMatrix: correlations,
    reason
  };
}

module.exports = {
  evaluateCorrelation,
  STOCK_BETAS
};
