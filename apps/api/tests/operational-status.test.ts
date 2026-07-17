import { test } from "node:test";
import assert from "node:assert/strict";
import type { Env } from "#api/env";
import { operationalStatus } from "#api/operations/status";

class Statement {
  constructor(
    private readonly sql: string,
    private readonly database: Database,
  ) {}

  async all<T>() {
    this.database.queries.push(this.sql);
    return { results: this.database.rows(this.sql) as T[] };
  }

  async first<T>() {
    this.database.queries.push(this.sql);
    return (this.database.rows(this.sql)[0] as T | undefined) ?? null;
  }
}

class Database {
  queries: string[] = [];
  constructor(private readonly resolver: (sql: string) => unknown[]) {}
  prepare(sql: string) {
    return new Statement(sql, this);
  }
  rows(sql: string) {
    return this.resolver(sql);
  }
}

test("operational status aggregates durable frontiers without counting recovery outputs", async () => {
  const core = new Database((sql) =>
    sql.includes("FROM asset_activity_outlook")
      ? [
          {
            rows: 10,
            distinct_ranks: 10,
            min_rank: 1,
            max_rank: 10,
            min_population: 10,
            max_population: 10,
            ineligible: 0,
            calculated_at: 100,
          },
        ]
      : [
          { key: "last_event_index", value: "120" },
          { key: "last_block_index", value: "101" },
          { key: "last_block_hash", value: "abc" },
        ],
  );
  const recovery = new Database((sql) => {
    if (sql.includes("FROM recovery_state"))
      return [
        { key: "read_ready", value: "0", updated_at: 10 },
        { key: "stamp_protection_ready", value: "1", updated_at: 10 },
        { key: "official_stamp_protection_ready", value: "1", updated_at: 10 },
        { key: "r2_audit_ready", value: "0", updated_at: 10 },
      ];
    if (sql.includes("FROM recovery_imports"))
      return [{ imports: 1, completed: 0, rows_seen: 12_000, rows_written: 11_900, started_at: 5, errors: 0 }];
    if (sql.includes("chain_checked_at IS NULL ORDER")) return [{ txid: "a".repeat(64), vout: 2 }];
    if (sql.includes("chain_checked_at IS NOT NULL")) return [{ chain_checked_at: 99 }];
    if (sql.includes("FROM recovery_attempts")) return [{ total: 3, pending: 2, unchecked: 1, oldest_check_at: 80 }];
    return [];
  });

  const result = await operationalStatus({ CORE_DB: core, RECOVERY_DB: recovery } as unknown as Env, 123);

  assert.equal(result.generated_at, 123);
  assert.deepEqual(result.core, {
    replay: { last_event_index: 120, last_block_index: 101, last_block_hash: "abc" },
    activity_outlook: { healthy: true, rows: 10, ineligible: 0, calculated_at: 100 },
  });
  assert.equal(result.recovery.import.rows_seen, 12_000);
  assert.equal(result.recovery.verification.complete, false);
  assert.equal(result.recovery.verification.next_output?.vout, 2);
  assert.equal(result.recovery.attempts.pending, 2);
  assert.deepEqual(result.recovery.readiness, {
    stamp_protection: true,
    official_stamp_protection: true,
    r2_audit: false,
  });
  assert.equal(
    recovery.queries.some((sql) => /COUNT\(\*\).*FROM recovery_outputs/is.test(sql)),
    false,
  );
});

test("verification is complete only after all imports complete and the indexed frontier is empty", async () => {
  const core = new Database(() => []);
  const recovery = new Database((sql) => {
    if (sql.includes("FROM recovery_imports"))
      return [{ imports: 2, completed: 2, rows_seen: 20, rows_written: 20, errors: 0 }];
    if (sql.includes("FROM recovery_attempts")) return [{ total: 0, pending: 0, unchecked: 0 }];
    return [];
  });

  const result = await operationalStatus({ CORE_DB: core, RECOVERY_DB: recovery } as unknown as Env, 1);
  assert.equal(result.recovery.verification.complete, true);
  assert.equal(result.recovery.verification.has_unchecked_outputs, false);
});
