const { Client } = require('pg');
require('dotenv').config();

async function run() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  await client.connect();

  const res = await client.query('SELECT * FROM agent24_audit_logs');
  const audits = res.rows;

  const reasons = {};
  let totalPnlSaved = 0;
  let totalPnlMissed = 0;
  let tqsBelowThresholdCount = 0;
  let tqsBelowThresholdPnl = 0;

  audits.forEach(a => {
    const ret = a.return_pct || 0;
    const price = a.price_at_rejection || 1000;
    const qty = 10; // baseline size 10 shares
    const pnl = price * qty * (ret / 100);

    const reason = a.reason || 'Unknown';
    if (!reasons[reason]) {
      reasons[reason] = { count: 0, pnl: 0, wins: 0, losses: 0 };
    }
    reasons[reason].count++;
    reasons[reason].pnl += pnl;
    if (pnl > 0) {
      reasons[reason].wins++;
      totalPnlMissed += pnl;
    } else {
      reasons[reason].losses++;
      totalPnlSaved += Math.abs(pnl);
    }

    if (reason.includes('TQS') && reason.includes('<')) {
      tqsBelowThresholdCount++;
      tqsBelowThresholdPnl += pnl;
    }
  });

  console.log('=== REJECTION REASONS ANALYSIS ===');
  console.log(`Total rejection audits: ${audits.length}`);
  console.log(`TQS Below Threshold Count: ${tqsBelowThresholdCount}`);
  console.log(`TQS Below Threshold Net PnL Saved (negative is good, means avoided loss): ₹${tqsBelowThresholdPnl.toFixed(2)}`);
  
  console.log('\nBreakdown of reasons:');
  Object.keys(reasons).forEach(r => {
    const data = reasons[r];
    console.log(`- "${r}": count=${data.count} | Net PnL=${data.pnl.toFixed(2)} | Wins=${data.wins} | Losses=${data.losses}`);
  });

  await client.end();
}
run().catch(console.error);
