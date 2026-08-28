/**
 * Network-free regression suite for the execution-path repairs.
 * Run: node backend/diagnostics/verify_fixes.js
 */
const assert = require('assert');
let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log('  \x1b[32mPASS\x1b[0m ' + name); pass++; }
  catch (e) { console.log('  \x1b[31mFAIL\x1b[0m ' + name + '\n        ' + e.message); fail++; }
}
async function ta(name, fn) {
  try { await fn(); console.log('  \x1b[32mPASS\x1b[0m ' + name); pass++; }
  catch (e) { console.log('  \x1b[31mFAIL\x1b[0m ' + name + '\n        ' + e.message); fail++; }
}

(async () => {
console.log('\n== 1. Transaction cost model ==');
const bc = require('../brokerCharges');
t('intraday round trip on Rs4000 is ~10-12 bps', () => {
  const rt = bc.roundTripCost({ entryPrice: 4000, exitPrice: 4000, quantity: 1, product: 'MIS' });
  assert(rt.bps > 9 && rt.bps < 13, `got ${rt.bps} bps`);
});
t('delivery round trip is materially higher than intraday (flat DP charge)', () => {
  const mis = bc.roundTripCost({ entryPrice: 4000, exitPrice: 4000, quantity: 1, product: 'MIS' });
  const cnc = bc.roundTripCost({ entryPrice: 4000, exitPrice: 4000, quantity: 1, product: 'CNC' });
  assert(cnc.total > mis.total * 4, `CNC ${cnc.total} vs MIS ${mis.total}`);
});
t('DP charge applies only to delivery SELL', () => {
  assert.strictEqual(bc.computeCharges({ side: 'BUY',  value: 4000, product: 'CNC' }).breakdown.dpCharge, 0);
  assert.strictEqual(bc.computeCharges({ side: 'SELL', value: 4000, product: 'MIS' }).breakdown.dpCharge, 0);
  assert(bc.computeCharges({ side: 'SELL', value: 4000, product: 'CNC' }).breakdown.dpCharge > 15);
});
t('brokerage is capped at Rs20 per leg', () => {
  const big = bc.computeCharges({ side: 'BUY', value: 5000000, product: 'MIS' });
  assert.strictEqual(big.breakdown.brokerage, 20, `got ${big.breakdown.brokerage}`);
});
t('cost per rupee is WORSE on smaller tickets (delivery)', () => {
  const small = bc.roundTripCost({ entryPrice: 500, exitPrice: 500, quantity: 2, product: 'CNC' });
  const large = bc.roundTripCost({ entryPrice: 500, exitPrice: 500, quantity: 200, product: 'CNC' });
  assert(small.bps > large.bps, `small ${small.bps} should exceed large ${large.bps}`);
});

console.log('\n== 2. Price-action agent can emit BUY (the no-trade root cause) ==');
const md = require('../marketData');
const a11 = require('../priceActionStructureAgent');
function series(n, rate, partialLast) {
  const closes = Array.from({ length: n }, (_, i) => 1000 * Math.pow(1 + rate, i));
  return {
    closes, opens: closes.map(c => c * 0.999),
    highs: closes.map(c => c * 1.003), lows: closes.map(c => c * 0.997),
    volumes: Array.from({ length: n }, (_, i) => (i === n - 1 && partialLast) ? 15000 : 100000),
    source: 'LIVE'
  };
}
// Realistic bars: a noiseless geometric curve contains no candle patterns,
// breakouts or retests, so those sub-models correctly sit at their neutral 50.
// Signal quality must be measured against noisy series, as the threshold was
// calibrated. Deterministic PRNG keeps this reproducible.
let seed = 12345;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const gauss = () => (rnd() + rnd() + rnd() + rnd() + rnd() + rnd() - 3) / 1.5;
function noisySeries(n, driftPct, volPct) {
  const closes = [], opens = [], highs = [], lows = [], volumes = [];
  let p = 1000;
  for (let i = 0; i < n; i++) {
    const o = p;
    p = p * (1 + (driftPct + gauss() * volPct) / 100);
    const c = p, wick = Math.abs(gauss()) * volPct / 100 * p * 0.5;
    opens.push(o); closes.push(c);
    highs.push(Math.max(o, c) + wick); lows.push(Math.min(o, c) - wick);
    volumes.push(Math.round(100000 * Math.exp(gauss() * 0.4)));
  }
  volumes[n - 1] = Math.round(volumes[n - 1] * 0.2); // forming bar
  return { closes, opens, highs, lows, volumes, source: 'LIVE' };
}
async function buyRate(drift, vol, n = 60) {
  let buys = 0;
  for (let i = 0; i < n; i++) {
    const s = noisySeries(70, drift, vol);
    md.getHistory = async () => s;
    const r = await a11.predict('T', s.closes);
    if (r.signal === 'BUY') buys++;
  }
  return buys / n;
}
let upRate, downRate;
await ta('fires BUY on a majority of realistic uptrends (was 0% — never once)', async () => {
  upRate = await buyRate(0.06, 0.35);
  assert(upRate > 0.5, `BUY rate on uptrends was only ${(upRate * 100).toFixed(0)}%`);
});
await ta('almost never fires BUY on downtrends', async () => {
  downRate = await buyRate(-0.06, 0.35);
  assert(downRate < 0.10, `BUY rate on downtrends was ${(downRate * 100).toFixed(0)}%`);
});
await ta('discriminates: uptrend BUY rate is >5x the downtrend rate', async () => {
  assert(upRate > downRate * 5, `up ${upRate} vs down ${downRate}`);
});
await ta('RVOL is measured on closed bars, so a partial last bar does not veto', async () => {
  const withPartial = series(70, 0.006, true);
  const noPartial = series(70, 0.006, false);
  md.getHistory = async () => withPartial;
  const r1 = await a11.predict('T', withPartial.closes);
  md.getHistory = async () => noPartial;
  const r2 = await a11.predict('T', noPartial.closes);
  assert.strictEqual(r1.signal, r2.signal, `partial=${r1.signal} vs full=${r2.signal}`);
});
await ta('risk:reward is positive on a breakout (was 0.02 before)', async () => {
  const s = series(70, 0.006, true);
  md.getHistory = async () => s;
  const r = await a11.predict('T', s.closes);
  assert(r.indicators.riskRewardVal > 1.0, `RR=${r.indicators.riskRewardVal}`);
});
await ta('structure score recognises a trend (was pinned at 50)', async () => {
  const s = series(70, 0.006, true);
  md.getHistory = async () => s;
  const r = await a11.predict('T', s.closes);
  assert(r.indicators.structureScore > 60, `structure=${r.indicators.structureScore}`);
});

console.log('\n== 3. Decision engine accepts a valid setup ==');
const ade = require('../adaptiveDecisionEngine');
t('a strong BUY setup passes the gate chain', () => {
  const d = ade.evaluateDecision('T', 'BUY', {
    candleScore: 75, candlePattern: 'Bullish Engulfing', structureScore: 78,
    volumeScore: 70, regime: 'TRENDING', rrVal: 2.2, expectancy: 0.4,
    buyWeight: 0.55, sellWeight: 0.15, buyConfidence: 0.68,
    hh: 1, hl: 1, currentVol: 120000, avgVol: 100000,
    premiumDiscountScore: 55, bosScore: 70, chochScore: 60,
    orderBlockScore: 60, fvgScore: 55, liquidityScore: 60,
    trend1D: 'BUY', trend1H: 'BUY', trend15M: 'BUY'
  });
  assert.strictEqual(d.execute, true, `rejected: ${d.rejections.join('; ')}`);
});
t('a HOLD direction is still rejected', () => {
  const d = ade.evaluateDecision('T', 'HOLD', { candleScore: 75, structureScore: 78 });
  assert.strictEqual(d.execute, false);
});

console.log('\n== 4. Alert logging accepts both call styles ==');
const db = require('../db');
await ta('positional logAlert("CRITICAL", msg) is recorded, not dropped', async () => {
  await db.logAlert('CRITICAL', 'regression-probe-positional');
  const d = db.readLocalDb();
  const hit = (d.alerts || []).find(x => x.message === 'regression-probe-positional');
  assert(hit, 'alert was not stored');
  assert.strictEqual(hit.type, 'CRITICAL');
});
await ta('object logAlert({type,message}) still works', async () => {
  await db.logAlert({ type: 'WARNING', message: 'regression-probe-object' });
  const d = db.readLocalDb();
  const hit = (d.alerts || []).find(x => x.message === 'regression-probe-object');
  assert(hit && hit.type === 'WARNING');
});

console.log('\n== 5. Order-quantity guards ==');
const broker = require('../broker');
for (const [label, q] of [['NaN', NaN], ['zero', 0], ['negative', -5], ['fractional', 2.5], ['Infinity', Infinity]]) {
  await ta(`rejects ${label} quantity`, async () => {
    let threw = false;
    try { await broker.executeOrder('RELIANCE', 'BUY', q, 'CNC', 'probe'); }
    catch (e) { threw = /positive integer/.test(e.message); }
    assert(threw, `${label} quantity was not rejected`);
  });
}

console.log('\n== 6. Emergency square-off uses a real broker method ==');
const riskEngine = require('../riskEngine');
await ta('calls executeOrder and reports unsold positions instead of blanking the book', async () => {
  const calls = [];
  const fakeBroker = {
    executeOrder: async (sym, act, qty) => {
      calls.push([sym, act, qty]);
      if (sym === 'FAILS') throw new Error('simulated broker rejection');
      return { ok: true };
    }
  };
  const res = await riskEngine.triggerEmergencySquareOff(fakeBroker, [
    { symbol: 'GOODONE', quantity: 3, strategy: 'MIS' },
    { symbol: 'FAILS', quantity: 2, strategy: 'MIS' }
  ]);
  assert(calls.some(c => c[0] === 'GOODONE' && c[1] === 'SELL'), 'did not sell the good position');
  assert.strictEqual(res.success, false, 'should report failure when a position could not be sold');
  assert(res.unsold.includes('FAILS'), 'unsold position not reported');
  assert(res.sold.includes('GOODONE'), 'sold position not reported');
});

console.log('\n' + '='.repeat(56));
console.log(`  ${pass} passed, ${fail} failed`);
console.log('='.repeat(56));
process.exit(fail ? 1 : 0);
})();
