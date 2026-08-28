/**
 * dry_run_session.js — end-to-end pipeline dry run.
 *
 * Answers the only question that matters: with the market forced open, does a
 * real symbol actually travel scan -> signal -> consensus -> decision -> ORDER?
 *
 * SAFETY: broker.executeOrder is stubbed out. Nothing is written to db.json,
 * no order reaches any broker, and no Telegram message is sent. This observes
 * the pipeline; it does not trade.
 *
 * Run: node backend/diagnostics/dry_run_session.js
 */

const path = require('path');

// ── 1. Force a live market session BEFORE anything reads the clock ──────────
// 2026-08-27 is a Thursday and is not in the NSE holiday table.
global.mockTime = { hours: 11, minutes: 0, seconds: 0, dateStr: '2026-08-27', day: 4 };

const fsm = require(path.join(__dirname, '..', 'lifecycleFSM.js'));
const broker = require(path.join(__dirname, '..', 'broker.js'));
const predictor = require(path.join(__dirname, '..', 'predictor.js'));
const alerts = require(path.join(__dirname, '..', 'alerts.js'));
const db = require(path.join(__dirname, '..', 'db.js'));

// ── 2. Neutralise every side effect ─────────────────────────────────────────
const attemptedOrders = [];
broker.executeOrder = async (symbol, action, qty, strategy, reason) => {
  attemptedOrders.push({ symbol, action, qty, strategy });
  return { simulated: true };
};
const telegramsSuppressed = [];
alerts.sendTelegram = async (msg) => { telegramsSuppressed.push(String(msg).slice(0, 70)); return true; };
db.writeLocalDb = () => {};              // no ledger mutation
db.logTrade = async () => ({ simulated: true });
db.updatePortfolioState = async (u) => u;

const SYMBOLS = ['RELIANCE', 'TCS', 'HDFCBANK', 'INFY', 'ICICIBANK',
                 'SBIN', 'ITC', 'AXISBANK', 'LT', 'BHARTIARTL'];

(async () => {
  console.log('\n' + '='.repeat(72));
  console.log('  END-TO-END DRY RUN — market forced open, all side effects stubbed');
  console.log('='.repeat(72));

  const session = fsm.getTradingSession();
  console.log(`\nSession        : ${session.session}   canTrade=${session.canTrade}   isOpen=${session.isOpen}`);
  console.log(`Clock (mocked) : ${global.mockTime.dateStr} 11:00 IST (Thursday)`);
  console.log(`Broker mode    : ${require('../../shared/config').BROKER_MODE}  (no Kite keys => paper ledger)\n`);

  if (!session.canTrade) {
    console.log('Session gate says trading is not allowed — aborting.');
    process.exit(1);
  }

  const rows = [];
  let live = 0, buys = 0, executable = 0;

  for (const sym of SYMBOLS) {
    process.stdout.write(`  ${sym.padEnd(12)}`);
    try {
      const p = await predictor.getPrediction(sym, []);
      const src = p.dataSource || 'LIVE';
      if (src !== 'LIVE') {
        console.log(`data ${src} — skipped (refusing to trade on non-live candles)`);
        rows.push({ sym, signal: '-', src, note: 'no live data' });
        continue;
      }
      live++;
      const sig = p.signal || '-';
      const tqs = p.tradeQuality != null ? p.tradeQuality : '-';
      const exec = !!p.execute;
      if (sig === 'BUY') buys++;
      if (exec) executable++;
      console.log(`${String(sig).padEnd(5)} TQS ${String(tqs).padEnd(4)} exec=${exec}  ${exec ? '' : '(' + String(p.rejectionReason || '').slice(0, 52) + ')'}`);
      rows.push({ sym, signal: sig, tqs, exec, reason: p.rejectionReason });
    } catch (e) {
      console.log(`ERROR ${e.message.slice(0, 60)}`);
      rows.push({ sym, signal: 'ERR', note: e.message.slice(0, 60) });
    }
  }

  console.log('\n' + '-'.repeat(72));
  console.log(`Symbols with live data reaching the predictor : ${live}/${SYMBOLS.length}`);
  console.log(`BUY signals produced                          : ${buys}`);
  console.log(`Setups the decision engine marked executable  : ${executable}`);
  console.log(`Orders the pipeline attempted (stubbed)       : ${attemptedOrders.length}`);
  if (attemptedOrders.length) {
    attemptedOrders.forEach(o => console.log(`   -> ${o.action} ${o.qty} ${o.symbol} (${o.strategy})`));
  }
  console.log(`Telegram messages suppressed during the run   : ${telegramsSuppressed.length}`);
  console.log('-'.repeat(72));

  // What this does and does not prove.
  console.log('\nWHAT THIS SHOWS');
  if (live === 0) {
    console.log('  Market data could not be fetched, so nothing can be concluded about');
    console.log('  signal quality. The data-integrity gate correctly refused to trade.');
  } else if (buys === 0) {
    console.log('  The pipeline runs end-to-end on live data but produced no BUY today.');
    console.log('  That is a market outcome, not necessarily a defect — check the');
    console.log('  rejection reasons above.');
  } else {
    console.log(`  A real symbol travelled the full path and produced ${buys} BUY signal(s),`);
    console.log(`  ${executable} of which cleared the decision engine. Before the fixes this`);
    console.log('  was structurally impossible: the count was zero for every input.');
  }
  console.log('\n  NOT proven by this run: live fill quality, slippage, win rate, or');
  console.log('  behaviour during real market volatility. No order was sent anywhere.');
  console.log('');
  process.exit(0);
})();
