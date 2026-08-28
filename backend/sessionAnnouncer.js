/**
 * sessionAnnouncer.js — tells the operator what the system is doing.
 *
 * WHY THIS EXISTS
 * ---------------
 * The bot was silent on any day it did not trade. On a holiday or weekend it
 * correctly stood down — and said nothing at all. From the outside that is
 * indistinguishable from "the process crashed", "the cron never fired", or
 * "it is broken". The operator had no way to tell.
 *
 * Every message here answers one question: is the system alive, and what is it
 * doing right now? Each announcement fires AT MOST ONCE PER DAY and the fact
 * that it fired is persisted, so a process restart cannot spam the channel.
 */

const alerts = require('./alerts');
const db = require('./db');
const fsm = require('./lifecycleFSM');

const STATE_KEY = 'session_announcements';

// ── one-shot bookkeeping, persisted so restarts do not re-announce ──────────
function loadState() {
  try {
    const d = db.readLocalDb();
    return d[STATE_KEY] || {};
  } catch (e) {
    return {};
  }
}

function alreadySent(kind, dateStr) {
  const s = loadState();
  return s[dateStr] && s[dateStr][kind] === true;
}

function markSent(kind, dateStr) {
  try {
    const d = db.readLocalDb();
    if (!d[STATE_KEY]) d[STATE_KEY] = {};
    if (!d[STATE_KEY][dateStr]) d[STATE_KEY][dateStr] = {};
    d[STATE_KEY][dateStr][kind] = true;
    // Keep only the last 10 days so this cannot grow without bound.
    const keys = Object.keys(d[STATE_KEY]).sort();
    while (keys.length > 10) delete d[STATE_KEY][keys.shift()];
    db.writeLocalDb(d);
  } catch (e) {
    console.error('[ANNOUNCER] Could not persist announcement state:', e.message);
  }
}

/**
 * The next date on which the exchange is actually open, looking forward from
 * `fromDateStr`. Used so a stand-down message can say WHEN trading resumes
 * rather than leaving the operator guessing.
 */
function nextTradingDay(fromDateStr, maxLookahead = 14) {
  const [y, m, d] = fromDateStr.split('-').map(Number);
  const cursor = new Date(Date.UTC(y, m - 1, d));
  for (let i = 1; i <= maxLookahead; i++) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const iso = cursor.toISOString().slice(0, 10);
    const dow = cursor.getUTCDay();
    if (dow === 0 || dow === 6) continue;         // weekend
    if (fsm.isHoliday(iso)) continue;             // exchange holiday
    const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return { dateStr: iso, dayName: names[dow] };
  }
  return null;
}

function hhmm(t) {
  return `${String(t.hours).padStart(2, '0')}:${String(t.minutes).padStart(2, '0')}`;
}

const announcer = {
  nextTradingDay,

  /**
   * Fired once when the process comes up. Confirms the system is alive and
   * states plainly whether it will trade today.
   */
  async announceBoot(extra = {}) {
    const t = fsm.getSystemTime();
    const s = fsm.getTradingSession();
    if (alreadySent('boot', t.dateStr)) return false;

    const mode = extra.brokerMode || 'SIMULATOR';
    const lines = [
      `🟢 <b>AGY-TRADER ONLINE</b>`,
      `Engine started at ${hhmm(t)} IST on ${t.dateStr}.`,
      ``,
      `<b>Mode:</b> ${mode === 'LIVE' ? 'LIVE broker routing' : 'Paper trading'}`,
      `<b>Today:</b> ${s.isHoliday ? 'Exchange holiday' : s.isWeekend ? 'Weekend' : 'Trading day'}`,
      `<b>Session now:</b> ${s.session}`
    ];

    if (s.isHoliday || s.isWeekend) {
      const nxt = nextTradingDay(t.dateStr);
      lines.push(``, `⏸ No trading today. ${nxt ? `Next session: <b>${nxt.dayName} ${nxt.dateStr}</b> at 09:15 IST.` : 'Next session date unavailable.'}`);
    } else {
      lines.push(``, `Scanning begins at 09:15 IST. Entries stop at 15:25, square-off at 15:15, session ends 15:30.`);
    }

    await alerts.sendTelegram(lines.join('\n'));
    markSent('boot', t.dateStr);
    return true;
  },

  /**
   * Fired once on a day the exchange is shut. This is the message whose absence
   * made the system look broken.
   */
  async announceStandDown() {
    const t = fsm.getSystemTime();
    const s = fsm.getTradingSession();
    if (!s.isHoliday && !s.isWeekend) return false;
    if (alreadySent('standdown', t.dateStr)) return false;

    const nxt = nextTradingDay(t.dateStr);
    const reason = s.isHoliday ? 'an NSE trading holiday' : 'a weekend';

    await alerts.sendTelegram(
      `⏸ <b>NO TRADING TODAY</b>\n` +
      `${t.dateStr} is ${reason}, so the engine is standing down. This is expected — nothing is wrong.\n\n` +
      `The system is running and will resume automatically.\n` +
      (nxt ? `<b>Next session:</b> ${nxt.dayName} ${nxt.dateStr}, 09:15 IST.` : '')
    );
    markSent('standdown', t.dateStr);
    return true;
  },

  /**
   * Fired once when the session actually opens, so the operator sees a positive
   * confirmation that automated trading is live for the day.
   */
  async announceMarketOpen(context = {}) {
    const t = fsm.getSystemTime();
    if (alreadySent('open', t.dateStr)) return false;

    const cap = context.capital != null ? `₹${Number(context.capital).toFixed(2)}` : 'unavailable';
    const tgt = context.dailyTarget != null ? `₹${Number(context.dailyTarget).toFixed(0)}` : 'not set';

    await alerts.sendTelegram(
      `🔔 <b>TRADING IS LIVE</b>\n` +
      `Market open — automated scanning and execution are now running.\n\n` +
      `<b>Starting capital:</b> ${cap}\n` +
      `<b>Daily target:</b> ${tgt}\n` +
      `<b>Universe:</b> ${context.universeSize || 'loading'} symbols\n` +
      `<b>Mode:</b> ${context.brokerMode === 'LIVE' ? 'LIVE broker routing' : 'Paper trading'}\n\n` +
      `You will get an alert on every entry and exit. Mid-session summaries every 30 minutes.`
    );
    markSent('open', t.dateStr);
    return true;
  },

  /**
   * Fired once at the end of a trading day — including when nothing traded,
   * which is precisely the case the operator most needs explained.
   */
  async announceClose(summary = {}) {
    const t = fsm.getSystemTime();
    if (alreadySent('close', t.dateStr)) return false;

    const trades = summary.tradesClosed != null ? summary.tradesClosed : 0;
    const pnl = summary.netPnL != null ? Number(summary.netPnL) : 0;
    const sign = pnl >= 0 ? '+' : '';
    const nxt = nextTradingDay(t.dateStr);

    const lines = [
      `🔕 <b>SESSION CLOSED — ${t.dateStr}</b>`,
      ``,
      `<b>Trades closed:</b> ${trades}`,
      `<b>Net P&L:</b> ${sign}₹${pnl.toFixed(2)}`,
      `<b>Portfolio value:</b> ₹${Number(summary.portfolioValue || 0).toFixed(2)}`,
      `<b>Open positions carried:</b> ${summary.openPositions != null ? summary.openPositions : 0}`
    ];

    // If nothing traded, say WHY. A silent zero is what caused the confusion.
    if (trades === 0) {
      lines.push(
        ``,
        `<b>No trades were placed today.</b>`,
        summary.candidatesScanned != null
          ? `Scanned ${summary.candidatesScanned} symbols; ${summary.candidatesPassed || 0} reached the execution stage.`
          : '',
        summary.topRejectionReason
          ? `Most common block: <i>${summary.topRejectionReason}</i>`
          : 'Check the dashboard "Live Risk & Execution Blockers" panel for the per-candidate reason.'
      );
    }

    if (nxt) lines.push(``, `<b>Next session:</b> ${nxt.dayName} ${nxt.dateStr}, 09:15 IST.`);

    await alerts.sendTelegram(lines.filter(Boolean).join('\n'));
    markSent('close', t.dateStr);
    return true;
  },

  /**
   * Safety-net heartbeat. If a whole trading day passes with no entry alert and
   * no stand-down notice, the operator should still hear from the system.
   */
  async announceStillAlive(note) {
    const t = fsm.getSystemTime();
    const key = 'alive-' + hhmm(t).slice(0, 2);   // at most one per hour
    if (alreadySent(key, t.dateStr)) return false;
    await alerts.sendTelegram(`💓 <b>Heartbeat</b> — engine alive at ${hhmm(t)} IST.\n${note || ''}`);
    markSent(key, t.dateStr);
    return true;
  }
};

module.exports = announcer;
