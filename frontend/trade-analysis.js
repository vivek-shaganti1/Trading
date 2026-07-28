// Standalone Trade Analysis JS Controller
function getBackendBase() {
  const customUrl = localStorage.getItem('BACKEND_URL');
  if (customUrl) {
    return customUrl.replace(/\/$/, '');
  }
  const injectedUrl = "__API_BASE_URL__";
  if (injectedUrl && !injectedUrl.startsWith('__')) {
    return injectedUrl.replace(/\/$/, '');
  }
  return '';
}

const backendBase = getBackendBase();
let liveAnalysisChart = null;
let rsiAnalysisChart = null;
let candlestickSeries = null;
let volumeSeries = null;
let ema9Series = null;
let ema21Series = null;
let supportSeries = null;
let resistanceSeries = null;
let vwapSeries = null;
let stopLossSeries = null;
let targetSeries = null;
let currentPriceSeries = null;
let rsiSeries = null;

let allReplayCandles = [];
let currentCandles = [];
let replayIndex = 0;
let isReplaying = false;
let replayTimer = null;
let currentSymbol = '';

// Parse query params
const urlParams = new URLSearchParams(window.location.search);
currentSymbol = urlParams.get('symbol') || 'NIFTY50_MINI';
console.log('Parsed symbol query parameter:', currentSymbol);

document.getElementById('symbol-header').innerText = currentSymbol;
document.getElementById('intel-symbol').innerText = currentSymbol;

// Initialize charting immediately if DOM is ready, or on DOMContentLoaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startInitialization);
} else {
  startInitialization();
}

function startInitialization() {
  console.log('Starting chart initialization...');
  initChart();
  loadChartData(currentSymbol);
  connectWS();
}

// Init charts
function initChart() {
  const chartContainer = document.getElementById('tv-chart-container');
  const rsiContainer = document.getElementById('tv-rsi-container');
  console.log('Chart container element:', chartContainer);
  console.log('RSI container element:', rsiContainer);
  if (!chartContainer || !rsiContainer) return;

  const chartOptions = {
    layout: {
      background: { type: 'solid', color: 'transparent' },
      textColor: '#5E696E',
    },
    grid: {
      vertLines: { color: 'rgba(0, 0, 0, 0.03)' },
      horzLines: { color: 'rgba(0, 0, 0, 0.03)' },
    },
    crosshair: { mode: 0 },
    timeScale: {
      borderColor: 'rgba(0, 0, 0, 0.08)',
      timeVisible: true,
    },
    rightPriceScale: { borderColor: 'rgba(0, 0, 0, 0.08)' }
  };

  const containerWidth = chartContainer.clientWidth || 800;
  const containerHeight = chartContainer.clientHeight || 400;
  console.log(`Initializing liveAnalysisChart with dimensions: ${containerWidth}x${containerHeight}`);

  liveAnalysisChart = LightweightCharts.createChart(chartContainer, {
    ...chartOptions,
    width: containerWidth,
    height: containerHeight,
  });
  console.log('liveAnalysisChart created successfully:', !!liveAnalysisChart);
  if (liveAnalysisChart) {
    console.log('liveAnalysisChart keys:', Object.keys(liveAnalysisChart));
  }

  candlestickSeries = liveAnalysisChart.addCandlestickSeries({
    upColor: '#94B692', downColor: '#D59DA4',
    borderVisible: false, wickUpColor: '#94B692', wickDownColor: '#D59DA4',
  });
  console.log('candlestickSeries created successfully:', !!candlestickSeries);

  volumeSeries = liveAnalysisChart.addHistogramSeries({
    color: 'rgba(155, 184, 205, 0.3)', priceFormat: { type: 'volume' }, priceScaleId: '',
  });
  volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.7, bottom: 0 } });

  ema9Series = liveAnalysisChart.addLineSeries({ color: '#9BB8CD', lineWidth: 1.5, title: 'EMA 9' });
  ema21Series = liveAnalysisChart.addLineSeries({ color: '#DFCA8D', lineWidth: 1.5, title: 'EMA 21' });
  supportSeries = liveAnalysisChart.addLineSeries({ color: 'rgba(148, 182, 146, 0.6)', lineWidth: 1.5, lineStyle: 1, title: 'Support' });
  resistanceSeries = liveAnalysisChart.addLineSeries({ color: 'rgba(213, 157, 164, 0.6)', lineWidth: 1.5, lineStyle: 1, title: 'Resistance' });
  vwapSeries = liveAnalysisChart.addLineSeries({ color: '#BCA6C4', lineWidth: 1.5, title: 'VWAP' });
  stopLossSeries = liveAnalysisChart.addLineSeries({ color: '#D59DA4', lineWidth: 1.5, lineStyle: 2, title: 'Stop Loss' });
  targetSeries = liveAnalysisChart.addLineSeries({ color: '#94B692', lineWidth: 1.5, lineStyle: 2, title: 'Target' });
  currentPriceSeries = liveAnalysisChart.addLineSeries({ color: '#5E696E', lineWidth: 1, lineStyle: 3, title: 'LTP' });

  const rsiWidth = rsiContainer.clientWidth || 800;
  const rsiHeight = rsiContainer.clientHeight || 120;
  console.log(`Initializing rsiAnalysisChart with dimensions: ${rsiWidth}x${rsiHeight}`);

  rsiAnalysisChart = LightweightCharts.createChart(rsiContainer, {
    ...chartOptions,
    width: rsiWidth,
    height: rsiHeight,
  });

  rsiSeries = rsiAnalysisChart.addLineSeries({ color: '#BCA6C4', lineWidth: 1.5, title: 'RSI' });

  const rsi30Line = rsiAnalysisChart.addLineSeries({ color: 'rgba(0, 0, 0, 0.06)', lineWidth: 1, lineStyle: 1 });
  const rsi50Line = rsiAnalysisChart.addLineSeries({ color: 'rgba(0, 0, 0, 0.04)', lineWidth: 1, lineStyle: 1 });
  const rsi70Line = rsiAnalysisChart.addLineSeries({ color: 'rgba(0, 0, 0, 0.06)', lineWidth: 1, lineStyle: 1 });

  const startSecs = Math.floor(Date.now() / 1000) - 200 * 300;
  rsi30Line.setData(Array.from({ length: 300 }).map((_, i) => ({ time: startSecs + i * 300, value: 30 })));
  rsi50Line.setData(Array.from({ length: 300 }).map((_, i) => ({ time: startSecs + i * 300, value: 50 })));
  rsi70Line.setData(Array.from({ length: 300 }).map((_, i) => ({ time: startSecs + i * 300, value: 70 })));

  liveAnalysisChart.timeScale().subscribeVisibleTimeRangeChange(range => {
    rsiAnalysisChart.timeScale().setVisibleRange(range);
  });

  window.addEventListener('resize', () => {
    if (liveAnalysisChart && rsiAnalysisChart) {
      liveAnalysisChart.resize(chartContainer.clientWidth || 800, chartContainer.clientHeight || 400);
      rsiAnalysisChart.resize(rsiContainer.clientWidth || 800, rsiContainer.clientHeight || 120);
    }
  });

  setupReplayControls();
}

// Fetch historical candles and populate
async function loadChartData(symbol) {
  const endpoint = `${backendBase}/api/historical-candles?symbol=${symbol}`;
  console.log(`Fetching candles from endpoint: ${endpoint}`);
  try {
    const res = await fetch(endpoint);
    const result = await res.json();
    if (!result.candles || result.candles.length === 0) {
      console.warn('No candles returned for symbol:', symbol);
      return;
    }

    allReplayCandles = result.candles;
    console.log('candles received', allReplayCandles.length);
    currentCandles = allReplayCandles;

    console.log('setting chart data');
    updateChartWithData(currentCandles);
    fetchPredictionDetail(symbol);
  } catch (err) {
    console.error('Error fetching candles:', err);
  }
}

let currentEntryPrice = null;
let currentTargetPrice = null;
let currentStopLossPrice = null;

function updateChartWithData(candles) {
  if (!candles || candles.length === 0) return;
  
  candlestickSeries.setData(candles);
  volumeSeries.setData(candles.map(c => ({
    time: c.time,
    value: c.volume,
    color: c.close >= c.open ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'
  })));

  const emas9 = computeEMA(candles, 9);
  const emas21 = computeEMA(candles, 21);
  ema9Series.setData(emas9);
  ema21Series.setData(emas21);

  // Compute support resistance levels
  const sr = computeSupportResistance(candles);
  const supportPoints = candles.map(c => ({ time: c.time, value: sr.support }));
  const resistancePoints = candles.map(c => ({ time: c.time, value: sr.resistance }));
  supportSeries.setData(supportPoints);
  resistanceSeries.setData(resistancePoints);

  // VWAP points
  const vwapPoints = computeVWAP(candles);
  vwapSeries.setData(vwapPoints);

  // RSI points
  const rsis = computeRSI(candles, 14);
  rsiSeries.setData(rsis);

  // Last Price Line
  const lastCandle = candles[candles.length - 1];
  const ltpPoints = candles.map(c => ({ time: c.time, value: lastCandle.close }));
  currentPriceSeries.setData(ltpPoints);

  // Stop loss and target price channels
  const entryPrice = currentEntryPrice || lastCandle.open; 
  const stopLossPrice = currentStopLossPrice || (entryPrice * 0.98);
  const targetPrice = currentTargetPrice || (entryPrice * 1.05);

  stopLossSeries.setData(candles.map(c => ({ time: c.time, value: stopLossPrice })));
  targetSeries.setData(candles.map(c => ({ time: c.time, value: targetPrice })));

  // Populate Sidebar LTP & basic values
  document.getElementById('intel-current-price').innerText = `₹${lastCandle.close.toFixed(2)}`;
  document.getElementById('intel-entry-price').innerText = `₹${entryPrice.toFixed(2)}`;
  document.getElementById('intel-target-price').innerText = `₹${targetPrice.toFixed(2)}`;
  document.getElementById('intel-stop-loss').innerText = `₹${stopLossPrice.toFixed(2)}`;
  document.getElementById('intel-rrr').innerText = `1:${((targetPrice - entryPrice) / Math.max(0.01, entryPrice - stopLossPrice)).toFixed(1)}`;
}

// Compute basic Indicators
function computeEMA(candles, period) {
  const result = [];
  if (candles.length < period) return result;
  
  let k = 2 / (period + 1);
  let ema = 0;
  for (let i = 0; i < period; i++) {
    ema += candles[i].close;
  }
  ema /= period;
  result.push({ time: candles[period - 1].time, value: parseFloat(ema.toFixed(2)) });

  for (let i = period; i < candles.length; i++) {
    ema = candles[i].close * k + ema * (1 - k);
    result.push({ time: candles[i].time, value: parseFloat(ema.toFixed(2)) });
  }
  return result;
}

function computeSupportResistance(candles) {
  let highs = candles.map(c => c.high);
  let lows = candles.map(c => c.low);
  return {
    support: parseFloat(Math.min(...lows).toFixed(2)),
    resistance: parseFloat(Math.max(...highs).toFixed(2))
  };
}

function computeVWAP(candles) {
  let cumulativeTPV = 0;
  let cumulativeVolume = 0;
  return candles.map(c => {
    const tp = (c.high + c.low + c.close) / 3;
    cumulativeTPV += tp * c.volume;
    cumulativeVolume += c.volume;
    const vwap = cumulativeVolume > 0 ? (cumulativeTPV / cumulativeVolume) : c.close;
    return { time: c.time, value: parseFloat(vwap.toFixed(2)) };
  });
}

function computeRSI(candles, period = 14) {
  const result = [];
  if (candles.length <= period) return result;

  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const diff = candles[i].close - candles[i - 1].close;
    if (diff > 0) gains += diff;
    else losses -= diff;
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;
  let rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  let rsi = 100 - (100 / (1 + rs));
  result.push({ time: candles[period].time, value: parseFloat(rsi.toFixed(2)) });

  for (let i = period + 1; i < candles.length; i++) {
    const diff = candles[i].close - candles[i - 1].close;
    avgGain = (avgGain * (period - 1) + (diff > 0 ? diff : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (diff < 0 ? -diff : 0)) / period;
    rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    rsi = 100 - (100 / (1 + rs));
    result.push({ time: candles[i].time, value: parseFloat(rsi.toFixed(2)) });
  }
  return result;
}

let activeMode = 'SIMULATOR';

function updateModeBadge() {
  const modeBadge = document.getElementById('mode-badge');
  if (modeBadge) {
    let modeText = 'SIMULATION';
    if (isReplaying) {
      modeText = 'REPLAY';
    } else if (activeMode === 'LIVE') {
      modeText = 'LIVE (PAPER)';
    } else if (activeMode === 'PAPER') {
      modeText = 'PAPER';
    } else if (activeMode === 'SIMULATOR') {
      modeText = 'SIMULATION';
    }
    modeBadge.innerText = modeText;
    modeBadge.style.background = isReplaying ? 'var(--warning)' : (activeMode === 'LIVE' ? 'var(--success)' : 'var(--accent-blue)');
    modeBadge.style.color = '#fff';
  }
}

// Update the DOM elements with Symbol Intelligence data
function updateUIWithIntelligence(data) {
  activeMode = data.mode || 'SIMULATOR';
  updateModeBadge();
  
  currentEntryPrice = data.entryPrice;
  currentTargetPrice = data.target;
  currentStopLossPrice = data.stopLoss;
  
  const tqs = data.tqs;
  const ics = data.ics;
  const icsLabel = data.icsLabel;
  const regime = data.marketRegime;
  const consensus = data.consensusVotes;
  const reasoning = data.reasoning;
  const participating_models = data.agentVotes || {};

  document.getElementById('intel-symbol').innerText = data.symbol;
  document.getElementById('intel-current-price').innerText = `₹${data.ltp.toFixed(2)}`;
  document.getElementById('intel-entry-price').innerText = `₹${data.entryPrice.toFixed(2)}`;
  document.getElementById('intel-target-price').innerText = `₹${data.target.toFixed(2)}`;
  document.getElementById('intel-stop-loss').innerText = `₹${data.stopLoss.toFixed(2)}`;
  document.getElementById('intel-rrr').innerText = `1:${data.riskReward.toFixed(1)}`;
  document.getElementById('intel-tqs').innerText = tqs;
  document.getElementById('intel-ics').innerText = `${ics} (${icsLabel})`;
  document.getElementById('intel-regime').innerText = regime;
  document.getElementById('intel-consensus-votes').innerText = consensus;
  
  const votesContainer = document.getElementById('intel-agent-votes');
  votesContainer.innerHTML = '';
  Object.keys(participating_models).forEach(k => {
    const row = document.createElement('div');
    row.className = 'flex-between';
    row.innerHTML = `<span>${k}:</span><b>${participating_models[k]}</b>`;
    votesContainer.appendChild(row);
  });

  const pred = data.prediction || {};
  document.getElementById('pred-direction').innerText = pred.direction || 'BUY';
  document.getElementById('pred-direction').className = pred.direction === 'BUY' ? 'badge bg-green' : 'badge bg-red';
  document.getElementById('pred-probability').innerText = pred.probability + '%';
  document.getElementById('pred-move').innerText = `${pred.expectedMove >= 0 ? '+' : ''}${pred.expectedMove.toFixed(2)}%`;
  document.getElementById('pred-target').innerText = `₹${pred.expectedTarget.toFixed(2)}`;
  document.getElementById('pred-stop').innerText = `₹${pred.expectedStop.toFixed(2)}`;
  document.getElementById('pred-reasoning').innerText = reasoning;

  const pa = data.priceActionDetails || {};
  if (document.getElementById('pa-structure')) {
    document.getElementById('pa-structure').innerText = pa.structureScore !== undefined ? pa.structureScore : '--';
    document.getElementById('pa-pattern').innerText = pa.patternScore !== undefined ? pa.patternScore : '--';
    document.getElementById('pa-breakout').innerText = pa.breakoutScore !== undefined ? pa.breakoutScore : '--';
    document.getElementById('pa-volume').innerText = pa.volumeScore !== undefined ? pa.volumeScore : '--';
    document.getElementById('pa-momentum').innerText = pa.momentumScore !== undefined ? pa.momentumScore : '--';
    document.getElementById('pa-rr').innerText = pa.riskRewardScore !== undefined ? pa.riskRewardScore : '--';
    
    const paVote = document.getElementById('pa-vote');
    paVote.innerText = pa.vote || 'HOLD';
    paVote.className = pa.vote === 'BUY' ? 'badge bg-green' : (pa.vote === 'SELL' ? 'badge bg-red' : 'badge bg-yellow');
    
    document.getElementById('pa-confidence').innerText = pa.confidence !== undefined ? (pa.confidence * 100).toFixed(0) + '%' : '--';
    document.getElementById('pa-reasoning').innerText = pa.reasoning || 'No pattern or structure anomalies detected.';
  }
}

// Fetch predictions details and real-time holdings info
async function fetchPredictionDetail(symbol) {
  try {
    const res = await fetch(`${backendBase}/api/symbol-intelligence?symbol=${symbol}`);
    const data = await res.json();
    updateUIWithIntelligence(data);
  } catch (err) {
    console.error('Error fetching prediction report:', err);
  }
}

// Replay mode functions
function setupReplayControls() {
  const btnPlay = document.getElementById('btn-replay-play');
  const btnPause = document.getElementById('btn-replay-pause');
  const btnBack = document.getElementById('btn-replay-back');
  const btnStep = document.getElementById('btn-replay-step');

  btnPlay.addEventListener('click', () => {
    if (isReplaying) return;
    isReplaying = true;
    updateModeBadge();
    btnPlay.style.display = 'none';
    btnPause.style.display = 'inline-block';
    
    if (replayIndex >= allReplayCandles.length) {
      replayIndex = Math.min(25, allReplayCandles.length);
    }

    replayTimer = setInterval(() => {
      if (replayIndex < allReplayCandles.length) {
        replayIndex++;
        currentCandles = allReplayCandles.slice(0, replayIndex);
        updateChartWithData(currentCandles);
      } else {
        clearInterval(replayTimer);
        isReplaying = false;
        updateModeBadge();
        btnPlay.style.display = 'inline-block';
        btnPause.style.display = 'none';
      }
    }, 1000);
  });

  btnPause.addEventListener('click', () => {
    clearInterval(replayTimer);
    isReplaying = false;
    updateModeBadge();
    btnPlay.style.display = 'inline-block';
    btnPause.style.display = 'none';
  });

  btnStep.addEventListener('click', () => {
    if (isReplaying) {
      clearInterval(replayTimer);
      isReplaying = false;
      btnPlay.style.display = 'inline-block';
      btnPause.style.display = 'none';
    }
    isReplaying = true;
    updateModeBadge();
    if (replayIndex < allReplayCandles.length) {
      replayIndex++;
      currentCandles = allReplayCandles.slice(0, replayIndex);
      updateChartWithData(currentCandles);
    }
  });

  btnBack.addEventListener('click', () => {
    if (isReplaying) {
      clearInterval(replayTimer);
      isReplaying = false;
      btnPlay.style.display = 'inline-block';
      btnPause.style.display = 'none';
    }
    isReplaying = true;
    updateModeBadge();
    if (replayIndex > 10) {
      replayIndex--;
      currentCandles = allReplayCandles.slice(0, replayIndex);
      updateChartWithData(currentCandles);
    }
  });

  replayIndex = Math.max(10, allReplayCandles.length - 20);
}

// Websockets live updating
function connectWS() {
  let wsUrl;
  if (backendBase) {
    const wsProtocol = backendBase.startsWith('https') ? 'wss:' : 'ws:';
    wsUrl = backendBase.replace(/^https?:\/\//, `${wsProtocol}//`) + '/';
  } else {
    let wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    wsUrl = `${wsProtocol}//${window.location.host || 'localhost:3000'}`;
  }
  let ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log('[WS]: Connected to server, subscribing to symbol:', currentSymbol);
    ws.send(JSON.stringify({ type: 'SUBSCRIBE', symbol: currentSymbol }));
  };

  ws.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data);
      if (payload.symbolIntelligence && payload.symbolIntelligence.symbol === currentSymbol) {
        updateUIWithIntelligence(payload.symbolIntelligence);
      }
      
      if (payload.type === 'STATUS_UPDATE' && payload.data) {
        const lastTicks = payload.data.lastTicks || {};
        if (lastTicks[currentSymbol]) {
          const ltp = lastTicks[currentSymbol];
          document.getElementById('intel-current-price').innerText = `₹${ltp.toFixed(2)}`;
          if (currentCandles.length > 0 && !isReplaying) {
            const lastCandle = { ...currentCandles[currentCandles.length - 1] };
            lastCandle.close = ltp;
            if (ltp > lastCandle.high) lastCandle.high = ltp;
            if (ltp < lastCandle.low) lastCandle.low = ltp;
            
            candlestickSeries.update(lastCandle);
            
            const ltpPoints = currentCandles.map((c, idx) => ({
              time: c.time,
              value: idx === currentCandles.length - 1 ? ltp : c.close
            }));
            currentPriceSeries.setData(ltpPoints);
          }
        }
      }
    } catch(e) {
      console.error('[WS]: Error processing websocket update:', e);
    }
  };
  
  ws.onclose = () => {
    console.warn('[WS]: Disconnected, reconnecting in 3 seconds...');
    setTimeout(connectWS, 3000);
  };
}
