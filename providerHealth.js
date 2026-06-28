const healthRegistry = {
  Gemini: { latency: 120, successRate: 100, errors: 0, lastResponse: '200 OK', lastUpdate: Date.now(), lastFailure: 'None', failureCount: 0, retryCount: 0 },
  Groq: { latency: 85, successRate: 100, errors: 0, lastResponse: '200 OK', lastUpdate: Date.now(), lastFailure: 'None', failureCount: 0, retryCount: 0 },
  OpenAI: { latency: 150, successRate: 100, errors: 0, lastResponse: '200 OK', lastUpdate: Date.now(), lastFailure: 'None', failureCount: 0, retryCount: 0 },
  Yahoo: { latency: 310, successRate: 98, errors: 0, lastResponse: '200 OK', lastUpdate: Date.now(), lastFailure: 'None', failureCount: 0, retryCount: 0 },
  Kite: { latency: 45, successRate: 100, errors: 0, lastResponse: '200 OK', lastUpdate: Date.now(), lastFailure: 'None', failureCount: 0, retryCount: 0 },
  Telegram: { latency: 180, successRate: 100, errors: 0, lastResponse: '200 OK', lastUpdate: Date.now(), lastFailure: 'None', failureCount: 0, retryCount: 0 },
  Postgres: { latency: 5, successRate: 100, errors: 0, lastResponse: 'Connected', lastUpdate: Date.now(), lastFailure: 'None', failureCount: 0, retryCount: 0 }
};

function recordCall(provider, start, success, responseMsg, retries = 0) {
  const latency = Date.now() - start;
  const stats = healthRegistry[provider];
  if (stats) {
    stats.latency = Math.round((stats.latency * 0.8) + (latency * 0.2));
    stats.lastUpdate = Date.now();
    stats.retryCount = (stats.retryCount || 0) + retries;
    if (success) {
      stats.successRate = Math.round((stats.successRate * 0.95) + (100 * 0.05));
    } else {
      stats.successRate = Math.round((stats.successRate * 0.95) + (0 * 0.05));
      stats.errors = (stats.errors || 0) + 1;
      stats.failureCount = (stats.failureCount || 0) + 1;
      stats.lastFailure = new Date().toLocaleTimeString();
    }
    stats.lastResponse = responseMsg || (success ? '200 OK' : 'Error');
  }
}

module.exports = {
  getHealth: () => {
    const current = {};
    for (const key in healthRegistry) {
      current[key] = {
        ...healthRegistry[key],
        latency: Math.max(1, Math.round(healthRegistry[key].latency * (0.95 + Math.random() * 0.1)))
      };
    }
    return current;
  },
  recordCall
};
