const db = require('../backend/db');
const predictor = require('../backend/predictor');
const dynamicThreshold = require('../backend/dynamicThreshold');
const agentResearch = require('../backend/agentResearch');

async function run() {
  console.log("=== CTO FORENSIC DATA ===");
  const data = db.readLocalDb();
  
  // 1. Trade history analysis
  const trades = data.trade_logs || [];
  console.log(`Total Trade Logs: ${trades.length}`);
  
  let totalWinPnL = 0;
  let totalLossPnL = 0;
  let wins = 0;
  let losses = 0;
  let holdingWins = 0;
  let holdingLosses = 0;

  // Process completed trades (sequential BUY -> SELL)
  // Let's pair them by symbol
  const symbolGroups = {};
  trades.forEach(t => {
    if (!symbolGroups[t.symbol]) symbolGroups[t.symbol] = [];
    symbolGroups[t.symbol].push(t);
  });

  const roundtrips = [];
  Object.keys(symbolGroups).forEach(sym => {
    const txs = symbolGroups[sym].sort((a,b) => new Date(a.timestamp) - new Date(b.timestamp));
    let entry = null;
    txs.forEach(t => {
      if (t.action === 'BUY') {
        entry = t;
      } else if (t.action === 'SELL' && entry) {
        const pnlMatch = t.reason ? t.reason.match(/PnL:\s*₹?(-?[\d.]+)/) : null;
        const pnl = pnlMatch ? parseFloat(pnlMatch[1]) : (t.price - entry.price) * t.quantity;
        roundtrips.push({ symbol: sym, entryPrice: entry.price, exitPrice: t.price, pnl });
        entry = null;
      }
    });
  });

  roundtrips.forEach(rt => {
    if (rt.pnl > 0) {
      wins++;
      totalWinPnL += rt.pnl;
    } else {
      losses++;
      totalLossPnL += Math.abs(rt.pnl);
    }
  });

  const totalRoundtrips = wins + losses;
  const winRate = totalRoundtrips > 0 ? wins / totalRoundtrips : 0.5;
  const avgWin = wins > 0 ? totalWinPnL / wins : 0;
  const avgLoss = losses > 0 ? totalLossPnL / losses : 0;
  const expectedProfit = (winRate * avgWin) - ((1 - winRate) * avgLoss);
  const profitFactor = totalLossPnL > 0 ? totalWinPnL / totalLossPnL : 1.0;

  console.log(`Wins: ${wins} | Losses: ${losses} | Win Rate: ${(winRate * 100).toFixed(1)}%`);
  console.log(`Avg Win: ₹${avgWin.toFixed(2)} | Avg Loss: ₹${avgLoss.toFixed(2)}`);
  console.log(`Expected Profit: ₹${expectedProfit.toFixed(2)} | Profit Factor: ${profitFactor.toFixed(2)}`);

  // 2. Skips/Opportunities skipped today (Agent 24)
  const audits = data.agent24_audit_logs || [];
  console.log(`\nMissed Opportunities Count: ${audits.length}`);
  let missedProfit = 0;
  let missedLoss = 0;
  audits.forEach(a => {
    const ret = a.return_pct || 0;
    const value = (a.price_at_rejection || 1000) * 10; // estimate size
    if (ret > 0) missedProfit += value * (ret / 100);
    else missedLoss += Math.abs(value * (ret / 100));
  });
  console.log(`Missed Profit (Skipped Wins): ₹${missedProfit.toFixed(2)}`);
  console.log(`Losses Prevented (Skipped Losses): ₹${missedLoss.toFixed(2)}`);

  // 3. Universe Size
  const scannedSymbols = new Set(audits.map(a => a.symbol));
  console.log(`\nUniverse: unique symbols scanned = ${scannedSymbols.size}`);
  
  // 4. Capital Utilization
  const portfolio = data.portfolio_state || {};
  const cash = portfolio.balance || 0;
  const holdingsVal = portfolio.equity_value || 0;
  const totalVal = cash + holdingsVal;
  const utilization = totalVal > 0 ? (holdingsVal / totalVal) * 100 : 0;
  console.log(`\nPortfolio Total: ₹${totalVal.toFixed(2)} | Cash: ₹${cash.toFixed(2)} | Holdings: ₹${holdingsVal.toFixed(2)}`);
  console.log(`Capital Utilization: ${utilization.toFixed(1)}%`);

  // 5. Memory matching influence
  const consensus = data.consensus_decisions || [];
  const memoryMatched = consensus.filter(c => c.participating_models?.learning_impact?.match_count > 0).length;
  console.log(`\nConsensus decisions: ${consensus.length}`);
  console.log(`Decisions influenced by analog memory: ${memoryMatched}`);
}

run().catch(console.error);
