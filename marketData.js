const config = require('./config');
const providerHealth = require('./providerHealth');

const currentPrices = {};
const priceSources = {}; // Tracks the source mode ('LIVE' or 'SIMULATOR') for each cached price

const YAHOO_MAPPINGS = {
  'NIFTY50_MINI': '^NSEI',
  'RELIANCE': 'RELIANCE.NS',
  'TCS': 'TCS.NS',
  'HDFCBANK': 'HDFCBANK.NS',
  'INFOSYS': 'INFY.NS'
};

const marketData = {
  // Returns active system mode: 'LIVE' or 'SIMULATOR'
  getMode() {
    return config.BROKER_MODE === 'LIVE' ? 'LIVE' : 'SIMULATOR';
  },

  // Returns human readable provider name
  getProviderName() {
    return this.getMode() === 'LIVE' ? 'Yahoo Finance API' : 'Simulated Market Feed';
  },

  // Update cached price (used by scanner or active price feeds)
  updatePrice(symbol, price, sourceMode) {
    const expectedMode = this.getMode();
    if (sourceMode && sourceMode !== expectedMode) {
      throw new Error(`[MARKET DATA CORRUPTION] Active mode is ${expectedMode} but attempted to cache price for ${symbol} from source mode ${sourceMode}.`);
    }
    if (symbol && price > 0) {
      currentPrices[symbol] = parseFloat(Number(price).toFixed(2));
      priceSources[symbol] = sourceMode || expectedMode;
    }
  },

  // Get current Last Traded Price (LTP) with strict mode checks
  getPrice(symbol) {
    const expectedMode = this.getMode();

    // Verify cache source matches expected mode
    if (currentPrices[symbol]) {
      const actualSource = priceSources[symbol];
      if (actualSource !== expectedMode) {
        throw new Error(`[MARKET DATA CORRUPTION] Requested price for ${symbol} in ${expectedMode} mode, but cached price originated from ${actualSource} mode.`);
      }
      return currentPrices[symbol];
    }

    // Fallback: Generate price deterministically in SIMULATOR mode, or fetch from live Yahoo in LIVE mode
    if (expectedMode === 'SIMULATOR') {
      const priceSeed = (symbol.charCodeAt(0) * 10) % 1500 + 100;
      this.updatePrice(symbol, priceSeed, 'SIMULATOR');
      return priceSeed;
    } else {
      // In LIVE mode, if no cached price, throw error to prevent fallback to stale simulator pricing
      throw new Error(`[MARKET DATA FAILURE] Price for ${symbol} not found in active live cache.`);
    }
  },

  // Fetch or generate historical charts for technical indicators
  async getHistory(symbol, closesHistory = [], interval = '5m', range = '5d') {
    const expectedMode = this.getMode();

    if (expectedMode === 'SIMULATOR') {
      const seedShift = interval === '1h' ? 50 : (interval === '15m' ? 25 : 0);
      const priceSeed = ((symbol.charCodeAt(0) * 10) % 1500 + 100) + seedShift;
      const closes = [];
      const highs = [];
      const lows = [];
      const volumes = [];
      let currentPrice = priceSeed;
      const bias = (Math.sin(seedShift) * 0.05) / 100;

      for (let i = 0; i < 50; i++) {
        closes.unshift(parseFloat(currentPrice.toFixed(2)));
        highs.unshift(parseFloat((currentPrice * (1 + 0.003 * Math.random())).toFixed(2)));
        lows.unshift(parseFloat((currentPrice * (1 - 0.003 * Math.random())).toFixed(2)));
        volumes.unshift(Math.round(100000 + (i * 1000) % 50000 + Math.random() * 10000));
        
        const change = ((Math.random() * 0.3 - 0.15) / 100) + bias;
        currentPrice = currentPrice / (1 + change);
      }

      return { closes, highs, lows, volumes, source: 'SIMULATOR' };
    } else {
      // LIVE mode: Query Yahoo Finance API
      const yahooSymbol = symbol === 'NIFTY50_MINI' ? '^NSEI' : (symbol.endsWith('.NS') ? symbol : `${symbol}.NS`);
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSymbol}?interval=${interval}&range=${range}`;
      
      const startTime = Date.now();
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Yahoo HTTP error: ${res.status}`);
        const data = await res.json();
        providerHealth.recordCall('Yahoo', startTime, true, '200 OK');
        const quotes = data?.chart?.result?.[0]?.indicators?.quote?.[0] || {};
        
        const closes = (quotes.close || []).filter(c => c !== null && c !== undefined);
        const highs = (quotes.high || []).filter(h => h !== null && h !== undefined);
        const lows = (quotes.low || []).filter(l => l !== null && l !== undefined);
        const volumes = (quotes.volume || []).filter(v => v !== null && v !== undefined);

        if (closes.length < 26) {
          throw new Error(`Insufficient live historical points for interval ${interval} (need >= 26)`);
        }

        return { closes, highs, lows, volumes, source: 'LIVE' };
      } catch (err) {
        providerHealth.recordCall('Yahoo', startTime, false, err.message);
        throw new Error(`[MARKET DATA FAILURE] Failed to fetch live history for ${symbol} at interval ${interval}: ${err.message}`);
      }
    }
  },

  // Verify prices match within a 0.5% tolerance window
  validatePrice(symbol, testPrice) {
    try {
      const activePrice = this.getPrice(symbol);
      const diff = Math.abs(activePrice - testPrice);
      const diffPct = (diff / activePrice) * 100;
      return {
        valid: diffPct <= 0.5,
        differencePct: diffPct,
        activePrice,
        testPrice
      };
    } catch (e) {
      return { valid: false, error: e.message };
    }
  },

  // Get source mode of cached price
  getPriceSource(symbol) {
    return priceSources[symbol] || null;
  }
};

module.exports = marketData;
