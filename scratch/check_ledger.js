const fs = require('fs');

const ct = JSON.parse(fs.readFileSync('scratch/completed_trades_from_pg.json', 'utf8'));
console.log('Trades:');
let sumGross = 0;
let sumNet = 0;
ct.forEach((t, i) => {
  const g = parseFloat(t.gross_pnl);
  const n = parseFloat(t.net_pnl);
  sumGross += g;
  sumNet += n;
  console.log(`${i+1}. ${t.symbol} | entry=${t.entry_price} | exit=${t.exit_price} | qty=${t.quantity} | gross=${g} | net=${n} | reason=${t.exit_reason}`);
});
console.log('Sum Gross:', sumGross);
console.log('Sum Net PnL:', sumNet);
console.log('Original Capital - Sum Net:', 12000 + sumNet);
console.log('Current cash balance in db.json:', 7306.34);
console.log('Difference between cash balance and (12000 + sumNet):', 7306.34 - (12000 + sumNet));
