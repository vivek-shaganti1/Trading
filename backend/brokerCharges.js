/**
 * brokerCharges.js — Realistic Indian equity transaction-cost model.
 *
 * Replaces the flat `orderValue * 0.0005` (5 bps/leg) approximation that was
 * duplicated across broker.js, db.js and tradingBot.js. That model understated
 * real delivery costs by roughly 6x, principally because it could not express
 * the FLAT per-scrip DP charge on delivery sells — which on a small ticket is
 * the single largest component.
 *
 * Rates below follow Zerodha's published equity rate card. They are declared as
 * data so they can be updated in one place when the exchanges revise them.
 * Verify against https://zerodha.com/charges before relying on exact figures.
 */

const RATES = {
  // Brokerage: 0.03% or Rs 20 per executed order, whichever is LOWER (intraday).
  // Delivery is brokerage-free.
  INTRADAY_BROKERAGE_PCT: 0.0003,
  INTRADAY_BROKERAGE_CAP: 20,
  DELIVERY_BROKERAGE: 0,

  // Securities Transaction Tax
  STT_INTRADAY_SELL_PCT: 0.00025,  // 0.025% on sell turnover only
  STT_DELIVERY_PCT: 0.001,         // 0.1% on BOTH buy and sell turnover

  // NSE exchange transaction charges
  NSE_TXN_PCT: 0.0000297,          // 0.00297% of turnover

  // SEBI turnover fees + Investor Protection Fund
  SEBI_PCT: 0.000001,              // Rs 10 per crore
  IPFT_PCT: 0.000001,              // Rs 10 per crore

  // Stamp duty — buy side only
  STAMP_INTRADAY_PCT: 0.00003,     // 0.003%
  STAMP_DELIVERY_PCT: 0.00015,     // 0.015%

  // GST on (brokerage + exchange txn + SEBI)
  GST_PCT: 0.18,

  // CDSL/DP charge: FLAT per scrip per day on a DELIVERY SELL, regardless of qty.
  // This is what a percentage-only model structurally cannot represent.
  DP_CHARGE_FLAT: 13.5,
  DP_CHARGE_GST: 0.18
};

/**
 * Compute the exact statutory + brokerage charges for a single leg.
 *
 * @param {object} p
 * @param {'BUY'|'SELL'} p.side
 * @param {number} p.value            turnover for this leg (price * qty)
 * @param {'MIS'|'CNC'} [p.product]   MIS = intraday, CNC = delivery
 * @returns {{total:number, breakdown:object}}
 */
function computeCharges({ side, value, product = 'MIS' }) {
  const turnover = Math.abs(Number(value) || 0);
  if (turnover <= 0) return { total: 0, breakdown: {} };

  const isIntraday = product === 'MIS';
  const isSell = String(side).toUpperCase() === 'SELL';

  const brokerage = isIntraday
    ? Math.min(turnover * RATES.INTRADAY_BROKERAGE_PCT, RATES.INTRADAY_BROKERAGE_CAP)
    : RATES.DELIVERY_BROKERAGE;

  let stt = 0;
  if (isIntraday) {
    if (isSell) stt = turnover * RATES.STT_INTRADAY_SELL_PCT;
  } else {
    stt = turnover * RATES.STT_DELIVERY_PCT; // both legs
  }

  const exchangeTxn = turnover * RATES.NSE_TXN_PCT;
  const sebi = turnover * RATES.SEBI_PCT;
  const ipft = turnover * RATES.IPFT_PCT;

  const stampDuty = isSell
    ? 0
    : turnover * (isIntraday ? RATES.STAMP_INTRADAY_PCT : RATES.STAMP_DELIVERY_PCT);

  const gst = (brokerage + exchangeTxn + sebi) * RATES.GST_PCT;

  // Flat DP charge applies only when delivering shares out (CNC sell).
  const dpCharge = (!isIntraday && isSell)
    ? RATES.DP_CHARGE_FLAT * (1 + RATES.DP_CHARGE_GST)
    : 0;

  const total = brokerage + stt + exchangeTxn + sebi + ipft + stampDuty + gst + dpCharge;

  return {
    total: round2(total),
    breakdown: {
      brokerage: round2(brokerage),
      stt: round2(stt),
      exchangeTxn: round2(exchangeTxn),
      sebi: round2(sebi),
      ipft: round2(ipft),
      stampDuty: round2(stampDuty),
      gst: round2(gst),
      dpCharge: round2(dpCharge)
    }
  };
}

/**
 * Full round-trip cost for a position, in rupees and in basis points of the
 * entry notional. Use this — not a flat percentage — anywhere the system needs
 * to know whether a setup's expected move can actually clear costs.
 */
function roundTripCost({ entryPrice, exitPrice, quantity, product = 'MIS' }) {
  const entryValue = entryPrice * quantity;
  const exitValue = (exitPrice || entryPrice) * quantity;
  const buy = computeCharges({ side: 'BUY', value: entryValue, product });
  const sell = computeCharges({ side: 'SELL', value: exitValue, product });
  const total = round2(buy.total + sell.total);
  return {
    total,
    entryCharges: buy.total,
    exitCharges: sell.total,
    bps: entryValue > 0 ? round2((total / entryValue) * 10000) : 0,
    breakdown: { buy: buy.breakdown, sell: sell.breakdown }
  };
}

/**
 * Minimum favourable move (as a fraction of entry price) required merely to
 * break even after all charges. The decision layer uses this as a hard floor:
 * a target that does not clear it has negative expectancy before any
 * probability weighting is applied.
 */
function breakevenMovePct({ entryPrice, quantity, product = 'MIS' }) {
  const rt = roundTripCost({ entryPrice, exitPrice: entryPrice, quantity, product });
  const notional = entryPrice * quantity;
  if (notional <= 0) return Infinity;
  return (rt.total / notional) * 100;
}

function round2(n) {
  return parseFloat((Number(n) || 0).toFixed(2));
}

module.exports = { RATES, computeCharges, roundTripCost, breakevenMovePct };
