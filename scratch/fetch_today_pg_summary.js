const db = require('../backend/db');
(async () => {
    try {
        const opps = await db.runQueryDirect(`
            SELECT symbol, scan_timestamp, signal_type, tqs, consensus_score, rejection_reason, status
            FROM opportunity_tracker 
            WHERE DATE(scan_timestamp) = CURRENT_DATE
              AND symbol != 'HDFCBANK' 
              AND symbol != 'MOCK_FAIL_BUY'
            ORDER BY scan_timestamp ASC
        `);
        console.log("--- REAL OPPORTUNITIES SUMMARY TODAY ---");
        console.table(opps);

        const suppressions = await db.runQueryDirect(`
            SELECT symbol, timestamp, tqs, rejection_reason, required_threshold 
            FROM signal_suppressions 
            WHERE DATE(timestamp) = CURRENT_DATE
        `);
        if(suppressions && suppressions.length > 0) {
            console.log("--- SIGNAL SUPPRESSIONS ---");
            console.table(suppressions);
        }

    } catch (e) {
        console.error("DB Error:", e);
    }
    process.exit(0);
})();
