const yahooTickers = ['RELIANCE.NS', 'TCS.NS', 'INFY.NS', 'HDFCBANK.NS'];

(async () => {
  console.log('--- YAHOO FINANCE LIVE CONNECTIVITY AUDIT ---');
  for (const ticker of yahooTickers) {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=5m&range=1d`;
    const start = Date.now();
    try {
      const res = await fetch(url);
      const latency = Date.now() - start;
      console.log(`\nTicker: ${ticker}`);
      console.log(`Endpoint: ${url}`);
      console.log(`HTTP Status: ${res.status}`);
      console.log(`Response Time: ${latency}ms`);
      
      if (res.ok) {
        const data = await res.json();
        const price = data?.chart?.result?.[0]?.meta?.regularMarketPrice;
        console.log(`Regular Market Price: ₹${price}`);
      } else {
        console.log('Failed to parse price data.');
      }
    } catch (err) {
      console.error(`Error connecting to Yahoo for ${ticker}:`, err.message);
    }
  }
  process.exit(0);
})();
