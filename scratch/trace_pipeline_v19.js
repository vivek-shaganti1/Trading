const fs = require('fs');
const db = require('../backend/db.js');
const runtimeState = require('../backend/runtimeState.js');
const marketData = require('../backend/marketData.js');

async function runAudit() {
  const dbData = await db.getPortfolioState();
  if (!dbData) {
    console.log("No Portfolio DB State found.");
    return;
  }
  
  const todayStr = new Date().toISOString().split('T')[0];
  console.log("====================================================");
  console.log(`[AUDIT V19] Date: ${todayStr}`);
  console.log("====================================================\n");

  const pipelineLogs = dbData.pipeline_logs || [];
  const todayLogs = pipelineLogs.filter(p => p.timestamp && p.timestamp.startsWith(todayStr));
  
  console.log("=== SIGNAL TRACE ===");
  if (todayLogs.length === 0) {
    console.log(`No pipeline logs found for today (${todayStr}).`);
  }
  
  let signalCount = 0;
  todayLogs.forEach((log, index) => {
    if (log.stage4_consensus > 0 || log.stage5_executed > 0 || log.stage3_candidates > 0) {
      console.log(`\n[PIPELINE RUN ${index+1}] Time: ${log.timestamp}`);
      console.log(`Scanner PASS -> Candidates: ${log.stage3_candidates}`);
      console.log(`Consensus PASS -> Signals: ${log.stage4_consensus}`);
      console.log(`Executed PASS -> Trades: ${log.stage5_executed}`);
      
      if (log.candidates_rejected) {
         console.log(`Rejections details: ${JSON.stringify(log.candidates_rejected)}`);
      }
      
      signalCount += log.stage4_consensus;
      if (log.stage5_executed === 0 && log.stage4_consensus > 0) {
        console.log(`🚨 EXECUTION STOPPED! ${log.stage4_consensus} signals failed to execute.`);
      }
    }
  });
  
  console.log("\n=== EXISTING POSITIONS ===");
  const openPositions = dbData.holding_stocks || [];
  console.log(`Total Open Positions: ${openPositions.length}`);
  openPositions.forEach(p => {
    console.log(`\nSymbol: ${p.symbol}`);
    console.log(`Entry Time: ${p.timestamp}`);
    console.log(`Quantity: ${p.quantity}`);
    console.log(`Entry Price: ${p.avgPrice}`);
    console.log(`Stop Loss: ${p.stopLossPrice}`);
    console.log(`Target Price: ${p.targetPrice}`);
    console.log(`Execution Mode: ${p.execution_mode}`);
    console.log(`Time Exit Triggered? ${p.timestamp ? ((Date.now() - new Date(p.timestamp).getTime()) > 7 * 24 * 60 * 60 * 1000 ? 'YES' : 'NO') : 'UNKNOWN'}`);
  });
  
  console.log("\n=== INVESTIGATING REJECTIONS ===");
  try {
     const brokerConf = require('../shared/config.js');
     console.log(`Broker Config: ${brokerConf.BROKER_MODE}`);
  } catch (e) {}
  
  console.log("\nSearching logs...");
  // Read local PM2/system logs if available or just check runtime state
  console.log(`Orders rejected today: ${dbData.orders_rejected_today || 0}`);
  
  process.exit(0);
}

runAudit();
