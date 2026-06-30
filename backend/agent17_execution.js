'use strict';

const broker = require('./broker');
const db = require('./db');
const runtimeState = require('./runtimeState');

const agent17_execution = {
  // Latency & slippage stats (rolling 20-sample buffers)
  stats: {
    latencies: [],
    slippagePct: []
  },

  async placeOrder(symbol, action, quantity, strategy, reason, scannerPrice) {
    if (quantity <= 0) {
      console.warn(`[AGENT 17] [REJECTED] Zero or negative quantity: Qty: ${quantity}`);
      throw new Error(`Order rejected: Quantity must be greater than 0. Got: ${quantity}`);
    }

    const signalTime = Date.now();
    console.log(`[AGENT 17] Placing ${action} order for ${symbol} via active broker. Qty: ${quantity}`);

    // Call the broker's underlying order execution function
    const result = await broker.executeOrder(symbol, action, quantity, strategy, reason, scannerPrice);

    // ── Real latency: signal-to-DB-write wall-clock time (no random noise) ──
    const latencyMs = Date.now() - signalTime;

    // ── Real slippage: computed from actual fill price vs. scanner price ──
    const fillPrice = result?.trade?.price || result?.portfolio?.holding_stocks?.find(h => h.symbol === symbol)?.avgPrice || scannerPrice;
    const slippagePct = scannerPrice && scannerPrice > 0
      ? parseFloat((Math.abs(fillPrice - scannerPrice) / scannerPrice * 100).toFixed(4))
      : 0;

    // ── Use exchange orderId from broker result; fallback to timestamp-based ID only ──
    const orderId = result?.trade?.exchange_order_id
      || result?.trade?.order_id
      || `ORD-${Date.now()}`;

    // Track in rolling buffers
    this.stats.latencies.push(latencyMs);
    if (this.stats.latencies.length > 20) this.stats.latencies.shift();
    this.stats.slippagePct.push(slippagePct);
    if (this.stats.slippagePct.length > 20) this.stats.slippagePct.shift();

    // Update runtimeState with real fill metrics
    runtimeState.recordFill(slippagePct, latencyMs);

    console.log(`[AGENT 17] Order complete in ${latencyMs}ms | Slippage: ${slippagePct.toFixed(4)}% | OrderId: ${orderId}`);

    return {
      success: true,
      orderId,
      latency: latencyMs,
      slippage: slippagePct,
      ...result
    };
  },

  async modifyOrder(orderId, newPrice, newQuantity) {
    console.log(`[AGENT 17] Modifying Order ${orderId}: New Price: ${newPrice}, Qty: ${newQuantity}`);
    try {
      const result = await broker.modifyOrder(orderId, newPrice, newQuantity);
      return { success: true, orderId, status: 'MODIFIED', ...result };
    } catch (err) {
      console.error(`[AGENT 17] modifyOrder failed: ${err.message}`);
      return { success: false, orderId, status: 'MODIFY_FAILED', error: err.message };
    }
  },

  async cancelOrder(orderId) {
    console.log(`[AGENT 17] Cancelling Order ${orderId}`);
    try {
      const result = await broker.cancelOrder(orderId);
      return { success: true, orderId, status: 'CANCELLED', ...result };
    } catch (err) {
      console.error(`[AGENT 17] cancelOrder failed: ${err.message}`);
      return { success: false, orderId, status: 'CANCEL_FAILED', error: err.message };
    }
  },

  async fetchPositions() {
    const valuation = await broker.getValuation();
    return valuation.holdingStocks;
  },

  async fetchHoldings() {
    const valuation = await broker.getValuation();
    return valuation.holdingStocks;
  },

  async fetchMargin() {
    const valuation = await broker.getValuation();
    return {
      availableMargin: valuation.balance,
      usedMargin: valuation.equityValue,
      totalMargin: valuation.totalVal
    };
  },

  getStats() {
    const avgLatency = this.stats.latencies.length
      ? this.stats.latencies.reduce((a, b) => a + b, 0) / this.stats.latencies.length
      : 0;
    const avgSlippage = this.stats.slippagePct.length
      ? this.stats.slippagePct.reduce((a, b) => a + b, 0) / this.stats.slippagePct.length
      : 0;
    return {
      avgLatencyMs: parseFloat(avgLatency.toFixed(2)),
      avgSlippagePct: parseFloat(avgSlippage.toFixed(4)),
      totalOrders: this.stats.latencies.length
    };
  }
};

module.exports = agent17_execution;
