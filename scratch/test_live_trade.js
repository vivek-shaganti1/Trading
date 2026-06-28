const db = require('../db');
const broker = require('../broker');
const agent17_execution = require('../agent17_execution');
const alerts = require('../alerts');

async function testLiveTradeLifecycle() {
  console.log('🏁 INITIATING LIVE TRADE LIFECYCLE AUDIT (TEST 2 & 3)...');
  console.log('====================================================\n');

  const symbol = 'EDELWEISS';
  
  // 1. Initial State
  const valA = await broker.getValuation();
  const portA = await db.getPortfolioState();
  
  console.log('Step 1: Initial Portfolio Accounting State:');
  console.log(`   - Cash Balance: ₹${valA.balance.toFixed(2)}`);
  console.log(`   - Equity Value: ₹${valA.equityValue.toFixed(2)}`);
  console.log(`   - Total Valuation: ₹${valA.totalVal.toFixed(2)}`);
  console.log(`   - Holdings count: ${valA.holdingStocks.length}`);
  console.log('');

  const price = broker.getLTP(symbol) || 1255.5;
  const qty = 1;
  const buyCost = price * qty;

  console.log(`Step 2: Placing BUY order for ${qty} Qty of ${symbol} @ ₹${price.toFixed(2)} (Estimated Cost: ₹${buyCost.toFixed(2)})...`);
  
  // Place BUY Order
  const buyResult = await agent17_execution.placeOrder(
    symbol,
    'BUY',
    qty,
    'CNC',
    `Audit Test BUY Entry Order`
  );

  console.log('BUY Order Response:', JSON.stringify(buyResult));
  console.log('');

  // 3. Post-BUY State
  const valB = await broker.getValuation();
  const portB = await db.getPortfolioState();

  console.log('Step 3: Post-BUY Portfolio Accounting State:');
  console.log(`   - Cash Balance: ₹${valB.balance.toFixed(2)} (Diff: -₹${(valA.balance - valB.balance).toFixed(2)})`);
  console.log(`   - Equity Value: ₹${valB.equityValue.toFixed(2)} (Diff: +₹${(valB.equityValue - valA.equityValue).toFixed(2)})`);
  console.log(`   - Total Valuation: ₹${valB.totalVal.toFixed(2)}`);
  console.log(`   - Holdings: ${JSON.stringify(valB.holdingStocks)}`);
  console.log('');

  // Verification 1
  const cashDecreased = valB.balance < valA.balance;
  const equityIncreased = valB.equityValue > valA.equityValue;
  const totalConsistent = Math.abs(valB.totalVal - valA.totalVal) < 1;

  if (cashDecreased && equityIncreased && totalConsistent) {
    console.log('✅ POST-BUY ACCOUNTING IS CORRECT');
  } else {
    console.error('❌ POST-BUY ACCOUNTING ERROR!');
    console.log(`Cash Decreased: ${cashDecreased}, Equity Increased: ${equityIncreased}, Total Consistent: ${totalConsistent}`);
    process.exit(1);
  }
  console.log('');

  // Wait 3 seconds
  console.log('Waiting 3 seconds before closing position...');
  await new Promise(r => setTimeout(r, 3000));
  console.log('');

  // 4. Place SELL Order to close
  const sellPrice = broker.getLTP(symbol) || price;
  console.log(`Step 4: Placing SELL order to liquidate ${qty} Qty of ${symbol} @ ₹${sellPrice.toFixed(2)}...`);
  
  const sellResult = await agent17_execution.placeOrder(
    symbol,
    'SELL',
    qty,
    'CNC',
    `Audit Test SELL Liquidation Order`
  );
  
  console.log('SELL Order Response:', JSON.stringify(sellResult));
  console.log('');

  // 5. Post-SELL State
  const valC = await broker.getValuation();
  
  console.log('Step 5: Post-SELL Portfolio Accounting State:');
  console.log(`   - Cash Balance: ₹${valC.balance.toFixed(2)} (Diff: +₹${(valC.balance - valB.balance).toFixed(2)})`);
  console.log(`   - Equity Value: ₹${valC.equityValue.toFixed(2)} (Diff: -₹${(valB.equityValue - valC.equityValue).toFixed(2)})`);
  console.log(`   - Total Valuation: ₹${valC.totalVal.toFixed(2)}`);
  console.log(`   - Holdings count: ${valC.holdingStocks.length}`);
  console.log('');

  // Verification 2
  const cashIncreased = valC.balance > valB.balance;
  const equityDecreased = valC.equityValue === 0;
  
  if (cashIncreased && equityDecreased) {
    console.log('✅ POST-SELL ACCOUNTING IS CORRECT');
  } else {
    console.error('❌ POST-SELL ACCOUNTING ERROR!');
    console.log(`Cash Increased: ${cashIncreased}, Equity Decreased: ${equityDecreased}`);
    process.exit(1);
  }
  console.log('');

  // 6. DB logs audit check
  console.log('Step 6: Verifying Database Trade Logs:');
  const freshTrades = await db.getTradeLogs(10);
  console.log('Latest Trade Logs inside DB:');
  freshTrades.slice(0, 2).forEach(t => {
    console.log(`  - [${t.timestamp}] ${t.action} ${t.symbol} Qty: ${t.quantity} @ ₹${t.price} | Reason: ${t.reason}`);
  });
  console.log('');

  // Send Telegram success alert
  await alerts.sendTelegram(`🧪 <b>LIFECYCLE ACCOUNTING TEST PASSED</b>\n\n- Symbol: ${symbol}\n- Qty: ${qty}\n- Buy Cash: ₹${valB.balance.toFixed(2)} | Buy Equity: ₹${valB.equityValue.toFixed(2)}\n- Sell Cash: ₹${valC.balance.toFixed(2)} | Sell Equity: ₹${valC.equityValue.toFixed(2)}\n- Total Valuation: ₹${valC.totalVal.toFixed(2)}\n\n✅ Trade accounting verified successfully without page reload.`);

  console.log('====================================================');
  console.log('🏆 FINAL VERDICT:');
  console.log('====================================================');
  console.log('PASS');
  console.log('====================================================');
  process.exit(0);
}

testLiveTradeLifecycle().catch(e => {
  console.error(e);
  process.exit(1);
});
