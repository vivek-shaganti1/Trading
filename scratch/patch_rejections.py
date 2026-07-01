import re

with open('backend/tradingBot.js', 'r') as f:
    content = f.read()

# Already held
content = content.replace(
    'rejectionReasons.already_held++;',
    "rejectionReasons.already_held++;\n        if (runtimeState && runtimeState.addRejection) runtimeState.addRejection(item.symbol, 'PORTFOLIO_CHECK', 'Already Held / Pending Entry', { price: item.price, agent: 'System' });"
)

# Entry cooldown
content = content.replace(
    'rejectionReasons.entry_cooldown++;',
    "rejectionReasons.entry_cooldown++;\n        if (runtimeState && runtimeState.addRejection) runtimeState.addRejection(item.symbol, 'PORTFOLIO_CHECK', 'Entry Cooldown', { price: item.price, agent: 'System' });"
)

# Replace logOpportunityInTracker definition to also push to funnel
old_logOpp = r"async logOpportunityInTracker\(item, prediction, tqs, status, reason = ''\) \{"
new_logOpp = """async logOpportunityInTracker(item, prediction, tqs, status, reason = '') {
    if (status === 'REJECTED' && runtimeState && runtimeState.addRejection) {
      runtimeState.addRejection(item.symbol, 'AI_ANALYSIS', reason, {
        price: item.price,
        score: tqs,
        confidence: prediction ? prediction.confidence : 0,
        agent: prediction && prediction.signal ? 'Consensus Engine' : 'Pre-filter'
      });
    }"""
content = re.sub(old_logOpp, new_logOpp, content)

with open('backend/tradingBot.js', 'w') as f:
    f.write(content)

