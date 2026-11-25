import assert from "node:assert/strict";
import { test } from "node:test";
import { Hono } from "hono";
import type { Env } from "#api/env";
import { limitAssetListMiss, observePublicReadBudget } from "#api/http/rate-budget";

function app() {
  const instance = new Hono<{ Bindings: Env }>();
  instance.use("*", observePublicReadBudget);
  instance.get("/v2/assets/XCP", (c) => c.text("ok"));
  return instance;
}

test("public GETs increment a bounded route-family counter without enforcement", async () => {
  const keys: string[] = [];
  const env = {
    PUBLIC_API_RATE_LIMITER: {
      limit: async ({ key }: { key: string }) => {
        keys.push(key);
        return { success: false };
      },
    },
  } as unknown as Env;
  const previousWarn = console.warn;
  console.warn = () => undefined;
  try {
    const response = await app().request(
      "http://test/v2/assets/XCP",
      { headers: { "CF-Connecting-IP": "192.0.2.10" } },
      env,
    );
    assert.equal(response.status, 200);
    assert.deepEqual(keys, ["192.0.2.10:/v2/assets/:detail"]);
  } finally {
    console.warn = previousWarn;
  }
});

test("service-binding reads without a public client header bypass the budget", async () => {
  let calls = 0;
  const env = {
    PUBLIC_API_RATE_LIMITER: {
      limit: async () => {
        calls += 1;
        return { success: true };
      },
    },
  } as unknown as Env;
  const response = await app().request("http://test/v2/assets/XCP", {}, env);
  assert.equal(response.status, 200);
  assert.equal(calls, 0);
});

test("the asset list rejects an over-budget client before the handler, including HEAD", async () => {
  const api = app();
  api.get("/v2/assets", () => {
    throw new Error("unexpected origin read");
  });
  const env = {
    ASSET_LIST_CLIENT_LIMIT: { limit: async () => ({ success: false }) },
  } as unknown as Env;
  const headers = { "CF-Connecting-IP": "192.0.2.10" };
  for (const method of ["GET", "HEAD"]) {
    const response = await api.request("http://test/v2/assets?offset=2000", { method, headers }, env);
    assert.equal(response.status, 429);
    assert.equal(response.headers.get("retry-after"), "60");
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  assert.equal((await api.request("http://test/v2/assets/XCP", { headers }, env)).status, 200);
});

test("uncached bulk pages share a global allowance across clients while browsing keeps its own", async () => {
  const api = app();
  const pools: string[] = [];
  const env = {
    ASSET_LIST_CLIENT_LIMIT: { limit: async () => ({ success: true }) },
    ASSET_LIST_MISS_LIMIT: { limit: async () => ({ success: true }) },
    ASSET_LIST_BUDGET: {
      getByName: (pool: string) => ({
        take: async () => {
          pools.push(pool);
          return pool === "bulk" && pools.length > 1 ? 12 : 0;
        },
      }),
    },
  } as unknown as Env;
  api.get("/v2/assets", async (c) => {
    const rejected = await limitAssetListMiss(c, {
      offset: Number(c.req.query("offset") ?? 0),
      sort: c.req.query("sort"),
    });
    return rejected ?? c.text("ok");
  });
  for (const [ip, query, status] of [
    ["192.0.2.10", "?offset=1000", 200],
    ["192.0.2.11", "?sort=supply", 429],
    ["192.0.2.11", "?offset=100", 200],
  ] as const) {
    const response = await api.request("http://test/v2/assets" + query, { headers: { "CF-Connecting-IP": ip } }, env);
    assert.equal(response.status, status);
    if (status === 429) assert.equal(response.headers.get("retry-after"), "12");
  }
  assert.deepEqual(pools, ["bulk", "bulk", "browse"]);
});
