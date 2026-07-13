import assert from "node:assert/strict";
import { test } from "node:test";
import {
  activateCoreForwardWrites,
  auditCoreDataParity,
  CORE_PARITY_RELATIONS,
  rollbackCoreForwardWrites,
} from "#api/indexer/core-parity";

class Statement {
  private binds: unknown[] = [];

  constructor(
    readonly sql: string,
    private readonly database: Database,
  ) {}

  bind(...values: unknown[]) {
    this.binds = values;
    return this;
  }

  async first<T>() {
    const key = String(this.binds[0]);
    const value = this.database.state.get(key);
    return (value == null ? null : { value }) as T | null;
  }

  execute() {
    const count = this.database.counts.get(this.sql);
    if (count != null) return { results: [{ count }], success: true };
    const key = /VALUES\('([^']+)',\?\)/.exec(this.sql)?.[1];
    if (key) this.database.state.set(key, String(this.binds[0]));
    const literal = /VALUES\('([^']+)','([^']+)'\)/.exec(this.sql);
    if (literal) this.database.state.set(literal[1], literal[2]);
    return { results: [], success: true };
  }

  async run() {
    return this.execute();
  }
}

class Database {
  constructor(
    readonly counts: Map<string, number>,
    readonly state: Map<string, string>,
  ) {}

  prepare(sql: string) {
    return new Statement(sql, this);
  }

  async batch(statements: Statement[]) {
    return statements.map((statement) => statement.execute());
  }
}

function databases() {
  const sourceCounts = new Map(CORE_PARITY_RELATIONS.map((relation) => [relation.sourceSql, 0]));
  const compactCounts = new Map(CORE_PARITY_RELATIONS.map((relation) => [relation.targetSql, 0]));
  const source = new Database(sourceCounts, new Map([["last_event_index", "100"]]));
  const compact = new Database(
    compactCounts,
    new Map([
      ["last_event_index", "100"],
      ["build_complete", "1"],
      ["import_complete", "1"],
      ["seed_reconciled", "1"],
    ]),
  );
  return { source, compact };
}

test("core parity covers copied tags, trades, merged ledger rows, and compressed PageRank edges", () => {
  const byTarget = new Map(CORE_PARITY_RELATIONS.map((relation) => [relation.target, relation]));
  assert.deepEqual(byTarget.get("tags")?.sources, ["tags"]);
  assert.deepEqual(byTarget.get("trades")?.sources, ["trades"]);
  assert.deepEqual(byTarget.get("ledger_events")?.sources, ["credits", "debits"]);
  assert.match(byTarget.get("pr_edges")?.targetSql ?? "", /sum\(multiplicity\)/);
});

test("core parity records acceptance only at an equal cursor with equal relation counts", async () => {
  const { source, compact } = databases();
  const tags = CORE_PARITY_RELATIONS.find((relation) => relation.target === "tags");
  if (!tags) throw new Error("tags parity relation is missing");
  source.counts.set(tags.sourceSql, 10);
  compact.counts.set(tags.targetSql, 9);

  const failed = await auditCoreDataParity(
    { DB: source as unknown as D1Database, CORE_DB: compact as unknown as D1Database },
    { accept: true, now: 50 },
  );
  assert.equal(failed.ok, false);
  assert.deepEqual(failed.mismatches, [{ target: "tags", sources: ["tags"], source: 10, compact: 9, matches: false }]);
  assert.equal(compact.state.get("parity_verified"), "0");

  compact.counts.set(tags.targetSql, 10);
  const passed = await auditCoreDataParity(
    { DB: source as unknown as D1Database, CORE_DB: compact as unknown as D1Database },
    { accept: true, now: 51 },
  );
  assert.equal(passed.ok, true);
  assert.equal(passed.checked_relations, CORE_PARITY_RELATIONS.length);
  assert.equal(compact.state.get("parity_verified"), "1");
  assert.equal(compact.state.get("parity_event_index"), "100");
  assert.equal(compact.state.get("parity_checked_at"), "51");
});

test("forward writes can only activate through a fresh successful parity audit", async () => {
  const { source, compact } = databases();
  compact.state.set("last_event_index", "99");
  const failed = await activateCoreForwardWrites({
    DB: source as unknown as D1Database,
    CORE_DB: compact as unknown as D1Database,
  });
  assert.equal(failed.ok, false);
  assert.notEqual(compact.state.get("forward_write_ready"), "1");

  compact.state.set("last_event_index", "100");
  const passed = await activateCoreForwardWrites({
    DB: source as unknown as D1Database,
    CORE_DB: compact as unknown as D1Database,
  });
  assert.equal(passed.ok, true);
  assert.equal(compact.state.get("forward_write_ready"), "1");

  await rollbackCoreForwardWrites(compact as unknown as D1Database);
  assert.equal(compact.state.get("forward_write_ready"), "0");
});
