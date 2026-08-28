const db = require('../backend/db');
(async () => {
    try {
        const res = await db.runQueryDirect(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public'
        `);
        console.log(res);
    } catch (e) {
        console.error("DB Error:", e);
    }
    process.exit(0);
})();
