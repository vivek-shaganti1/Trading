const db = require('../backend/db');
(async () => {
    try {
        const th = await db.runQueryDirect(`
            SELECT timestamp, scanned, candidates, consensus, executed, rejection_reasons 
            FROM throughput_history 
            WHERE DATE(timestamp) = CURRENT_DATE
              AND consensus > 0
            ORDER BY timestamp ASC
        `);
        console.table(th);
    } catch (e) {
        console.error("DB Error:", e);
    }
    process.exit(0);
})();
