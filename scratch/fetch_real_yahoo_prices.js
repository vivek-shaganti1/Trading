// Using global fetch

const trades = [
  { symbol: 'JSWENERGY', entry: '2026-06-12T04:22:18.248Z', exit: '2026-06-12T04:34:47.078Z' },
  { symbol: 'HINDPETRO', entry: '2026-06-12T04:22:20.421Z', exit: '2026-06-12T04:34:50.833Z' },
  { symbol: 'BPCL', entry: '2026-06-12T04:22:22.264Z', exit: '2026-06-12T04:34:53.941Z' },
  { symbol: 'GUJGASLTD', entry: '2026-06-12T04:22:24.107Z', exit: '2026-06-12T04:34:57.210Z' },
  { symbol: 'TEXT3223', entry: '2026-06-12T04:22:25.938Z', exit: '2026-06-12T04:35:17.624Z' },
  { symbol: 'GAIL', entry: '2026-06-12T04:34:43.089Z', exit: '2026-06-12T04:35:18.428Z' }
];

async function getPriceAtTime(yahooSymbol, isoString) {
  const targetTime = new Date(isoString).getTime() / 1000;
  const period1 = Math.floor(targetTime - 300);
  const period2 = Math.floor(targetTime + 300);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSymbol}?period1=${period1}&period2=${period2}&interval=1m`;
  
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = await res.json();
    const result = json?.chart?.result?.[0];
    if (!result) return null;
    
    const timestamps = result.timestamp || [];
    const closes = result.indicators?.quote?.[0]?.close || [];
    
    let closestPrice = null;
    let minDiff = Infinity;
    
    for (let i = 0; i < timestamps.length; i++) {
      const diff = Math.abs(timestamps[i] - targetTime);
      if (diff < minDiff && closes[i] !== null && closes[i] !== undefined) {
        minDiff = diff;
        closestPrice = closes[i];
      }
    }
    return closestPrice ? parseFloat(closestPrice.toFixed(2)) : null;
  } catch (err) {
    return null;
  }
}

async function run() {
  for (const t of trades) {
    const yahooSymbol = t.symbol === 'TEXT3223' ? 'TEXT3223.NS' : `${t.symbol}.NS`;
    const entryPrice = await getPriceAtTime(yahooSymbol, t.entry);
    const exitPrice = await getPriceAtTime(yahooSymbol, t.exit);
    console.log(`${t.symbol} | entry_time=${t.entry} | entry_yahoo=${entryPrice} | exit_time=${t.exit} | exit_yahoo=${exitPrice}`);
  }
}

run().catch(console.error);
