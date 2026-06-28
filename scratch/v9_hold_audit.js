const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
require('dotenv').config();

async function runHoldAudit() {
  console.log('🏁 INITIATING V9 OBJECTIVE 1: HOLD DECISION AUDIT...');
  console.log('==================================================\n');

  if (!process.env.DATABASE_URL) {
    console.error('❌ PostgreSQL DATABASE_URL is not set.');
    return;
  }

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  await client.connect();

  try {
    // 1. Fetch HOLD consensus decisions
    const decisionsRes = await client.query(
      `SELECT * FROM consensus_decisions 
       WHERE decision = 'HOLD' 
       ORDER BY timestamp DESC`
    );
    const holdDecisions = decisionsRes.rows;
    console.log(`• Found ${holdDecisions.length} HOLD decisions in database.`);

    // 2. Fetch audit logs with returns to map outcomes
    const auditsRes = await client.query(
      `SELECT symbol, timestamp, return_pct, ref_15m 
       FROM agent24_audit_logs 
       WHERE return_pct IS NOT NULL`
    );
    const audits = auditsRes.rows;

    console.log('\n--- HOLD Decision Distribution Report ---');
    console.log('Symbol | Confidence | Req Thresh | TQS | Votes | Outcome (15m Return)');
    console.log('-------|------------|------------|-----|-------|---------------------');

    let distribution = {
      bypassed_agents_veto: 0,
      below_confidence_threshold: 0,
      below_tqs_threshold: 0,
      neutral_consensus: 0
    };

    const auditedHolds = [];

    holdDecisions.forEach(d => {
      let pm = d.participating_models;
      if (typeof pm === 'string') {
        try { pm = JSON.parse(pm); } catch (e) {}
      }
      if (!pm) return;

      const confNum = Number(d.confidence) || 0.5;
      const tqs = pm.trade_quality_score || Math.round(confNum * 100) || 65;
      
      // Map to actual outcome return
      const decisionTime = new Date(d.timestamp).getTime();
      const match = audits.find(a => {
        if (a.symbol !== d.symbol) return false;
        const auditTime = new Date(a.timestamp).getTime();
        return Math.abs(decisionTime - auditTime) <= 2 * 60 * 1000;
      });
      const outcome = match ? Number(match.ref_15m || match.return_pct || 0.0) : null;

      // Extract votes
      const votes = [];
      Object.keys(pm).forEach(k => {
        if (k.startsWith('agent') && pm[k].signal) {
          votes.push(`${k.replace('agent', '')}:${pm[k].signal}`);
        }
      });

      const reqThresh = 0.70; // Standard threshold
      const gSignal = pm.agent2_gemini?.signal;
      const qSignal = pm.agent3_groq?.signal;

      let reason = 'Neutral consensus';
      if (gSignal === 'HOLD' && qSignal === 'HOLD') {
        reason = 'Bypassed Agents Veto';
        distribution.bypassed_agents_veto++;
      } else if (confNum < reqThresh) {
        reason = 'Below Confidence Threshold';
        distribution.below_confidence_threshold++;
      } else if (tqs < 65) {
        reason = 'Below TQS Threshold';
        distribution.below_tqs_threshold++;
      } else {
        distribution.neutral_consensus++;
      }

      const outcomeStr = outcome !== null ? `${outcome.toFixed(2)}%` : 'N/A';
      console.log(
        `${d.symbol.padEnd(10)} | ${confNum.toFixed(3)} | ${reqThresh.toFixed(2)} | ${String(tqs).padEnd(3)} | ${votes.slice(0, 3).join(',').padEnd(12)} | ${outcomeStr}`
      );

      auditedHolds.push({
        symbol: d.symbol,
        confidence: confNum,
        threshold: reqThresh,
        tqs,
        votes: votes.join(','),
        outcome,
        reason
      });
    });

    console.log('\n--- HOLD Rejection Reasons Distribution ---');
    console.log(`• Bypassed Agents Veto: ${distribution.bypassed_agents_veto}`);
    console.log(`• Below Confidence Threshold: ${distribution.below_confidence_threshold}`);
    console.log(`• Below TQS Threshold: ${distribution.below_tqs_threshold}`);
    console.log(`• Neutral/Other Consensus: ${distribution.neutral_consensus}`);

    // Store report to json file for programmatic usage
    fs.writeFileSync(
      path.join(__dirname, '../db_hold_audit.json'),
      JSON.stringify(auditedHolds, null, 2)
    );
    console.log('\n✅ Report saved to db_hold_audit.json');

  } catch (err) {
    console.error('Error conducting hold audit:', err.message);
  } finally {
    await client.end();
  }
}

runHoldAudit();
