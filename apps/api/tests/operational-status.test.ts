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
  const ledger = new Database(() => [
    { key: "backfill_active", value: "1" },
    { key: "ledger_credit_cursor", value: "100" },
    { key: "ledger_credit_done", value: "1" },
    { key: "ledger_debit_cursor", value: "200" },
    { key: "ledger_debit_done", value: "0" },
    { key: "read_cutover", value: "0" },
  ]);
  const recovery = new Database((sql) => {
    if (sql.includes("FROM recovery_state")) return [{ key: "read_ready", value: "0", updated_at: 10 }];
    if (sql.includes("FROM recovery_imports"))
      return [{ imports: 1, completed: 0, rows_seen: 12_000, rows_written: 11_900, started_at: 5, errors: 0 }];
    if (sql.includes("chain_checked_at IS NULL ORDER")) return [{ txid: "a".repeat(64), vout: 2 }];
    if (sql.includes("chain_checked_at IS NOT NULL")) return [{ chain_checked_at: 99 }];
    if (sql.includes("FROM recovery_attempts")) return [{ total: 3, pending: 2, unchecked: 1, oldest_check_at: 80 }];
    return [];
  });

  const result = await operationalStatus({ LEDGER_DB: ledger, RECOVERY_DB: recovery } as unknown as Env, 123);

  assert.equal(result.generated_at, 123);
  assert.deepEqual(result.ledger.debit, { cursor: "200", complete: false });
  assert.equal(result.recovery.import.rows_seen, 12_000);
  assert.equal(result.recovery.verification.complete, false);
  assert.equal(result.recovery.verification.next_output?.vout, 2);
  assert.equal(result.recovery.attempts.pending, 2);
  assert.equal(
    recovery.queries.some((sql) => /COUNT\(\*\).*FROM recovery_outputs/is.test(sql)),
    false,
  );
});

test("verification is complete only after all imports complete and the indexed frontier is empty", async () => {
  const ledger = new Database(() => []);
  const recovery = new Database((sql) => {
    if (sql.includes("FROM recovery_imports"))
      return [{ imports: 2, completed: 2, rows_seen: 20, rows_written: 20, errors: 0 }];
    if (sql.includes("FROM recovery_attempts")) return [{ total: 0, pending: 0, unchecked: 0 }];
    return [];
  });

  const result = await operationalStatus({ LEDGER_DB: ledger, RECOVERY_DB: recovery } as unknown as Env, 1);
  assert.equal(result.recovery.verification.complete, true);
  assert.equal(result.recovery.verification.has_unchecked_outputs, false);
});
