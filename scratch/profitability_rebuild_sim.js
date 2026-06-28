const { Client } = require('pg');
require('dotenv').config();

async function run() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  try {
    await client.connect();

    // Fetch completed trades
    const res = await client.query('SELECT * FROM completed_trades');
    const trades = res.rows;

    // Filter out the corrupted June 12 trades to get a clean baseline of normal market conditions
    // The corrupted trades are those with huge losses or abnormal price moves on June 12
    const cleanTrades = trades.filter(t => {
      // Exclude JSWENERGY, HINDPETRO, BPCL, GAIL, CESC, IDEA, GUJGASLTD, ADANIGREEN, TORNTPOWER from June 12
      const dateStr = t.exit_time.toISOString().split('T')[0];
      const corruptedSymbols = ['JSWENERGY', 'HINDPETRO', 'BPCL', 'GAIL', 'CESC', 'IDEA', 'GUJGASLTD', 'ADANIGREEN', 'TORNTPOWER'];
      if (dateStr === '2026-06-12' && corruptedSymbols.includes(t.symbol)) {
        return false;
      }
      return true;
    });

    console.log(`Clean baseline trades: ${cleanTrades.length} out of ${trades.length}`);

    // Simulation parameters
    const tqsOptions = [65, 70, 75, 80];
    const sizeOptions = [0.10, 0.15, 0.20, 0.25];

    console.log('\n========================================================================');
    console.log('📊 SIMULATION RESULTS (TQS THRESHOLDS vs POSITION SIZES) ON ₹12,000 START');
    console.log('========================================================================');
    console.log('TQS | Size % | Expected Daily Profit | Win Rate % | Max Drawdown % | Sharpe | Trade Freq/Day');
    console.log('----|--------|-----------------------|------------|----------------|--------|---------------');

    tqsOptions.forEach(tqsLimit => {
      sizeOptions.forEach(sizePct => {
        // Filter trades matching this TQS limit
        const filteredTrades = cleanTrades.filter(t => Number(t.tqs || 65) >= tqsLimit);
        
        let initialCapital = 12000;
        let capital = initialCapital;
        let peak = initialCapital;
        let maxDD = 0;
        
        let wins = 0;
        let totalPnL = 0;
        let dailyPnLList = [];

        filteredTrades.forEach(t => {
          const retPct = parseFloat(t.return_pct || 0);
          // Calculate trade PnL based on custom position size percentage
          const tradeSize = capital * sizePct;
          const tradePnL = tradeSize * (retPct / 100);
          
          capital += tradePnL;
          totalPnL += tradePnL;
          dailyPnLList.push(tradePnL);
          
          if (tradePnL > 0) wins++;
          if (capital > peak) peak = capital;
          const dd = ((peak - capital) / peak) * 100;
          if (dd > maxDD) maxDD = dd;
        });

        const winRate = filteredTrades.length > 0 ? (wins / filteredTrades.length) * 100 : 0;
        
        // Expected Daily Profit assuming 5 trade setups scanned per day on average, converted to actual trade frequency
        // Trade frequency = filteredTrades / active days (approx 3 days in database logs)
        const tradeFreq = filteredTrades.length / 3;
        const expectedProfit = filteredTrades.length > 0 ? (totalPnL / filteredTrades.length) * tradeFreq : 0;

        // Sharpe Ratio estimation from PnL list
        const avgPnL = filteredTrades.length > 0 ? totalPnL / filteredTrades.length : 0;
        const variance = filteredTrades.length > 1 
          ? dailyPnLList.reduce((sum, val) => sum + Math.pow(val - avgPnL, 2), 0) / (filteredTrades.length - 1)
          : 0;
        const stdDev = Math.sqrt(variance);
        const sharpe = stdDev > 0 ? (avgPnL / stdDev) * Math.sqrt(252) : 0;

        console.log(
          `${tqsLimit}  | ${(sizePct*100).toFixed(0)}%    | ₹${expectedProfit.toFixed(2).padEnd(20)} | ${winRate.toFixed(1)}%      | ${maxDD.toFixed(2)}%          | ${sharpe.toFixed(2).padEnd(6)} | ${tradeFreq.toFixed(2)}`
        );
      });
    });

  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}

run();
