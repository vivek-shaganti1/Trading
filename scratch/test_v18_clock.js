const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const cases = [
  { desc: "08:00 IST (Pre-market)", iso: "2026-07-01T02:30:00.000Z" },
  { desc: "09:14 IST (Pre-market)", iso: "2026-07-01T03:44:00.000Z" },
  { desc: "09:15 IST (Market Open)", iso: "2026-07-01T03:45:00.000Z" },
  { desc: "10:00 IST (Active Session)", iso: "2026-07-01T04:30:00.000Z" },
  { desc: "12:00 IST (Mid Session)", iso: "2026-07-01T06:30:00.000Z" },
  { desc: "15:29 IST (Active Session)", iso: "2026-07-01T09:59:00.000Z" },
  { desc: "15:30 IST (Market Close)", iso: "2026-07-01T10:00:00.000Z" },
  { desc: "15:31 IST (Post Market)", iso: "2026-07-01T10:01:00.000Z" },
  { desc: "16:00 IST (Post Market)", iso: "2026-07-01T10:30:00.000Z" },
  { desc: "20:00 IST (Post Market)", iso: "2026-07-01T14:30:00.000Z" },
  { desc: "Saturday (Weekend)", iso: "2026-07-04T06:30:00.000Z" },
  { desc: "Sunday (Weekend)", iso: "2026-07-05T06:30:00.000Z" }
];

console.log("=========================================");
console.log("AGY TRADER V18.0 - CLOCK SIMULATION TEST");
console.log("=========================================");

const tradingBotPath = path.resolve(__dirname, '../backend/tradingBot.js');
const tradingBot = require(tradingBotPath);

async function runTests() {
  for (const c of cases) {
    const dt = new Date(c.iso);
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false
    }).formatToParts(dt);
    
    let hours, minutes, seconds, year, month, dayStr;
    parts.forEach(p => {
      if (p.type === 'hour') hours = parseInt(p.value, 10);
      if (p.type === 'minute') minutes = parseInt(p.value, 10);
      if (p.type === 'second') seconds = parseInt(p.value, 10);
      if (p.type === 'year') year = p.value;
      if (p.type === 'month') month = p.value;
      if (p.type === 'day') dayStr = p.value;
    });

    if (hours === 24) hours = 0;
    
    global.mockTime = {
      hours, minutes, seconds,
      dateStr: `${year}-${month}-${dayStr}`,
      day: dt.getDay()
    };
    
    const isOpen = tradingBot.isMarketOpenWindow();
    
    console.log(`[TEST] ${c.desc} -> isOpen: ${isOpen ? 'OPEN 🟢' : 'CLOSED 🔴'}`);
  }
  process.exit(0);
}
runTests();
