import re

with open('backend/server.js', 'r') as f:
    content = f.read()

# 1. Update wss.on('connection')
connection_old = """wss.on('connection', (ws) => {
  console.log('[WS]: Dashboard client connected.');

  // Immediate send current status"""
connection_new = """wss.on('connection', (ws) => {
  console.log('[WS]: Dashboard client connected.');
  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  // Immediate send current status"""
content = content.replace(connection_old, connection_new)

# 2. Add heartbeat interval
wss_interval = """
// WebSocket heartbeat to clear dead connections
const heartbeatInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      console.log('[WS]: Terminating dead connection.');
      return ws.terminate();
    }
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on('close', () => {
  clearInterval(heartbeatInterval);
});
"""

# add it right after `const wss = new WebSocket.Server({ server });`
content = content.replace('const wss = new WebSocket.Server({ server });', 'const wss = new WebSocket.Server({ server });' + wss_interval)

with open('backend/server.js', 'w') as f:
    f.write(content)

