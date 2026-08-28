const tradingBot = require('../backend/tradingBot');
(async () => {
  await tradingBot.start();
  process.exit(0);
})();
