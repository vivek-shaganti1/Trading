#!/usr/bin/env node
/**
 * clean_stale_data.js
 * -------------------
 * One-shot cleanup script for the local db.json.
 *
 * What it removes:
 *   1. completed_trades with synthetic symbols (STRTECH|TELE|TEXT|ENER|SERV|INDU + optional digits)
 *   2. completed_trades where entry_price == exit_price AND exit_reason contains 'Emergency Liquidation'
 *   3. daily_stats entries from non-today dates whose status contains 'HALTED'
 *   4. Resets portfolio_state.holding_stocks to []
 *
 * Usage:  node scratch/clean_stale_data.js
 */

const db = require('../db');

const SYNTHETIC_RE = /^(STRTECH|TELE|TEXT|ENER|SERV|INDU)\d*$/;

function todayDateStr() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

(async () => {
  console.log('[CLEAN] Waiting for DB initialisation...');
  await db.initPromise;
  console.log('[CLEAN] DB ready. Reading local data...\n');

  const data = db.readLocalDb();
  const today = todayDateStr();

  // ── 1. Remove completed_trades with synthetic symbols ──────────────────
  const originalTrades = (data.completed_trades || []).slice();
  const syntheticTrades = originalTrades.filter(t => SYNTHETIC_RE.test(t.symbol));

  if (syntheticTrades.length > 0) {
    console.log(`[CLEAN] Removing ${syntheticTrades.length} synthetic-symbol trade(s):`);
    syntheticTrades.forEach(t => {
      console.log(`   ✗ ${t.trade_id || 'no-id'}  ${t.symbol}  entry=${t.entry_price}  exit=${t.exit_price}  pnl=${t.net_pnl}`);
    });
  } else {
    console.log('[CLEAN] No synthetic-symbol trades found.');
  }

  // ── 2. Remove zero-return halt victims ─────────────────────────────────
  const afterSynthetic = originalTrades.filter(t => !SYNTHETIC_RE.test(t.symbol));
  const haltVictims = afterSynthetic.filter(t =>
    t.entry_price === t.exit_price &&
    typeof t.exit_reason === 'string' &&
    t.exit_reason.includes('Emergency Liquidation')
  );

  if (haltVictims.length > 0) {
    console.log(`\n[CLEAN] Removing ${haltVictims.length} zero-return halt-victim trade(s):`);
    haltVictims.forEach(t => {
      console.log(`   ✗ ${t.trade_id || 'no-id'}  ${t.symbol}  price=${t.entry_price}  reason="${t.exit_reason}"`);
    });
  } else {
    console.log('\n[CLEAN] No zero-return halt-victim trades found.');
  }

  const haltVictimIds = new Set(haltVictims.map(t => t.trade_id));
  data.completed_trades = afterSynthetic.filter(t => !haltVictimIds.has(t.trade_id));

  // ── 3. Remove stale HALTED daily_stats from non-today dates ────────────
  const originalStats = (data.daily_stats || []).slice();
  const staleHalted = originalStats.filter(s => {
    const statusStr = typeof s.status === 'string' ? s.status : '';
    const dateStr = s.date || '';
    return statusStr.includes('HALTED') && dateStr !== today;
  });

  if (staleHalted.length > 0) {
    console.log(`\n[CLEAN] Removing ${staleHalted.length} stale HALTED daily_stats entr(ies):`);
    staleHalted.forEach(s => {
      console.log(`   ✗ date=${s.date}  status="${s.status}"`);
    });
  } else {
    console.log('\n[CLEAN] No stale HALTED daily_stats found.');
  }

  const staleDates = new Set(staleHalted.map(s => s.date));
  data.daily_stats = originalStats.filter(s => {
    const statusStr = typeof s.status === 'string' ? s.status : '';
    const dateStr = s.date || '';
    // Only remove if it's a HALTED entry from a non-today date
    if (statusStr.includes('HALTED') && dateStr !== today) return false;
    return true;
  });

  // ── 4. Reset holding_stocks ────────────────────────────────────────────
  const prevHoldings = (data.portfolio_state && data.portfolio_state.holding_stocks) || [];
  if (prevHoldings.length > 0) {
    console.log(`\n[CLEAN] Clearing ${prevHoldings.length} holding_stocks entry(ies):`);
    prevHoldings.forEach(h => {
      const sym = typeof h === 'string' ? h : (h.symbol || JSON.stringify(h));
      console.log(`   ✗ ${sym}`);
    });
  } else {
    console.log('\n[CLEAN] holding_stocks already empty.');
  }
  data.portfolio_state.holding_stocks = [];

  // ── Write back ─────────────────────────────────────────────────────────
  db.writeLocalDb(data);
  console.log('\n[CLEAN] Data written back to db.json.');

  // ── Final summary ──────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════════');
  console.log('  CLEANUP SUMMARY');
  console.log('══════════════════════════════════════════════');
  console.log(`  Synthetic trades removed : ${syntheticTrades.length}`);
  console.log(`  Halt-victim trades removed: ${haltVictims.length}`);
  console.log(`  Stale HALTED stats removed: ${staleHalted.length}`);
  console.log(`  Holdings cleared          : ${prevHoldings.length}`);
  console.log('──────────────────────────────────────────────');
  console.log(`  Remaining completed_trades: ${data.completed_trades.length}`);
  console.log(`  Remaining daily_stats     : ${data.daily_stats.length}`);
  console.log(`  Current holding_stocks    : ${data.portfolio_state.holding_stocks.length}`);
  console.log('══════════════════════════════════════════════\n');

  process.exit(0);
})();
