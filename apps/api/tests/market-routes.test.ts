import { test } from "node:test";
import assert from "node:assert/strict";
import type { Env } from "#api/env";
import { markets } from "#api/read/markets";

const providerMarket = {
  base_asset: "PEPECASH",
  quote_asset: "XCP",
  last_price: 0.0022,
  last_trade_time: 1783599251,
  last_side: "sell",
  price_change_24h: 0,
  price_change_7d: 1.5,
  price_change_30d: 2.5,
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

const bindings = (provider: Response | Response[], quote: { usd: number; day: string } | null = null): Env =>
  ({
    XCPDEX: {
      fetch: async () =>
        Array.isArray(provider) ? (provider.shift() ?? Response.json({}, { status: 500 })) : provider,
    } as unknown as Fetcher,
    DB: {
      prepare: () => ({
        bind: () => ({ first: async () => quote }),
      }),
    } as unknown as D1Database,
  }) as Env;

test("canonical market route exposes an ordered pair without compatibility wrapping", async () => {
  const response = await markets.request("/markets/pepecash/xcp", undefined, bindings(Response.json(providerMarket)));
  assert.equal(response.status, 200);
  const body = (await response.json()) as { result: Record<string, unknown> };
  assert.equal(body.result.baseAsset, "PEPECASH");
  assert.equal(body.result.quoteAsset, "XCP");
  assert.equal(body.result.lastPrice, 0.0022);
  assert.equal("data" in body, false);
  assert.equal("trading_pair" in body.result, false);
});

test("canonical market route distinguishes a missing pair from provider drift", async () => {
  const missing = await markets.request(
    "/markets/UNKNOWN/XCP",
    undefined,
    bindings([
      Response.json({ error: "Pair not found" }, { status: 404 }),
      Response.json({ error: "Pair not found" }, { status: 404 }),
    ]),
  );
  assert.equal(missing.status, 404);

  const malformed = await markets.request(
    "/markets/PEPECASH/XCP",
    undefined,
    bindings(Response.json({ ...providerMarket, last_price: "0.0022" })),
  );
  assert.equal(malformed.status, 502);
});

test("canonical market route resolves an ordered pair from the provider's reverse orientation", async () => {
  const response = await markets.request(
    "/markets/XCP/PEPECASH",
    undefined,
    bindings([Response.json({ error: "Pair not found" }, { status: 404 }), Response.json(providerMarket)]),
  );
  assert.equal(response.status, 200);
  const market = ((await response.json()) as { result: Record<string, unknown> }).result;
  assert.equal(market.baseAsset, "XCP");
  assert.equal(market.quoteAsset, "PEPECASH");
  assert.equal(market.lastPrice, 1 / 0.0022);
  assert.equal(market.bestBid, 1 / 0.0045);
  assert.equal(market.bestAsk, 1 / 0.0022);
  assert.equal(market.volume7d, 1684);
  assert.equal(market.lastSide, "buy");
});

test("XCP/USD quote uses the newest indexed price observation", async () => {
  const response = await markets.request(
    "/quotes/XCP/USD",
    undefined,
    bindings(Response.json({}), { usd: 2.73, day: "2026-07-12" }),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    result: {
      baseAsset: "XCP",
      quoteAsset: "USD",
      price: 2.73,
      observedOn: "2026-07-12",
      source: "counterparty_dex",
    },
  });
});

test("XCP/USD quote fails closed when no valid observation exists", async () => {
  assert.equal((await markets.request("/quotes/XCP/USD", undefined, bindings(Response.json({}), null))).status, 503);
  assert.equal(
    (await markets.request("/quotes/XCP/USD", undefined, bindings(Response.json({}), { usd: 0, day: "" }))).status,
    503,
  );
});
