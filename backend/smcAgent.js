// SMC Agent for Smart Money Concepts (SMC) Analysis (Section 1)

function findSwings(candles) {
  const swingHighs = [];
  const swingLows = [];
  // Require 2 candles on left and right to confirm a local peak/valley
  for (let i = 2; i < candles.length - 2; i++) {
    const h = candles[i].high;
    const l = candles[i].low;
    if (h > candles[i - 1].high && h > candles[i - 2].high && h > candles[i + 1].high && h > candles[i + 2].high) {
      swingHighs.push({ price: h, index: i });
    }
    if (l < candles[i - 1].low && l < candles[i - 2].low && l < candles[i + 1].low && l < candles[i + 2].low) {
      swingLows.push({ price: l, index: i });
    }
  }
  return { swingHighs, swingLows };
}

function findUnmitigatedOBsAndFVGs(candles) {
  const obs = []; // { type: 'BULLISH'|'BEARISH', low: number, high: number, index: number }
  const fvgs = []; // { type: 'BULLISH'|'BEARISH', lowLimit: number, highLimit: number, index: number }

  for (let i = 2; i < candles.length; i++) {
    const cPrev2 = candles[i - 2];
    const cPrev1 = candles[i - 1];
    const cCurr = candles[i];

    // 1. Check Mitigation for existing blocks by current candle high/low
    for (let j = obs.length - 1; j >= 0; j--) {
      const ob = obs[j];
      if (ob.type === 'BULLISH' && cCurr.low <= ob.low) {
        obs.splice(j, 1); // Mitigated / breached
      } else if (ob.type === 'BEARISH' && cCurr.high >= ob.high) {
        obs.splice(j, 1); // Mitigated / breached
      }
    }

    for (let j = fvgs.length - 1; j >= 0; j--) {
      const fvg = fvgs[j];
      if (fvg.type === 'BULLISH' && cCurr.low <= fvg.lowLimit) {
        fvgs.splice(j, 1); // FVG completely filled
      } else if (fvg.type === 'BEARISH' && cCurr.high >= fvg.highLimit) {
        fvgs.splice(j, 1); // FVG completely filled
      }
    }

    // 2. Detect New Fair Value Gaps (FVG)
    if (cCurr.low > cPrev2.high) {
      fvgs.push({
        type: 'BULLISH',
        lowLimit: cPrev2.high,
        highLimit: cCurr.low,
        index: i
      });
    } else if (cCurr.high < cPrev2.low) {
      fvgs.push({
        type: 'BEARISH',
        lowLimit: cCurr.high,
        highLimit: cPrev2.low,
        index: i
      });
    }

    // 3. Detect New Order Blocks (OB)
    // Bullish OB: An aggressive green candle body exceeds previous candle high
    const isBullishImpulse = cCurr.close > cCurr.open && (cCurr.close - cCurr.open) > (cPrev1.high - cPrev1.low);
    if (isBullishImpulse && cPrev1.close < cPrev1.open) {
      obs.push({
        type: 'BULLISH',
        low: cPrev1.low,
        high: cPrev1.high,
        index: i - 1
      });
    }

    // Bearish OB: An aggressive red candle body exceeds previous candle low
    const isBearishImpulse = cCurr.close < cCurr.open && (cCurr.open - cCurr.close) > (cPrev1.high - cPrev1.low);
    if (isBearishImpulse && cPrev1.close > cPrev1.open) {
      obs.push({
        type: 'BEARISH',
        low: cPrev1.low,
        high: cPrev1.high,
        index: i - 1
      });
    }
  }

  return { obs, fvgs };
}

function predict(symbol, candles) {
  if (!candles || candles.length < 15) {
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

  // 1. Get fractal swings
  const { swingHighs, swingLows } = findSwings(candles);
  
  // 2. Get unmitigated blocks
  const { obs, fvgs } = findUnmitigatedOBsAndFVGs(candles);

  // A. Market Structure (Dynamic direction of swings)
  let structure = 'RANGING';
  let structureScore = 50;
  if (swingHighs.length >= 2 && swingLows.length >= 2) {
    const lastH = swingHighs[swingHighs.length - 1].price;
    const prevH = swingHighs[swingHighs.length - 2].price;
    const lastL = swingLows[swingLows.length - 1].price;
    const prevL = swingLows[swingLows.length - 2].price;

    if (lastH > prevH && lastL > prevL) {
      structure = 'BULLISH';
      structureScore = 80;
    } else if (lastH < prevH && lastL < prevL) {
      structure = 'BEARISH';
      structureScore = 20;
    }
  }

  // B. Break Of Structure (BOS)
  let bosType = 'None';
  let bosScore = 50;
  if (swingHighs.length > 0 && swingLows.length > 0) {
    const activeHigh = swingHighs[swingHighs.length - 1].price;
    const activeLow = swingLows[swingLows.length - 1].price;

    if (ltp > activeHigh) {
      bosType = 'BULLISH_BOS';
      bosScore = 85;
    } else if (ltp < activeLow) {
      bosType = 'BEARISH_BOS';
      bosScore = 15;
    }
  }

  // C. Change Of Character (CHOCH)
  let chochType = 'None';
  let chochScore = 50;
  if (swingHighs.length >= 2 && swingLows.length >= 2) {
    const keyHigh = Math.max(...swingHighs.slice(-2).map(s => s.price));
    const keyLow = Math.min(...swingLows.slice(-2).map(s => s.price));

    if (ltp > keyHigh) {
      chochType = 'BULLISH_CHOCH';
      chochScore = 90;
    } else if (ltp < keyLow) {
      chochType = 'BEARISH_CHOCH';
      chochScore = 10;
    }
  }

  // D. Liquidity Sweeps
  let liquidityType = 'None';
  let liquidityScore = 50;
  if (swingHighs.length > 0 && swingLows.length > 0) {
    const targetHigh = swingHighs[swingHighs.length - 1].price;
    const targetLow = swingLows[swingLows.length - 1].price;

    if (highs[len - 1] > targetHigh && ltp < targetHigh) {
      liquidityType = 'BEARISH_SWEEP';
      liquidityScore = 25;
    } else if (lows[len - 1] < targetLow && ltp > targetLow) {
      liquidityType = 'BULLISH_SWEEP';
      liquidityScore = 75;
    }
  }

  // E. Order Block & FVG Proximity/Mitigation check
  let obType = 'None';
  let obScore = 50;
  let fvgType = 'None';
  let fvgScore = 50;

  const activeBullishOB = obs.find(ob => ob.type === 'BULLISH');
  const activeBearishOB = obs.find(ob => ob.type === 'BEARISH');
  if (activeBullishOB && ltp >= activeBullishOB.low && ltp <= activeBullishOB.high) {
    obType = 'BULLISH_OB_TEST';
    obScore = 80;
  } else if (activeBearishOB && ltp >= activeBearishOB.low && ltp <= activeBearishOB.high) {
    obType = 'BEARISH_OB_TEST';
    obScore = 20;
  }

  const activeBullishFVG = fvgs.find(f => f.type === 'BULLISH');
  const activeBearishFVG = fvgs.find(f => f.type === 'BEARISH');
  if (activeBullishFVG && ltp >= activeBullishFVG.lowLimit && ltp <= activeBullishFVG.highLimit) {
    fvgType = 'BULLISH_FVG_TEST';
    fvgScore = 80;
  } else if (activeBearishFVG && ltp >= activeBearishFVG.lowLimit && ltp <= activeBearishFVG.highLimit) {
    fvgType = 'BEARISH_FVG_TEST';
    fvgScore = 20;
  }

  // F. Premium / Discount Zones
  const highest = Math.max(...highs.slice(-14));
  const lowest = Math.min(...lows.slice(-14));
  const equilibrium = (highest + lowest) / 2;
  let premiumDiscountZone = 'EQUILIBRIUM';
  let premiumDiscountScore = 50;

  if (ltp > equilibrium) {
    premiumDiscountZone = 'PREMIUM';
    premiumDiscountScore = 35;
  } else if (ltp < equilibrium) {
    premiumDiscountZone = 'DISCOUNT';
    premiumDiscountScore = 65;
  }

  // G. Vote Compilation
  let vote = 'HOLD';
  const totalScore = (structureScore + bosScore + chochScore + liquidityScore + obScore + fvgScore + premiumDiscountScore) / 7;
  let confidence = 0.50;

  if (totalScore > 58) {
    vote = 'BUY';
    confidence = 0.50 + (totalScore - 58) / 100;
  } else if (totalScore < 42) {
    vote = 'SELL';
    confidence = 0.50 + (42 - totalScore) / 100;
  }

  const reasoning = `SMC Analysis: structure=${structure}, BOS=${bosType}, CHOCH=${chochType}, liquidity=${liquidityType}, OB=${obType}, FVG=${fvgType}, zone=${premiumDiscountZone}. Active OBs: ${obs.filter(o => o.type === 'BULLISH').length} Bull, ${obs.filter(o => o.type === 'BEARISH').length} Bear.`;

  return {
    vote,
    // The consensus loop in predictor.js reads `.signal`, not `.vote`. Without
    // this alias agent12 was counted in activeWeightSum and diluted every other
    // agent's share by ~7%, while being structurally unable to cast a vote.
    signal: vote,
    confidence: parseFloat(Math.min(0.95, confidence).toFixed(2)),
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
