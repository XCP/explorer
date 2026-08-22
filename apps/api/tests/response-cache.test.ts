import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { cached, claimCacheRefresh, type Ctx } from "#api/read/respond";

class Statement {
  private args: unknown[] = [];
  constructor(
    private readonly db: DatabaseSync,
    private readonly sql: string,
  ) {}
  bind(...args: unknown[]) {
    this.args = args;
    return this;
  }
  async run() {
    const result = this.db.prepare(this.sql).run(...this.args);
    return { meta: { rows_written: result.changes } };
  }
  async first<T>() {
    return (this.db.prepare(this.sql).get(...(this.args as never[])) as T | undefined) ?? null;
  }
}

function cacheDatabase(rows: Array<[key: string, body: string, expiresAt: number]>) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(
    `CREATE TABLE cache(key TEXT PRIMARY KEY,body TEXT,ctype TEXT,expires_at INTEGER,refreshing_until INTEGER NOT NULL);`,
  );
  for (const [key, body, expiresAt] of rows) {
    sqlite.prepare(`INSERT INTO cache VALUES(?,?,'application/json',?,0)`).run(key, body, expiresAt);
  }
  return { sqlite, db: { prepare: (sql: string) => new Statement(sqlite, sql) } as unknown as D1Database };
}

/** The slice of Hono's Context that cached() consumes. */
function fakeContext(db: D1Database, pending: Promise<unknown>[]) {
  return {
    env: { CORE_DB: db },
    executionCtx: { waitUntil: (p: Promise<unknown>) => pending.push(p) },
    body: (body: string, status: number, headers: Record<string, string>) => new Response(body, { status, headers }),
  } as unknown as Ctx;
}

test("only one stale-cache request owns a refresh lease", async () => {
  const { sqlite, db } = cacheDatabase([["heavy", "{}", 0]]);

  assert.equal(await claimCacheRefresh(db, "heavy", 100), true);
  assert.equal(await claimCacheRefresh(db, "heavy", 100), false);
  assert.equal(await claimCacheRefresh(db, "heavy", 161), true);
  assert.equal(await claimCacheRefresh(db, "missing", 161), false);
  sqlite.close();
});

test("a fresh hit is edge-cacheable for the configured window", async () => {
  const future = Math.floor(Date.now() / 1000) + 1_000;
  const { sqlite, db } = cacheDatabase([["k:v2", `{"n":2}`, future]]);
  const pending: Promise<unknown>[] = [];

  const response = await cached(fakeContext(db, pending), "k:v2", { ttl: 100, edge: 60 }, async () => ({ n: 99 }));
  assert.equal(response.headers.get("x-d1-cache"), "HIT");
  assert.equal(response.headers.get("cache-control"), "public, max-age=60");
  assert.equal(await response.text(), `{"n":2}`);
  sqlite.close();
});

test("cache coordination reads the primary instead of a stale route replica", async () => {
  const future = Math.floor(Date.now() / 1000) + 1_000;
  const primary = cacheDatabase([["shared", `{"source":"primary"}`, future]]);
  const replica = cacheDatabase([]);
  let routeReads = 0;
  const routeDb = {
    prepare(sql: string) {
      routeReads += 1;
      return replica.db.prepare(sql);
    },
    withSession(mode: string) {
      assert.equal(mode, "first-primary");
      return primary.db;
    },
  } as unknown as D1Database;

  const response = await cached(fakeContext(routeDb, []), "shared", { ttl: 100 }, async () => {
    routeDb.prepare(`SELECT 1`);
    return { source: "producer" };
  });
  assert.equal(response.headers.get("x-d1-cache"), "HIT");
  assert.equal(await response.text(), `{"source":"primary"}`);
  assert.equal(routeReads, 0);
  primary.sqlite.close();
  replica.sqlite.close();
});

test("a prior-version fallback serves instantly but is never edge-cached", async () => {
  // Version bump: k:v2 is absent, k:v1 holds the old body. The reader must get v1 now, the
  // producer must run in the background, and the response must carry max-age=0 so the edge
  // middleware does not pin the OLD body under the NEW contract key for the full edge TTL.
  const { sqlite, db } = cacheDatabase([["k:v1", `{"n":1}`, 0]]);
  const pending: Promise<unknown>[] = [];

  const response = await cached(
    fakeContext(db, pending),
    "k:v2",
    { ttl: 100, edge: 86_400, staleKey: "k:v1" },
    async () => ({ n: 2 }),
  );
  assert.equal(response.headers.get("x-d1-cache"), "STALE-VERSION");
  assert.equal(response.headers.get("cache-control"), "public, max-age=0");
  assert.equal(await response.text(), `{"n":1}`);

  assert.equal(pending.length, 1);
  await Promise.all(pending);
  const written = sqlite.prepare(`SELECT body FROM cache WHERE key='k:v2'`).get() as { body: string };
  assert.equal(written.body, `{"n":2}`);

  // The next request finds the recomputed primary and is edge-cacheable again.
  const next = await cached(fakeContext(db, []), "k:v2", { ttl: 100, edge: 86_400, staleKey: "k:v1" }, async () => ({
    n: 3,
  }));
  assert.equal(next.headers.get("x-d1-cache"), "HIT");
  assert.equal(next.headers.get("cache-control"), "public, max-age=86400");
  assert.equal(await next.text(), `{"n":2}`);
  sqlite.close();
});
