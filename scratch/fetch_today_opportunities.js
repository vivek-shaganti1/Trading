const db = require('../backend/db');
(async () => {
    try {
        console.log("Fetching opportunities...");
        const res = await db.runQueryDirect(`SELECT * FROM opportunities WHERE timestamp >= CURRENT_DATE ORDER BY timestamp ASC`);
        console.log("Total opportunities today:", res.length);
        console.log(JSON.stringify(res, null, 2));
    } catch (e) {
        console.error("DB Error:", e);
    }
    
    try {
        const suppressions = await db.runQueryDirect(`SELECT * FROM signal_suppressions WHERE timestamp >= CURRENT_DATE`);
        console.log("Total suppressions today:", suppressions.length);
        console.log(JSON.stringify(suppressions, null, 2));
    } catch (e) {
         console.error("DB Error:", e);
    }

    try {
        const shadow = await db.runQueryDirect(`SELECT * FROM shadow_trades WHERE timestamp >= CURRENT_DATE`);
        console.log("Total shadow trades today:", shadow.length);
        console.log(JSON.stringify(shadow, null, 2));
    } catch (e) {
         console.error("DB Error:", e);
    }
    process.exit(0);
})();
