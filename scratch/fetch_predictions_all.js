const db = require('../backend/db');
(async () => {
    try {
        const rows = await db.runQueryDirect(`
            SELECT * FROM prediction_logs WHERE symbol = 'ACC' ORDER BY timestamp DESC LIMIT 5
        `);
        console.table(rows);
    } catch (e) {
        console.error("DB Error:", e);
    }
    process.exit(0);
})();
