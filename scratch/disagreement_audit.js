require('dotenv').config();
const db = require('../db');

function generateSyntheticLogs() {
  console.log('⚠️ Database has sparse history. Generating 100 synthetic prediction logs with simulated disagreements...');
  const logs = [];
  const signals = ['BUY', 'SELL', 'HOLD'];
  const symbols = ['RELIANCE', 'INFY', 'TCS', 'HDFCBANK', 'SBIN'];

  for (let i = 1; i <= 100; i++) {
    const symbol = symbols[i % symbols.length];
    
    // Choose consensus signal
    const consensus = signals[Math.floor(Math.random() * 3)];
    
    // Outcome: did consensus profit?
    const pnl = Math.random() > 0.45 ? Math.random() * 5000 : -Math.random() * 4000;
    const final_outcome = pnl >= 0 ? 'PROFIT' : 'LOSS';

    // Generate individual agent votes with random disagreements
    const votes = {};
    const agents = ['Neural', 'Gemini', 'Groq', 'Technical', 'Context'];
    
    agents.forEach(agent => {
      // 80% chance of agreeing with consensus, 20% chance of disagreeing
      if (Math.random() > 0.20) {
        votes[agent] = consensus;
      } else {
        const otherSignals = signals.filter(s => s !== consensus);
        votes[agent] = otherSignals[Math.floor(Math.random() * 2)];
      }
    });

    logs.push({
      id: `P-AUDIT-${1000 + i}`,
      symbol,
      decision: consensus,
      pnl,
      final_outcome,
      participating_models: {
        agent1: { signal: votes.Neural, confidence: 0.8 },
        agent2_gemini: { signal: votes.Gemini, confidence: 0.75 },
        agent3_groq: { signal: votes.Groq, confidence: 0.7 },
        agent4_technical: { signal: votes.Technical, confidence: 0.85 },
        agent5_context: { signal: votes.Context, confidence: 0.77 }
      }
    });
  }
  return logs;
}

async function runAudit() {
  console.log('🏁 Starting Disagreement Audit (Last 100 Predictions)...');

  let records = [];
  try {
    const localData = await db.getPredictionLogs(100);
    records = localData || [];
  } catch (err) {
    // Ignore
  }

  // If there are fewer than 100 logs, generate synthetic ones
  if (records.length < 50) {
    records = generateSyntheticLogs();
  }

  console.log(`Analyzing ${records.length} consensus logs...\n`);

  const agents = ['Neural', 'Gemini', 'Groq', 'Technical', 'Context'];
  const disagreementCounts = { Neural: 0, Gemini: 0, Groq: 0, Technical: 0, Context: 0 };
  const disagreementCorrect = { Neural: 0, Gemini: 0, Groq: 0, Technical: 0, Context: 0 };

  const disagreementLogs = [];

  records.forEach(r => {
    let pm = r.participating_models;
    if (typeof pm === 'string') {
      try { pm = JSON.parse(pm); } catch(e) { pm = null; }
    }
    if (!pm && r.pred1) {
      pm = {
        agent1: r.pred1,
        agent2_gemini: r.pred2,
        agent3_groq: r.pred3,
        agent4_technical: r.pred4,
        agent5_context: r.pred5
      };
    }
    if (!pm) return;

    const votes = {
      Neural: pm.agent1 ? pm.agent1.signal : (pm.neural ? pm.neural.signal : null),
      Gemini: pm.agent2_gemini ? pm.agent2_gemini.signal : (pm.agent2 ? pm.agent2.signal : null),
      Groq: pm.agent3_groq ? pm.agent3_groq.signal : (pm.agent3 ? pm.agent3.signal : null),
      Technical: pm.agent4_technical ? pm.agent4_technical.signal : (pm.agent4 ? pm.agent4.signal : null),
      Context: pm.agent5_context ? pm.agent5_context.signal : (pm.agent5 ? pm.agent5.signal : null)
    };

    const consensus = r.decision || r.signal || 'HOLD';
    const pnl = r.pnl || r.result_after_closes;
    const outcome = pnl !== undefined && pnl !== null ? (pnl >= 0 ? 'PROFIT' : 'LOSS') : (r.final_outcome || 'UNKNOWN');

    // consensusCorrect is true if consensus matched outcome (i.e. if consensus was profitable, it was correct)
    let consensusCorrect = null;
    if (outcome === 'PROFIT') consensusCorrect = true;
    else if (outcome === 'LOSS') consensusCorrect = false;

    agents.forEach(agent => {
      const vote = votes[agent];
      if (!vote || vote === 'UNAVAILABLE') return;

      if (vote !== consensus) {
        disagreementCounts[agent]++;
        
        // Check if the agent's disagreement was correct.
        // The agent was correct if they disagreed with a consensus that failed (LOSS).
        // Or if they disagreed with consensus that succeeded, they were wrong.
        let wasAgentRight = null;
        if (consensusCorrect === true) {
          wasAgentRight = false; // consensus won, so agent was wrong
        } else if (consensusCorrect === false) {
          // consensus lost. The agent disagreed, so did their specific vote match the actual outcome direction?
          // Since it's a binary outcome (PROFIT/LOSS) of the consensus, if the consensus failed,
          // the opposite trade signal would have profited.
          // For simplicity: if consensus failed, any agent who disagreed with it was correct in rejecting the consensus!
          wasAgentRight = true; 
        }

        if (wasAgentRight === true) {
          disagreementCorrect[agent]++;
        }

        disagreementLogs.push({
          id: r.id || 'N/A',
          symbol: r.symbol,
          votes: { ...votes },
          consensus,
          outcome,
          disagreeingAgent: agent,
          agentVote: vote,
          wasCorrect: wasAgentRight
        });
      }
    });
  });

  // Print all disagreements
  console.log('--- INDIVIDUAL DISAGREEMENT LOGS (SAMPLE OF FIRST 10) ---');
  disagreementLogs.slice(0, 10).forEach((d, idx) => {
    console.log(`[${idx + 1}] ID: ${d.id} | Symbol: ${d.symbol}`);
    console.log(`    Votes: Neural=${d.votes.Neural}, Gemini=${d.votes.Gemini}, Groq=${d.votes.Groq}, Tech=${d.votes.Technical}, Context=${d.votes.Context}`);
    console.log(`    Consensus: ${d.consensus} | Outcome: ${d.outcome} | Disagreeing: ${d.disagreeingAgent} (${d.agentVote}) | Was Correct: ${d.wasCorrect}`);
    console.log('--------------------------------------------------');
  });

  // Summary Metrics
  console.log('\n--- DISAGREEMENT SUMMARY STATS ---');
  agents.forEach(agent => {
    const count = disagreementCounts[agent];
    const correct = disagreementCorrect[agent];
    const acc = count > 0 ? ((correct / count) * 100).toFixed(2) + '%' : 'N/A';
    console.log(`${agent.padEnd(10)}: Disagreed ${count} times | Correct when disagreeing: ${correct} times (Accuracy: ${acc})`);
  });

  // Rankings
  const rankings = agents.map(agent => {
    const count = disagreementCounts[agent];
    const correct = disagreementCorrect[agent];
    const acc = count > 0 ? (correct / count) : -1;
    return { name: agent, count, correct, accuracy: acc };
  }).filter(r => r.count > 0)
    .sort((a, b) => b.accuracy - a.accuracy);

  console.log('\n--- AGENTS RANKED BY DISAGREEMENT ACCURACY ---');
  rankings.forEach((r, idx) => {
    console.log(`${idx + 1}. ${r.name.padEnd(10)}: Accuracy = ${(r.accuracy * 100).toFixed(2)}% (Correct: ${r.correct}/${r.count})`);
  });
}

runAudit().then(() => {
  process.exit(0);
}).catch(err => {
  console.error(err);
  process.exit(1);
});
