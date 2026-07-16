import assert from "node:assert/strict";
import { test } from "node:test";
import { FIRST_QUERY_BATCH_SIZE, FIRSTS_CATALOG, queryFirstRecords } from "#api/queries/firsts";

const STATUS_BACKED_FIRSTS = [
  "burn",
  "asset",
  "destruction",
  "send",
  "order",
  "order_match",
  "dispenser",
  "dividend",
  "broadcast",
  "bet",
  "bet_match",
  "rps",
  "rps_match",
  "sweep",
  "cancel",
  "btcpay",
  "non_xcp_order",
  "enhanced_send",
  "mpma",
  "attach",
  "move",
  "detach",
  "locked",
  "divisible",
  "indivisible",
  "one_of_one",
  "reset",
  "transfer",
  "callable",
  "description",
  "json_desc",
  "inscription",
  "easyasset",
  "fairminter",
  "fairmint",
  "pool_deposit",
  "pool_swap",
  "stamp",
  "src20",
  "src721",
  "btns",
  "priced_oracle",
  "sweep_memo",
  "send_memo",
  "description_lock",
  "fairminter_premint",
  "fairminter_commission",
  "fairminter_burn_payment",
  "numeric_one_of_one",
  "subasset_one_of_one",
  "satoshi_nft",
  "tokenless",
  "non_ascii_description",
  "embedded_image",
  "raw_base64_image",
  "jpeg_media",
  "png_media",
  "gif_media",
  "mp4_media",
  "ipfs_media",
  "arweave_media",
  "imgur_media",
  "ordinals_media",
  "svg_media",
  "description_url",
  "pepe_mention",
  "nft_term",
  "nft_name",
  "tokenless_named",
  "issuance_rights_burned",
  "max_int_supply",
  "asset_dividend",
  "free_numeric_subasset",
  "locked_feed",
  "indefinite_order",
  "memo_only_address",
  "sale_1000000_pepecash",
  "cex_deposit",
  "send_to_burn",
  "emblem_deposit",
  "emblem_withdrawal",
];

test("catalog keys are unique and every query satisfies the shared row contract", () => {
  const keys = FIRSTS_CATALOG.map((entry) => entry.key);
  assert.equal(new Set(keys).size, keys.length, "firsts catalog contains a duplicate key");
  for (const entry of FIRSTS_CATALOG) {
    for (const alias of [" b", " t", " ref", " typ", " tx"]) {
      assert.ok(entry.sql.includes(alias), `${entry.key} does not return the ${alias.trim()} alias`);
    }
  }
});

test("catalog execution stays below D1's statement ceiling and preserves order", async () => {
  const batches: unknown[][] = [];
  const db = {
    prepare: (sql: string) => sql,
    batch: async (statements: unknown[]) => {
      batches.push(statements);
      return statements.map((sql) => ({ results: [{ ref: sql }] }));
    },
  } as unknown as D1Database;
  const rows = await queryFirstRecords(db);

  assert.ok(batches.length > 1, "the current catalog should exercise chunking");
  assert.ok(batches.every((batch) => batch.length <= FIRST_QUERY_BATCH_SIZE));
  assert.deepEqual(
    rows.map((row) => row?.ref),
    FIRSTS_CATALOG.map((definition) => definition.sql),
  );
});

test("every first backed by a protocol-status table excludes invalid records", () => {
  const byKey = new Map(FIRSTS_CATALOG.map((entry) => [entry.key, entry.sql]));
  for (const key of STATUS_BACKED_FIRSTS) {
    const sql = byKey.get(key);
    assert.equal(typeof sql, "string", `missing firsts entry ${key}`);
    assert.match(sql!, /status NOT LIKE 'invalid%'/, `${key} does not exclude invalid records`);
  }
});

test("only the literal first transaction displays a transaction hash as its subject", () => {
  for (const entry of FIRSTS_CATALOG) {
    if (entry.key === "transaction") continue;
    assert.equal(/HEX\(.+\) ref,'tx' typ/.test(entry.sql), false, `${entry.key} exposes a hash as its subject`);
  }
});

test("joined dictionary predicates are self-contained inside earliest-block subqueries", () => {
  const numeric = FIRSTS_CATALOG.find((entry) => entry.key === "numeric");
  if (!numeric) throw new Error("numeric first is missing");
  assert.match(numeric.sql, /x\.asset_id IN \(SELECT asset_id FROM asset_dictionary/);
  assert.equal(/WHERE[^)]*asset\.asset GLOB/.test(numeric.sql), false);
});
