const tradingBot = require('../backend/tradingBot');
const db = require('../backend/db');

async function testRun() {
  await db.initPromise;
  await tradingBot.start();
  
  setTimeout(() => {
    const status = tradingBot.getStatus();
    console.log("ENGINE STATUS:", status.services.scanner);
    console.log("MARKET STATUS:", status.market.status);
    process.exit(0);
  }, 2000);
}
testRun();
