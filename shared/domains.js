/**
 * AGY-TRADER V2 — 6-Domain Architectural Mapping
 * Classifies every module into its corresponding domain boundary.
 */

const DOMAINS = {
  MARKET: {
    name: 'MARKET DOMAIN',
    description: 'Data feeds, universe definition, scanning, and real-time feature store.',
    modules: [
      'backend/marketData.js',
      'backend/pre_market_check.js'
    ]
  },
  RESEARCH: {
    name: 'RESEARCH DOMAIN',
    description: 'Alpha signals, technical patterns, ML neural net, and multi-agent consensus.',
    modules: [
      'backend/predictor.js',
      'backend/adaptiveDecisionEngine.js',
      'backend/adaptiveWeightEngine.js',
      'backend/smcAgent.js',
      'backend/priceActionStructureAgent.js',
      'backend/marketRegimeAgent.js',
      'backend/volumeIntelligenceAgent.js',
      'backend/agent3_technicals.js',
      'backend/agent4_context.js',
      'backend/marketModel.js',
      'backend/institutionalConfluenceEngine.js',
      'backend/candleScoringEngine.js',
      'backend/setupPerformanceEngine.js'
    ]
  },
  PORTFOLIO: {
    name: 'PORTFOLIO DOMAIN',
    description: 'Pre-trade risk management, Kelly sizing, VaR, CVaR, and beta/sector limits.',
    modules: [
      'backend/riskEngine.js',
      'backend/portfolioManager.js',
      'backend/portfolioCorrelationEngine.js',
      'backend/stopTargetEngine.js'
    ]
  },
  EXECUTION: {
    name: 'EXECUTION DOMAIN',
    description: 'Multi-broker gateways, order dispatches, fill tracking, and position monitoring.',
    modules: [
      'backend/broker.js',
      'backend/agent17_execution.js',
      'backend/exitIntelligenceEngine.js'
    ]
  },
  LEARNING: {
    name: 'LEARNING DOMAIN',
    description: 'Post-market trade analytics, MFE/MAE recalibration, and walk-forward validation.',
    modules: [
      'backend/agentResearch.js',
      'backend/agentFirm.js',
      'backend/learningEngine.js',
      'backend/dynamicThreshold.js',
      'backend/predictionValidator.js',
      'backend/backtestEngine.js'
    ]
  },
  INFRASTRUCTURE: {
    name: 'INFRASTRUCTURE DOMAIN',
    description: 'Market clock FSM, database persistence, WebSocket server, Telegram, and PM2.',
    modules: [
      'backend/server.js',
      'backend/tradingBot.js',
      'backend/lifecycleFSM.js',
      'backend/runtimeState.js',
      'backend/db.js',
      'backend/resilience.js',
      'backend/alerts.js',
      'backend/telegramControl.js'
    ]
  }
};

module.exports = DOMAINS;
