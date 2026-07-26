const events = require('events');

class LifecycleFSM extends events.EventEmitter {
  constructor() {
    super();
    this.currentState = 'BOOT';
    this.session = 'NONE';
    this.lifecycleLog = [];
    this.tickCycle = 0;
    this.lastPrintTime = 0;
    this.lastPrintReason = '';
  }

  isHoliday(dateStr) {
    const holidays = [
      '2026-01-26', // Republic Day
      '2026-03-06', // Holi
      '2026-04-02', // Mahavir Jayanti
      '2026-04-03', // Good Friday
      '2026-04-14', // Dr. Ambedkar Jayanti
      '2026-05-01', // Maharashtra Day
      '2026-05-21', // Id-ul-Zuha
      '2026-08-15', // Independence Day
      '2026-08-28', // Ganesh Chaturthi
      '2026-10-02', // Gandhi Jayanti
      '2026-10-22', // Dussehra
      '2026-11-12', // Diwali Laxmi Puja
      '2026-11-13', // Diwali Balipratipada
      '2026-11-23', // Guru Nanak Jayanti
      '2026-12-25'  // Christmas
    ];
    return holidays.includes(dateStr);
  }

  getSystemTime() {
    if (global.mockTime) return global.mockTime;
    const now = new Date();
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false
    }).formatToParts(now);

    const lookup = {};
    parts.forEach(p => { lookup[p.type] = p.value; });

    const dayStr = now.toLocaleDateString('en-US', { timeZone: 'Asia/Kolkata', weekday: 'short' });
    const days = { 'Sun': 0, 'Mon': 1, 'Tue': 2, 'Wed': 3, 'Thu': 4, 'Fri': 5, 'Sat': 6 };
    const day = days[dayStr];

    return {
      hours: parseInt(lookup.hour, 10),
      minutes: parseInt(lookup.minute, 10),
      seconds: parseInt(lookup.second, 10),
      dateStr: `${lookup.year}-${lookup.month}-${lookup.day}`,
      day: day
    };
  }

  // THE ONLY MARKET TIMING FUNCTION
  getTradingSession() {
    const timeInfo = this.getSystemTime();
    const currentMins = timeInfo.hours * 60 + timeInfo.minutes;

    const isWeekend = timeInfo.day === 0 || timeInfo.day === 6;
    const isHoliday = this.isHoliday(timeInfo.dateStr);

    let session = 'CLOSED';
    let blockReason = null;

    if (isWeekend) {
      blockReason = 'Weekend';
    } else if (isHoliday) {
      blockReason = 'Holiday';
    } else if (currentMins < 9 * 60) {
      session = 'PREMARKET_WAIT';
      blockReason = 'Premarket (Before 09:00)';
    } else if (currentMins >= 9 * 60 && currentMins < 9 * 60 + 15) {
      session = 'PREMARKET';
      blockReason = 'Premarket (09:00 - 09:15)';
    } else if (currentMins >= 9 * 60 + 15 && currentMins < 15 * 60 + 25) {
      session = 'TRADING'; // Includes scanning
    } else if (currentMins >= 15 * 60 + 25 && currentMins < 15 * 60 + 30) {
      session = 'MARKET_CLOSING'; // Stop new entries
      blockReason = 'Market Closing (No new entries)';
    } else if (currentMins >= 15 * 60 + 30 && currentMins < 15 * 60 + 35) {
      session = 'MARKET_CLOSING'; // 15:30 Square off
      blockReason = 'Market Closing (Square Off Window)';
    } else if (currentMins >= 15 * 60 + 35 && currentMins < 15 * 60 + 40) {
      session = 'EOD_PROCESSING'; // 15:35 Generate Reports
      blockReason = 'EOD Processing';
    } else {
      session = 'CLOSED';
      blockReason = 'Market Closed';
    }

    this.session = session;
    return {
      session,
      timeInfo,
      currentMins,
      isOpen: (session === 'TRADING' || session === 'MARKET_CLOSING'),
      canScan: session === 'TRADING',
      canTrade: session === 'TRADING',
      blockReason,
      isWeekend,
      isHoliday
    };
  }

  transitionTo(newState, timeStr) {
    if (this.currentState !== newState) {
      const logEntry = `${timeStr} ${this.currentState} -> ${newState}`;
      console.log(`[LIFECYCLE FSM] ${logEntry}`);
      this.lifecycleLog.push(logEntry);
      
      const oldState = this.currentState;
      this.currentState = newState;
      this.emit('stateChange', { oldState, newState });
    }
  }

  evaluateTransitions() {
    this.tickCycle++;
    const s = this.getTradingSession();
    const timeStr = `${s.timeInfo.hours.toString().padStart(2, '0')}:${s.timeInfo.minutes.toString().padStart(2, '0')}:${s.timeInfo.seconds.toString().padStart(2, '0')}`;
    
    // Determine target state based on session
    let targetState = this.currentState;

    if (this.currentState === 'BOOT') {
      targetState = 'INITIALIZING';
    } else if (this.currentState === 'INITIALIZING') {
      if (s.session === 'PREMARKET_WAIT' || s.session === 'CLOSED') targetState = 'WAITING_FOR_PREMARKET';
      else if (s.session === 'PREMARKET') targetState = 'PREMARKET';
      else if (s.session === 'TRADING') targetState = 'TRADING';
      else if (s.session === 'MARKET_CLOSING') targetState = 'MARKET_CLOSING';
      else if (s.session === 'EOD_PROCESSING') targetState = 'EOD';
    } else {
      // Normal progression
      if (s.session === 'PREMARKET_WAIT' || s.session === 'CLOSED') {
        if (this.currentState === 'EOD') targetState = 'STOPPED';
        else if (this.currentState !== 'STOPPED' && this.currentState !== 'BOOT') targetState = 'WAITING_FOR_PREMARKET';
      } else if (s.session === 'PREMARKET') {
        if (s.currentMins === 9 * 60 + 14) targetState = 'WAITING_FOR_OPEN';
        else targetState = 'PREMARKET';
      } else if (s.session === 'TRADING') {
        if (this.currentState === 'WAITING_FOR_OPEN' || this.currentState === 'PREMARKET') targetState = 'MARKET_OPEN';
        else if (this.currentState === 'MARKET_OPEN') targetState = 'SCANNING';
        else if (this.currentState === 'SCANNING') targetState = 'TRADING';
      } else if (s.session === 'MARKET_CLOSING') {
        targetState = 'MARKET_CLOSING';
      } else if (s.session === 'EOD_PROCESSING') {
        targetState = 'EOD';
      }
    }

    this.transitionTo(targetState, timeStr);
    
    return {
      state: this.currentState,
      sessionDetails: s,
      tickCycle: this.tickCycle
    };
  }

  printSchedulerBlock(reason, sessionDetails) {
    const now = Date.now();
    if (reason === this.lastPrintReason && (now - this.lastPrintTime) < 3600 * 1000) {
      return;
    }
    this.lastPrintTime = now;
    this.lastPrintReason = reason;

    console.log(`\n=====================================================`);
    console.log(`[SCHEDULER BLOCKED] WHY: ${reason}`);
    console.log(`Current UTC    : ${new Date().toISOString()}`);
    console.log(`Current IST    : ${sessionDetails.timeInfo.dateStr} ${sessionDetails.timeInfo.hours}:${sessionDetails.timeInfo.minutes}`);
    console.log(`Trading Day    : ${!sessionDetails.isWeekend ? 'YES' : 'NO (Weekend)'}`);
    console.log(`Holiday        : ${sessionDetails.isHoliday ? 'YES' : 'NO'}`);
    console.log(`Session        : ${sessionDetails.session}`);
    console.log(`Reason         : ${sessionDetails.blockReason}`);
    console.log(`=====================================================\n`);
  }
}

const fsm = new LifecycleFSM();
module.exports = fsm;
