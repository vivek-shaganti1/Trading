const db = require('../backend/db');
(async () => {
    try {
        const eod = await db.runQueryDirect(`
            SELECT * FROM telegram_commands
            WHERE timestamp >= CURRENT_DATE
        `);
        console.log("--- TELEGRAM ---");
        console.table(eod);

        const alerts = await db.runQueryDirect(`
            SELECT message, timestamp FROM alerts
            WHERE timestamp >= CURRENT_DATE
            AND message ILIKE '%GROWTH MODE DAILY REPORT%'
        `);
        console.log("--- EOD ALERTS ---");
        for(const a of alerts) {
            console.log(a.timestamp);
            console.log(a.message);
            console.log("-------------");
        }
    } catch (e) {
        console.error("DB Error:", e);
    }
    process.exit(0);
})();
