const db = require('../backend/db');
(async () => {
    try {
        const alerts = await db.runQueryDirect(`
            SELECT message, timestamp FROM alerts
            WHERE timestamp >= CURRENT_DATE
            AND message ILIKE '%HIGH CONVICTION SETUP DETECTED%'
        `);
        console.table(alerts);
    } catch (e) {
        console.error("DB Error:", e);
    }
    process.exit(0);
})();
