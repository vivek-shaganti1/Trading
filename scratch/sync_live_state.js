const http = require('http');
const db = require('../backend/db');

function fetchStatus() {
  return new Promise((resolve, reject) => {
    http.get('http://localhost:3000/api/status', (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Failed to parse: ${e.message}`));
        }
      });
    }).on('error', reject);
  });
}

async function main() {
  console.log('Fetching live server state...');
  const status = await fetchStatus();
  
  const balance = Number(status.balance);
  const holdingStocks = status.holdingStocks || [];
  
  if (isNaN(balance) || balance <= 0) {
    throw new Error(`Invalid balance fetched: ${status.balance}`);
  }
  
  console.log(`Live Server Balance: ₹${balance}`);
  console.log(`Live Server Holdings Count: ${holdingStocks.length}`);
  
  console.log('Updating db.json and Postgres to match...');
  await db.initPromise;
  
  const currentDailyTarget = 1000;
  const netPnL = Number((balance - 12000).toFixed(2));
  
  await db.updatePortfolioState({
    balance: balance,
    holding_stocks: holdingStocks,
    equity_value: 0,
    lifetime_pnl: netPnL,
    current_daily_target: currentDailyTarget
  });
  
  console.log('Successfully synchronized database and local cache with live server state.');
  await db.close();
  process.exit(0);
}

main().catch((err) => {
  console.error('Sync failed:', err);
  process.exit(1);
});
