# Lifecycle and Scheduler Stabilization Plan

The user requested an immediate fix for the project not starting at 9 AM and not sending messages, as well as addressing the 7 previously reported lifecycle bugs. We will ensure the entire flow from startup to premarket to trading is rock solid.

## Proposed Changes

### [Component: tradingBot.js]

#### [MODIFY] backend/tradingBot.js
- **Bug 1 & 2 (Premarket Race Condition)**: Add `preMarketState.currentDate = timeInfo.dateStr;` in `runPreMarketWarmup()` so that `tick()` doesn't falsely reset the `preMarketState` to `PENDING` right after startup.
- **Bug 3 (State Leaking)**: In the daily reset block inside `tick()`, explicitly reset `signalSuppressionState` to prevent yesterday's threshold rejections from blocking today's trades.
- **Bug 1 (/start behavior)**: Inside `start()`, add an `isStarting` lock to prevent concurrent executions.
- **Bug 6 (Jobs outside hours)**: Ensure that shadow exits and background polling are strictly gated by `isOpen` or specific allowed sessions.
- **WebSocket Broadcasts**: In `tick()`, remove the aggressive stringify check for `lastPayloadStr` which might be silently failing to broadcast dashboard updates due to object reference differences or large payload freezing. Replace with a reliable throttle (e.g. every 5 seconds).

### [Component: telegramControl.js]

#### [MODIFY] backend/telegramControl.js
- **Bug 1 & 5**: Adjust the `/start` command so that it conditionally outputs the readiness report ONLY if it's currently premarket. Otherwise, if the market is open, it should simply state "Bot is active" without spoofing a pre-market report. 
- Ensure that the Telegram `/status` fetches from the exact same `tradingBot.getStatus()` object as the dashboard.

### [Component: Process Management]

#### [NEW] ecosystem.config.js
- **Startup Reliability**: Create a PM2 ecosystem file to manage `trading-bot` with automatic restarts and cron-based restarts if necessary, ensuring it always survives a reboot. (We already started it via PM2, but an ecosystem file ensures exact args are preserved).

## Verification Plan

- Trigger a mock day-change by injecting a different date in `tick()` to verify `preMarketState` resets correctly without corrupting.
- Trigger `/start` via code and verify the race condition is eliminated (Database shows `READY`, not `PENDING`).
