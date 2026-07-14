import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { extensionApi } from "#api/extension-api";
import type { Env } from "#api/env";

class Statement {
  private values: unknown[] = [];
  constructor(
    private readonly database: DatabaseSync,
    private readonly sql: string,
  ) {}
  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }
  async first<T>() {
    return (this.database.prepare(this.sql).get(...this.values) as T | undefined) ?? null;
  }
  async all<T>() {
    return { results: this.database.prepare(this.sql).all(...this.values) as T[] };
  }
}

function coreDatabase(): D1Database {
  const database = new DatabaseSync(":memory:");
  for (const migration of readdirSync("migrations-core")
    .filter((name) => name.endsWith(".sql"))
    .sort())
    database.exec(readFileSync(`migrations-core/${migration}`, "utf8"));
  database.exec(`
    INSERT INTO address_dictionary(address) VALUES('issuer'),('owner');
    INSERT INTO asset_dictionary(asset) VALUES('CARD');
    INSERT INTO assets(
      asset_id,type,issuer_id,owner_id,description,divisible,locked,supply_normalized,
      first_issuance_block_time,asset_longname,mime_type
    ) VALUES(
      (SELECT asset_id FROM asset_dictionary WHERE asset='CARD'),'asset',
      (SELECT address_id FROM address_dictionary WHERE address='issuer'),
      (SELECT address_id FROM address_dictionary WHERE address='owner'),
      'A card',0,1,'100',123,'PARENT.CARD','image/png'
    );
  `);
  return { prepare: (sql: string) => new Statement(database, sql) } as unknown as D1Database;
}

test("extension asset routes preserve their public shape over compact identities", async () => {
  const env = { CORE_DB: coreDatabase() } as Env;
  const search = await extensionApi.request("http://test/api/v1/search?query=CAR", {}, env);
  assert.equal(search.status, 200);
  assert.deepEqual((await search.json<{ assets: unknown[] }>()).assets, [
    {
      asset: "CARD",
      symbol: "CARD",
      description: "A card",
      issuer: "issuer",
      owner: "owner",
      issued: 100,
      burned: 0,
      supply: 100,
      locked: 1,
      low_quality: 0,
      first_issued_at: 123,
    },
  ]);

  const detail = await extensionApi.request("http://test/api/v1/asset/PARENT.CARD", {}, env);
  assert.equal(detail.status, 200);
  const body = await detail.json<{ data: Record<string, unknown> }>();
  assert.equal(body.data.asset, "CARD");
  assert.equal(body.data.asset_longname, "PARENT.CARD");
  assert.equal(body.data.mime_type, "image/png");
});
