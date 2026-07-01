const runtimeState = require('./runtimeState');

// Global Circuit Breaker State Map
const circuitBreakers = {
  yahoo: { failures: 0, nextRetry: 0, state: 'CLOSED' },
  gemini: { failures: 0, nextRetry: 0, state: 'CLOSED' },
  groq: { failures: 0, nextRetry: 0, state: 'CLOSED' },
  broker: { failures: 0, nextRetry: 0, state: 'CLOSED' },
  telegram: { failures: 0, nextRetry: 0, state: 'CLOSED' }
};

const CB_THRESHOLD = 5;       // Failures before opening circuit
const CB_TIMEOUT_MS = 60000;  // Stay open for 60 seconds

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function withResilience(providerName, fetchFunction, maxRetries = 3, initialBackoff = 500) {
  const cb = circuitBreakers[providerName];
  if (!cb) {
    // If not tracked, just run it
    return await fetchFunction();
  }

  // Check Circuit Breaker
  if (cb.state === 'OPEN') {
    if (Date.now() < cb.nextRetry) {
      throw new Error(`[CIRCUIT BREAKER OPEN] ${providerName} is temporarily blocked due to repeated failures.`);
    } else {
      cb.state = 'HALF_OPEN';
    }
  }

  let attempt = 0;
  let lastError = null;

  while (attempt < maxRetries) {
    try {
      const startTime = Date.now();
      const result = await fetchFunction();
      const latency = Date.now() - startTime;
      
      // Success: Reset Circuit Breaker
      cb.failures = 0;
      cb.state = 'CLOSED';

      // Update provider health (if tracked)
      if (runtimeState.updateProviderHealth) {
        runtimeState.updateProviderHealth(providerName, latency, true);
      }
      return result;
    } catch (err) {
      lastError = err;
      attempt++;
      
      if (runtimeState.updateProviderHealth) {
        runtimeState.updateProviderHealth(providerName, 0, false);
      }

      // Check if it's a 4xx error (do not retry on 400, 401, 403, 404 except 429)
      const isClientError = err.response && err.response.status >= 400 && err.response.status < 500 && err.response.status !== 429;
      if (isClientError) {
        break; // Don't retry auth or bad request errors
      }

      if (attempt < maxRetries) {
        const backoff = initialBackoff * Math.pow(2, attempt - 1);
        console.warn(`[RETRY] ${providerName} failed (Attempt ${attempt}/${maxRetries}). Retrying in ${backoff}ms... Error: ${err.message}`);
        await sleep(backoff);
      }
    }
  }

  // All retries failed
  cb.failures++;
  if (cb.failures >= CB_THRESHOLD && cb.state !== 'OPEN') {
    cb.state = 'OPEN';
    cb.nextRetry = Date.now() + CB_TIMEOUT_MS;
    console.error(`🚨 [CIRCUIT BREAKER OPENED] ${providerName} failed ${CB_THRESHOLD} times consecutively. Blocking for ${CB_TIMEOUT_MS / 1000}s.`);
  } else if (cb.state === 'HALF_OPEN') {
    // If half-open and failed again, re-open immediately
    cb.state = 'OPEN';
    cb.nextRetry = Date.now() + CB_TIMEOUT_MS;
    console.error(`🚨 [CIRCUIT BREAKER RE-OPENED] ${providerName} failed while HALF_OPEN. Blocking for ${CB_TIMEOUT_MS / 1000}s.`);
  }

  throw lastError;
}

module.exports = {
  withResilience,
  circuitBreakers
};
