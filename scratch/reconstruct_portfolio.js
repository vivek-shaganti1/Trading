require('dotenv').config();
const { Client } = require('pg');
const broker = require('../backend/broker');

async function reconstruct() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  try {
    await client.connect();

    // 1. Fetch trade logs for today
    const res = await client.query(
      "SELECT * FROM trade_logs WHERE timestamp >= '2026-06-11 00:00:00+00' ORDER BY timestamp ASC"
    );
    const trades = res.rows;

    // 2. Fetch current db portfolio state
    const pStateRes = await client.query("SELECT * FROM portfolio_state WHERE id='default'");
    const dbState = pStateRes.rows[0];

    console.log('=== Step-by-Step Reconstruction ===');
    let cash = 12000.00;
    let holdings = {};
    let realizedPnL = 0.00;

    const timeline = [];

    for (const trade of trades) {
      const price = Number(trade.price);
      const qty = Number(trade.quantity);
      const val = price * qty;
      const action = trade.action;
      const symbol = trade.symbol;

      if (action === 'BUY') {
        cash -= val;
        if (!holdings[symbol]) {
          holdings[symbol] = { quantity: 0, totalCost: 0, avgPrice: 0 };
        }
        holdings[symbol].quantity += qty;
        holdings[symbol].totalCost += val;
        holdings[symbol].avgPrice = holdings[symbol].totalCost / holdings[symbol].quantity;
      } else if (action === 'SELL') {
        cash += val;
        if (holdings[symbol]) {
          const costBasis = holdings[symbol].avgPrice * qty;
          const profit = val - costBasis;
          realizedPnL += profit;

          holdings[symbol].quantity -= qty;
          holdings[symbol].totalCost -= costBasis;
          if (holdings[symbol].quantity <= 0) {
            delete holdings[symbol];
          } else {
            holdings[symbol].avgPrice = holdings[symbol].totalCost / holdings[symbol].quantity;
          }
        } else {
          console.warn(`Warning: SELL order for ${symbol} with no active holdings!`);
        }
      }

      timeline.push({
        id: trade.id,
        timestamp: trade.timestamp,
        symbol,
        action,
        qty,
        price,
        cash: cash.toFixed(2),
        holdings: JSON.parse(JSON.stringify(holdings))
      });
    }

    // 3. Get current LTPs and calculate unrealized PnL
    console.log('\n=== Reconstructed Holdings & Valuation ===');
    let equityValue = 0.00;
    let unrealizedPnL = 0.00;
    const currentHoldingsReconstructed = [];

    for (const [symbol, info] of Object.entries(holdings)) {
      const ltp = broker.getLTP(symbol) || info.avgPrice; // fallback to avgPrice if LTP unavailable
      const currentVal = info.quantity * ltp;
      const costVal = info.quantity * info.avgPrice;
      const uPnL = currentVal - costVal;

      equityValue += currentVal;
      unrealizedPnL += uPnL;

      currentHoldingsReconstructed.push({
        symbol,
        quantity: info.quantity,
        avgPrice: Number(info.avgPrice.toFixed(4)),
        ltp,
        costValue: Number(costVal.toFixed(2)),
        currentValue: Number(currentVal.toFixed(2)),
        unrealizedPnL: Number(uPnL.toFixed(2))
      });
    }

    const totalPortfolioValue = cash + equityValue;

    console.log('Reconstructed Timeline:', JSON.stringify(timeline, null, 2));
    console.log('\nReconstructed Holdings:', JSON.stringify(currentHoldingsReconstructed, null, 2));
    console.log('\nSummary:');
    console.log(`Reconstructed Cash: ₹${cash.toFixed(2)}`);
    console.log(`Reconstructed Realized PnL: ₹${realizedPnL.toFixed(2)}`);
    console.log(`Reconstructed Unrealized PnL: ₹${unrealizedPnL.toFixed(2)}`);
    console.log(`Reconstructed Equity Value: ₹${equityValue.toFixed(2)}`);
    console.log(`Reconstructed Total Portfolio Value: ₹${totalPortfolioValue.toFixed(2)}`);

    console.log('\n=== Dashboard State (Postgres portfolio_state) ===');
    console.log(JSON.stringify(dbState, null, 2));

  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}

reconstruct();
