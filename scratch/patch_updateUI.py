import re

with open('frontend/dashboard.js', 'r') as f:
    content = f.read()

old_str = r"function updateUI\(data\) \{"
new_str = """function updateUI(data) {
  const banner = document.getElementById('market-closed-banner');
  if (banner && data.marketDataDiagnostics) {
    if (data.marketDataDiagnostics['market.isOpen'] === false) {
      banner.style.display = 'flex';
    } else {
      banner.style.display = 'none';
    }
  }
"""

content = re.sub(old_str, new_str, content)

with open('frontend/dashboard.js', 'w') as f:
    f.write(content)
