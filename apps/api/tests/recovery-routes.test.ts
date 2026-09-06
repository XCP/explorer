import { test } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import type { Env } from "#api/env";
import { recoveryAdmin } from "#api/recovery/admin";
import { deriveRecoveryFeeAddress } from "#api/recovery/fee-address";
import { RECOVERY_MAX_OUTPUTS_PER_PAGE, recoveryRead } from "#api/recovery/read";

type Row = Record<string, unknown>;

interface FeeAddressRow {
  id: number;
  scope: string;
  key_id: string | null;
  derivation_index: number | null;
  derivation_path: string | null;
  address: string | null;
  script_pubkey_hex: string | null;
}

class Statement {
  values: unknown[] = [];
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
    return Promise.resolve({ success: true, meta: { changes: 1 } });
  }
}

class FakeRecoveryDb {
  readReady = false;
  stampProtectionReady = false;
  officialStampProtectionReady = false;
  r2AuditReady = false;
  r2AuditGeneration = 0;
  imports: Array<{ completed: boolean }> = [];
  uncheckedOutputs = 0;
  outputs: Row[] = [];
  pendingAttempts = 0;
  protectedTxids = new Set<string>();
  feeAddresses: FeeAddressRow[] = [];
  attempts: unknown[][] = [];
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
        return { results: this.all(statement.sql, statement.values) };
      }),
    );
  }
  first(sql: string, values: unknown[]): Row | null {
    if (sql.includes("FROM recovery_state")) {
      if (sql.includes("r2_audit_generation")) return { value: String(this.r2AuditGeneration) };
      if (sql.includes("r2_audit_ready")) return this.r2AuditReady ? { value: "1" } : null;
      if (sql.includes("official_stamp_protection_ready"))
        return this.officialStampProtectionReady ? { value: "1" } : null;
      if (sql.includes("stamp_protection_ready")) return this.stampProtectionReady ? { value: "1" } : null;
      return this.readReady ? { value: "1" } : null;
    }
    if (sql.includes("COUNT(*) total_imports") && sql.includes("recovery_imports"))
      return {
        total_imports: this.imports.length,
        completed_imports: this.imports.filter((row) => row.completed).length,
      };
    if (sql.includes("COUNT(*) total") && sql.includes("recovery_imports"))
      return {
        total: this.imports.length,
        completed: this.imports.filter((row) => row.completed).length,
      };
    if (sql.includes("COUNT(*) transactions") && sql.includes("MIN(txid)")) {
      const txids = [...new Set(this.outputs.map((row) => String(row.txid)))].sort();
      return {
        transactions: txids.length,
        first_txid: txids.at(0) ?? null,
        last_txid: txids.at(-1) ?? null,
      };
    }
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
    if (sql.includes("FROM recovery_fee_addresses WHERE scope=?"))
      return (this.feeAddresses.find((row) => row.scope === values[0]) as unknown as Row | undefined) ?? null;
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
    if (sql.includes("FROM recovery_fee_addresses") && sql.includes("script_pubkey_hex IN"))
      return this.feeAddresses.filter((row) => values.includes(row.script_pubkey_hex)) as unknown as Row[];
    if (sql.includes("FROM recovery_outputs WHERE txid=? AND vout=?"))
      return this.outputs
        .filter((row) => row.txid === values[0] && row.vout === values[1])
        .map((row) => ({
          recovery_address: row.recovery_address,
          classification: row.classification,
          value_sats: row.value_sats,
          spent_by_txid: null,
          protected_stamp: this.protectedTxids.has(String(row.txid)) ? 1 : 0,
          pending_txid: null,
        }));
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
    if (sql.includes("INSERT INTO recovery_fee_addresses")) {
      const scope = String(values[0]);
      if (!this.feeAddresses.some((row) => row.scope === scope))
        this.feeAddresses.push({
          id: this.feeAddresses.length + 1,
          scope,
          key_id: null,
          derivation_index: null,
          derivation_path: null,
          address: null,
          script_pubkey_hex: null,
        });
    }
    if (sql.includes("UPDATE recovery_fee_addresses")) {
      const [id, keyId, derivationIndex, path, address, scriptPubkeyHex] = values as [
        number,
        string,
        number,
        string,
        string,
        string,
      ];
      const row = this.feeAddresses.find((candidate) => candidate.id === id && candidate.address === null);
      if (row)
        Object.assign(row, {
          key_id: keyId,
          derivation_index: derivationIndex,
          derivation_path: path,
          address,
          script_pubkey_hex: scriptPubkeyHex,
        });
    }
    if (sql.includes("INSERT INTO recovery_attempts")) this.attempts.push(values);
    if (sql.includes("recovery_state") && sql.includes("read_ready")) this.readReady = sql.includes("'1'");
    if (sql.includes("recovery_state") && sql.includes("r2_audit_ready")) this.r2AuditReady = sql.includes("'1'");
    if (sql.includes("recovery_state") && sql.includes("r2_audit_generation")) this.r2AuditGeneration++;
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
  async put(key: string, value: string) {
    this.objects.set(key, value);
  }
}

function env(db: FakeRecoveryDb, objects?: Map<string, string>, fees: { xpub?: string; addresses?: string } = {}): Env {
  return {
    RECOVERY_DB: db,
    RECOVERY_TRANSACTIONS: new FakeR2(objects),
    RECOVERY_FEE_XPUB: fees.xpub,
    RECOVERY_FEE_ADDRESSES: fees.addresses ?? "",
    RECOVERY_FEE_PERCENT: "9",
    RECOVERY_FEE_EXEMPTION_SATS: "10000",
  } as unknown as Env;
}

// BIP86 test vectors: account 0 of the "abandon … about" mnemonic.
const ACCOUNT_XPUB =
  "xpub6BgBgsespWvERF3LHQu6CnqdvfEvtMcQjYrcRzx53QJjSxarj2afYWcLteoGVky7D3UKDP9QyrLprQ3VCECoY49yfdDEHGCtMMj92pReUsQ";
const EATER = "1BitcoinEaterAddressDontSendf59kuE";
const EATER_SCRIPT = "76a914759d6677091e973b9e9d99f19c68fbf43e3f05f988ac";

function recoverableOutput(txid: string, vout: number, valueSats: number): Row {
  return {
    txid,
    vout,
    value_sats: valueSats,
    script_pubkey_hex: "51",
    layout: "historical-1-of-2",
    recovery_key_position: 0,
    classification: "recoverable",
    recovery_address: EATER,
    block_height: 100,
    verified_at: 1,
  };
}

/** A legacy transaction spending one outpoint, byte-symmetric txids so serialization order is moot. */
function rawRecovery(inputTxid: string, outputs: Array<{ valueSats: number; scriptHex: string }>): string {
  const uint64 = (value: number) => BigInt(value).toString(16).padStart(16, "0").match(/../g)!.reverse().join("");
  const serialized = outputs
    .map(
      (output) =>
        `${uint64(output.valueSats)}${(output.scriptHex.length / 2).toString(16).padStart(2, "0")}${output.scriptHex}`,
    )
    .join("");
  return `0100000001${inputTxid}0000000000ffffffff${outputs.length.toString(16).padStart(2, "0")}${serialized}00000000`;
}

function report(raw: string, fees: { network: number; service: number; output: number }): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      raw_transaction_hex: raw,
      network_fee_sats: fees.network,
      service_fee_sats: fees.service,
      output_value_sats: fees.output,
    }),
  };
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

test("R2 audit acceptance is bound to the completed import manifest", async () => {
  const app = new Hono<{ Bindings: Env }>();
  app.route("/", recoveryAdmin);
  const db = new FakeRecoveryDb();
  const first = "11".repeat(32);
  const last = "22".repeat(32);
  db.imports = [{ completed: true }];
  db.outputs = [{ txid: first }, { txid: last }, { txid: last }];
  const manifest = {
    transactions: 2,
    first_txid: first,
    last_txid: last,
    total_imports: 1,
    completed_imports: 1,
    imports_complete: true,
    generation: 0,
  };

  let response = await app.request(
    "/admin/recovery/audit/transactions/accept",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ manifest, checked: 2, last_cursor: last, missing: 1, corrupt: 0 }),
    },
    env(db),
  );
  assert.equal(response.status, 409);
  assert.equal(db.r2AuditReady, false);

  response = await app.request(
    "/admin/recovery/audit/transactions/accept",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ manifest, checked: 2, last_cursor: last, missing: 0, corrupt: 0 }),
    },
    env(db),
  );
  assert.equal(response.status, 200);
  assert.equal(db.r2AuditReady, true);
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
    // Reported so a client never has to carry its own copy of the batch bound.
    max_outputs_per_page: RECOVERY_MAX_OUTPUTS_PER_PAGE,
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

test("recovery fee addresses derive from the account key once per batch, only when a fee is due", async () => {
  const app = new Hono<{ Bindings: Env }>();
  app.route("/", recoveryRead);
  const db = new FakeRecoveryDb();
  db.readReady = true;
  db.outputs = [recoverableOutput("ab".repeat(32), 0, 100_000), recoverableOutput("cd".repeat(32), 0, 50_000)];
  const objects = new Map(db.outputs.map((row) => [`transactions/${row.txid}.hex`, "raw"]));
  const bindings = env(db, objects, { xpub: ACCOUNT_XPUB });
  const fee = async (query = "") =>
    ((await (await app.request(`/addresses/${EATER}/recovery${query}`, undefined, bindings)).json()) as { fee: Row })
      .fee;

  const first = deriveRecoveryFeeAddress(ACCOUNT_XPUB, 0).address;
  assert.deepEqual(await fee(), { address: first, percent: 9, exemption_sats: 10_000 });
  // A repeat read of the same batch returns the same address without allocating again.
  assert.deepEqual(await fee(), { address: first, percent: 9, exemption_sats: 10_000 });
  assert.equal(db.feeAddresses.length, 1);
  assert.deepEqual(db.feeAddresses[0], {
    id: 1,
    scope: `recovery:${"ab".repeat(32)}:0`,
    key_id: deriveRecoveryFeeAddress(ACCOUNT_XPUB, 0).keyId,
    derivation_index: 0,
    derivation_path: "0/0",
    address: first,
    script_pubkey_hex: deriveRecoveryFeeAddress(ACCOUNT_XPUB, 0).scriptPubKeyHex,
  });

  // A batch starting at a different output is a different batch and gets the next address.
  assert.equal((await fee("?page=2&limit=1")).address, deriveRecoveryFeeAddress(ACCOUNT_XPUB, 1).address);
  assert.equal(db.feeAddresses.length, 2);

  // Below the exemption nothing is owed, so nothing is allocated.
  db.outputs = [recoverableOutput("ef".repeat(32), 0, 5_000)];
  assert.deepEqual(await fee(), { address: null, percent: 0, exemption_sats: 10_000 });
  assert.equal(db.feeAddresses.length, 2);
});

test("an invalid recovery fee key fails loudly instead of quoting no fee address", async () => {
  const app = new Hono<{ Bindings: Env }>();
  app.route("/", recoveryRead);
  const db = new FakeRecoveryDb();
  db.readReady = true;
  db.outputs = [recoverableOutput("ab".repeat(32), 0, 100_000)];
  const bindings = env(db, new Map([[`transactions/${"ab".repeat(32)}.hex`, "raw"]]), { xpub: "xpub-nonsense" });
  const response = await app.request(`/addresses/${EATER}/recovery`, undefined, bindings);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "recovery fee configuration is invalid" });
});

test("the static fee list remains the fallback until the account key is configured", async () => {
  const app = new Hono<{ Bindings: Env }>();
  app.route("/", recoveryRead);
  const db = new FakeRecoveryDb();
  db.readReady = true;
  db.outputs = [recoverableOutput("ab".repeat(32), 0, 100_000)];
  const objects = new Map([[`transactions/${"ab".repeat(32)}.hex`, "raw"]]);
  const legacy = `${EATER},1BoatSLRHtKNngkdXEeobR76b53LETtpyT`;
  const response = await app.request(
    `/addresses/${EATER}/recovery`,
    undefined,
    env(db, objects, { addresses: legacy }),
  );
  const body = (await response.json()) as { fee: { address: string } };
  assert.ok(legacy.split(",").includes(body.fee.address));
  assert.equal(db.feeAddresses.length, 0);
});

test("a reported recovery must pay its service fee to an issued fee address", async () => {
  const app = new Hono<{ Bindings: Env }>();
  app.route("/", recoveryRead);
  const db = new FakeRecoveryDb();
  db.readReady = true;
  const inputTxid = "ab".repeat(32);
  db.outputs = [recoverableOutput(inputTxid, 0, 100_000)];
  const bindings = env(db, new Map([[`transactions/${inputTxid}.hex`, "raw"]]), {
    xpub: ACCOUNT_XPUB,
    addresses: EATER,
  });
  assert.equal((await app.request(`/addresses/${EATER}/recovery`, undefined, bindings)).status, 200);
  const feeScript = db.feeAddresses[0]!.script_pubkey_hex!;
  const post = (raw: string, fees: { network: number; service: number; output: number }) =>
    app.request(`/addresses/${EATER}/recoveries`, report(raw, fees), bindings);

  // The fee output is found by script, its value checked, and its position recorded on the attempt.
  let response = await post(
    rawRecovery(inputTxid, [
      { valueSats: 90_000, scriptHex: "51" },
      { valueSats: 9_000, scriptHex: feeScript },
    ]),
    { network: 1_000, service: 9_000, output: 90_000 },
  );
  assert.equal(response.status, 201, JSON.stringify(await response.clone().json()));
  assert.deepEqual(db.attempts.at(-1)!.slice(1, 7), [EATER, 1_000, 9_000, 90_000, 1, 1]);

  // A claimed fee that the transaction pays somewhere else is not a fee.
  response = await post(
    rawRecovery(inputTxid, [
      { valueSats: 90_000, scriptHex: "51" },
      { valueSats: 9_000, scriptHex: "52" },
    ]),
    { network: 1_000, service: 9_000, output: 90_000 },
  );
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "reported service fee does not pay a recovery fee address" });

  // The fee output's value is the fee; the report cannot understate it.
  response = await post(
    rawRecovery(inputTxid, [
      { valueSats: 90_000, scriptHex: "51" },
      { valueSats: 9_000, scriptHex: feeScript },
    ]),
    { network: 1_000, service: 8_000, output: 91_000 },
  );
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "reported service fee does not match the fee output" });

  // No fee owed, none paid: still fine.
  response = await post(rawRecovery(inputTxid, [{ valueSats: 99_000, scriptHex: "51" }]), {
    network: 1_000,
    service: 0,
    output: 99_000,
  });
  assert.equal(response.status, 201);
  assert.deepEqual(db.attempts.at(-1)!.slice(5, 7), [null, null]);

  // A fee paid to the legacy list is honoured while that list is configured, with no allocation row.
  response = await post(
    rawRecovery(inputTxid, [
      { valueSats: 90_000, scriptHex: "51" },
      { valueSats: 9_000, scriptHex: EATER_SCRIPT },
    ]),
    { network: 1_000, service: 9_000, output: 90_000 },
  );
  assert.equal(response.status, 201);
  assert.deepEqual(db.attempts.at(-1)!.slice(5, 7), [null, 1]);
});
