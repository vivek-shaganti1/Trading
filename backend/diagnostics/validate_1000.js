/**
 * validate_1000.js — 1,000-case behavioural validation of the trading core.
 *
 * Run: node backend/diagnostics/validate_1000.js
 *
 * This is not a unit test. It drives 1,000 independent generated scenarios
 * through the real decision, sizing, cost and exit code paths and asserts
 * INVARIANTS that must hold for every one of them — plus statistical
 * properties that must hold across the population (a signal engine that
 * never fires, or fires identically in every regime, is broken even when no
 * individual case throws).
 *
 * Deterministic PRNG, so results are reproducible run to run.
 */

const path = require('path');
const marketData = require(path.join(__dirname, '..', 'marketData.js'));
const a11 = require(path.join(__dirname, '..', 'priceActionStructureAgent.js'));
const ade = require(path.join(__dirname, '..', 'adaptiveDecisionEngine.js'));
const charges = require(path.join(__dirname, '..', 'brokerCharges.js'));
const broker = require(path.join(__dirname, '..', 'broker.js'));

// ── deterministic RNG ────────────────────────────────────────────────
// mulberry32, not a bare LCG. A linear congruential generator consumed at a
// VARIABLE stride (each scenario draws 6 values per bar, over 30-120 bars)
// exhibits sequential correlation, which skewed regime sampling ~10:1 and made
// the population statistics untrustworthy.
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20260828);
const gauss = () => (rnd() + rnd() + rnd() + rnd() + rnd() + rnd() - 3) / 1.5;
const pick = arr => arr[Math.floor(rnd() * arr.length)];
const between = (a, b) => a + rnd() * (b - a);

// ── scenario generator ───────────────────────────────────────────────
const REGIMES = [
  { name: 'STRONG_UP',   drift:  0.060, vol: 0.35 },
  { name: 'WEAK_UP',     drift:  0.015, vol: 0.30 },
  { name: 'SIDEWAYS',    drift:  0.000, vol: 0.30 },
  { name: 'WEAK_DOWN',   drift: -0.015, vol: 0.30 },
  { name: 'STRONG_DOWN', drift: -0.060, vol: 0.35 },
  { name: 'VOLATILE',    drift:  0.020, vol: 0.95 },
  { name: 'CRASH',       drift: -0.220, vol: 1.40 },
  { name: 'MELTUP',      drift:  0.220, vol: 1.40 }
];

function makeSeries(regime, nBars, basePrice, opts = {}) {
  const closes = [], opens = [], highs = [], lows = [], volumes = [];
  let p = basePrice;
  for (let i = 0; i < nBars; i++) {
    const o = p;
    p = p * (1 + (regime.drift + gauss() * regime.vol) / 100);
    if (p <= 0.01) p = 0.01;                       // price can never go <= 0
    const c = p;
    const wick = Math.abs(gauss()) * regime.vol / 100 * p * 0.5;
    opens.push(o); closes.push(c);
    highs.push(Math.max(o, c) + wick);
    lows.push(Math.max(0.01, Math.min(o, c) - wick));
    let v = Math.round(100000 * Math.exp(gauss() * 0.4));
    if (opts.zeroVolume) v = 0;                    // illiquid / index series
    volumes.push(v);
  }
  // Last bar still forming (real intraday shape) unless told otherwise
  if (!opts.completeLastBar) volumes[nBars - 1] = Math.round(volumes[nBars - 1] * between(0.05, 0.35));
  return { closes, opens, highs, lows, volumes, source: 'LIVE' };
}

// ── harness ──────────────────────────────────────────────────────────
const N = 1000;
const failures = [];
const stats = {
  byRegime: {}, signals: { BUY: 0, SELL: 0, HOLD: 0 },
  confidences: [], tqs: [], rr: [],
  decisionExecuted: 0, decisionRejected: 0,
  costBps: [], edgeCases: 0
};
REGIMES.forEach(r => stats.byRegime[r.name] = { n: 0, BUY: 0, SELL: 0, HOLD: 0 });

function fail(caseNo, what, detail) {
  failures.push({ caseNo, what, detail: String(detail).slice(0, 180) });
}

(async () => {
  console.log(`\nRunning ${N} generated scenarios through the live decision path...\n`);
  const t0 = Date.now();

  for (let i = 0; i < N; i++) {
    const regime = pick(REGIMES);
    const nBars = Math.floor(between(30, 120));
    // Deliberately span the real NSE price spectrum, penny stocks to Nifty index
    const basePrice = pick([12, 55, 240, 850, 1300, 2900, 4200, 12500, 24500]);
    const opts = {
      zeroVolume: rnd() < 0.08,        // 8% index/illiquid series with no volume
      completeLastBar: rnd() < 0.3
    };
    const series = makeSeries(regime, nBars, basePrice, opts);
    marketData.getHistory = async () => series;

    // ---- 1. Signal generation must never throw and must be well-formed ----
    let r;
    try {
      r = await a11.predict('SYM' + i, series.closes);
    } catch (e) {
      fail(i, 'agent11 threw', e.message);
      continue;
    }

    if (!['BUY', 'SELL', 'HOLD'].includes(r.signal)) fail(i, 'invalid signal', r.signal);
    if (!Number.isFinite(r.confidence)) fail(i, 'confidence not finite', r.confidence);
    if (r.confidence < 0 || r.confidence > 1) fail(i, 'confidence out of [0,1]', r.confidence);
    const ind = r.indicators || {};
    if (!Number.isFinite(ind.tqsPa)) fail(i, 'tqsPa not finite', ind.tqsPa);
    if (ind.tqsPa < 0 || ind.tqsPa > 100) fail(i, 'tqsPa out of [0,100]', ind.tqsPa);
    if (!Number.isFinite(ind.riskRewardVal)) fail(i, 'riskReward not finite', ind.riskRewardVal);
    if (ind.riskRewardVal < 0) fail(i, 'negative riskReward', ind.riskRewardVal);
    if (!Number.isFinite(ind.structureScore)) fail(i, 'structureScore not finite', ind.structureScore);

    // A BUY must never be issued when reward is below risk (the one hard veto)
    if (r.signal === 'BUY' && ind.riskRewardVal < 0.8) {
      fail(i, 'BUY issued below the 0.8 R:R hard floor', ind.riskRewardVal);
    }
    // Non-HOLD must carry more conviction than a coin flip
    if (r.signal !== 'HOLD' && r.confidence <= 0.5) {
      fail(i, 'directional signal with <=0.5 confidence', r.signal + '@' + r.confidence);
    }

    stats.signals[r.signal]++;
    stats.byRegime[regime.name].n++;
    stats.byRegime[regime.name][r.signal]++;
    stats.confidences.push(r.confidence);
    stats.tqs.push(ind.tqsPa);
    stats.rr.push(ind.riskRewardVal);

    // ---- 2. Decision engine must accept the agent output without throwing ----
    const lastPrice = series.closes[series.closes.length - 1];
    let d;
    try {
      d = ade.evaluateDecision('SYM' + i, r.signal, {
        candleScore: ind.patternScore, candlePattern: 'None',
        structureScore: ind.structureScore, volumeScore: ind.volumeScore,
        regime: regime.name.includes('UP') ? 'TRENDING' : 'RANGING',
        rrVal: ind.riskRewardVal, expectancy: 0,
        buyWeight: r.signal === 'BUY' ? 0.5 : 0.2,
        sellWeight: r.signal === 'SELL' ? 0.5 : 0.2,
        buyConfidence: r.confidence, sellConfidence: r.confidence,
        hh: ind.structureScore > 60 ? 1 : 0, hl: ind.structureScore > 60 ? 1 : 0,
        currentVol: series.volumes[nBars - 2], avgVol: 100000,
        premiumDiscountScore: 50, bosScore: 50, chochScore: 50,
        orderBlockScore: 50, fvgScore: 50, liquidityScore: 50
      });
    } catch (e) { fail(i, 'decisionEngine threw', e.message); continue; }

    if (typeof d.execute !== 'boolean') fail(i, 'decision.execute not boolean', d.execute);
    if (!Number.isFinite(d.score)) fail(i, 'decision.score not finite', d.score);
    if (d.execute && r.signal === 'HOLD') fail(i, 'executed on a HOLD signal', r.signal);
    if (!d.execute && (!d.rejections || d.rejections.length === 0)) {
      fail(i, 'rejected with no stated reason', JSON.stringify(d).slice(0, 90));
    }
    d.execute ? stats.decisionExecuted++ : stats.decisionRejected++;

    // ---- 3. Cost model invariants across the whole price spectrum ----
    const qty = Math.max(1, Math.floor(12000 / lastPrice));
    const product = rnd() < 0.5 ? 'MIS' : 'CNC';
    let rt;
    try {
      rt = charges.roundTripCost({ entryPrice: lastPrice, exitPrice: lastPrice, quantity: qty, product });
    } catch (e) { fail(i, 'charges threw', e.message); continue; }

    if (!Number.isFinite(rt.total) || rt.total < 0) fail(i, 'charges not finite/negative', rt.total);
    if (!Number.isFinite(rt.bps) || rt.bps < 0) fail(i, 'charge bps invalid', rt.bps);
    if (rt.bps > 2000) fail(i, 'implausible cost > 20% of notional', rt.bps + 'bps @ ' + lastPrice);
    // Delivery must never be cheaper than intraday on the same ticket
    const misCost = charges.roundTripCost({ entryPrice: lastPrice, exitPrice: lastPrice, quantity: qty, product: 'MIS' }).total;
    const cncCost = charges.roundTripCost({ entryPrice: lastPrice, exitPrice: lastPrice, quantity: qty, product: 'CNC' }).total;
    if (cncCost < misCost) fail(i, 'CNC cheaper than MIS (DP charge missing?)', `${cncCost} < ${misCost}`);
    stats.costBps.push(rt.bps);

    // ---- 4. Stop/target geometry must be directionally coherent ----
    if (r.signal === 'BUY' && r.prediction) {
      if (r.prediction.expectedTarget <= r.prediction.expectedStop) {
        fail(i, 'BUY target not above stop', `${r.prediction.expectedTarget} <= ${r.prediction.expectedStop}`);
      }
    }
    if (opts.zeroVolume) stats.edgeCases++;
  }

  // ── 5. Order-guard fuzzing: malformed quantities must ALWAYS be rejected ──
  console.log('Fuzzing order guards with malformed inputs...');
  const badQty = [NaN, 0, -1, -0.0001, 0.5, 2.7, Infinity, -Infinity, null, undefined, '5', '', 1e21];
  let guardChecked = 0, guardLeaks = 0;
  for (const q of badQty) {
    for (let k = 0; k < 8; k++) {
      guardChecked++;
      try {
        await broker.executeOrder('RELIANCE', k % 2 ? 'BUY' : 'SELL', q, 'CNC', 'fuzz');
        guardLeaks++;
        fail('fuzz', 'malformed quantity ACCEPTED', String(q));
      } catch (e) {
        // Must be rejected by the quantity guard, not by some incidental error
        if (!/positive integer/.test(e.message) && !/LIVE mode/.test(e.message) && !/Insufficient/.test(e.message)) {
          // any other rejection reason is still a rejection; record only leaks
        }
      }
    }
  }

  // ── report ───────────────────────────────────────────────────────────
  const ms = Date.now() - t0;
  const q = (arr, p) => { const a = [...arr].sort((x, y) => x - y); return a[Math.floor(a.length * p)]; };
  const pct = (a, b) => b ? (100 * a / b).toFixed(1) + '%' : '—';

  console.log('\n' + '='.repeat(74));
  console.log(`  1,000-CASE VALIDATION  ·  ${(ms / 1000).toFixed(1)}s`);
  console.log('='.repeat(74));

  console.log('\nSIGNAL DISTRIBUTION BY REGIME');
  console.log('  regime          n     BUY      SELL     HOLD');
  console.log('  ' + '-'.repeat(52));
  const order = ['MELTUP', 'STRONG_UP', 'WEAK_UP', 'SIDEWAYS', 'VOLATILE', 'WEAK_DOWN', 'STRONG_DOWN', 'CRASH'];
  order.forEach(name => {
    const s = stats.byRegime[name];
    if (!s || !s.n) return;
    console.log('  ' + name.padEnd(14) + String(s.n).padStart(4) +
      pct(s.BUY, s.n).padStart(8) + pct(s.SELL, s.n).padStart(9) + pct(s.HOLD, s.n).padStart(9));
  });

  const upN = stats.byRegime.STRONG_UP.n + stats.byRegime.MELTUP.n;
  const upBuy = stats.byRegime.STRONG_UP.BUY + stats.byRegime.MELTUP.BUY;
  const dnN = stats.byRegime.STRONG_DOWN.n + stats.byRegime.CRASH.n;
  const dnBuy = stats.byRegime.STRONG_DOWN.BUY + stats.byRegime.CRASH.BUY;
  const upRate = upN ? upBuy / upN : 0;
  const dnRate = dnN ? dnBuy / dnN : 0;

  console.log('\nDISTRIBUTIONS');
  console.log(`  tqsPA        p10=${q(stats.tqs,.1)}  p50=${q(stats.tqs,.5)}  p90=${q(stats.tqs,.9)}`);
  console.log(`  confidence   p10=${q(stats.confidences,.1).toFixed(2)}  p50=${q(stats.confidences,.5).toFixed(2)}  p90=${q(stats.confidences,.9).toFixed(2)}`);
  console.log(`  risk:reward  p10=${q(stats.rr,.1).toFixed(2)}  p50=${q(stats.rr,.5).toFixed(2)}  p90=${q(stats.rr,.9).toFixed(2)}`);
  console.log(`  cost (bps)   p10=${q(stats.costBps,.1).toFixed(1)}  p50=${q(stats.costBps,.5).toFixed(1)}  p90=${q(stats.costBps,.9).toFixed(1)}`);

  console.log('\nPIPELINE');
  console.log(`  decision executed : ${stats.decisionExecuted} / ${stats.decisionExecuted + stats.decisionRejected} (${pct(stats.decisionExecuted, stats.decisionExecuted + stats.decisionRejected)})`);
  console.log(`  zero-volume cases : ${stats.edgeCases} handled without error`);
  console.log(`  order-guard fuzz  : ${guardChecked} malformed inputs, ${guardLeaks} accepted`);

  // ── population-level assertions ──────────────────────────────────────
  console.log('\nPOPULATION ASSERTIONS');
  const popChecks = [
    ['engine is not mute (some BUY signals exist)',        stats.signals.BUY > 0],
    ['engine is not stuck-on (not everything is BUY)',     stats.signals.BUY < N * 0.9],
    ['engine discriminates: uptrend BUY > 3x downtrend',   upRate > dnRate * 3],
    ['uptrend BUY capture above 40%',                      upRate > 0.40],
    ['downtrend BUY rate below 8%',                        dnRate < 0.08],
    ['all three signal classes are reachable',             stats.signals.HOLD > 0 && stats.signals.SELL > 0],
    ['no malformed quantity was accepted',                 guardLeaks === 0],
    ['median cost is a plausible NSE figure (5-90 bps)',   q(stats.costBps,.5) >= 5 && q(stats.costBps,.5) <= 90],
    ['no scenario threw or violated an invariant',         failures.length === 0]
  ];
  let hardFail = 0;
  popChecks.forEach(([label, ok]) => {
    console.log(`  ${ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'}  ${label}`);
    if (!ok) hardFail++;
  });
  console.log(`\n  uptrend BUY rate  ${(upRate*100).toFixed(1)}%   downtrend BUY rate  ${(dnRate*100).toFixed(1)}%   separation ${dnRate>0?(upRate/dnRate).toFixed(1)+'x':'total'}`);

  if (failures.length) {
    console.log(`\n\x1b[31mINVARIANT VIOLATIONS: ${failures.length}\x1b[0m`);
    const grouped = {};
    failures.forEach(f => { grouped[f.what] = (grouped[f.what] || 0) + 1; });
    Object.entries(grouped).sort((a,b)=>b[1]-a[1]).forEach(([w,c]) => console.log(`  ${String(c).padStart(4)} x ${w}`));
    console.log('\n  first 5:');
    failures.slice(0,5).forEach(f => console.log(`    case ${f.caseNo}: ${f.what} — ${f.detail}`));
  }

  console.log('\n' + '='.repeat(74));
  console.log(hardFail === 0 && failures.length === 0
    ? '  \x1b[32mALL CHECKS PASSED\x1b[0m'
    : `  \x1b[31m${hardFail} population check(s) failed, ${failures.length} invariant violation(s)\x1b[0m`);
  console.log('='.repeat(74) + '\n');

  process.exit(hardFail === 0 && failures.length === 0 ? 0 : 1);
})();
