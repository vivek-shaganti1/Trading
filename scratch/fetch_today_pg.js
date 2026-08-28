const db = require('../backend/db');
(async () => {
    try {
        const opps = await db.runQueryDirect(`
            SELECT * FROM opportunity_tracker 
            WHERE DATE(scan_timestamp) = CURRENT_DATE
              AND symbol != 'HDFCBANK' 
              AND symbol != 'MOCK_FAIL_BUY'
            ORDER BY scan_timestamp ASC
        `);
        console.log("--- REAL OPPORTUNITIES TODAY ---");
        console.log(JSON.stringify(opps, null, 2));

        const logs = await db.runQueryDirect(`
            SELECT * FROM trade_logs 
            WHERE DATE(timestamp) = CURRENT_DATE
            ORDER BY timestamp ASC
        `);
        console.log("--- TRADE LOGS TODAY ---");
        console.log(JSON.stringify(logs, null, 2));

        const audits = await db.runQueryDirect(`
            SELECT * FROM agent24_audit_logs 
            WHERE DATE(timestamp) = CURRENT_DATE
            ORDER BY timestamp ASC
        `);
        console.log("--- AUDIT LOGS TODAY ---");
        console.log(JSON.stringify(audits, null, 2));
    } catch (e) {
        console.error("DB Error:", e);
    }
    process.exit(0);
})();
