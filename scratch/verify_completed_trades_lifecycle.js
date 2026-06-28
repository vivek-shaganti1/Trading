const tradingBot = require('../backend/tradingBot');
const db = require('../backend/db');
const predictor = require('../backend/predictor');
const broker = require('../backend/broker');
const config = require('../shared/config');

async function testLifecycle() {
  console.log('🚀 STARTING COMPLETED TRADES FULL LIFECYCLE VERIFICATION AUDIT...');
  console.log('==================================================================');

  // Initialize DB and weights
  await db.initPromise;
  await predictor.loadLeaderboardFromDb();

  // Reset bot state and clear any stale holding stocks from database to ensure isolated test
  tradingBot._resetLocalState();
  const dbData = db.readLocalDb();
  dbData.portfolio_state.holding_stocks = [];
  dbData.completed_trades = []; // Clear completed trades to test from zero
  dbData.trade_logs = []; // Clear trade logs to ensure clean matchmaking
  dbData.daily_stats = []; // Clear daily stats
  db.writeLocalDb(dbData);

  // Set mock time to premarket open first (09:00) to initialize daily stats cleanly
  tradingBot._setMockTime({
    hours: 9,
    minutes: 0,
    seconds: 0,
    dateStr: '2026-06-12',
    day: 1
  });
  
  await tradingBot.tick(); // Run premarket warmup which resets daily stats

  // Override prediction and scanner for ASIANPAINT
  const originalGetPrediction = predictor.getPrediction;
  predictor.getPrediction = async function(symbol, prices) {
    if (symbol === 'ASIANPAINT') {
      return {
        consensus: true,
        tradeQuality: 90,
        signal: 'BUY',
        confidence: 0.85,
        expectancyBeforeTrade: 0.95,
        participating_models: {
          agent1: { signal: 'BUY', confidence: 0.85 },
          agent4_technical: { signal: 'BUY', confidence: 0.85 },
          agent2_gemini: { signal: 'BUY', confidence: 0.85 }
        },
        reasoning: 'Mocked high conviction buy'
      };
    }
    return originalGetPrediction.call(predictor, symbol, prices);
  };

  const originalGetUniverse = broker.getUniversePriceData;
  broker.getUniversePriceData = async function() {
    return [
      { symbol: 'ASIANPAINT', price: 3000.00, change: 1.5, volume: 100000, high: 3010, low: 2980, ltp: 3000 }
    ];
  };

  const originalGetLTP = broker.getLTP;
  let mockLtp = 3000.00;
  broker.getLTP = function(symbol) {
    if (symbol === 'ASIANPAINT') {
      return mockLtp;
    }
    return originalGetLTP.call(broker, symbol);
  };

  // Set mock time to market hours (09:16)
  tradingBot._setMockTime({
    hours: 9,
    minutes: 16,
    seconds: 0,
    dateStr: '2026-06-12',
    day: 1
  });

  console.log('\n➡️ [TICK 1: BUY EXECUTION]');
  await tradingBot.tick(); // Trigger buy execution

  // Verify Buy Position
  const portfolio = await db.getPortfolioState();
  const holdings = portfolio.holding_stocks || [];
  console.log('Holdings after BUY tick:', holdings);
  const position = holdings.find(p => p.symbol === 'ASIANPAINT');
  if (!position) {
    console.error('❌ FAIL: ASIANPAINT position not added to portfolio.');
    process.exit(1);
  }
  console.log('✅ BUY execution successfully verified.');

  // Set mock LTP to exit price (+3% gain to hit target)
  mockLtp = 3090.00;
  
  // Set mock time slightly later (09:30)
  tradingBot._setMockTime({
    hours: 9,
    minutes: 30,
    seconds: 0,
    dateStr: '2026-06-12',
    day: 1
  });

  console.log('\n➡️ [TICK 2: SELL EXECUTION]');
  await tradingBot.tick(); // Trigger sell execution

  // Verify completed trade creation and matchmaking logic
  const completed = await db.getCompletedTrades();
  console.log('Completed Trades after SELL tick:', completed);
  
  if (completed.length === 0) {
    console.error('❌ FAIL: No completed trades recorded.');
    process.exit(1);
  }

  const trade = completed[0];
  const expectedGross = (3090.00 - 3000.00) * Number(position.quantity);
  const expectedTxCost = (3000.00 * position.quantity * 0.0005) + (3090.00 * position.quantity * 0.0005);
  const expectedNet = expectedGross - expectedTxCost;

  console.log('\n==================================================================');
  console.log('📊 LIFECYCLE METRICS VERIFICATION:');
  console.log(`- Symbol         : ${trade.symbol}`);
  console.log(`- Entry Price    : ₹${trade.entry_price} (Expected: 3000)`);
  console.log(`- Exit Price     : ₹${trade.exit_price} (Expected: 3090)`);
  console.log(`- Quantity       : ${trade.quantity}`);
  console.log(`- Gross PnL      : ₹${trade.gross_pnl} (Expected: ₹${expectedGross.toFixed(2)})`);
  console.log(`- Net PnL        : ₹${trade.net_pnl} (Expected: ₹${expectedNet.toFixed(2)})`);
  console.log(`- Return %       : ${trade.return_pct.toFixed(2)}% (Expected: 3.00%)`);
  console.log(`- Holding Time   : ${trade.holding_minutes} mins (Expected: 14 mins)`);
  console.log(`- Execution Mode : ${trade.execution_mode} (Expected: LEGACY or ADAPTIVE)`);

  if (trade.quantity <= 0) {
    console.error('❌ FAIL: Quantity cannot be zero or negative.');
    process.exit(1);
  }

  if (trade.entry_price !== 3000 || trade.exit_price !== 3090 || trade.gross_pnl !== expectedGross || trade.net_pnl <= 0) {
    console.error('❌ FAIL: Completed trade metrics calculation mismatch or zero real P&L.');
    process.exit(1);
  }
  console.log('✅ Completed trade metric calculations and real P&L verified.');

  // Verify dashboard stats derivation from completed_trades
  const stats = await db.getPaperTradingResults();
  console.log('\n📊 DASHBOARD STATS DERIVED FROM COMPLETED_TRADES:');
  console.log(`- Total Trades   : ${stats.total_trades}`);
  console.log(`- Win Rate       : ${stats.win_rate}%`);
  console.log(`- Profit Factor  : ${stats.profit_factor}`);
  console.log(`- Sharpe Ratio   : ${stats.sharpe_ratio}`);
  console.log(`- Max Drawdown   : ${stats.max_drawdown}%`);
  console.log(`- Net P&L        : ₹${stats.net_pnl}`);
  console.log(`- Verification   : ${stats.verification_status}`);

  if (stats.total_trades !== 1 || stats.win_rate !== 100 || stats.verification_status !== 'VERIFIED') {
    console.error('❌ FAIL: Dashboard metrics or verification status mismatch.');
    process.exit(1);
  }
  
  console.log('\n==================================================================');
  console.log('🟢 PASS: Full BUY -> HOLD -> SELL lifecycle succeeded without manual intervention.');
  console.log('==================================================================');

  // Restore mocks
  predictor.getPrediction = originalGetPrediction;
  broker.getUniversePriceData = originalGetUniverse;
  broker.getLTP = originalGetLTP;
  
  process.exit(0);
}

testLifecycle().catch(err => {
  console.error('❌ TEST CRASHED:', err);
  process.exit(1);
});
