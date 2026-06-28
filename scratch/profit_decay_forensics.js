const { Client } = require('pg');
require('dotenv').config();

async function runDecayForensics() {
  console.log("=== PROFIT DECAY FORENSICS START ===");
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  await client.connect();

  const audits = await client.query('SELECT * FROM agent24_audit_logs ORDER BY timestamp ASC').then(res => res.rows);
  
  const holdings = [
    { symbol: 'AXISBANK', entryPrice: 1324.50, quantity: 2, sector: 'BANKING' },
    { symbol: 'KOTAKBANK', entryPrice: 389.77, quantity: 12, sector: 'BANKING' },
    { symbol: 'ICICIBANK', entryPrice: 1331.00, quantity: 1, sector: 'BANKING' }
  ];

  console.log("Trade | Entry Price | Max Price | Current Price | Max Profit | Current Profit | Profit Surrendered | % Lost | Classification");
  console.log("---|---|---|---|---|---|---|---|---");

  holdings.forEach(h => {
    const symAudits = audits.filter(a => a.symbol === h.symbol && new Date(a.timestamp) >= new Date('2026-06-11T00:00:00Z'));
    const prices = symAudits.map(a => Number(a.current_price || a.price_at_rejection || h.entryPrice));
    
    const maxPrice = prices.length > 0 ? Math.max(...prices) : h.entryPrice;
    const currentPrice = prices.length > 0 ? Number(prices[prices.length - 1]) : h.entryPrice;

    const maxProfit = (maxPrice - h.entryPrice) * h.quantity;
    const currentProfit = (currentPrice - h.entryPrice) * h.quantity;
    const surrendered = maxProfit - currentProfit;
    const pctLost = maxProfit > 0 ? (surrendered / maxProfit) * 100 : 0;

    let classification = 'Optimal Exit';
    if (pctLost > 50) classification = 'Late Exit / Missed Exit';
    else if (pctLost > 0) classification = 'Acceptable Exit';
    
    console.log(`${h.symbol} | ₹${h.entryPrice.toFixed(2)} | ₹${maxPrice.toFixed(2)} | ₹${currentPrice.toFixed(2)} | ₹${maxProfit.toFixed(2)} | ₹${currentProfit.toFixed(2)} | ₹${surrendered.toFixed(2)} | ${pctLost.toFixed(1)}% | ${classification}`);
  });

  await client.end();
  console.log("=== PROFIT DECAY FORENSICS END ===");
}

runDecayForensics().catch(console.error);
