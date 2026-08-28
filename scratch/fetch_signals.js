const db = require('../backend/db');
(async () => {
    try {
        const opps = await db.runQueryDirect(`
            SELECT symbol, scan_timestamp, signal_type, tqs, consensus_score, rejection_reason, status
            FROM opportunity_tracker 
            WHERE DATE(scan_timestamp) = CURRENT_DATE
              AND symbol != 'HDFCBANK' 
              AND symbol != 'MOCK_FAIL_BUY'
              AND signal_type != 'HOLD'
            ORDER BY scan_timestamp ASC
        `);
        console.log("--- SIGNALS TODAY ---");
        console.table(opps);
    } catch (e) {
        console.error("DB Error:", e);
    }
    process.exit(0);
})();
