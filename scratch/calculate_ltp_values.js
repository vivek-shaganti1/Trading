const db = require('../db');
const marketData = require('../marketData');
const broker = require('../broker');

async function run() {
  await db.initPromise;
  const portfolio = await db.getPortfolioState();
  const holdings = portfolio.holding_stocks || [];
  console.log('Holdings in DB:', holdings);
  for (const h of holdings) {
    try {
      const price = marketData.getPrice(h.symbol);
      console.log(`Symbol: ${h.symbol} | Avg Price: ${h.avgPrice} | Live Price: ${price}`);
    } catch (e) {
      console.log(`Symbol: ${h.symbol} | avgPrice: ${h.avgPrice} | error: ${e.message}`);
    }
  }
  const val = await broker.getValuation();
  console.log('Broker Valuation:', val);
}

run();
