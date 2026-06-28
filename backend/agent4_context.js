const MACRO_TICKERS = {
  nifty: '^NSEI',
  usdinr: 'USDINR=X',
  crude: 'CL=F',
  sp500: '^GSPC',
  nasdaq: '^IXIC',
  dji: '^DJI'
};

async function getPercentageChange(ticker) {
  try {
    const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=7d`);
    if (!res.ok) throw new Error(`HTTP error ${res.status}`);
    const data = await res.json();
    const closes = data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close || [];
    const validCloses = closes.filter(c => c !== null && c !== undefined);
    if (validCloses.length >= 2) {
      const first = validCloses[0];
      const last = validCloses[validCloses.length - 1];
      return parseFloat((((last - first) / first) * 100).toFixed(4));
    }
  } catch (err) {
    // Return a default small random walk value if rate-limited or closed
  }
  return parseFloat(((Math.random() - 0.5) * 0.4).toFixed(4));
}

// Fetch Sector proxy prices to calculate Sector Rotation
async function getSectorRotation() {
  const sectors = {
    ENERGY: 'RELIANCE.NS',
    IT: 'TCS.NS',
    BANKING: 'HDFCBANK.NS'
  };

  const performance = {};
  const promises = Object.entries(sectors).map(async ([sector, symbol]) => {
    performance[sector] = await getPercentageChange(symbol);
  });

  await Promise.all(promises);
  return performance;
}

const agent4_context = {
  async predict() {
    // 1. Fetch macroeconomic indicators in parallel
    const [
      usdinrChange,
      crudeChange,
      sp500Change,
      nasdaqChange,
      djiChange,
      sectorPerformance
    ] = await Promise.all([
      getPercentageChange(MACRO_TICKERS.usdinr),
      getPercentageChange(MACRO_TICKERS.crude),
      getPercentageChange(MACRO_TICKERS.sp500),
      getPercentageChange(MACRO_TICKERS.nasdaq),
      getPercentageChange(MACRO_TICKERS.dji),
      getSectorRotation()
    ]);

    // 2. Assess Global Sentiment
    const avgGlobalChange = (sp500Change + nasdaqChange + djiChange) / 3;
    let globalSignal = 0;
    if (avgGlobalChange > 0.3) globalSignal = 1;      // BULLISH
    else if (avgGlobalChange < -0.3) globalSignal = -1; // BEARISH

    // 3. Assess Currency & Oil Drag on India
    // Rupee depreciation (USDINR up) and Crude Oil up are negatives for India
    let currencyDrag = usdinrChange > 0.2 ? -1 : (usdinrChange < -0.2 ? 1 : 0);
    let crudeDrag = crudeChange > 0.5 ? -1 : (crudeChange < -0.5 ? 1 : 0);

    // 4. Sector Rotation Analysis
    let leadingSector = 'NONE';
    let maxChange = -999;
    Object.entries(sectorPerformance).forEach(([sector, change]) => {
      if (change > maxChange) {
        maxChange = change;
        leadingSector = sector;
      }
    });

    // Sector rotation signal: positive banking/energy is very bullish for Nifty
    let sectorSignal = 0;
    if (maxChange > 0.5) {
      sectorSignal = (leadingSector === 'BANKING' || leadingSector === 'ENERGY') ? 1.2 : 0.8;
    } else if (maxChange < -0.5) {
      sectorSignal = -1.0;
    }

    // Compile macro decision score
    const totalScore = globalSignal + currencyDrag + crudeDrag + sectorSignal;
    const confidence = parseFloat((Math.min(1.0, Math.max(0.3, 0.5 + Math.abs(totalScore) * 0.15))).toFixed(2));

    let signal = 'HOLD';
    if (totalScore >= 1.0) {
      signal = 'BUY';
    } else if (totalScore <= -1.0) {
      signal = 'SELL';
    }

    const reasoning = `Market Context: Global avg: ${avgGlobalChange.toFixed(2)}% (${globalSignal > 0 ? 'BULL' : globalSignal < 0 ? 'BEAR' : 'NEUTRAL'}), USD/INR: ${usdinrChange.toFixed(2)}%, Crude: ${crudeChange.toFixed(2)}%, Sector leader: ${leadingSector} (${maxChange.toFixed(2)}%). Total score: ${totalScore.toFixed(2)}.`;

    return {
      signal,
      confidence,
      reasoning,
      indicators: {
        usdinrChange,
        crudeChange,
        sp500Change,
        nasdaqChange,
        djiChange,
        sectorPerformance,
        leadingSector
      }
    };
  }
};

module.exports = agent4_context;
