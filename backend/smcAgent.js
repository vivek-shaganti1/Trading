// SMC Agent for Smart Money Concepts (SMC) Analysis (Section 1)
function predict(symbol, candles) {
  if (!candles || candles.length < 10) {
    return {
      vote: 'HOLD',
      confidence: 0.50,
      structureScore: 50,
      bosScore: 50,
      chochScore: 50,
      liquidityScore: 50,
      orderBlockScore: 50,
      fvgScore: 50,
      premiumDiscountScore: 50,
      reasoning: 'Insufficient historical candles to perform SMC calculations.'
    };
  }

  const closes = candles.map(c => c.close);
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  const len = candles.length;
  const ltp = closes[len - 1];

  // A. Market Structure (HH, HL, LH, LL)
  let structure = 'RANGING';
  let structureScore = 50;
  const recentHighs = highs.slice(-5);
  const recentLows = lows.slice(-5);

  const maxH = Math.max(...recentHighs);
  const minL = Math.min(...recentLows);

  if (closes[len - 1] > closes[len - 5]) {
    structure = 'BULLISH';
    structureScore = 75;
  } else if (closes[len - 1] < closes[len - 5]) {
    structure = 'BEARISH';
    structureScore = 25;
  }

  // B. Break Of Structure (BOS)
  let bosType = 'None';
  let bosScore = 50;
  const prevPeakHigh = Math.max(...highs.slice(-10, -3));
  const prevValleyLow = Math.min(...lows.slice(-10, -3));

  if (ltp > prevPeakHigh) {
    bosType = 'BULLISH_BOS';
    bosScore = 80;
  } else if (ltp < prevValleyLow) {
    bosType = 'BEARISH_BOS';
    bosScore = 20;
  }

  // C. Change Of Character (CHOCH)
  let chochType = 'None';
  let chochScore = 50;
  const rangeHigh = Math.max(...highs.slice(-15, -5));
  const rangeLow = Math.min(...lows.slice(-15, -5));

  if (ltp > rangeHigh) {
    chochType = 'BULLISH_CHOCH';
    chochScore = 85;
  } else if (ltp < rangeLow) {
    chochType = 'BEARISH_CHOCH';
    chochScore = 15;
  }

  // D. Liquidity Sweeps
  let liquidityType = 'None';
  let liquidityScore = 50;
  if (highs[len - 1] > prevPeakHigh && closes[len - 1] < prevPeakHigh) {
    liquidityType = 'EQUAL_HIGH_SWEEP';
    liquidityScore = 30; // bearish sweep
  } else if (lows[len - 1] < prevValleyLow && closes[len - 1] > prevValleyLow) {
    liquidityType = 'EQUAL_LOW_SWEEP';
    liquidityScore = 70; // bullish sweep
  }

  // E. Order Blocks (OB)
  let obType = 'None';
  let obScore = 50;
  let obStatus = 'Fresh';
  
  // Last opposing candle before a strong move
  const firstCandleColor = closes[len - 3] > closes[len - 4] ? 'GREEN' : 'RED';
  const secondCandleColor = closes[len - 2] > closes[len - 3] ? 'GREEN' : 'RED';

  if (firstCandleColor === 'RED' && secondCandleColor === 'GREEN' && ltp > closes[len - 2]) {
    obType = 'BULLISH_OB';
    obScore = 75;
  } else if (firstCandleColor === 'GREEN' && secondCandleColor === 'RED' && ltp < closes[len - 2]) {
    obType = 'BEARISH_OB';
    obScore = 25;
  }

  // F. Fair Value Gaps (FVG)
  let fvgType = 'None';
  let fvgScore = 50;
  let fvgStatus = 'Open';

  // Bullish FVG: Low of candle 3 is greater than High of candle 1
  if (lows[len - 1] > highs[len - 3]) {
    fvgType = 'BULLISH_FVG';
    fvgScore = 80;
  } else if (highs[len - 1] < lows[len - 3]) {
    fvgType = 'BEARISH_FVG';
    fvgScore = 20;
  }

  // G. Premium / Discount Zones
  const highest = Math.max(...highs.slice(-14));
  const lowest = Math.min(...lows.slice(-14));
  const equilibrium = (highest + lowest) / 2;
  let premiumDiscountZone = 'EQUILIBRIUM';
  let premiumDiscountScore = 50;

  if (ltp > equilibrium) {
    premiumDiscountZone = 'PREMIUM';
    premiumDiscountScore = 35; // expensive to buy
  } else if (ltp < equilibrium) {
    premiumDiscountZone = 'DISCOUNT';
    premiumDiscountScore = 65; // cheap to buy
  }

  // Final Vote & Confidence Output
  let vote = 'HOLD';
  let totalScore = (structureScore + bosScore + chochScore + liquidityScore + obScore + fvgScore + premiumDiscountScore) / 7;
  let confidence = 0.50;

  if (totalScore > 58) {
    vote = 'BUY';
    confidence = 0.50 + (totalScore - 58) / 100;
  } else if (totalScore < 42) {
    vote = 'SELL';
    confidence = 0.50 + (42 - totalScore) / 100;
  }

  const reasoning = `SMC Analysis: structure=${structure}, BOS=${bosType}, CHOCH=${chochType}, liquidity=${liquidityType}, OB=${obType}, FVG=${fvgType}, zone=${premiumDiscountZone}.`;

  return {
    vote,
    confidence: parseFloat(Math.min(0.92, confidence).toFixed(2)),
    structureScore,
    bosScore,
    chochScore,
    liquidityScore,
    orderBlockScore: obScore,
    fvgScore,
    premiumDiscountScore,
    reasoning
  };
}

module.exports = {
  predict
};
