const { execSync } = require('child_process');

function getSystemTime(mockDateStr) {
  const now = new Date(mockDateStr);
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

// Ensure process is running in UTC
process.env.TZ = 'UTC';
const d1 = getSystemTime("2026-07-02T03:45:00.000Z"); // 09:15 AM IST
console.log("03:45 UTC -> IST Time:", d1.hours + ":" + d1.minutes);

const d2 = getSystemTime("2026-07-02T10:00:00.000Z"); // 03:30 PM IST
console.log("10:00 UTC -> IST Time:", d2.hours + ":" + d2.minutes);

