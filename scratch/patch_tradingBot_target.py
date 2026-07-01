import re

with open('backend/tradingBot.js', 'r') as f:
    content = f.read()

# Replace the static 12000 * 0.10 target calculation with dynamic target
target_calc = r"const calculatedTarget = Math.max\(100\.0, parseFloat\(\(Math.max\(12000, [^)]+\) \* 0\.10\)\.toFixed\(2\)\)\);"

new_target_calc = """
      const riskPerTrade = (runtimeState && runtimeState.getSnapshot().settings.risk_per_trade_percent) || 1.0;
      const cap = (typeof valuation !== 'undefined' ? valuation.totalVal : (typeof startCapital !== 'undefined' ? startCapital : 12000));
      const avgRR = 2.5; 
      const winRate = 0.62;
      const dailyTrades = 7;
      const expectedProfitPerTrade = (cap * (riskPerTrade / 100)) * ((avgRR * winRate) - (1 - winRate));
      const calculatedTarget = Math.max(100.0, parseFloat((expectedProfitPerTrade * dailyTrades).toFixed(2)));
      
      if (runtimeState && runtimeState.targetEngineState) {
        runtimeState.targetEngineState = {
          ...runtimeState.targetEngineState,
          dailyTarget: calculatedTarget,
          requiredExpectedProfit: calculatedTarget,
          requiredTradeCount: dailyTrades,
          requiredWinRate: (winRate * 100).toFixed(0),
          requiredCapitalUtilization: 85
        };
      }
"""

content = re.sub(target_calc, new_target_calc.strip(), content)

with open('backend/tradingBot.js', 'w') as f:
    f.write(content)

