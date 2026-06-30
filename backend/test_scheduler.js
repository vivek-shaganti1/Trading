const tradingBot = require('./tradingBot');

console.log('=== V11.0 Phase 3: Scheduler Time-Travel Simulation ===');

// Mock time wrapper to simulate exact times on Mon-Fri and weekends
function simulateTime(isoString) {
  const simulatedDate = new Date(isoString);
  // Temporarily override the global Date object for this test cycle
  const RealDate = Date;
  global.Date = class extends RealDate {
    constructor(...args) {
      if (args.length === 0) return simulatedDate;
      return new RealDate(...args);
    }
  };
  global.Date.now = () => simulatedDate.getTime();
  
  // Return a restoration function
  return () => {
    global.Date = RealDate;
  };
}

async function runTest() {
  const scenarios = [
    { time: '2026-07-06T09:14:00+05:30', expected: false, desc: 'Monday 09:14 (Pre-market)' },
    { time: '2026-07-06T09:15:00+05:30', expected: true,  desc: 'Monday 09:15 (Market Open)' },
    { time: '2026-07-06T15:29:00+05:30', expected: true,  desc: 'Monday 15:29 (Market Open)' },
    { time: '2026-07-06T15:30:00+05:30', expected: false, desc: 'Monday 15:30 (Market Close)' },
    { time: '2026-07-06T16:00:00+05:30', expected: false, desc: 'Monday 16:00 (Post-market)' },
    { time: '2026-07-04T12:00:00+05:30', expected: false, desc: 'Saturday 12:00 (Weekend)' },
    { time: '2026-07-05T12:00:00+05:30', expected: false, desc: 'Sunday 12:00 (Weekend)' }
  ];

  let passed = 0;

  for (const s of scenarios) {
    const restoreDate = simulateTime(s.time);
    
    // We check the internal logic: isMarketOpenWindow
    // Because tradingBot.tick() is an interval, we can just test the gating function.
    const isOpen = tradingBot.isMarketOpenWindow();
    
    if (isOpen === s.expected) {
      console.log(`✅ PASS: ${s.desc} -> isOpen: ${isOpen}`);
      passed++;
    } else {
      console.error(`❌ FAIL: ${s.desc} -> Expected ${s.expected}, got ${isOpen}`);
    }
    
    restoreDate();
  }

  console.log(`\nTest Complete: ${passed}/${scenarios.length} Passed.`);
  process.exit(passed === scenarios.length ? 0 : 1);
}

runTest();
