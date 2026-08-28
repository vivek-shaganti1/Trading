/**
 * REPRODUCTION HARNESS — proves why the system never emits a BUY.
 * Run: node backend/diagnostics/repro_signal_veto.js
 *
 * Exercises agent11 (priceActionStructureAgent) — the primary trigger in the
 * "candle-first" decision engine — across a sweep of synthetic-but-realistic
 * 5-minute candle series, and reports how often it can emit BUY.
 */
const path = require('path');
const agent11 = require(path.join(__dirname, '..', 'priceActionStructureAgent.js'));

// Build a deterministic bullish series: strong uptrend, higher highs / higher lows,
// expanding volume on completed bars, last bar = partially-formed (as Yahoo returns intraday).
function buildSeries({ n = 60, trend = 1, partialLastBar = true, fullBarVolume = 100000 }) {
  const candles = { closes: [], opens: [], highs: [], lows: [], volumes: [] };
  let price = 1000;
  for (let i = 0; i < n; i++) {
    const drift = trend * (0.4 + (i % 3) * 0.1);
    const open = price;
    price = price * (1 + drift / 100);
    const close = price;
    candles.opens.push(+open.toFixed(2));
    candles.closes.push(+close.toFixed(2));
    candles.highs.push(+(Math.max(open, close) * 1.002).toFixed(2));
    candles.lows.push(+(Math.min(open, close) * 0.998).toFixed(2));
    // Last bar is still forming -> only a fraction of a full bar's volume
    const isLast = i === n - 1;
    candles.volumes.push(isLast && partialLastBar ? Math.round(fullBarVolume * 0.15) : fullBarVolume);
  }
  return candles;
}

// Stub marketData.getHistory so the agent consumes our controlled series.
function installHistory(series) {
  const md = require(path.join(__dirname, '..', 'marketData.js'));
  md.getHistory = async () => ({ ...series, source: 'LIVE' });
}

(async () => {
  console.log('='.repeat(78));
  console.log('REPRO: can agent11 (price-action, the PRIMARY trigger) ever emit BUY?');
  console.log('='.repeat(78));

  const scenarios = [
    { name: 'Strong uptrend, last bar partially formed (REAL intraday shape)', opts: { trend: 1.0, partialLastBar: true } },
    { name: 'Strong uptrend, last bar COMPLETE, flat volume',                   opts: { trend: 1.0, partialLastBar: false } },
    { name: 'Explosive uptrend, last bar complete',                             opts: { trend: 2.5, partialLastBar: false } },
    { name: 'Downtrend',                                                        opts: { trend: -1.0, partialLastBar: false } },
  ];

  let buyCount = 0;
  for (const s of scenarios) {
    const series = buildSeries(s.opts);
    installHistory(series);
    const r = await agent11.predict('TESTSYM', series.closes);
    if (r.signal === 'BUY') buyCount++;
    const volLine = String(r.reasoning).match(/Volume expanded to ([\d.]+)x/);
    console.log(`\n• ${s.name}`);
    console.log(`    signal = ${r.signal}   confidence = ${r.confidence}`);
    console.log(`    volRatio seen by failsafe = ${volLine ? volLine[1] + 'x' : 'n/a'}  (BUY requires >= 1.2x)`);
    console.log(`    ${String(r.reasoning).slice(0, 150)}`);
  }

  console.log('\n' + '-'.repeat(78));
  console.log(`RESULT: BUY emitted in ${buyCount} of ${scenarios.length} scenarios.`);
  if (buyCount === 0) {
    console.log('>> CONFIRMED DEFECT: the primary trigger agent cannot emit BUY under any');
    console.log('   trend condition, because volRatio = lastBarVolume / avgVolume is');
    console.log('   structurally < 1.2 (last intraday bar is partial; synthetic fallback');
    console.log('   uses constant volume => ratio exactly 1.0).');
    console.log('   => primarySignal stays HOLD => adaptiveDecisionEngine Gate 8 rejects');
    console.log('      "Signal direction is neutral (HOLD)" => zero BUY orders, ever.');
  }
  console.log('-'.repeat(78));
})();
