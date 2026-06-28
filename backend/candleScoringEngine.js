/**
 * Context-Aware Candle Scoring Engine for AGY-Trader (Phase 21 Rebuild)
 * Evaluates patterns inside their trend, swing structure, session, volume, and ATR location context.
 */

function detectPatterns(candles, context = {}) {
  if (!candles || candles.length < 3) {
    return {
      pattern: 'None',
      score: 50,
      strength: 'Neutral',
      reasoning: 'Insufficient candle data',
      category: 'Neutral',
      metrics: {}
    };
  }

  const len = candles.length;
  const c = candles[len - 1];      // Current candle
  const prev = candles[len - 2];   // Previous candle
  const prev2 = candles[len - 3];  // Two candles ago

  const body = Math.abs(c.close - c.open);
  const range = c.high - c.low;
  const upperWick = c.high - Math.max(c.open, c.close);
  const lowerWick = Math.min(c.open, c.close) - c.low;

  const prevBody = Math.abs(prev.close - prev.open);
  const prevRange = prev.high - prev.low;

  // Average volume of recent candles
  const avgVol = candles.slice(-10).reduce((sum, k) => sum + k.volume, 0) / 10;
  const volExpansion = c.volume > avgVol * 1.2;

  // 1. Compute Section 3 Candle Metrics
  const bodyPct = range > 0 ? parseFloat(((body / range) * 100).toFixed(2)) : 0;
  const wickPct = range > 0 ? parseFloat((((upperWick + lowerWick) / range) * 100).toFixed(2)) : 0;
  
  // ATR Calculation (14 periods)
  const trs = [];
  for (let i = Math.max(0, len - 15); i < len; i++) {
    const curr = candles[i];
    if (i === 0) {
      trs.push(curr.high - curr.low);
    } else {
      const prevC = candles[i - 1];
      trs.push(Math.max(
        curr.high - curr.low,
        Math.abs(curr.high - prevC.close),
        Math.abs(curr.low - prevC.close)
      ));
    }
  }
  const atr = trs.reduce((sum, val) => sum + val, 0) / trs.length;

  const rvol = avgVol > 0 ? parseFloat((c.volume / avgVol).toFixed(2)) : 1.0;
  const volumeDelta = parseFloat((c.volume - prev.volume).toFixed(2));
  
  const buyingPressure = range > 0 ? parseFloat((((c.close - c.low) / range) * 100).toFixed(2)) : 50;
  const sellingPressure = range > 0 ? parseFloat((((c.high - c.close) / range) * 100).toFixed(2)) : 50;
  const closingStrength = buyingPressure; // normalized 0-100
  
  const momentum = parseFloat((c.close - prev2.close).toFixed(2));
  const compression = range < atr * 0.7;
  const expansion = range > atr * 1.5;

  let patternResult = null;

  // 1. Morning Star
  if (prev2.close < prev2.open && 
      prevBody <= Math.abs(prev2.close - prev2.open) * 0.3 && 
      c.close > c.open && 
      c.close >= prev2.close + (prev2.open - prev2.close) * 0.5) {
    patternResult = {
      pattern: 'Morning Star',
      baseScore: 80,
      strength: 'Medium',
      reasoning: 'Bullish Morning Star reversal pattern.',
      category: 'Trend Reversal',
      direction: 'BUY'
    };
  }
  // 2. Evening Star
  else if (prev2.close > prev2.open && 
           prevBody <= Math.abs(prev2.close - prev2.open) * 0.3 && 
           c.close < c.open && 
           c.close <= prev2.close - (prev2.close - prev2.open) * 0.5) {
    patternResult = {
      pattern: 'Evening Star',
      baseScore: 80,
      strength: 'Medium',
      reasoning: 'Bearish Evening Star reversal pattern.',
      category: 'Trend Reversal',
      direction: 'SELL'
    };
  }
  // 3. Doji
  else if (range > 0 && body <= 0.05 * range) {
    patternResult = {
      pattern: 'Doji',
      baseScore: 50,
      strength: 'Weak',
      reasoning: 'Doji candle shows balance/indecision.',
      category: 'Compression',
      direction: 'HOLD'
    };
  }
  // 4. Marubozu
  else if (range > 0 && body >= 0.90 * range) {
    const isBullish = c.close > c.open;
    patternResult = {
      pattern: 'Marubozu',
      baseScore: 85,
      strength: 'Strong',
      reasoning: `${isBullish ? 'Bullish' : 'Bearish'} Marubozu showing strong momentum.`,
      category: 'Expansion',
      direction: isBullish ? 'BUY' : 'SELL'
    };
  }
  // 5. Bullish Engulfing
  else if (prev.close < prev.open && c.close > c.open && c.close >= prev.open && c.open <= prev.close) {
    patternResult = {
      pattern: 'Bullish Engulfing',
      baseScore: 75,
      strength: 'Medium',
      reasoning: 'Bullish Engulfing pattern wrapping prev body.',
      category: 'Expansion',
      direction: 'BUY'
    };
  }
  // 6. Bearish Engulfing
  else if (prev.close > prev.open && c.close < c.open && c.close <= prev.open && c.open >= prev.close) {
    patternResult = {
      pattern: 'Bearish Engulfing',
      baseScore: 75,
      strength: 'Medium',
      reasoning: 'Bearish Engulfing pattern wrapping prev body.',
      category: 'Expansion',
      direction: 'SELL'
    };
  }
  // 7. Hammer
  else if (lowerWick >= 2 * body && upperWick <= 0.2 * body && range > 0) {
    const isBullish = c.close > c.open;
    patternResult = {
      pattern: 'Hammer',
      baseScore: isBullish ? 70 : 60,
      strength: 'Medium',
      reasoning: 'Hammer pin rejection of lower prices.',
      category: 'Trend Reversal',
      direction: 'BUY'
    };
  }
  // 8. Shooting Star
  else if (upperWick >= 2 * body && lowerWick <= 0.2 * body && range > 0) {
    const isBearish = c.close < c.open;
    patternResult = {
      pattern: 'Shooting Star',
      baseScore: isBearish ? 70 : 60,
      strength: 'Medium',
      reasoning: 'Shooting Star rejection of higher prices.',
      category: 'Trend Reversal',
      direction: 'SELL'
    };
  }
  // 9. Pin Bar
  else if (Math.max(upperWick, lowerWick) >= 0.7 * range && body <= 0.2 * range && range > 0) {
    const isBullishRejection = lowerWick > upperWick;
    patternResult = {
      pattern: 'Pin Bar',
      baseScore: 75,
      strength: 'Medium',
      reasoning: `${isBullishRejection ? 'Bullish' : 'Bearish'} Pin Bar rejection.`,
      category: 'Liquidity Grab',
      direction: isBullishRejection ? 'BUY' : 'SELL'
    };
  }
  // 10. Outside Bar
  else if (c.high >= prev.high && c.low <= prev.low) {
    patternResult = {
      pattern: 'Outside Bar',
      baseScore: 65,
      strength: 'Medium',
      reasoning: 'Outside Bar range expansion.',
      category: 'Expansion',
      direction: c.close > c.open ? 'BUY' : 'SELL'
    };
  }
  // 11. Inside Bar
  else if (c.high <= prev.high && c.low >= prev.low) {
    patternResult = {
      pattern: 'Inside Bar',
      baseScore: 60,
      strength: 'Medium',
      reasoning: 'Inside Bar compression.',
      category: 'Compression',
      direction: 'HOLD'
    };
  }
  // Fallbacks
  else {
    const isHigherClose = c.close > prev.close;
    patternResult = {
      pattern: 'None',
      baseScore: 50,
      strength: 'Weak',
      reasoning: 'Standard price progression.',
      category: 'Trend Continuation',
      direction: isHigherClose ? 'BUY' : 'SELL'
    };
  }

  // --- CONTEXT EVALUATION SYSTEM (Section 1) ---
  let contextScore = patternResult.baseScore;
  let rejections = [];

  // A. ATR Filter (Noise reduction)
  if (range < 0.5 * atr) {
    contextScore -= 25;
    rejections.push('Pattern range below 0.5 ATR threshold (market noise)');
  }

  // B. Trend Alignment Context
  const trend = context.trend || 'RANGING';
  if (patternResult.direction !== 'HOLD' && trend !== 'RANGING') {
    if (patternResult.direction === trend) {
      contextScore += 10;
    } else {
      const isReversalAtSwing = context.isNearSwingHigh || context.isNearSwingLow;
      if (!isReversalAtSwing) {
        contextScore -= 15;
        rejections.push('Counter-trend candle pattern without structure alignment');
      }
    }
  }

  // C. Swing Structure / Location Context
  if (patternResult.direction === 'BUY') {
    if (context.isNearSwingLow || context.premiumDiscount === 'DISCOUNT') {
      contextScore += 15;
    } else if (context.isNearSwingHigh || context.premiumDiscount === 'PREMIUM') {
      contextScore -= 20;
      rejections.push('Bullish pattern at swing high / premium zone');
    } else {
      contextScore -= 10;
    }
  } else if (patternResult.direction === 'SELL') {
    if (context.isNearSwingHigh || context.premiumDiscount === 'PREMIUM') {
      contextScore += 15;
    } else if (context.isNearSwingLow || context.premiumDiscount === 'DISCOUNT') {
      contextScore -= 20;
      rejections.push('Bearish pattern at swing low / discount zone');
    } else {
      contextScore -= 10;
    }
  }

  // D. Liquidity zones
  if (context.isNearLiquidityGrab) {
    contextScore += 10;
  }

  // E. Relative Volume (RVOL)
  if (rvol > 1.5) {
    contextScore += 10;
  } else if (rvol < 0.5) {
    contextScore -= 10;
  }

  // F. Session timing (NSE open/close hours have premium liquidity)
  if (context.isHighLiquiditySession) {
    contextScore += 5;
  }

  // G. VWAP proximity context
  if (context.distVWAP !== undefined && Math.abs(context.distVWAP) <= 0.2) {
    contextScore += 5;
  }

  // H. EMA proximity context (pullback alignment)
  if (context.distEMA21 !== undefined && Math.abs(context.distEMA21) <= 0.15) {
    contextScore += 10;
  } else if (context.distEMA50 !== undefined && Math.abs(context.distEMA50) <= 0.15) {
    contextScore += 10;
  }

  // I. Order Block (OB) proximity context
  if (context.distOB !== undefined && Math.abs(context.distOB) <= 0.2) {
    contextScore += 15;
  }

  // J. Fair Value Gap (FVG) proximity context
  if (context.distFVG !== undefined && Math.abs(context.distFVG) <= 0.2) {
    contextScore += 10;
  }

  // Clamp final score
  const finalScore = Math.max(1, Math.min(100, contextScore));
  const quality = finalScore >= 85 ? 'Strong' : (finalScore >= 75 ? 'Medium' : 'Weak');

  const finalMetrics = {
    bodyPct,
    wickPct,
    range,
    atr,
    rvol,
    volumeDelta,
    buyingPressure,
    sellingPressure,
    closingStrength,
    momentum,
    compression,
    expansion
  };

  return {
    pattern: patternResult.pattern,
    score: finalScore,
    strength: quality,
    reasoning: patternResult.reasoning + (rejections.length > 0 ? ` Context Issues: ${rejections.join('; ')}` : ' Context aligned.'),
    category: patternResult.category,
    direction: patternResult.direction,
    metrics: finalMetrics
  };
}

module.exports = {
  scoreSetup: detectPatterns,
  detectPatterns
};
