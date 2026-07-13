import { test } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import type { Env } from "#api/env";
import { recoveryAdmin } from "#api/recovery/admin";
import { recoveryRead } from "#api/recovery/read";

type Row = Record<string, unknown>;

class Statement {
  private values: unknown[] = [];
  constructor(
    private readonly db: FakeRecoveryDb,
    readonly sql: string,
  ) {}
  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }
  first<T>() {
    return Promise.resolve(this.db.first(this.sql, this.values) as T | null);
  }
  all<T>() {
    return Promise.resolve({ results: this.db.all(this.sql, this.values) as T[] });
  }
  run() {
    this.db.run(this.sql, this.values);
    return Promise.resolve({ success: true });
  }
}

class FakeRecoveryDb {
  readReady = false;
  stampProtectionReady = false;
  imports: Array<{ completed: boolean }> = [];
  uncheckedOutputs = 0;
  outputs: Row[] = [];
  pendingAttempts = 0;
  protectedTxids = new Set<string>();
  importRows = new Map<string, { cursor: number; rowsSeen: number; completed: boolean }>();
  receipts = new Map<
    string,
    { page_cursor: number; next_cursor: number | null; rows_seen: number; rows_written: number }
  >();
  prepare(sql: string) {
    return new Statement(this, sql);
  }
  withSession() {
    return this;
  }
  batch(statements: Statement[]) {
    return Promise.all(
      statements.map(async (statement) => {
        statement.run();
        return { results: [] };
      }),
    );
  }
  first(sql: string, values: unknown[]): Row | null {
    if (sql.includes("FROM recovery_state")) {
      if (sql.includes("stamp_protection_ready")) return this.stampProtectionReady ? { value: "1" } : null;
      return this.readReady ? { value: "1" } : null;
    }
    if (sql.includes("COUNT(*) total") && sql.includes("recovery_imports"))
      return {
        total: this.imports.length,
        completed: this.imports.filter((row) => row.completed).length,
      };
    if (sql.includes("chain_checked_at IS NULL")) return { count: this.uncheckedOutputs };
    if (sql.includes("COUNT(*) output_count")) {
      const address = values[0];
      const protectedOnly = sql.includes("AND EXISTS (SELECT 1 FROM recovery_protected_transactions");
      const excludesProtected = sql.includes("AND NOT EXISTS (SELECT 1 FROM recovery_protected_transactions");
      const matching = this.outputs.filter((row) => {
        const protectedStamp = this.protectedTxids.has(String(row.txid));
        return (
          row.recovery_address === address &&
          row.classification === "recoverable" &&
          (!protectedOnly || protectedStamp) &&
          (!excludesProtected || !protectedStamp)
        );
      });
      return {
        output_count: matching.length,
        value_sats: matching.reduce((sum, row) => sum + Number(row.value_sats), 0),
      };
    }
    if (sql.includes("COUNT(*) attempts")) return { attempts: this.pendingAttempts };
    if (sql.includes("FROM recovery_import_receipts WHERE import_id=? AND page_cursor=?")) {
      const receipt = this.receipts.get(`${values[0]}:${values[1]}`);
      return receipt ? { next_cursor: receipt.next_cursor, rows_seen: receipt.rows_seen } : null;
    }
    if (sql.includes("SELECT cursor FROM recovery_imports")) {
      const row = this.importRows.get(String(values[0]));
      return row ? { cursor: String(row.cursor) } : null;
    }
    return null;
  }
  all(sql: string, values: unknown[]): Row[] {
    if (sql.includes("FROM recovery_import_receipts") && sql.includes("ORDER BY page_cursor"))
      return [...this.receipts.entries()]
        .filter(([key]) => key.startsWith(`${values[0]}:`))
        .map(([, receipt]) => ({ page_cursor: receipt.page_cursor, next_cursor: receipt.next_cursor }));
    if (sql.includes("FROM recovery_outputs WHERE recovery_address")) {
      const [address, limit, offset] = values as [string, number, number];
      return this.outputs
        .filter(
          (row) =>
            row.recovery_address === address &&
            row.classification === "recoverable" &&
            (!sql.includes("AND NOT EXISTS (SELECT 1 FROM recovery_protected_transactions") ||
              !this.protectedTxids.has(String(row.txid))),
        )
        .sort((a, b) => Number(b.value_sats) - Number(a.value_sats) || String(a.txid).localeCompare(String(b.txid)))
        .slice(offset, offset + limit);
    }
    return [];
  }
  run(sql: string, values: unknown[] = []) {
    if (sql.includes("recovery_state") && sql.includes("read_ready")) this.readReady = true;
    if (sql.includes("recovery_state") && sql.includes("stamp_protection_ready")) this.stampProtectionReady = true;
    if (sql.includes("INSERT INTO recovery_imports")) {
      const [id, cursor] = values as [string, number];
      if (!this.importRows.has(id)) this.importRows.set(id, { cursor, rowsSeen: 0, completed: false });
    }
    if (sql.includes("INSERT INTO recovery_import_receipts")) {
      const [id, pageCursor, nextCursor, rowsSeen, rowsWritten] = values as [
        string,
        number,
        number | null,
        number,
        number,
      ];
      const key = `${id}:${pageCursor}`;
      if (!this.receipts.has(key))
        this.receipts.set(key, {
          page_cursor: pageCursor,
          next_cursor: nextCursor,
          rows_seen: rowsSeen,
          rows_written: rowsWritten,
        });
    }
    if (sql.includes("UPDATE recovery_imports SET")) {
      const [cursor, importId, , complete] = values as [string, string, string, number];
      const row = this.importRows.get(importId);
      if (row) {
        row.cursor = Number(cursor);
        row.rowsSeen = [...this.receipts.entries()]
          .filter(([key]) => key.startsWith(`${importId}:`))
          .reduce((sum, [, receipt]) => sum + receipt.rows_seen, 0);
        row.completed ||= complete === 1;
      }
    }
  }
}

class FakeR2 {
  constructor(private readonly objects = new Map<string, string>()) {}
  async get(key: string) {
    const value = this.objects.get(key);
    return value == null ? null : { text: async () => value };
  }
}

function env(db: FakeRecoveryDb, objects?: Map<string, string>): Env {
  return {
    RECOVERY_DB: db,
    RECOVERY_TRANSACTIONS: new FakeR2(objects),
    RECOVERY_FEE_ADDRESSES: "",
    RECOVERY_FEE_PERCENT: "9",
    RECOVERY_FEE_EXEMPTION_SATS: "10000",
  } as unknown as Env;
}

test("all public recovery workflows stay unavailable until the read gate opens", async () => {
  const app = new Hono<{ Bindings: Env }>();
  app.route("/", recoveryRead);
  const bindings = env(new FakeRecoveryDb());

  for (const [path, init] of [
    ["/addresses/anything/recovery", undefined],
    ["/addresses/anything/recoveries", undefined],
    ["/addresses/anything/recoveries", { method: "POST", body: "{}" }],
  ] as const) {
    const response = await app.request(path, init, bindings);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "recovery index is still being verified" });
  }
});

test("finalization refuses absent, incomplete, and unchecked imports before opening reads", async () => {
  const app = new Hono<{ Bindings: Env }>();
  app.route("/", recoveryAdmin);
  const db = new FakeRecoveryDb();
  const bindings = env(db);

  let response = await app.request("/admin/recovery/finalize", { method: "POST" }, bindings);
  assert.equal(response.status, 409);
  assert.equal(db.readReady, false);

  db.imports = [{ completed: true }, { completed: false }];
  db.uncheckedOutputs = 3;
  response = await app.request("/admin/recovery/finalize", { method: "POST" }, bindings);
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    error: "recovery index is not ready",
    total_imports: 2,
    completed_imports: 1,
    unchecked_outputs: 3,
    failed_transactions: 0,
    stamp_protection_ready: false,
  });
  assert.equal(db.readReady, false);
});

test("finalization opens reads only after every import and output is complete", async () => {
  const app = new Hono<{ Bindings: Env }>();
  app.route("/", recoveryAdmin);
  const db = new FakeRecoveryDb();
  db.imports = [{ completed: true }, { completed: true }];
  db.stampProtectionReady = true;

  const response = await app.request("/admin/recovery/finalize", { method: "POST" }, env(db));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, read_ready: true });
  assert.equal(db.readReady, true);
});

test("replaying an identical terminal import page reuses its receipt without inflating progress", async () => {
  const app = new Hono<{ Bindings: Env }>();
  app.route("/", recoveryAdmin);
  const db = new FakeRecoveryDb();
  const bindings = env(db);
  const request = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ import_id: "bootstrap", cursor: 0, next_cursor: null, transactions: [] }),
  };

  let response = await app.request("/admin/recovery/import", request, bindings);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    upserted: 0,
    replayed: false,
    next_cursor: null,
    complete: true,
  });

  response = await app.request("/admin/recovery/import", request, bindings);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    upserted: 0,
    replayed: true,
    next_cursor: null,
    complete: true,
  });
  assert.equal(db.receipts.size, 1);
  assert.equal(db.importRows.get("bootstrap")?.rowsSeen, 0);
});

test("recovery output pagination supports direct navigation to the final page", async () => {
  const app = new Hono<{ Bindings: Env }>();
  app.route("/", recoveryRead);
  const db = new FakeRecoveryDb();
  db.readReady = true;
  const address = "1BitcoinEaterAddressDontSendf59kuE";
  db.outputs = Array.from({ length: 5 }, (_, index) => ({
    txid: String(index + 1).padStart(64, "0"),
    vout: index,
    value_sats: 500 - index * 100,
    script_pubkey_hex: "51",
    layout: "historical-1-of-2",
    recovery_key_position: 0,
    classification: "recoverable",
    recovery_address: address,
    block_height: 100 + index,
    verified_at: 1,
  }));
  const objects = new Map(db.outputs.map((row) => [`transactions/${row.txid}.hex`, `raw-${row.txid}`]));

  const response = await app.request(`/addresses/${address}/recovery?page=3&limit=2`, undefined, env(db, objects));
  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    summary: Row;
    outputs: Row[];
    transactions: Row;
    missing_transactions: string[];
  };
  assert.deepEqual(body.summary, {
    total_outputs: 5,
    total_value_sats: 1500,
    pages: 3,
    current_page: 3,
    outputs_on_page: 1,
  });
  assert.equal(body.outputs[0].value_sats, 100);
  assert.equal(Object.keys(body.transactions).length, 1);
  assert.deepEqual(body.missing_transactions, []);
});

test("Stamp transaction outputs are excluded by default and require explicit inclusion", async () => {
  const app = new Hono<{ Bindings: Env }>();
  app.route("/", recoveryRead);
  const db = new FakeRecoveryDb();
  db.readReady = true;
  const address = "1BitcoinEaterAddressDontSendf59kuE";
  const safeTxid = "1".repeat(64);
  const protectedTxid = "2".repeat(64);
  db.outputs = [safeTxid, protectedTxid].map((txid, index) => ({
    txid,
    vout: 0,
    value_sats: (index + 1) * 100,
    script_pubkey_hex: "51",
    layout: "historical-1-of-2",
    recovery_key_position: 0,
    classification: "recoverable",
    recovery_address: address,
    block_height: 100,
    verified_at: 1,
  }));
  db.protectedTxids.add(protectedTxid);
  const bindings = env(db, new Map(db.outputs.map((row) => [`transactions/${row.txid}.hex`, "raw"])));

  let response = await app.request(`/addresses/${address}/recovery`, undefined, bindings);
  let body = (await response.json()) as { summary: Row; protection: Row; outputs: Row[] };
  assert.equal(body.summary.total_outputs, 1);
  assert.deepEqual(
    body.outputs.map((row) => row.txid),
    [safeTxid],
  );
  assert.deepEqual(body.protection, {
    protected_stamp_outputs: 1,
    protected_stamp_value_sats: 200,
    included: false,
  });

  response = await app.request(`/addresses/${address}/recovery?include_protected_stamps=true`, undefined, bindings);
  body = (await response.json()) as { summary: Row; protection: Row; outputs: Row[] };
  assert.equal(body.summary.total_outputs, 2);
  assert.equal(body.protection.included, true);
});
