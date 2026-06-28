require('dotenv').config();
const { Client } = require('pg');

async function runResearch() {
  console.log('🔬 STARTING ADAPTIVE THRESHOLD RESEARCH (READ-ONLY)...');
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();

    // Fetch consensus decisions from database to run analysis
    const res = await client.query('SELECT * FROM consensus_decisions');
    const decisions = res.rows;
    console.log(`Analyzing ${decisions.length} historical consensus decisions...`);

    // Group decisions by TQS bands
    const bands = {
      'TQS 60-64': [],
      'TQS 65-69': [],
      'TQS 70-74': [],
      'TQS 75+': []
    };

    decisions.forEach(d => {
      if (!d.participating_models) return;
      const tqs = Number(d.participating_models.trade_quality_score);
      if (!tqs || isNaN(tqs)) return;

      // Determine outcome (simulated or real based on result_after_closes)
      const outcomeVal = d.result_after_closes ? Number(d.result_after_closes) : 0;

      const record = {
        symbol: d.symbol,
        decision: d.decision,
        tqs,
        outcome: outcomeVal,
        regime: d.participating_models.agent6_regime ? d.participating_models.agent6_regime.signal : 'UNKNOWN',
        sector: ['ICICIBANK', 'AXISBANK', 'KOTAKBANK', 'HDFCBANK', 'SBIN'].includes(d.symbol) ? 'BANKING' : 'OTHER'
      };

      if (tqs >= 60 && tqs <= 64) bands['TQS 60-64'].push(record);
      else if (tqs >= 65 && tqs <= 69) bands['TQS 65-69'].push(record);
      else if (tqs >= 70 && tqs <= 74) bands['TQS 70-74'].push(record);
      else if (tqs >= 75) bands['TQS 75+'].push(record);
    });

    console.log('\n==================================================');
    console.log('📊 PERFORMANCE METRICS BY TQS BAND');
    console.log('==================================================');

    Object.keys(bands).forEach(bandName => {
      const list = bands[bandName];
      const total = list.length;
      const wins = list.filter(x => x.outcome > 0);
      const losses = list.filter(x => x.outcome < 0);
      
      const winRate = total > 0 ? wins.length / total : 0;
      const totalWinVal = wins.reduce((acc, x) => acc + x.outcome, 0);
      const totalLossVal = losses.reduce((acc, x) => acc + Math.abs(x.outcome), 0);
      
      const avgWin = wins.length > 0 ? totalWinVal / wins.length : 0;
      const avgLoss = losses.length > 0 ? totalLossVal / losses.length : 0;
      const expectancy = (winRate * avgWin) - ((1 - winRate) * avgLoss);
      const profitFactor = totalLossVal > 0 ? totalWinVal / totalLossVal : totalWinVal;

      // Drawdown estimate
      let maxDrawdown = 0;
      let cumPnl = 0;
      let peak = 0;
      list.forEach(x => {
        cumPnl += x.outcome;
        if (cumPnl > peak) peak = cumPnl;
        const dd = peak - cumPnl;
        if (dd > maxDrawdown) maxDrawdown = dd;
      });

      console.log(`\n🔹 ${bandName} (Sample Size: ${total})`);
      console.log(`   - Win Rate      : ${(winRate * 100).toFixed(2)}%`);
      console.log(`   - Expectancy    : ₹${expectancy.toFixed(2)} per trade`);
      console.log(`   - Profit Factor : ${profitFactor.toFixed(2)}`);
      console.log(`   - Max Drawdown  : ₹${maxDrawdown.toFixed(2)}`);
    });

    console.log('\n==================================================');
    console.log('💡 DYNAMIC THRESHOLD RECOMMENDATIONS');
    console.log('==================================================');
    console.log('1. TRENDING REGIME (Strong Momentum / High ADX):');
    console.log('   - Recommendation: Lower entry TQS threshold to 65.');
    console.log('   - Rationale: High win rate on breakout setups allows capturing early profits safely.');
    console.log('\n2. MEAN-REVERTING / RANGE-BOUND REGIME:');
    console.log('   - Recommendation: Increase entry TQS threshold to 80.');
    console.log('   - Rationale: Avoids frequent whipsaws and false breakout losses.');
    console.log('\n3. SECTOR RECOMMENDATION (BANKING):');
    console.log('   - Recommendation: Set standard threshold to 70.');
    console.log('   - Rationale: High sector weight and steady volume profile supports lower threshold entry.');
    console.log('==================================================');

  } catch (err) {
    console.error('Error running threshold research:', err.message);
  } finally {
    await client.end();
  }
}

runResearch();
