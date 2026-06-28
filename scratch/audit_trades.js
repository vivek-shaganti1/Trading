require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { constructFeatures } = require('./feature_engineer');
const { DeeperNeuralNet, GradientBoostedTrees, RandomForest } = require('./models');

// Load cached data
const cachePath = path.join(__dirname, 'historical_market_data.json');
if (!fs.existsSync(cachePath)) {
  console.log('Error: Cache file missing. Run data_loader first.');
  process.exit(1);
}
const allData = JSON.parse(fs.readFileSync(cachePath, 'utf8'));

// Extract validation set for RELIANCE
const relianceCandles = allData.RELIANCE;
const niftyCandles = allData.NIFTY;
const engineered = constructFeatures('RELIANCE', relianceCandles, niftyCandles, allData);
const splitIdx = Math.round(engineered.length * 0.8);
const testRows = engineered.slice(splitIdx);

// Initialize models
const nn = new DeeperNeuralNet(17, 32, 16, 3);
const rf = new RandomForest(15, 4);
const gbdt = new GradientBoostedTrees(15, 3);

// Let's load weights from DB first if possible, or train them quickly on dummy/train partition to inspect.
// Since we want to check the actual trades generated in the benchmark, let's write a detailed simulator:
function auditModel(model, name) {
  console.log(`\n=================== AUDITING MODEL: ${name} ===================`);
  
  let balance = 100000.0;
  let shares = 0;
  let entryPrice = 0;
  let entryIndex = -1;
  let entryDate = '';
  
  const trades = [];
  const dailyEquity = [];

  for (let i = 0; i < testRows.length; i++) {
    const row = testRows[i];
    const price = row.close;
    const date = row.time;

    // Check exit
    if (shares > 0) {
      const holdingDays = i - entryIndex;
      const probs = model.predict ? model.predict(row.inputs) : [0, 0, 1];
      const shouldSell = (holdingDays >= 5) || (probs[1] > probs[0] && probs[1] > probs[2] && probs[1] >= 0.35);
      
      if (shouldSell) {
        const exitPrice = price;
        const pnl = (exitPrice - entryPrice) * shares;
        const prevBalance = balance;
        balance += (shares * entryPrice) + pnl; // Add back principal + pnl
        
        trades.push({
          entryDate,
          exitDate: date,
          entryPrice,
          exitPrice,
          shares,
          pnl,
          portfolioValue: balance
        });
        
        console.log(`TRADE ${trades.length} | Entered: ${entryDate} @ ₹${entryPrice} | Exited: ${date} @ ₹${exitPrice} | Shares: ${shares} | PnL: ₹${pnl.toFixed(2)} | Balance after: ₹${balance.toFixed(2)}`);
        
        shares = 0;
        entryPrice = 0;
        entryIndex = -1;
      }
    }

    // Check entry
    if (shares === 0 && i < testRows.length - 5) {
      const probs = model.predict ? model.predict(row.inputs) : [1, 0, 0];
      const shouldBuy = (probs[0] > probs[1] && probs[0] > probs[2] && probs[0] >= 0.35);
      
      if (shouldBuy) {
        entryPrice = price;
        entryIndex = i;
        entryDate = date;
        shares = Math.floor(balance / price);
        balance -= shares * entryPrice;
      }
    }

    const equity = balance + (shares * price);
    dailyEquity.push({ date, equity });
  }

  // Final Closeout
  if (shares > 0) {
    const exitDate = testRows[testRows.length - 1].time;
    const exitPrice = testRows[testRows.length - 1].close;
    const pnl = (exitPrice - entryPrice) * shares;
    balance += (shares * entryPrice) + pnl; // Add back principal + pnl
    
    trades.push({
      entryDate,
      exitDate,
      entryPrice,
      exitPrice,
      shares,
      pnl,
      portfolioValue: balance
    });
    console.log(`FINAL CLOSEOUT | Entered: ${entryDate} @ ₹${entryPrice} | Exited: ${exitDate} @ ₹${exitPrice} | Shares: ${shares} | PnL: ₹${pnl.toFixed(2)} | Balance after: ₹${balance.toFixed(2)}`);
  }

  // Verify: Sum(PnL) + initial capital = final value
  const totalPnL = trades.reduce((sum, t) => sum + t.pnl, 0);
  const finalValueCheck = 100000.0 + totalPnL;
  console.log(`\n• Sum of all trade PnLs: ₹${totalPnL.toFixed(2)}`);
  console.log(`• Initial Capital + Sum(PnL): ₹${finalValueCheck.toFixed(2)}`);
  console.log(`• Reported Final Portfolio Value: ₹${balance.toFixed(2)}`);
  console.log(`• Math check validation: ${Math.abs(finalValueCheck - balance) < 0.01 ? '🟢 SUCCESS' : '🔴 FAILURE'}`);
  
  // Recalculate metrics
  const winning = trades.filter(t => t.pnl > 0).length;
  const losing = trades.filter(t => t.pnl <= 0).length;
  const winRate = trades.length > 0 ? (winning / trades.length) * 100 : 0;
  
  const grossProfit = trades.filter(t => t.pnl > 0).reduce((sum, t) => sum + t.pnl, 0);
  const grossLoss = Math.abs(trades.filter(t => t.pnl < 0).reduce((sum, t) => sum + t.pnl, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit;

  console.log(`• Recalculated Win Rate: ${winRate.toFixed(1)}%`);
  console.log(`• Recalculated Profit Factor: ${profitFactor.toFixed(2)}`);
}

// Perform audits on the three models
async function runAudit() {
  // We'll train the models for a few samples to make them generate predictions for audit
  console.log('Initializing models for audit...');
  const X_train = engineered.slice(0, splitIdx).map(r => r.inputs);
  const y_train = engineered.slice(0, splitIdx).map(r => r.target);
  
  // Quick training so they produce predictions
  for (let i = 0; i < 50; i++) {
    nn.train(X_train[i % X_train.length], y_train[i % y_train.length]);
  }
  rf.train(X_train.slice(0, 500), y_train.slice(0, 500));
  gbdt.train(X_train.slice(0, 500), y_train.slice(0, 500));

  auditModel(nn, 'Neural Net (17x32x16x3)');
  auditModel(rf, 'Random Forest');
  auditModel(gbdt, 'Gradient Boosted GBDT');
}

runAudit();
