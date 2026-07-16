import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { listEmergingAssets } from "#api/queries/asset-emergence";

const migrations = readdirSync("migrations-core")
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => readFileSync(`migrations-core/${name}`, "utf8"));

class Statement {
  private values: unknown[] = [];
  constructor(
    private readonly db: DatabaseSync,
    private readonly sql: string,
  ) {}
  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }
  async all<T>() {
    return { results: this.db.prepare(this.sql).all(...this.values) as T[] };
  }
}

const d1 = (db: DatabaseSync) => ({ prepare: (sql: string) => new Statement(db, sql) }) as unknown as D1Database;
const DAY = 86_400;

test("emerging assets use cohort percentiles, eligibility rules, and deterministic ties", async () => {
  const db = new DatabaseSync(":memory:");
  for (const migration of migrations) db.exec(migration);
  const now = 200 * DAY;
  const assets = [
    ["LEADER", 40, 8, 5, 0, 100],
    ["TIEA", 40, 2, 2, 0, 100],
    ["TIEB", 40, 2, 2, 0, 100],
    ["LOWQUALITY", 40, 20, 10, 1, 100],
    ["ZEROSUPPLY", 40, 20, 10, 0, 0],
    ["GRADUATED", 90, 20, 10, 0, 100],
    ["FRESH", 20, 20, 10, 0, 100],
  ] as const;
  for (const [asset, age, buyers, days, lowQuality, supply] of assets) {
    db.prepare("INSERT INTO asset_dictionary(asset) VALUES(?)").run(asset);
    const id = Number(db.prepare("SELECT asset_id FROM asset_dictionary WHERE asset=?").get(asset)?.asset_id);
    const issuedAt = now - age * DAY;
    db.prepare(
      "INSERT INTO assets(asset_id,type,first_issuance_block_time,supply_normalized) VALUES(?,'asset',?,?)",
    ).run(id, issuedAt, String(supply));
    db.prepare(`INSERT INTO asset_signals(asset_id,holders,supply,low_quality) VALUES(?,?,?,?)`).run(
      id,
      buyers,
      supply,
      lowQuality,
    );
    db.prepare(
      `INSERT INTO asset_emergence(asset_id,issued_at,observation_cutoff,observed_through,finalized,
      trades,buyers,sellers,active_days,late_buyers,late_active_days,market_span_days,venues,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      id,
      issuedAt,
      issuedAt + 30 * DAY,
      issuedAt + 30 * DAY,
      age >= 30 ? 1 : 0,
      buyers,
      buyers,
      1,
      days,
      1,
      1,
      days,
      1,
      now,
    );
  }

  const rows = await listEmergingAssets(d1(db), now);
  assert.deepEqual(
    rows.map(({ asset, market_formation }) => [asset, market_formation]),
    [
      ["LEADER", 100],
      ["TIEA", 0],
      ["TIEB", 0],
    ],
  );
  db.close();
});
