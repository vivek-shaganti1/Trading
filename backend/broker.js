const crypto = require('crypto');
const db = require('./db');
const config = require('../shared/config');
const marketData = require('./marketData');

// Yahoo Finance Mappings
const YAHOO_MAPPINGS = {
  'NIFTY50_MINI': '^NSEI',
  'RELIANCE': 'RELIANCE.NS',
  'TCS': 'TCS.NS',
  'HDFCBANK': 'HDFCBANK.NS',
  'INFOSYS': 'INFY.NS'
};

// Angel One Scrip/Token Map
const ANGEL_TOKENS = {
  'NIFTY50_MINI': '10440', // Traded via NIFTYBEES-EQ
  'RELIANCE': '2885',     // RELIANCE-EQ
  'TCS': '11536',         // TCS-EQ
  'HDFCBANK': '1333',     // HDFCBANK-EQ
  'INFOSYS': '1594'       // INFY-EQ
};

// Internal active prices state
const currentPrices = {
  'NIFTY50_MINI': 0,
  'RELIANCE': 0,
  'TCS': 0,
  'HDFCBANK': 0,
  'INFOSYS': 0
};

// Broker session state
let kiteSession = null;
let angelSession = null;
let shoonyaSession = null;

// Debug panel metrics
let lastApiUrlCalled = 'None';
let lastApiResponseTimestamp = 'None';
let dataSourceName = 'Yahoo Finance API';
let activeBroker = 'SIMULATOR';

function isMarketOpenNow() {
  if (process.env.FORCE_SIMULATION === 'true') {
    return true;
  }
  const d = new Date();
  const utc = d.getTime() + (d.getTimezoneOffset() * 60000);
  const ist = new Date(utc + (3600000 * 5.5));
  
  const day = ist.getDay();
  if (day === 0 || day === 6) return false;
  
  const hour = ist.getHours();
  const minute = ist.getMinutes();
  const currentMins = hour * 60 + minute;
  
  const startMins = 9 * 60 + 15; // 9:15 AM
  const closeMins = 15 * 60 + 30; // 3:30 PM
  
  return currentMins >= startMins && currentMins < closeMins;
}

// Native TOTP generator for Angel One SmartAPI login handshake
function generateTOTP(secret) {
  if (!secret) return '';
  try {
    const cleanSecret = secret.replace(/\s/g, '').toUpperCase();
    const key = base32Decode(cleanSecret);
    const epoch = Math.round(Date.now() / 1000);
    const time = Buffer.alloc(8);
    time.writeUInt32BE(0, 0);
    time.writeUInt32BE(Math.floor(epoch / 30), 4);

    const hmac = crypto.createHmac('sha1', key);
    hmac.update(time);
    const hash = hmac.digest();

    const offset = hash[hash.length - 1] & 0xf;
    const otp = (
      ((hash[offset] & 0x7f) << 24) |
      ((hash[offset + 1] & 0xff) << 16) |
      ((hash[offset + 2] & 0xff) << 8) |
      (hash[offset + 3] & 0xff)
    ) % 1000000;

    return String(otp).padStart(6, '0');
  } catch (err) {
    console.error('[TOTP] Generation failed:', err.message);
    return '';
  }
}

function base32Decode(str) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let length = str.length;
  let bits = 0;
  let value = 0;
  let index = 0;
  const out = [];

  for (let i = 0; i < length; i++) {
    const idx = alphabet.indexOf(str[i]);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out[index++] = (value >>> (bits - 8)) & 255;
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

// Fetch real market prices from Yahoo Finance API
async function fetchRealPrices(force = false) {
  const isOpen = isMarketOpenNow();
  if (!isOpen && !force) {
    return;
  }

  // Get dynamic list of symbols to fetch (default mappings + active holdings)
  const symbolsToFetch = { ...YAHOO_MAPPINGS };
  try {
    const portfolio = await db.getPortfolioState();
    if (portfolio && portfolio.holding_stocks) {
      portfolio.holding_stocks.forEach(h => {
        if (!symbolsToFetch[h.symbol]) {
          symbolsToFetch[h.symbol] = `${h.symbol}.NS`;
        }
      });
    }
  } catch (err) {
    // Fail silently
  }

  const promises = Object.entries(symbolsToFetch).map(async ([symbol, yahooSymbol]) => {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSymbol}?interval=1m&range=1d`;
    lastApiUrlCalled = url;
    
    try {
      const response = await fetch(url);
      if (!response.ok) return;
      const data = await response.json();
      const price = data?.chart?.result?.[0]?.meta?.regularMarketPrice;
      if (price) {
        const floatPrice = parseFloat(price.toFixed(2));
        currentPrices[symbol] = floatPrice;
        try {
          marketData.updatePrice(symbol, floatPrice, 'LIVE');
        } catch (modeErr) {
          // If in simulator mode, ignore updates from live background fetch
        }
        lastApiResponseTimestamp = new Date().toISOString();
      }
    } catch (err) {
      // Fail silently to avoid crashing
    }
  });

  await Promise.all(promises);
}

// --- Live Broker Connectors ---

// Zerodha Kite Session Verify
async function verifyKiteSession() {
  if (!config.KITE_API_KEY || !config.KITE_ACCESS_TOKEN) {
    throw new Error('Zerodha Kite API key or Access Token missing.');
  }

  const url = 'https://api.kite.trade/user/margins';
  lastApiUrlCalled = url;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'X-Kite-Version': '3',
      'Authorization': `token ${config.KITE_API_KEY}:${config.KITE_ACCESS_TOKEN}`,
      'Accept': 'application/json'
    }
  });

  const resData = await response.json();
  if (resData.status === 'success') {
    kiteSession = { active: true };
    dataSourceName = 'Zerodha Kite Connect';
    activeBroker = 'ZERODHA';
    console.log('[BROKER] Successfully verified Zerodha Kite Connect session.');
  } else {
    throw new Error(resData.message || 'Kite margins fetch failed.');
  }
}

// Angel One Login
async function loginAngelOne() {
  if (!config.SMARTAPI_CLIENT_CODE || !config.SMARTAPI_PASSWORD || !config.SMARTAPI_API_KEY || !config.SMARTAPI_TOTP_KEY) {
    throw new Error('Angel One credentials missing.');
  }

  const totp = generateTOTP(config.SMARTAPI_TOTP_KEY);
  const url = 'https://apiconnect.angelone.in/rest/auth/angelone/user/v1/loginByPassword';
  lastApiUrlCalled = url;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-UserType': 'USER',
      'X-SourceID': 'WEB',
      'X-ClientLocalIP': '192.168.1.1',
      'X-ClientPublicIP': '8.8.8.8',
      'X-MACAddress': '02:00:00:00:00:00',
      'X-PrivateKey': config.SMARTAPI_API_KEY
    },
    body: JSON.stringify({
      clientcode: config.SMARTAPI_CLIENT_CODE,
      password: config.SMARTAPI_PASSWORD,
      totp: totp
    })
  });

  const resData = await response.json();
  if (resData.status && resData.data) {
    angelSession = {
      jwtToken: resData.data.jwtToken,
      refreshToken: resData.data.refreshToken
    };
    dataSourceName = 'Angel One SmartAPI';
    activeBroker = 'ANGEL_ONE';
    console.log('[BROKER] Successfully logged into Angel One SmartAPI.');
  } else {
    throw new Error(resData.message || 'Angel One login failed.');
  }
}

// Shoonya (Finvasia) Login
async function loginShoonya() {
  if (!config.SHOONYA_USER_ID || !config.SHOONYA_PASSWORD || !config.SHOONYA_FACTOR2 || !config.SHOONYA_VENDOR_CODE || !config.SHOONYA_API_KEY) {
    throw new Error('Shoonya credentials missing.');
  }

  const url = 'https://api.shoonya.com/NorenWsev/User/Login';
  lastApiUrlCalled = url;

  const payload = {
    apkversion: '1.0.0',
    uid: config.SHOONYA_USER_ID,
    pwd: config.SHOONYA_PASSWORD,
    factor2: config.SHOONYA_FACTOR2,
    vc: config.SHOONYA_VENDOR_CODE,
    appkey: config.SHOONYA_API_KEY
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: 'jData=' + JSON.stringify(payload)
  });

  const resData = await response.json();
  if (resData.stat === 'Ok') {
    shoonyaSession = {
      susertoken: resData.susertoken,
      actid: resData.actid || config.SHOONYA_USER_ID
    };
    dataSourceName = 'Finvasia Shoonya API';
    activeBroker = 'FINVASIA';
    console.log('[BROKER] Successfully logged into Finvasia Shoonya.');
  } else {
    throw new Error(resData.emsg || 'Shoonya login failed.');
  }
}

// Initialized update loop
setInterval(async () => {
  if (process.env.FORCE_SIMULATION === 'true') {
    const symbols = Object.keys(YAHOO_MAPPINGS);
    try {
      const portfolio = await db.getPortfolioState();
      if (portfolio && portfolio.holding_stocks) {
        portfolio.holding_stocks.forEach(h => {
          if (!symbols.includes(h.symbol)) symbols.push(h.symbol);
        });
      }
    } catch (e) {}

    const additionalSymbols = ['BLISSGVS', 'FLFL', 'FCONSUMER', 'EXIDEIND', 'AUROPHARMA', 'CHOLAHLDNG', 'DRREDDY', 'CHOLAFIN'];
    additionalSymbols.forEach(s => {
      if (!symbols.includes(s)) symbols.push(s);
    });

    symbols.forEach(symbol => {
      let currentPrice = currentPrices[symbol] || ((symbol.charCodeAt(0) * 10) % 1000 + 100);
      const changePercent = (Math.random() * 0.4 - 0.18) / 100;
      currentPrice = parseFloat((currentPrice * (1 + changePercent)).toFixed(2));
      currentPrices[symbol] = currentPrice;
      try {
        marketData.updatePrice(symbol, currentPrice, marketData.getMode());
      } catch (err) {}
    });
    lastApiResponseTimestamp = new Date().toISOString();
  }
  await fetchRealPrices(false);
}, 2000);

// Startup Auth Hook
async function initBroker() {
  await fetchRealPrices(true);
  
  if (config.BROKER_MODE === 'LIVE') {
    try {
      if (config.KITE_API_KEY && config.KITE_ACCESS_TOKEN) {
        await verifyKiteSession();
      } else if (config.SMARTAPI_CLIENT_CODE) {
        await loginAngelOne();
      } else if (config.SHOONYA_USER_ID) {
        await loginShoonya();
      } else {
        console.warn('[BROKER] LIVE mode set but no broker keys configured in .env. Operating Paper Trading.');
      }
    } catch (err) {
      console.error('[BROKER] Live Broker Authentication failed:', err.message);
      console.log('[BROKER] Falling back to Paper-Trading on Live API Quotes.');
    }
  }
}

initBroker().catch(console.error);

const broker = {
  // Test stub helper (used only in test suites)
  _setMockPrice(symbol, price) {
    currentPrices[symbol] = price;
    try {
      marketData.updatePrice(symbol, price, marketData.getMode());
    } catch (err) {
      console.warn(`[BROKER] Failed to sync mock price to marketData for ${symbol}:`, err.message);
    }
  },

  // Public method: update price from scanner/universe data
  // Called by tradingBot.processScannerRankings to populate prices for ALL scanned symbols
  updatePriceFromScan(symbol, price) {
    if (symbol && price > 0) {
      currentPrices[symbol] = price;
      try {
        marketData.updatePrice(symbol, price, marketData.getMode());
      } catch (err) {
        console.warn(`[BROKER] Failed to sync scan price to marketData for ${symbol}:`, err.message);
      }
    }
  },

  // Force fetch live prices and await them
  async forceFetchLivePrices() {
    await fetchRealPrices(true);
  },

  // Get all current prices
  getPrices() {
    return { ...currentPrices };
  },

  // Get Last Traded Price for a symbol
  // CRITICAL FIX: Fall back to holding entry price instead of returning 0
  // Returning 0 caused getValuation() to compute equityValue=0 for all holdings,
  // which falsely triggered weekly drawdown halts on every single trade.
  getLTP(symbol) {
    try {
      return marketData.getPrice(symbol);
    } catch (err) {
      if (err.message.includes('CORRUPTION') || err.message.includes('Requested price for') || err.message.includes('different source')) {
        throw err;
      }
      // Fall back: look up the holding's entry price to avoid valuing at 0
      try {
        const portfolio = db.readLocalDb().portfolio_state;
        const holding = (portfolio.holding_stocks || []).find(h => h.symbol === symbol);
        if (holding && holding.avgPrice > 0) {
          console.warn(`[BROKER LTP WARNING] No live price for ${symbol}, using entry price ₹${holding.avgPrice} as fallback: ${err.message}`);
          return holding.avgPrice;
        }
      } catch (e) {
        // Fail silently
      }
      return 0;
    }
  },

  // Get Debug Data
  getDebugData() {
    const isReal = (activeBroker === 'ZERODHA' && kiteSession) || (activeBroker === 'ANGEL_ONE' && angelSession) || (activeBroker === 'FINVASIA' && shoonyaSession);
    return {
      lastApiUrlCalled,
      lastApiResponseTimestamp,
      marketStatus: isMarketOpenNow() ? 'OPEN' : 'CLOSED',
      dataSourceName,
      simulatorMode: activeBroker === 'SIMULATOR',
      activeBroker,
      brokerMode: config.BROKER_MODE,
      tradingType: isReal ? 'Real Trading' : 'Paper Trading'
    };
  },

  // Recent orders map for duplicate prevention
  _recentOrders: new Map(),

  // Execute an order with capital checks
  async executeOrder(symbol, action, quantity, strategy, reason, scannerPrice) {
    if (quantity <= 0) {
      throw new Error(`Order execution rejected: Quantity must be greater than 0. Got: ${quantity}`);
    }
    const orderKey = `${symbol}-${action}-${strategy}`;
    const now = Date.now();
    if (this._recentOrders.has(orderKey)) {
      const lastTime = this._recentOrders.get(orderKey);
      if (now - lastTime < 2000) {
        throw new Error(`Duplicate order blocked: ${action} ${quantity} ${symbol} (${strategy}) placed too quickly.`);
      }
    }
    this._recentOrders.set(orderKey, now);

    let ltp = this.getLTP(symbol);
    if (ltp === 0) {
      try {
        const yahooSymbol = YAHOO_MAPPINGS[symbol] || `${symbol}.NS`;
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSymbol}?interval=1m&range=1d`;
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          const price = data?.chart?.result?.[0]?.meta?.regularMarketPrice;
          if (price) {
            this._setMockPrice(symbol, parseFloat(price.toFixed(2)));
            ltp = price;
          }
        }
      } catch (err) {
        console.error(`[BROKER] Failed to fetch on-demand price for ${symbol}:`, err.message);
      }
    }

    if (ltp === 0) {
      throw new Error(`Symbol ${symbol} price unavailable. Live data offline.`);
    }

    // RUNTIME PRICE VALIDATION BEFORE BUY
    if (action === 'BUY') {
      const targetPrice = scannerPrice || ltp;
      const validation = marketData.validatePrice(symbol, targetPrice);
      if (!validation.valid) {
        const errReason = `Price validation failed for ${symbol}: scanner price ₹${targetPrice} vs execution price ₹${ltp} differs by ${validation.differencePct?.toFixed(2)}% (limit 0.5%). Source: ${marketData.getProviderName()}`;
        console.error(`[PRICE VALIDATION REJECTED] ${errReason}`);
        await db.logAlert('WARNING', errReason);
        try {
          const dbData = db.readLocalDb();
          dbData.lastPriceValidation = {
            timestamp: new Date().toISOString(),
            symbol,
            scannerPrice: targetPrice,
            executionPrice: ltp,
            status: 'FAIL',
            reason: errReason
          };
          db.writeLocalDb(dbData);
        } catch (e) {}
        throw new Error(errReason);
      } else {
        try {
          const dbData = db.readLocalDb();
          dbData.lastPriceValidation = {
            timestamp: new Date().toISOString(),
            symbol,
            scannerPrice: targetPrice,
            executionPrice: ltp,
            status: 'PASS'
          };
          db.writeLocalDb(dbData);
        } catch (e) {}
      }
    }

    const orderValue = parseFloat((ltp * quantity).toFixed(2));

    // If active broker is ZERODHA, place order on Kite Connect
    if (activeBroker === 'ZERODHA' && kiteSession) {
      try {
        const url = 'https://api.kite.trade/orders/regular';
        lastApiUrlCalled = url;
        const formBody = [];
        const orderParams = {
          exchange: 'NSE',
          tradingsymbol: symbol === 'NIFTY50_MINI' ? 'NIFTYBEES' : symbol,
          transaction_type: action,
          order_type: 'MARKET',
          quantity: String(Math.max(1, Math.round(quantity))),
          product: strategy === 'DAY_TRADING' ? 'MIS' : 'CNC',
          validity: 'DAY'
        };
        for (const property in orderParams) {
          const encodedKey = encodeURIComponent(property);
          const encodedValue = encodeURIComponent(orderParams[property]);
          formBody.push(encodedKey + "=" + encodedValue);
        }

        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'X-Kite-Version': '3',
            'Authorization': `token ${config.KITE_API_KEY}:${config.KITE_ACCESS_TOKEN}`,
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: formBody.join("&")
        });
        const orderRes = await res.json();
        console.log(`[BROKER] Zerodha Kite Order placed status: ${orderRes.status}`);
      } catch (err) {
        console.error('[BROKER] Zerodha Kite Connect placeOrder failed:', err.message);
      }
    }
    // If active broker is ANGEL_ONE, place order on exchange
    else if (activeBroker === 'ANGEL_ONE' && angelSession) {
      try {
        const url = 'https://apiconnect.angelone.in/rest/secure/angelone/order/v1/placeOrder';
        lastApiUrlCalled = url;
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${angelSession.jwtToken}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'X-UserType': 'USER',
            'X-SourceID': 'WEB',
            'X-PrivateKey': config.SMARTAPI_API_KEY
          },
          body: JSON.stringify({
            variety: 'NORMAL',
            tradingsymbol: symbol === 'NIFTY50_MINI' ? 'NIFTYBEES-EQ' : `${symbol}-EQ`,
            symboltoken: ANGEL_TOKENS[symbol],
            transactiontype: action,
            exchange: 'NSE',
            ordertype: 'MARKET',
            producttype: strategy === 'DAY_TRADING' ? 'INTRADAY' : 'DELIVERY',
            duration: 'DAY',
            qty: String(Math.max(1, Math.round(quantity)))
          })
        });
        const orderRes = await res.json();
        console.log(`[BROKER] Angel One Order placed: ${orderRes.message}`);
      } catch (err) {
        console.error('[BROKER] Angel One placeOrder failed:', err.message);
      }
    } 
    // If active broker is FINVASIA, place order on Shoonya
    else if (activeBroker === 'FINVASIA' && shoonyaSession) {
      try {
        const url = 'https://api.shoonya.com/NorenWsev/PlaceOrder';
        lastApiUrlCalled = url;
        const payload = {
          uid: config.SHOONYA_USER_ID,
          actid: shoonyaSession.actid,
          prd: strategy === 'DAY_TRADING' ? 'I' : 'C',
          trantype: action === 'BUY' ? 'B' : 'S',
          exch: 'NSE',
          tsym: symbol === 'NIFTY50_MINI' ? 'NIFTYBEES-EQ' : `${symbol}-EQ`,
          qty: String(Math.max(1, Math.round(quantity))),
          prctyp: 'MKT',
          ret: 'DAY'
        };
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: 'jData=' + JSON.stringify(payload)
        });
        const orderRes = await res.json();
        console.log(`[BROKER] Shoonya Order placed: ${orderRes.stat}`);
      } catch (err) {
        console.error('[BROKER] Shoonya placeOrder failed:', err.message);
      }
    }

    // Mirror the execution in the local DB portfolio ledger
    const portfolio = await db.getPortfolioState();
    let updatedBalance = portfolio.balance;
    let updatedHoldingStocks = [...(portfolio.holding_stocks || [])];
    
    if (action === 'BUY') {
      const fee = parseFloat((orderValue * 0.0005).toFixed(2));
      const totalCost = parseFloat((orderValue + fee).toFixed(2));
      if (updatedBalance < totalCost) {
        throw new Error(`Insufficient balance for BUY: Required ₹${totalCost} (including ₹${fee} fee), Available ₹${updatedBalance}`);
      }
      updatedBalance = parseFloat((updatedBalance - totalCost).toFixed(2));
      
      let participating_models = null;
      let execution_mode = 'INSTITUTIONAL';
      let stopLossPrice = null;
      let targetPrice = null;
      if (reason && reason.includes('| REPORT: ')) {
        try {
          const reportStr = reason.split('| REPORT: ')[1];
          const reportObj = JSON.parse(reportStr);
          participating_models = reportObj.participating_models || null;
          execution_mode = reportObj.execution_mode || 'INSTITUTIONAL';
          stopLossPrice = reportObj.stopLossPrice || null;
          targetPrice = reportObj.targetPrice || null;
        } catch (err) {
          console.error('[BROKER] Failed to parse participating_models from reason:', err.message);
        }
      }

      const stockIdx = updatedHoldingStocks.findIndex(s => s.symbol === symbol && s.strategy === strategy);
      if (stockIdx !== -1) {
        const existing = updatedHoldingStocks[stockIdx];
        const newQty = existing.quantity + quantity;
        const newAvg = parseFloat(((existing.avgPrice * existing.quantity + orderValue) / newQty).toFixed(2));
        updatedHoldingStocks[stockIdx] = {
          ...existing,
          quantity: newQty,
          avgPrice: newAvg,
          participating_models: participating_models || existing.participating_models,
          execution_mode: execution_mode,
          stopLossPrice: stopLossPrice || existing.stopLossPrice,
          targetPrice: targetPrice || existing.targetPrice
        };
      } else {
        updatedHoldingStocks.push({
          symbol,
          quantity,
          avgPrice: ltp,
          strategy,
          participating_models,
          execution_mode,
          stopLossPrice,
          targetPrice,
          timestamp: new Date().toISOString()
        });
      }
    } else if (action === 'SELL') {
      const stockIdx = updatedHoldingStocks.findIndex(s => s.symbol === symbol && s.strategy === strategy);
      if (stockIdx === -1 || updatedHoldingStocks[stockIdx].quantity < quantity) {
        throw new Error(`Insufficient stock holdings to SELL ${quantity} shares of ${symbol} (${strategy})`);
      }
      
      const holding = updatedHoldingStocks[stockIdx];
      const fee = parseFloat((orderValue * 0.0005).toFixed(2));
      updatedBalance = parseFloat((updatedBalance + orderValue - fee).toFixed(2));
      
      if (holding.quantity === quantity) {
        updatedHoldingStocks.splice(stockIdx, 1);
      } else {
        updatedHoldingStocks[stockIdx] = {
          ...holding,
          quantity: holding.quantity - quantity
        };
      }
    }

    // Recalculate equity valuation
    let equityValue = 0;
    updatedHoldingStocks.forEach(s => {
      const currentVal = this.getLTP(s.symbol) * s.quantity;
      equityValue += currentVal;
    });
    equityValue = parseFloat(equityValue.toFixed(2));

    const totalPortfolioValue = parseFloat((updatedBalance + equityValue).toFixed(2));
    const netPnL = parseFloat((totalPortfolioValue - config.INITIAL_CAPITAL).toFixed(2));

    const updatedState = await db.updatePortfolioState({
      balance: updatedBalance,
      holding_stocks: updatedHoldingStocks,
      equity_value: equityValue,
      lifetime_pnl: netPnL
    });

    try {
      await this.refreshPortfolioState();
      await this.recalculateValuation();
      await this.broadcastDashboardUpdate();
    } catch (broadcastErr) {
      console.error('[BROKER INSTANT UPDATE ERROR]:', broadcastErr.message);
    }

    const tradeResult = await db.logTrade({
      symbol,
      action,
      strategy,
      quantity,
      price: ltp,
      total_value: orderValue,
      reason
    });

    return {
      trade: tradeResult,
      portfolio: updatedState
    };
  },

  // Modify an existing order (exchange-side)
  // Currently not supported in fire-and-forget architecture — orders are MARKET orders filled instantly
  async modifyOrder(orderId, newPrice, newQuantity) {
    console.warn(`[BROKER] modifyOrder(${orderId}) called but not supported — MARKET orders fill instantly.`);
    throw new Error(`Order modification not supported for MARKET orders. OrderId: ${orderId}`);
  },

  // Cancel an existing order (exchange-side)
  // Currently not supported — MARKET orders fill instantly before cancel can be processed
  async cancelOrder(orderId) {
    console.warn(`[BROKER] cancelOrder(${orderId}) called but not supported — MARKET orders fill instantly.`);
    throw new Error(`Order cancellation not supported for MARKET orders. OrderId: ${orderId}`);
  },

  // Calculate portfolio PnL and valuation
  async getValuation() {
    const portfolio = await db.getPortfolioState();
    let balance = portfolio.balance;
    let holdings = portfolio.holding_stocks || [];

    // Sync balance from live brokers if active
    if (activeBroker === 'ZERODHA' && kiteSession) {
      try {
        const url = 'https://api.kite.trade/user/margins';
        lastApiUrlCalled = url;
        const res = await fetch(url, {
          headers: {
            'X-Kite-Version': '3',
            'Authorization': `token ${config.KITE_API_KEY}:${config.KITE_ACCESS_TOKEN}`
          }
        });
        const fundData = await res.json();
        if (fundData.status === 'success' && fundData.data) {
          balance = parseFloat(fundData.data.equity.net || balance);
        }
      } catch (err) {
        // Fallback to DB
      }
    } else if (activeBroker === 'ANGEL_ONE' && angelSession) {
      try {
        const url = 'https://apiconnect.angelone.in/rest/secure/angelone/margin/v1/funds';
        lastApiUrlCalled = url;
        const res = await fetch(url, {
          headers: {
            'Authorization': `Bearer ${angelSession.jwtToken}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'X-UserType': 'USER',
            'X-SourceID': 'WEB',
            'X-PrivateKey': config.SMARTAPI_API_KEY
          }
        });
        const fundData = await res.json();
        if (fundData.status && fundData.data) {
          balance = parseFloat(fundData.data.netrange || fundData.data.availablecash || balance);
        }
      } catch (err) {
        // Fallback
      }
    } else if (activeBroker === 'FINVASIA' && shoonyaSession) {
      try {
        const url = 'https://api.shoonya.com/NorenWsev/Limits';
        lastApiUrlCalled = url;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: 'jData=' + JSON.stringify({
            uid: config.SHOONYA_USER_ID,
            actid: shoonyaSession.actid
          })
        });
        const limitData = await res.json();
        if (limitData.stat === 'Ok') {
          balance = parseFloat(limitData.cash || balance);
        }
      } catch (err) {
        // Fallback
      }
    }

    // Verify valuation source matches execution source
    const expectedSource = marketData.getMode();
    for (const s of holdings) {
      const actualSource = marketData.getPriceSource(s.symbol);
      if (actualSource && actualSource !== expectedSource) {
        const reason = `Valuation price source mismatch for ${s.symbol}: valuation price source is ${actualSource} but expected execution source is ${expectedSource}`;
        console.error(`[VALUATION VALIDATION REJECTED] ${reason}`);
        await db.logAlert('CRITICAL', reason);
        try {
          const dbData = db.readLocalDb();
          dbData.lastPriceValidation = {
            timestamp: new Date().toISOString(),
            status: 'FAIL',
            reason
          };
          db.writeLocalDb(dbData);
        } catch (e) {}
        throw new Error(reason);
      }
    }

    let equityValue = 0;
    holdings.forEach(s => {
      let ltp = this.getLTP(s.symbol);
      // SAFETY NET: Never value a held position at 0
      // If getLTP still returns 0 (no live price AND no holding entry price),
      // use the holding's avgPrice directly to prevent false drawdown halts
      if (ltp <= 0 && s.avgPrice > 0) {
        console.warn(`[VALUATION WARNING] LTP for ${s.symbol} is 0, using avgPrice ₹${s.avgPrice}`);
        ltp = s.avgPrice;
      }
      equityValue += ltp * s.quantity;
    });

    equityValue = parseFloat(equityValue.toFixed(2));
    const totalVal = parseFloat((balance + equityValue).toFixed(2));
    const netPnL = parseFloat((totalVal - config.INITIAL_CAPITAL).toFixed(2));

    // Log warning if holdings exist but equity is still 0 (should never happen now)
    if (holdings.length > 0 && equityValue <= 0) {
      console.error(`[VALUATION CRITICAL] Holdings exist (${holdings.length}) but equityValue is ₹${equityValue}. This indicates a pricing failure.`);
    }

    return {
      balance,
      equityValue,
      totalVal,
      netPnL,
      holdingStocks: holdings
    };
  },

  async refreshPortfolioState() {
    return await db.getPortfolioState(true);
  },

  async recalculateValuation() {
    const portfolio = await db.getPortfolioState(true);
    let equityValue = 0;
    for (const s of (portfolio.holding_stocks || [])) {
      let ltp = this.getLTP(s.symbol);
      if (ltp <= 0 && s.avgPrice > 0) ltp = s.avgPrice;
      equityValue += ltp * s.quantity;
    }
    equityValue = parseFloat(equityValue.toFixed(2));
    const totalVal = parseFloat((Number(portfolio.balance) + equityValue).toFixed(2));
    const netPnL = parseFloat((totalVal - config.INITIAL_CAPITAL).toFixed(2));
    
    await db.updatePortfolioState({
      equity_value: equityValue,
      lifetime_pnl: netPnL
    });
  },

  async broadcastDashboardUpdate() {
    const tradingBot = require('./tradingBot');
    if (typeof tradingBot.broadcastDashboardUpdate === 'function') {
      await tradingBot.broadcastDashboardUpdate();
    }
  }
};

module.exports = broker;
