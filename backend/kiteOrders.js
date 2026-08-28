/**
 * kiteOrders.js — Zerodha Kite Connect order placement WITH confirmation.
 *
 * Why this module exists
 * ----------------------
 * broker.js previously POSTed an order, checked only `status === 'success'`,
 * threw the response away and then booked the trade into the local ledger at the
 * pre-trade Yahoo quote. That is wrong in three independent ways:
 *
 *   1. Kite returns `success` when the order is ACCEPTED INTO THE QUEUE, not
 *      when it is filled. A MARKET order can still go to REJECTED (RMS margin
 *      block, freeze quantity, circuit limit, scrip ban) or sit OPEN partially
 *      filled. Treating acceptance as a fill desynchronises the ledger from
 *      reality on the very first rejection, and nothing ever re-syncs it.
 *   2. The recorded entry/exit price was a Yahoo quote, not the exchange's
 *      average fill price, so every P&L number in the system was fiction and
 *      slippage was structurally unobservable.
 *   3. The POST was wrapped in withResilience(..., 3 retries). fetch() rejects
 *      on network errors — precisely the ambiguous case where Kite may already
 *      have routed the order — so a socket hiccup could place the SAME MARKET
 *      ORDER UP TO THREE TIMES.
 *
 * This module places the order exactly once, tags it for correlation, then
 * polls until the exchange reaches a terminal state and reports the real
 * filled quantity and average price.
 */

const config = require('../shared/config');

const KITE_BASE = 'https://api.kite.trade';
const TERMINAL_OK = new Set(['COMPLETE']);
const TERMINAL_BAD = new Set(['REJECTED', 'CANCELLED']);

function authHeader() {
  return `token ${config.KITE_API_KEY}:${config.KITE_ACCESS_TOKEN}`;
}

function baseHeaders() {
  return {
    'X-Kite-Version': '3',
    'Authorization': authHeader()
  };
}

/**
 * A short, deterministic-ish tag Kite echoes back on the order. Max 20 chars.
 * Lets us find an order we may have placed when the network response was lost.
 */
function makeTag(symbol, side) {
  const t = Date.now().toString(36);
  return `${side[0]}${symbol}${t}`.replace(/[^A-Za-z0-9]/g, '').slice(0, 20);
}

/**
 * Detects an expired/invalid access token. Kite tokens die daily ~06:00 IST;
 * every order silently failing all day is a catastrophic failure mode.
 */
function isTokenError(body, httpStatus) {
  if (httpStatus === 403) return true;
  const t = body && (body.error_type || '');
  return t === 'TokenException';
}

class KiteTokenError extends Error {
  constructor(msg) { super(msg); this.name = 'KiteTokenError'; this.isTokenError = true; }
}

/**
 * Place a single regular order. NOT retried — see header note 3.
 * @returns {Promise<{orderId:string, tag:string}>}
 */
async function placeOrderOnce({ symbol, side, quantity, product = 'MIS', orderType = 'MARKET' }) {
  const tag = makeTag(symbol, side);
  const params = {
    exchange: 'NSE',
    tradingsymbol: symbol,
    transaction_type: side,
    order_type: orderType,
    quantity: String(quantity),
    product,
    validity: 'DAY',
    tag
  };

  const body = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');

  const res = await fetch(`${KITE_BASE}/orders/regular`, {
    method: 'POST',
    headers: { ...baseHeaders(), 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });

  let json = null;
  try { json = await res.json(); } catch (e) { /* handled below */ }

  if (isTokenError(json, res.status)) {
    throw new KiteTokenError('Kite access token is invalid or expired — re-authentication required.');
  }
  if (!res.ok || !json || json.status !== 'success' || !json.data || !json.data.order_id) {
    const reason = (json && (json.message || json.error_type)) || `HTTP ${res.status}`;
    throw new Error(`Kite rejected order for ${symbol}: ${reason}`);
  }

  return { orderId: String(json.data.order_id), tag };
}

/** Fetch the status history for one order; the last entry is the current state. */
async function fetchOrderStatus(orderId) {
  const res = await fetch(`${KITE_BASE}/orders/${encodeURIComponent(orderId)}`, {
    headers: baseHeaders()
  });
  let json = null;
  try { json = await res.json(); } catch (e) { /* fallthrough */ }
  if (isTokenError(json, res.status)) {
    throw new KiteTokenError('Kite access token expired while polling order status.');
  }
  if (!res.ok || !json || json.status !== 'success' || !Array.isArray(json.data)) {
    throw new Error(`Could not read status for order ${orderId}: HTTP ${res.status}`);
  }
  return json.data[json.data.length - 1] || null;
}

/**
 * Poll until the order reaches a terminal state.
 * @returns {Promise<{status:string, filledQuantity:number, averagePrice:number, raw:object}>}
 */
async function awaitTerminalState(orderId, { timeoutMs = 15000, intervalMs = 700 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = null;

  while (Date.now() < deadline) {
    try {
      last = await fetchOrderStatus(orderId);
    } catch (err) {
      if (err.isTokenError) throw err;
      // Transient read failure — keep polling; we must not conclude anything.
    }

    if (last) {
      const st = String(last.status || '').toUpperCase();
      if (TERMINAL_OK.has(st) || TERMINAL_BAD.has(st)) {
        return {
          status: st,
          filledQuantity: Number(last.filled_quantity || 0),
          averagePrice: Number(last.average_price || 0),
          raw: last
        };
      }
    }
    await new Promise(r => setTimeout(r, intervalMs));
  }

  // Timed out still OPEN/PENDING. Report honestly — the caller must NOT assume
  // a fill, and must not blindly re-send.
  return {
    status: last ? String(last.status || 'UNKNOWN').toUpperCase() : 'UNKNOWN',
    filledQuantity: last ? Number(last.filled_quantity || 0) : 0,
    averagePrice: last ? Number(last.average_price || 0) : 0,
    timedOut: true,
    raw: last
  };
}

/**
 * Place an order and confirm it end-to-end.
 *
 * @returns {Promise<{
 *   orderId:string, tag:string, status:string,
 *   filledQuantity:number, averagePrice:number, complete:boolean, timedOut?:boolean
 * }>}
 * @throws if the order was rejected outright, or the token is dead.
 */
async function placeAndConfirm({ symbol, side, quantity, product = 'MIS' }) {
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity !== Math.floor(quantity)) {
    throw new Error(`Refusing to place order: quantity must be a positive integer, got ${quantity}`);
  }

  const { orderId, tag } = await placeOrderOnce({ symbol, side, quantity, product });
  const result = await awaitTerminalState(orderId);

  if (TERMINAL_BAD.has(result.status)) {
    throw new Error(
      `Order ${orderId} ${result.status} for ${side} ${quantity} ${symbol}: ${result.raw?.status_message || 'no reason given'}`
    );
  }

  const complete = result.status === 'COMPLETE' && result.filledQuantity === quantity;
  return { orderId, tag, complete, ...result };
}

/** Live positions from the broker — the ground truth for reconciliation. */
async function fetchNetPositions() {
  const res = await fetch(`${KITE_BASE}/portfolio/positions`, { headers: baseHeaders() });
  let json = null;
  try { json = await res.json(); } catch (e) { /* fallthrough */ }
  if (isTokenError(json, res.status)) throw new KiteTokenError('Kite token expired reading positions.');
  if (!res.ok || !json || json.status !== 'success') {
    throw new Error(`Could not read positions: HTTP ${res.status}`);
  }
  return (json.data && json.data.net) || [];
}

/** Delivery holdings (CNC) — separate from intraday positions in Kite. */
async function fetchHoldings() {
  const res = await fetch(`${KITE_BASE}/portfolio/holdings`, { headers: baseHeaders() });
  let json = null;
  try { json = await res.json(); } catch (e) { /* fallthrough */ }
  if (isTokenError(json, res.status)) throw new KiteTokenError('Kite token expired reading holdings.');
  if (!res.ok || !json || json.status !== 'success') {
    throw new Error(`Could not read holdings: HTTP ${res.status}`);
  }
  return json.data || [];
}

/** Cheap liveness probe for the access token. */
async function verifyToken() {
  try {
    const res = await fetch(`${KITE_BASE}/user/margins`, { headers: baseHeaders() });
    const json = await res.json().catch(() => null);
    if (isTokenError(json, res.status)) return { valid: false, reason: 'TokenException' };
    if (!res.ok || !json || json.status !== 'success') {
      return { valid: false, reason: `HTTP ${res.status}` };
    }
    return { valid: true, equity: json.data && json.data.equity };
  } catch (err) {
    return { valid: false, reason: err.message };
  }
}

module.exports = {
  placeAndConfirm,
  placeOrderOnce,
  fetchOrderStatus,
  awaitTerminalState,
  fetchNetPositions,
  fetchHoldings,
  verifyToken,
  KiteTokenError
};
