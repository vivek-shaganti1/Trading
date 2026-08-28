const db = require('../backend/db');
(async () => {
    try {
        const rows = await db.runQueryDirect(`
            SELECT symbol, scan_timestamp, signal_type, tqs, consensus_score, rejection_reason, prediction_details 
            FROM opportunity_tracker 
            WHERE symbol = 'ACC' AND scan_timestamp >= CURRENT_DATE
        `);
        console.log("--- PG ACC OPPORTUNITY ---");
        rows.forEach(r => {
            console.log(r.scan_timestamp, r.rejection_reason);
            if (r.rejection_reason && r.rejection_reason.includes('ICS')) {
                console.log(JSON.stringify(r.prediction_details, null, 2));
            }
        });
    } catch (e) {
        console.error("DB Error:", e);
    }
    process.exit(0);
})();
