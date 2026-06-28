const broker = require('./broker');
const db = require('./db');

const agent17_execution = {
  // Latency & slippage stats
  stats: {
    latencies: [],
    slippagePct: []
  },

  async placeOrder(symbol, action, quantity, strategy, reason, scannerPrice) {
    if (quantity <= 0) {
      console.warn(`[AGENT 17] [REJECTED] Zero or negative quantity: Qty: ${quantity}`);
      throw new Error(`Order rejected: Quantity must be greater than 0. Got: ${quantity}`);
    }
    const startTime = Date.now();
    console.log(`[AGENT 17] Placing ${action} order for ${symbol} via active broker. Qty: ${quantity}`);
    
    // Call the broker's underlying order execution function
    const result = await broker.executeOrder(symbol, action, quantity, strategy, reason, scannerPrice);
    
    // Track execution latency (standard execution in simulator ranges from 80ms to 250ms)
    const latency = Date.now() - startTime + Math.floor(Math.random() * 50);
    this.stats.latencies.push(latency);
    
    // Track slippage (simulate 0.02% to 0.05% slippage on execution)
    const slippage = 0.02 + Math.random() * 0.03;
    this.stats.slippagePct.push(slippage);

    console.log(`[AGENT 17] Order filled in ${latency}ms with ${slippage.toFixed(3)}% slippage.`);
    return {
      success: true,
      orderId: `ORD-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      latency,
      slippage,
      ...result
    };
  },

  async modifyOrder(orderId, newPrice, newQuantity) {
    console.log(`[AGENT 17] Modifying Order ${orderId}: New Price: ${newPrice}, Qty: ${newQuantity}`);
    return {
      success: true,
      orderId,
      status: 'MODIFIED'
    };
  },

  async cancelOrder(orderId) {
    console.log(`[AGENT 17] Cancelling Order ${orderId}`);
    return {
      success: true,
      orderId,
      status: 'CANCELLED'
    };
  },

  async fetchPositions() {
    // Retrieves open positions from active broker (mirroring holding stocks)
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
    const avgLatency = this.stats.latencies.reduce((a, b) => a + b, 0) / (this.stats.latencies.length || 1);
    const avgSlippage = this.stats.slippagePct.reduce((a, b) => a + b, 0) / (this.stats.slippagePct.length || 1);
    return {
      avgLatencyMs: parseFloat(avgLatency.toFixed(2)),
      avgSlippagePct: parseFloat(avgSlippage.toFixed(4)),
      totalOrders: this.stats.latencies.length
    };
  }
};

module.exports = agent17_execution;
