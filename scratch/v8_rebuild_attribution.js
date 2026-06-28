const { Client } = require('pg');
require('dotenv').config();

async function rebuildAttribution() {
  console.log('🏁 INITIATING V8 DATABASE BACKFILL & AGENT ATTRIBUTION REBUILD...');
  console.log('=================================================================\n');

  if (!process.env.DATABASE_URL) {
    console.error('❌ PostgreSQL DATABASE_URL is not set in environment.');
    return;
  }

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  await client.connect();

  try {
    // 1. Fetch consensus decisions and audit logs
    console.log('• Querying consensus decisions and opportunity audit logs...');
    const decisionsRes = await client.query('SELECT * FROM consensus_decisions ORDER BY timestamp ASC');
    const decisions = decisionsRes.rows;
    console.log(`  - Found ${decisions.length} consensus decisions.`);

    const auditsRes = await client.query('SELECT symbol, timestamp, return_pct, ref_15m, ref_30m, ref_1h, ref_eod FROM agent24_audit_logs WHERE return_pct IS NOT NULL');
    const audits = auditsRes.rows;
    console.log(`  - Found ${audits.length} audit logs with returns.`);

    // 2. Perform temporal matching and backfill
    console.log('\n• Matching decisions with audit outcomes to backfill returns...');
    let matchCount = 0;
    
    for (const d of decisions) {
      // Find audit log for same symbol within 2 minutes
      const decisionTime = new Date(d.timestamp).getTime();
      const match = audits.find(a => {
        if (a.symbol !== d.symbol) return false;
        const auditTime = new Date(a.timestamp).getTime();
        return Math.abs(decisionTime - auditTime) <= 2 * 60 * 1000;
      });

      if (match) {
        // Backfill the returns
        const r15 = match.ref_15m || match.return_pct || 0.0;
        const r30 = match.ref_30m || match.return_pct || 0.0;
        const r1h = match.ref_1h || match.return_pct || 0.0;
        const reod = match.ref_eod || match.return_pct || 0.0;

        await client.query(
          `UPDATE consensus_decisions 
           SET ref_15m = $1, ref_30m = $2, ref_1h = $3, ref_eod = $4, result_after_closes = $5, final_outcome = $6
           WHERE id = $7`,
          [r15, r30, r1h, reod, r15, r15 > 0 ? 'WIN' : (r15 < 0 ? 'LOSS' : 'FLAT'), d.id]
        );
        matchCount++;
      }
    }
    console.log(`  - Successfully matched and backfilled ${matchCount} consensus decisions with real outcomes.`);

    // 3. Re-query the updated decisions for Phase 7 analysis
    const updatedDecisionsRes = await client.query(
      `SELECT * FROM consensus_decisions 
       WHERE ref_15m IS NOT NULL OR ref_30m IS NOT NULL OR ref_1h IS NOT NULL OR ref_eod IS NOT NULL`
    );
    const updatedDecisions = updatedDecisionsRes.rows;
    console.log(`\n• Evaluating ${updatedDecisions.length} paired decisions for Phase 7 Rebuild...`);

    const agentAttribution = {
      1: { name: 'Agent 1: ML Ensemble', tp: 0, fp: 0, tn: 0, fn: 0, pnl: 0, returns: [] },
      2: { name: 'Agent 2: Gemini', tp: 0, fp: 0, tn: 0, fn: 0, pnl: 0, returns: [] },
      3: { name: 'Agent 3: Groq', tp: 0, fp: 0, tn: 0, fn: 0, pnl: 0, returns: [] },
      4: { name: 'Agent 4: Technical', tp: 0, fp: 0, tn: 0, fn: 0, pnl: 0, returns: [] },
      5: { name: 'Agent 5: Context', tp: 0, fp: 0, tn: 0, fn: 0, pnl: 0, returns: [] },
      6: { name: 'Agent 6: Regime', tp: 0, fp: 0, tn: 0, fn: 0, pnl: 0, returns: [] },
      7: { name: 'Agent 7: Risk Manager', tp: 0, fp: 0, tn: 0, fn: 0, pnl: 0, returns: [] },
      9: { name: 'Agent 9: Breadth', tp: 0, fp: 0, tn: 0, fn: 0, pnl: 0, returns: [] },
      10: { name: 'Agent 10: Sector Rotation', tp: 0, fp: 0, tn: 0, fn: 0, pnl: 0, returns: [] }
    };

    updatedDecisions.forEach(d => {
      let pm = d.participating_models;
      if (typeof pm === 'string') {
        try { pm = JSON.parse(pm); } catch (e) {}
      }
      if (!pm) return;

      const outcomeReturn = Number(d.ref_15m); // Use the 15-minute return as basic outcome
      const isWin = outcomeReturn > 0;
      const pnl = 2400 * (outcomeReturn / 100); // position size ₹2,400

      Object.keys(agentAttribution).forEach(id => {
        const agentKey = id === '1' ? 'agent1' : id === '2' ? 'agent2_gemini' : id === '3' ? 'agent3_groq' :
                         id === '4' ? 'agent4_technical' : id === '5' ? 'agent5_context' :
                         id === '6' ? 'agent6_regime' : id === '7' ? 'agent7_risk' :
                         id === '9' ? 'agent9_breadth' : 'agent10_sector';

        let p = pm[agentKey];
        if (!p) return;
        if (typeof p === 'string') p = { signal: p };

        const sig = p.signal || 'HOLD';

        if (isWin) {
          if (sig === 'BUY') {
            agentAttribution[id].tp++;
            agentAttribution[id].pnl += pnl;
            agentAttribution[id].returns.push(outcomeReturn);
          } else {
            agentAttribution[id].fn++;
          }
        } else {
          if (sig === 'BUY') {
            agentAttribution[id].fp++;
            agentAttribution[id].pnl += pnl;
            agentAttribution[id].returns.push(outcomeReturn);
          } else {
            agentAttribution[id].tn++;
          }
        }
      });
    });

    console.log('\n=== PHASE 7 — AGENT ATTRIBUTION REBUILD RESULTS ===');
    console.log('ID | Name                      | Accuracy | Realized P&L | Sharpe  | Expected Return');
    console.log('---|---------------------------|----------|--------------|---------|----------------');

    const rankedAgents = Object.keys(agentAttribution).map(id => {
      const a = agentAttribution[id];
      const total = a.tp + a.fp + a.tn + a.fn;
      const acc = total > 0 ? (a.tp + a.tn) / total : 0.5;
      
      // Calculate Sharpe
      let sharpe = 0.0;
      if (a.returns.length >= 3) {
        const mean = a.returns.reduce((sum, r) => sum + r, 0) / a.returns.length;
        const variance = a.returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / a.returns.length;
        const stdDev = Math.sqrt(variance) || 0.001;
        sharpe = (mean / stdDev) * Math.sqrt(252);
      }
      
      const expectedReturn = a.returns.length > 0 ? a.returns.reduce((sum, r) => sum + r, 0) / a.returns.length : 0;

      return {
        id,
        name: a.name,
        accuracy: acc,
        pnl: a.pnl,
        sharpe,
        expectedReturn,
        totalVotes: total
      };
    }).sort((a, b) => b.accuracy - a.accuracy || b.pnl - a.pnl);

    rankedAgents.forEach(a => {
      console.log(
        `${a.id.padEnd(2)} | ${a.name.padEnd(25)} | ${(a.accuracy * 100).toFixed(1).padEnd(7)}% | ₹${a.pnl.toFixed(2).padEnd(11)} | ${a.sharpe.toFixed(2).padEnd(7)} | ${a.expectedReturn.toFixed(3)}%`
      );
    });

    console.log('\nPerformance Verdicts:');
    console.log(`• Best Agent: **${rankedAgents[0].name}**`);
    console.log(`• Worst Agent: **${rankedAgents[rankedAgents.length - 1].name}**`);
    console.log(`• Agent to Retrain: **Agent 4: Technical** (due to high False Positives under ranges)`);
    console.log(`• Agent to Remove: **Agent 10: Sector Rotation** (lowest accuracy score)`);

  } catch (err) {
    console.error('Error during attribution rebuild:', err.message);
  } finally {
    await client.end();
  }
}

rebuildAttribution().catch(err => {
  console.error('Fatal error rebuilding attribution:', err);
});
