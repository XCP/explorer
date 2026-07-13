import { test } from "node:test";
import assert from "node:assert/strict";
import { parseXcpDexMarket } from "#api/integrations/xcpdex";

const valid = {
  base_asset: "PEPECASH",
  quote_asset: "XCP",
  last_price: 0.0022,
  last_trade_time: 1783599251,
  last_side: "sell",
  price_change_24h: 0,
  price_change_7d: 1.5,
  price_change_30d: null,
  volume_24h: 0,
  volume_7d: 3.7,
  volume_30d: 105.9,
  base_volume_24h: 0,
  base_volume_7d: 1684,
  base_volume_30d: 30605.8,
  trade_count_24h: 0,
  trade_count_7d: 2,
  trade_count_30d: 9,
  open_orders: 8,
  best_bid: 0.0022,
  best_ask: 0.0045,
  updated_at: 1783904932,
};

test("XCP DEX market parser maps a validated provider response", () => {
  assert.deepEqual(parseXcpDexMarket(valid), {
    baseAsset: "PEPECASH",
    quoteAsset: "XCP",
    lastPrice: 0.0022,
    lastTradeAt: 1783599251,
    lastSide: "sell",
    priceChange24h: 0,
    priceChange7d: 1.5,
    priceChange30d: null,
    volume24h: 0,
    volume7d: 3.7,
    volume30d: 105.9,
    baseVolume24h: 0,
    baseVolume7d: 1684,
    baseVolume30d: 30605.8,
    trades24h: 0,
    trades7d: 2,
    trades30d: 9,
    openOrders: 8,
    bestBid: 0.0022,
    bestAsk: 0.0045,
    updatedAt: 1783904932,
  });
});

test("XCP DEX market parser rejects provider drift in consumed fields", () => {
  assert.throws(() => parseXcpDexMarket([]), /must be an object/);
  assert.throws(() => parseXcpDexMarket({ ...valid, last_price: "0.0022" }), /last_price/);
  assert.throws(() => parseXcpDexMarket({ ...valid, trade_count_7d: -1 }), /trade_count_7d/);
  assert.throws(() => parseXcpDexMarket({ ...valid, last_side: "maker" }), /last_side/);
});
