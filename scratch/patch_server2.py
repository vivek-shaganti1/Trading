import re

with open('backend/server.js', 'r') as f:
    content = f.read()

shutdown_code = """
// Graceful shutdown handling
let isShuttingDown = false;
async function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`[SERVER]: Received ${signal}, shutting down gracefully.`);
  
  // Force exit after 10s
  const forceExit = setTimeout(() => {
    console.error('[SERVER]: Could not close connections in time, forcefully shutting down');
    process.exit(1);
  }, 10000);

  // Close HTTP and WebSocket servers
  server.close(async () => {
    console.log('[SERVER]: HTTP and WebSocket connections closed.');
    
    // Stop intervals and timeouts
    if (typeof heartbeatInterval !== 'undefined') clearInterval(heartbeatInterval);
    
    // Stop broker polling if available
    const broker = require('./broker');
    if (broker.stopPricePolling) {
      broker.stopPricePolling();
    }
    
    // Close DB
    if (db.close) {
      await db.close();
      console.log('[SERVER]: Database connections closed.');
    }
    
    clearTimeout(forceExit);
    process.exit(0);
  });
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
"""

# add it before the end of the file, around the line `server.listen(port, () => {`
content = content.replace('server.listen(port, () => {', shutdown_code + '\nserver.listen(port, () => {')

with open('backend/server.js', 'w') as f:
    f.write(content)

