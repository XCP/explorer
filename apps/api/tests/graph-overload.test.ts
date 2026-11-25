import assert from "node:assert/strict";
import { test } from "node:test";
import { Hono } from "hono";
import type { Env } from "#api/env";
import { read } from "#api/read/router";
import { describeHttpError } from "#api/http/errors";

test("a graph cache miss serves the last good result only for the same holder limit", async () => {
  const entries = new Map<string, Response>();
  const saved = Object.getOwnPropertyDescriptor(globalThis, "caches");
  Object.defineProperty(globalThis, "caches", {
    configurable: true,
    value: {
      default: {
        match: async (key: Request) => entries.get(key.url)?.clone(),
        put: async (key: Request, response: Response) => {
          entries.set(key.url, response);
        },
      },
    },
  });
  try {
    const app = new Hono<{ Bindings: Env }>();
    app.route("/", read);
    app.onError((error, c) => {
      const failure = describeHttpError(error);
      return c.json({ error: failure.publicMessage }, failure.status);
    });
    let busy = false;
    const env = {
      CORE_DB: {
        prepare() {
          if (busy) throw new Error("D1 DB is overloaded");
          return { bind: () => ({ all: async () => ({ results: [] }) }) };
        },
      },
    } as unknown as Env;
    const context = {
      waitUntil(p: Promise<unknown>) {
        pending.push(p);
      },
    } as ExecutionContext;
    const pending: Promise<unknown>[] = [];
    const get = (query: string) => app.request("https://api.xcp.io/v2/graph/asset/CARD?" + query, {}, env, context);
    const good = await get("limit=4");
    assert.equal(good.status, 200);
    await Promise.all(pending);
    busy = true;
    assert.equal((await get("limit=4&tracking=x")).headers.get("x-cache"), "HIT");
    for (const url of entries.keys()) if (!new URL(url).searchParams.has("__last_good")) entries.delete(url);
    const stale = await get("limit=4&tracking=y");
    assert.equal(stale.status, 200);
    assert.equal(stale.headers.get("x-cache"), "STALE-IF-ERROR");
    assert.deepEqual(await stale.json(), await good.json());
    assert.equal((await get("limit=5")).status, 503);
  } finally {
    if (saved) Object.defineProperty(globalThis, "caches", saved);
    else Reflect.deleteProperty(globalThis, "caches");
  }
});
