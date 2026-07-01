import re

with open('backend/broker.js', 'r') as f:
    content = f.read()

# 1. Replace setInterval with recursive setTimeout
interval_match = re.search(r'// Initialized update loop\nsetInterval\(async \(\) => \{\n.*?\}, 2000\);', content, re.DOTALL)
if interval_match:
    new_loop = """// Initialized update loop (recursive timeout to avoid overlaps)
let pollingTimeout = null;
async function pollRealPrices() {
  if (isMarketOpenNow()) {
    await fetchRealPrices(false);
  }
  pollingTimeout = setTimeout(pollRealPrices, 2000);
}
pollRealPrices();"""
    content = content.replace(interval_match.group(0), new_loop)

# 2. Fix the unbounded map in executeOrder
map_set_match = re.search(r'this\._recentOrders\.set\(orderKey, now\);', content)
if map_set_match:
    new_map_set = """this._recentOrders.set(orderKey, now);
    setTimeout(() => {
      this._recentOrders.delete(orderKey);
    }, 5000);"""
    content = content.replace(map_set_match.group(0), new_map_set)

with open('backend/broker.js', 'w') as f:
    f.write(content)

