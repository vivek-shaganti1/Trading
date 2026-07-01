import re

with open('backend/tradingBot.js', 'r') as f:
    content = f.read()

old_fn = r"""  calculateTargetEngineState\(valuation\) \{.*?    return \{.*?    \};
  \},"""

new_fn = """  calculateTargetEngineState(valuation) {
    let riskMode = 'NORMAL';
    try {
      const dbData = db.readLocalDb();
      riskMode = dbData.portfolio_state?.user_instructions?.risk_mode || 'NORMAL';
    } catch (e) {}

    const cap = valuation.totalVal;
    const riskPerTrade = (runtimeState && runtimeState.getSnapshot().settings.risk_per_trade_percent) || 1.0;
    const avgRR = 2.5; 
    const winRate = (runtimeState && runtimeState.state && runtimeState.state.performance && runtimeState.state.performance.today_win_rate > 0)
      ? runtimeState.state.performance.today_win_rate / 100 
      : 0.62;
    const dailyTrades = 7;
    const expectedProfitPerTrade = (cap * (riskPerTrade / 100)) * ((avgRR * winRate) - (1 - winRate));
    let dailyTarget = Math.max(100.0, parseFloat((expectedProfitPerTrade * dailyTrades).toFixed(2)));

    // Update currentDayStats daily_target to keep it in sync
    if (typeof currentDayStats !== 'undefined' && currentDayStats && currentDayStats.daily_target !== dailyTarget) {
      currentDayStats.daily_target = dailyTarget;
    }

    const dailyPnL = (typeof currentDayStats !== 'undefined' && currentDayStats) ? parseFloat((valuation.totalVal - currentDayStats.start_capital).toFixed(2)) : 0;
    const remainingTarget = Math.max(0, dailyTarget - dailyPnL);
    
    const avgWin = parseFloat((valuation.totalVal * 0.20 * 0.03).toFixed(2));   // 3% gain on 20% capital allocation
    const avgLoss = parseFloat((valuation.totalVal * 0.20 * 0.015).toFixed(2));  // 1.5% loss on 20% capital stop-loss
    const requiredTrades = expectedProfitPerTrade > 0 ? Math.ceil(remainingTarget / expectedProfitPerTrade) : dailyTrades;
    const requiredCapitalUtil = Math.min(100.0, Math.max(10.0, (requiredTrades * 20.0))); // 20% allocation per trade
    
    let requiredWinRate = winRate;
    if (requiredTrades > 0 && remainingTarget > 0) {
      requiredWinRate = (remainingTarget / requiredTrades + avgLoss) / (avgWin + avgLoss);
      requiredWinRate = Math.max(0.40, Math.min(0.95, requiredWinRate));
    } else if (remainingTarget === 0) {
      requiredWinRate = 0.0;
    }

    const timeInfo = getSystemTime();
    const currentMins = timeInfo.hours * 60 + timeInfo.minutes;
    const closeMins = 15 * 60 + 30;
    const minsRemaining = Math.max(0, closeMins - currentMins);

    let rating = 'HIGH';
    if (remainingTarget <= 0) {
      rating = 'HIGH';
    } else if (requiredTrades > (minsRemaining / 10)) {
      rating = 'LOW';
    } else if (requiredWinRate > 0.8) {
      rating = 'MEDIUM';
    }

    return {
      dailyTarget,
      currentPnL: dailyPnL,
      remainingTarget: parseFloat(remainingTarget.toFixed(2)),
      requiredExpectedProfit: parseFloat(remainingTarget.toFixed(2)),
      requiredTradeCount: requiredTrades,
      requiredCapitalUtilization: parseFloat(requiredCapitalUtil.toFixed(2)),
      requiredWinRate: parseFloat((requiredWinRate * 100).toFixed(2)),
      rating,
      minsRemaining
    };
  },"""

content = re.sub(old_fn, new_fn, content, flags=re.DOTALL)

with open('backend/tradingBot.js', 'w') as f:
    f.write(content)

