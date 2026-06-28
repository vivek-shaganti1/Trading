const path = require('path');
const fs = require('fs');

const envPathLocal = path.join(process.cwd(), '.env');
const envPathParent = path.join(process.cwd(), '..', '.env');
const envPathConfigDir = path.join(__dirname, '..', '.env');

if (fs.existsSync(envPathLocal)) {
  require('dotenv').config({ path: envPathLocal });
} else if (fs.existsSync(envPathParent)) {
  require('dotenv').config({ path: envPathParent });
} else if (fs.existsSync(envPathConfigDir)) {
  require('dotenv').config({ path: envPathConfigDir });
} else {
  require('dotenv').config();
}

module.exports = {
  PORT: process.env.PORT || 3000,
  
  // Risk & Capital Configuration
  INITIAL_CAPITAL: 12000,
  LIFETIME_CAPITAL_FLOOR: 8000, // 33% maximum drawdown of ₹12,000 capital
  DAILY_PROFIT_TARGET_START: 1000,
  DAILY_STOP_LOSS_PCT: 0.07, // Halts day trading if daily loss exceeds 7%
  ADMIN_RESET_PASSWORD: process.env.ADMIN_PASSWORD || process.env.ADMIN_RESET_PASSWORD || 'admin123',
  EXPONENTIAL_GROWTH_FACTOR: 1.10, // 10% target growth once achieved

  // Strategy Timings (IST - Indian Standard Time)
  MARKET_START_TIME: { hour: 9, minute: 15 },
  STRATEGY_SWITCH_TIME: { hour: 14, minute: 30 }, // 2:30 PM switch to long-term
  AUTO_SQUAREOFF_TIME: { hour: 15, minute: 15 }, // 3:15 PM auto squareoff day trades
  MARKET_CLOSE_TIME: { hour: 15, minute: 30 }, // 3:30 PM market close

  // Database Configuration (Neon PostgreSQL or local db.json fallback)
  DATABASE_URL: process.env.DATABASE_URL || null,
  USE_LOCAL_CACHE: process.env.USE_LOCAL_CACHE === 'true' || !process.env.DATABASE_URL,
  USE_SQLITE: process.env.USE_LOCAL_CACHE === 'true' || !process.env.DATABASE_URL, // historical alias

  // Alerts Configuration (Telegram)
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || null,
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID || null,

  // Broker Configuration
  BROKER_MODE: process.env.BROKER_MODE || 'SIMULATOR', // 'SIMULATOR' or 'LIVE'

  // Zerodha Kite Connect credentials
  KITE_API_KEY: process.env.KITE_API_KEY || null,
  KITE_API_SECRET: process.env.KITE_API_SECRET || null,
  KITE_CLIENT_ID: process.env.KITE_CLIENT_ID || null,
  KITE_PIN: process.env.KITE_PIN || null,
  KITE_ACCESS_TOKEN: process.env.KITE_ACCESS_TOKEN || null,

  // Angel One SmartAPI credentials
  SMARTAPI_CLIENT_CODE: process.env.SMARTAPI_CLIENT_CODE || null,
  SMARTAPI_PASSWORD: process.env.SMARTAPI_PASSWORD || null,
  SMARTAPI_API_KEY: process.env.SMARTAPI_API_KEY || null,
  SMARTAPI_TOTP_KEY: process.env.SMARTAPI_TOTP_SECRET || process.env.SMARTAPI_TOTP_KEY || null,
  SMARTAPI_TOTP_SECRET: process.env.SMARTAPI_TOTP_SECRET || process.env.SMARTAPI_TOTP_KEY || null, // duplicate for compatibility

  // Finvasia Shoonya credentials
  SHOONYA_USER_ID: process.env.SHOONYA_USER_ID || null,
  SHOONYA_PASSWORD: process.env.SHOONYA_PASSWORD || null,
  SHOONYA_FACTOR2: process.env.SHOONYA_FACTOR2 || process.env.SHOONYA_IMEI || null,
  SHOONYA_IMEI: process.env.SHOONYA_FACTOR2 || process.env.SHOONYA_IMEI || null, // duplicate for compatibility
  SHOONYA_VENDOR_CODE: process.env.SHOONYA_VENDOR_CODE || null,
  SHOONYA_API_KEY: process.env.SHOONYA_API_KEY || null,

  // AI Providers
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || null,
  GROQ_API_KEY: process.env.GROQ_API_KEY || null,
  HIGH_OPPORTUNITY_MODE: process.env.HIGH_OPPORTUNITY_MODE === 'true' || false
};
