import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { classifyCoreTx } from "#api/queries/records";

class Statement {
  private value: number | null = null;
  constructor(private readonly db: DatabaseSync, private readonly sql: string) {}
  bind(value: number) { this.value = value; return this; }
  all<T>() { return { results: this.db.prepare(this.sql).all(this.value) as T[] }; }
}

const tables = [
  "dispenses","sends","dispensers","dispenser_refills","cancels","btcpays","fairminters","fairmints",
  "pool_liquidity","pool_matches","orders","issuances","sweeps","broadcasts","dividends","burns",
  "destructions","bets","rps",
];

test("compact transaction classification uses priority over shared tx_index", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec(tables.map((table) => `CREATE TABLE ${table}(tx_index INTEGER);`).join(""));
  db.exec(`INSERT INTO issuances VALUES(7); INSERT INTO fairmints VALUES(7); INSERT INTO sends VALUES(8);`);
  const binding = {
    prepare: (sql: string) => new Statement(db, sql),
    batch: async <T>(statements: Statement[]) => statements.map((statement) => statement.all<T>()),
  } as unknown as D1Database;
  assert.equal(await classifyCoreTx(binding, 7), "fairmints");
  assert.equal(await classifyCoreTx(binding, 8), "sends");
  assert.equal(await classifyCoreTx(binding, 9), null);
});
