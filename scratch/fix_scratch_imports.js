const fs = require('fs');
const path = require('path');

const backendFiles = [
  'db', 'tradingBot', 'broker', 'predictor', 'telegramControl', 'alerts',
  'adaptiveDecisionEngine', 'adaptiveWeightEngine', 'agent17_execution',
  'agent3_technicals', 'agent4_context', 'agentFirm', 'agentResearch',
  'candleScoringEngine', 'confidenceEngine', 'dynamicThreshold',
  'executionQualityEngine', 'institutionalConfluenceEngine', 'learningEngine',
  'marketData', 'marketModel', 'marketRegimeAgent', 'marketStateClassifier',
  'marketStructureHierarchy', 'portfolioCorrelationEngine', 'portfolioManager',
  'predictionValidator', 'priceActionStructureAgent', 'providerHealth',
  'riskEngine', 'smcAgent', 'smcValidationEngine', 'stopTargetEngine',
  'volumeIntelligenceAgent', 'pre_market_check', 'prove_system', 'test_bot',
  'test_connection', 'verify_neon', 'verify_neon_production',
  'setupPerformanceEngine', 'backtestEngine', 'bayesianConfidenceEngine'
];

const scratchDir = __dirname;
const files = fs.readdirSync(scratchDir);

files.forEach(file => {
  if (file.endsWith('.js')) {
    const filePath = path.join(scratchDir, file);
    let content = fs.readFileSync(filePath, 'utf8');
    let modified = false;

    backendFiles.forEach(bf => {
      // Matches require('../backend/db') or require('../db.js')
      const regexSingle = new RegExp(`require\\('\\.\\./${bf}'\\)`, 'g');
      if (regexSingle.test(content)) {
        content = content.replace(regexSingle, `require('../backend/${bf}')`);
        modified = true;
      }
      const regexDouble = new RegExp(`require\\("\\.\\./${bf}"\\)`, 'g');
      if (regexDouble.test(content)) {
        content = content.replace(regexDouble, `require("../backend/${bf}")`);
        modified = true;
      }
    });

    if (modified) {
      fs.writeFileSync(filePath, content, 'utf8');
      console.log(`Updated backend paths inside scratch file: ${file}`);
    }
  }
});

console.log('Scratch files import fix completed!');
