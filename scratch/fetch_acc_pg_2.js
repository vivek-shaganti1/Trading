const db = require('../backend/db');
(async () => {
    try {
        const rows = await db.runQueryDirect(`
            SELECT symbol, scan_timestamp, participating_models 
            FROM opportunity_tracker 
            WHERE symbol = 'ACC' AND scan_timestamp >= CURRENT_DATE
        `);
        console.log("--- PG ACC OPPORTUNITY ---");
        rows.forEach(r => {
            if (r.participating_models && Object.keys(r.participating_models).length > 0) {
                console.log(r.scan_timestamp);
                console.log(JSON.stringify(r.participating_models, null, 2));
            }
        });
    } catch (e) {
        console.error("DB Error:", e);
    }
    process.exit(0);
})();
