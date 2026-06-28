const db = require('../backend/db');

(async () => {
  await db.initPromise;
  const data = db.readLocalDb();
  console.log('=========================================');
  console.log('SYSTEM STATUS AUDIT');
  console.log('=========================================');
  console.log('Mode / Price Provider details:');
  console.log('Last Price Validation State:', JSON.stringify(data.lastPriceValidation, null, 2));
  console.log('Orders Rejected Today:', data.orders_rejected_today);
  console.log('Zero Qty Rejections:', data.zero_qty_rejections);
  console.log('-----------------------------------------');
  console.log('Latest 10 Trades in local JSON:');
  const trades = data.trade_logs || [];
  trades.slice(-10).forEach(t => {
    console.log(`- ${t.timestamp} | ${t.symbol} | ${t.action} | Price: ₹${t.price} | Mode: ${t.execution_mode || 'N/A'}`);
  });
  console.log('=========================================');
  process.exit(0);
})();
