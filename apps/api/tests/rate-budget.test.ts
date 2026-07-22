import assert from "node:assert/strict";
import { test } from "node:test";
import { Hono } from "hono";
import type { Env } from "#api/env";
import { observePublicReadBudget } from "#api/http/rate-budget";

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
