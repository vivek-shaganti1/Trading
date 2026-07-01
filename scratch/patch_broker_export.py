import re

with open('backend/broker.js', 'r') as f:
    content = f.read()

# Add stopPricePolling if not present
if 'function stopPricePolling()' not in content:
    stop_fn = """
function stopPricePolling() {
  if (typeof pollingTimeout !== 'undefined' && pollingTimeout) {
    clearTimeout(pollingTimeout);
    pollingTimeout = null;
  }
}
"""
    content = content.replace('module.exports = {', stop_fn + '\nmodule.exports = {')

# Add stopPricePolling to module.exports
if 'stopPricePolling,' not in content:
    content = content.replace('module.exports = {', 'module.exports = {\n  stopPricePolling,')

with open('backend/broker.js', 'w') as f:
    f.write(content)

