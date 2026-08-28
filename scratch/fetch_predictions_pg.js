const db = require('../backend/db');
(async () => {
    try {
        const rows = await db.runQueryDirect(`
            SELECT symbol, timestamp, direction, confidence, ics, target, stop_loss 
            FROM prediction_logs 
            WHERE symbol = 'ACC' AND timestamp >= CURRENT_DATE
        `);
        console.table(rows);
    } catch (e) {
        console.error("DB Error:", e);
    }
    process.exit(0);
})();
