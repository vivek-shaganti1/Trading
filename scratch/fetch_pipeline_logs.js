const db = require('../backend/db');
(async () => {
    try {
        const logs = await db.runQueryDirect(`
            SELECT timestamp, stage1_scanned, stage2_research, stage3_candidates, stage4_consensus, stage5_executed 
            FROM pipeline_logs 
            WHERE DATE(timestamp) = CURRENT_DATE
            ORDER BY timestamp ASC
        `);
        console.table(logs);
    } catch (e) {
        console.error("DB Error:", e);
    }
    process.exit(0);
})();
