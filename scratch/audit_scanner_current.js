const db = require('../db');
const predictor = require('../predictor');

async function runAudit() {
  console.log('🔍 RUNNING LIVE SCANNED CANDIDATES AUDIT...');
  console.log('====================================================\n');

  // 1. Fetch latest scanner rankings
  const rankings = await db.getLatestScannerRankings();
  if (!rankings || !rankings.longs) {
    console.error('❌ No scanner rankings found in DB!');
    process.exit(1);
  }

  const top10 = rankings.longs.slice(0, 10);
  console.log(`FOUND ${top10.length} TOP LONG CANDIDATES:\n`);

  for (let i = 0; i < top10.length; i++) {
    const candidate = top10[i];
    console.log(`${i + 1}. Symbol: ${candidate.symbol} | Score: ${candidate.score || candidate.longScore || 'N/A'} | Price: ₹${candidate.price}`);

    // Run prediction to get live agent outputs and TQS
    const prediction = await predictor.getPrediction(candidate.symbol, [candidate.price * 0.98, candidate.price * 0.99, candidate.price]);
    
    console.log(`   - Live TQS: ${prediction.tradeQuality}`);
    console.log(`   - Signal: ${prediction.signal}`);
    console.log(`   - Confidence: ${prediction.confidence.toFixed(4)}`);
    console.log(`   - Consensus Reached: ${prediction.consensus ? 'YES' : 'NO'}`);
    console.log('   - Agent Outputs:');
    
    const models = prediction.participating_models || {};
    console.log(`     * Agent 1 (ML): ${models.agent1?.signal} (Conf: ${models.agent1?.confidence?.toFixed(2)})`);
    console.log(`     * Agent 2 (Gemini): ${models.agent2_gemini?.signal} (Reasoning: ${models.agent2_gemini?.reasoning})`);
    console.log(`     * Agent 3 (Groq): ${models.agent3_groq?.signal} (Reasoning: ${models.agent3_groq?.reasoning})`);
    console.log(`     * Agent 4 (Technical): ${models.agent4_technical?.signal} (Conf: ${models.agent4_technical?.confidence?.toFixed(2)} | RSI: ${models.agent4_technical?.indicators?.rsi ?? 'N/A'})`);
    console.log(`     * Agent 5 (Context): ${models.agent5_context?.signal} (Conf: ${models.agent5_context?.confidence?.toFixed(2)} | Sector Performance: ${JSON.stringify(models.agent5_context?.indicators?.sectorPerformance ?? {})})`);
    
    // Rejection Analysis
    let rejectionReasons = [];
    if (prediction.signal === 'HOLD') {
      rejectionReasons.push('Consensus signal is HOLD (buyWeight <= 0.55 or weightedConfidence < 0.70)');
    }
    if (prediction.tradeQuality < 75) {
      rejectionReasons.push(`Trade Quality Score (${prediction.tradeQuality}) is below the required 75 threshold`);
    }
    console.log(`   - REJECTION ANALYSIS: ${rejectionReasons.join(' AND ')}`);
    console.log('----------------------------------------------------\n');
  }

  process.exit(0);
}

runAudit().catch(e => {
  console.error(e);
  process.exit(1);
});
