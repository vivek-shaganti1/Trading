const db = require('../backend/db');
(async () => {
    try {
        const rows = await db.runQueryDirect(`
            SELECT column_name FROM information_schema.columns WHERE table_name = 'prediction_logs'
        `);
        console.log(rows.map(r => r.column_name).join(', '));
    } catch (e) {
        console.error("DB Error:", e);
    }
    process.exit(0);
})();
