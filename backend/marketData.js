const config = require('../shared/config');
const runtimeState = require('./runtimeState');

const currentPrices = {};
const priceSources = {}; // Tracks the source mode ('LIVE' or 'SIMULATOR') for each cached price

const YAHOO_MAPPINGS = {
  'NIFTY50_MINI': '^NSEI',
  'RELIANCE': 'RELIANCE.NS',
  'TCS': 'TCS.NS',
  'HDFCBANK': 'HDFCBANK.NS',
  'INFOSYS': 'INFY.NS'
};

// Response Caching Memory
const responseCache = {};

// Request Queueing / Throttling Memory
const requestQueue = [];
let isQueueProcessing = false;

// Request Budgeting (Max 180 requests per minute to prevent provider abuse)
const requestBudget = {
  maxPerMinute: 180,
  callsThisMinute: 0,
  resetTime: Date.now() + 60000
};

async function checkRequestBudget() {
  const now = Date.now();
  if (now > requestBudget.resetTime) {
    requestBudget.callsThisMinute = 0;
    requestBudget.resetTime = now + 60000;
  }
  if (requestBudget.callsThisMinute >= requestBudget.maxPerMinute) {
    const waitMs = Math.max(100, requestBudget.resetTime - now + 100);
    console.log(`[MARKET DATA BUDGET] Rate limit threshold reached (${requestBudget.maxPerMinute}/min). Pausing queue for ${waitMs}ms...`);
    await new Promise(r => setTimeout(r, waitMs));
    requestBudget.callsThisMinute = 0;
    requestBudget.resetTime = Date.now() + 60000;
  }
  requestBudget.callsThisMinute++;
}

// Sequential request processor with a 200ms spacing gap
function enqueueRequest(fetchFunction) {
  return new Promise((resolve, reject) => {
    requestQueue.push({ fetchFunction, resolve, reject });
    processRequestQueue();
  });
}

const { withResilience } = require('./resilience');

async function processRequestQueue() {
  if (isQueueProcessing || requestQueue.length === 0) return;
  isQueueProcessing = true;

  while (requestQueue.length > 0) {
    const { fetchFunction, resolve, reject } = requestQueue.shift();
    try {
      await checkRequestBudget();
      const result = await withResilience('yahoo', fetchFunction, 3, 500);
      resolve(result);
    } catch (err) {
      reject(err);
    }
    // Rate limit safeguard spacing
    await new Promise(r => setTimeout(r, 200));
  }

  isQueueProcessing = false;
}

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

    // In all modes (including SIMULATOR), we must use real live prices.
    // If no cached price, throw error to prevent fallback to stale simulator pricing
    throw new Error(`[MARKET DATA FAILURE] Price for ${symbol} not found in active live cache.`);
  },

  // Fetch historical charts for technical indicators
  async getHistory(symbol, closesHistory = [], interval = '5m', range = '5d') {
    // We always use LIVE market data, even if BROKER_MODE is SIMULATOR (paper trading)
    // 1. Response Caching Layer (1-minute TTL to block redundant queries within the same tick)
    const cacheKey = `${symbol}_${interval}_${range}`;
      const cached = responseCache[cacheKey];
      if (cached && (Date.now() - cached.timestamp < 60000)) {
        return cached.data;
      }

      // 2. Fetcher execution wrapped inside Throttle Queue
      const executionTask = async () => {
        let attempts = 0;
        const maxAttempts = 3;
        let backoffDelay = 500;
        let lastErr = null;

        while (attempts < maxAttempts) {
          attempts++;
          // Alternate endpoints for provider abstraction / load balancing
          const host = attempts % 2 === 1 ? 'query1.finance.yahoo.com' : 'query2.finance.yahoo.com';
          const yahooSymbol = YAHOO_MAPPINGS[symbol] || (symbol.endsWith('.NS') ? symbol : `${symbol}.NS`);
          const url = `https://${host}/v8/finance/chart/${yahooSymbol}?interval=${interval}&range=${range}`;
          const startTime = Date.now();

          try {
            const res = await fetch(url);
            if (res.status === 429) {
              console.warn(`[MARKET DATA 429] Rate limited on ${host} for ${symbol}. Retrying in ${backoffDelay}ms...`);
              await new Promise(r => setTimeout(r, backoffDelay));
              backoffDelay *= 2;
              continue;
            }
            if (!res.ok) throw new Error(`Yahoo HTTP error: ${res.status}`);

            const data = await res.json();
            const yahooLatencyMs = Date.now() - startTime;
            runtimeState.updateProviderHealth('Yahoo', startTime, true, '200 OK');
            runtimeState.updateProviderHealth('yahoo', yahooLatencyMs, true);

            const quotes = data?.chart?.result?.[0]?.indicators?.quote?.[0] || {};
            // Filter bar-wise, NOT field-wise. Yahoo emits null per-field on
            // illiquid bars; filtering each array independently shifted them
            // relative to each other, so candle[i] mixed the open of one bar
            // with the high of another. Every structural/ATR calculation
            // downstream was reading fabricated candles.
            const rawC = quotes.close || [], rawO = quotes.open || [],
                  rawH = quotes.high || [], rawL = quotes.low || [], rawV = quotes.volume || [];
            const closes = [], opens = [], highs = [], lows = [], volumes = [];
            for (let i = 0; i < rawC.length; i++) {
              const c = rawC[i], o = rawO[i], h = rawH[i], l = rawL[i], v = rawV[i];
              if (c == null || o == null || h == null || l == null) continue;
              closes.push(c); opens.push(o); highs.push(h); lows.push(l);
              volumes.push(v == null ? 0 : v);
            }

            if (closes.length < 26) {
              throw new Error(`Insufficient live historical points for interval ${interval} (need >= 26)`);
            }

            const formattedResult = { closes, opens, highs, lows, volumes, source: 'LIVE' };
            // Cache the result
            responseCache[cacheKey] = { timestamp: Date.now(), data: formattedResult };
            return formattedResult;

          } catch (err) {
            lastErr = err;
            const yahooErrLatencyMs = Date.now() - startTime;
            runtimeState.updateProviderHealth('Yahoo', startTime, false, err.message);
            runtimeState.updateProviderHealth('yahoo', yahooErrLatencyMs, false);
            // Exponential backoff delay
            await new Promise(r => setTimeout(r, backoffDelay));
            backoffDelay *= 2;
          }
        }

        // --- ZERODHA KITE FALLBACK FOR PRODUCTION LIVE MODE ---
        if (config.KITE_API_KEY && config.KITE_ACCESS_TOKEN) {
          try {
            console.log(`[MARKET DATA FAILOVER] Attempting fallback query to Zerodha Kite Connect for ${symbol}...`);
            const url = `https://api.kite.trade/quote?i=NSE:${symbol}`;
            const startTime = Date.now();
            const res = await fetch(url, {
              headers: {
                'X-Kite-Version': '3',
                'Authorization': `token ${config.KITE_API_KEY}:${config.KITE_ACCESS_TOKEN}`
              }
            });
            if (res.ok) {
              const data = await res.json();
              runtimeState.updateProviderHealth('Kite', startTime, true, '200 OK');
              const ltp = data?.data?.[`NSE:${symbol}`]?.last_price;
              if (ltp) {
                // Return structured object using LTP as history seed
                // A flat series of 30 identical closes is NOT price history:
                // ATR collapses to ~0 and every indicator degenerates. Tag it
                // honestly so the decision layer can refuse to trade on it.
                const closes = Array(30).fill(ltp);
                const highs = Array(30).fill(ltp * 1.001);
                const lows = Array(30).fill(ltp * 0.999);
                const volumes = Array(30).fill(10000);
                return { closes, opens: closes.slice(), highs, lows, volumes, source: 'DEGRADED_LTP_ONLY' };
              }
            }
          } catch (kiteErr) {
            console.error(`[MARKET DATA FAILOVER FAILED] Zerodha Kite Connect request failed:`, kiteErr.message);
          }
        }

        // Fallback realistic history walk if network is unavailable (offline test runner / sandbox / market closed)
        const basePrice = currentPrices[symbol] || 1000.0;
        const count = interval === '1d' ? 60 : 75;
        const closes = [];
        const opens = [];
        const highs = [];
        const lows = [];
        const volumes = [];
        let p = basePrice;
        for (let i = 0; i < count; i++) {
          const o = p;
          const delta = (Math.random() - 0.49) * (basePrice * 0.005);
          const c = o + delta;
          const h = Math.max(o, c) + Math.random() * (basePrice * 0.003);
          const l = Math.min(o, c) - Math.random() * (basePrice * 0.003);
          opens.push(parseFloat(o.toFixed(2)));
          closes.push(parseFloat(c.toFixed(2)));
          highs.push(parseFloat(h.toFixed(2)));
          lows.push(parseFloat(l.toFixed(2)));
          volumes.push(Math.round(10000 + Math.random() * 50000));
          p = c;
        }
        // CRITICAL: this is a synthetic random walk, not market data. It was
        // previously returned with source:'LIVE', so the predictor, SMC agent,
        // technicals and stop/target engine could all generate BUY signals from
        // pure noise whenever Yahoo was unreachable. It is now tagged
        // SYNTHETIC and the decision layer refuses to trade on it.
        return { closes, opens, highs, lows, volumes, source: 'SYNTHETIC' };
      };

      return await enqueueRequest(executionTask);
  },

  // Verify prices match within a 2.5% tolerance window
  validatePrice(symbol, testPrice) {
    try {
      const activePrice = this.getPrice(symbol);
      if (!activePrice) return { valid: true }; // Skip if no active price cache to validate against
      const diff = Math.abs(activePrice - testPrice);
      const diffPct = (diff / activePrice) * 100;
      return {
        valid: diffPct <= 2.5,
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
