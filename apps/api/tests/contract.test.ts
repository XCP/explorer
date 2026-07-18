/**
 * Live wire-contract checks — assert the DEPLOYED read API's JSON still matches the @xcp/shared DTOs.
 *
 * HERMETIC BY DEFAULT: every test skips unless process.env.LIVE_API is set, so `npm test -w xcp-api`
 * (and CI) never touches the network. Run the live checks with either:
 *     npm run test:contract -w xcp-api      (sets LIVE_API for you via tests/contract-runner.mjs)
 *     LIVE_API=1 npm test -w xcp-api         (POSIX shells; runs the whole suite incl. these)
 * Point at a different origin by setting LIVE_API to a full URL (LIVE_API=http://127.0.0.1:8787).
 *
 * Each spec below is HAND-WRITTEN from the DTO file it names, so a drift in EITHER direction fails: an API
 * field that vanishes/changes type trips assertShape; a DTO field the API stops sending trips the
 * "required but missing" assert. Optional DTO fields carry a trailing "?". A failure here against live is a
 * REAL finding — do not loosen a spec unless the DTO is provably wrong.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

const LIVE = !!process.env.LIVE_API;
const BASE =
  process.env.LIVE_API && process.env.LIVE_API !== "1"
    ? process.env.LIVE_API.replace(/\/$/, "")
    : "https://xcp-api.me-bbe.workers.dev";

/* ---------- generic structural matcher ---------- */
// spec: field -> "string" | "number" | "boolean" | "object" | "array" | "null" | "any", "|"-unioned,
// with a trailing "?" marking the field OPTIONAL (absent is allowed; present must still match).
type Spec = Record<string, string>;
const typeOf = (v: unknown): string => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v);

function assertShape(obj: any, spec: Spec, path = ""): void {
  assert.ok(
    obj && typeof obj === "object" && !Array.isArray(obj),
    `${path || "value"} should be an object, got ${typeOf(obj)}`,
  );
  for (const [field, rawType] of Object.entries(spec)) {
    const optional = rawType.endsWith("?");
    const type = optional ? rawType.slice(0, -1) : rawType;
    const present = field in obj && obj[field] !== undefined;
    if (!present) {
      assert.ok(optional, `${path}${field}: required by the DTO but missing from the API response`);
      continue;
    }
    const allowed = type.split("|");
    if (allowed.includes("any")) continue;
    const actual = typeOf(obj[field]);
    assert.ok(
      allowed.includes(actual),
      `${path}${field}: DTO expects ${type}, API sent ${actual} (${JSON.stringify(obj[field])})`,
    );
  }
}
function assertRows(arr: any, spec: Spec, path: string): void {
  assert.ok(Array.isArray(arr), `${path} should be an array, got ${typeOf(arr)}`);
  arr.forEach((r: any, i: number) => assertShape(r, spec, `${path}[${i}].`));
}

async function getJson(path: string): Promise<any> {
  const res = await fetch(BASE + path, { signal: AbortSignal.timeout(20_000) });
  assert.ok(res.ok, `GET ${path} → HTTP ${res.status}`);
  return (await res.json()) as any;
}
// list envelope: result is an array; next_offset present, and === limit when the page came back full.
function assertListEnvelope(json: any, rowSpec: Spec, limit: number, name: string): void {
  assert.ok(json && typeof json === "object", `${name}: envelope must be an object`);
  assertRows(json.result, rowSpec, `${name}.result`);
  assert.ok("next_offset" in json, `${name}: list envelope must carry next_offset`);
  if (json.result.length === limit) {
    assert.equal(typeof json.next_offset, "number", `${name}: full page → numeric next_offset`);
    assert.equal(json.next_offset, limit, `${name}: next_offset should be offset(0)+limit(${limit})`);
  } else {
    assert.ok(
      json.next_offset === null || typeof json.next_offset === "number",
      `${name}: short page → null or number next_offset`,
    );
  }
}

/* ---------- DTO specs (hand-written from packages/shared/src) ---------- */
const BLOCK_ROW: Spec = {
  block_index: "number",
  block_hash: "string|null",
  block_time: "number|null",
  transaction_count: "number|null",
  bitcoin_transaction_count: "number|null",
};
const ASSET_INDEX_ROW: Spec = {
  asset: "string",
  asset_longname: "string|null",
  type: "string",
  issuer: "string|null",
  owner: "string|null",
  divisible: "number",
  locked: "number",
  supply_normalized: "string|null",
  description: "string|null",
  stamp: "number",
  first_issuance_block_time: "number|null",
  last_issuance_block_index: "number|null",
};
// AssetDetail — the REQUIRED (non-optional) DTO fields; the native XCP/BTC path omits the optional ones.
const ASSET_DETAIL: Spec = {
  asset: "string",
  asset_longname: "string|null",
  type: "string",
  issuer: "string|null",
  owner: "string|null",
  divisible: "number",
  locked: "number",
  description: "string|null",
  supply_normalized: "string|null",
  holder_count: "number",
};
const ASSET_RATING: Spec = {
  status: "string",
  rating: "number|null",
};
const ASSET_ACTIVITY: Spec = {
  active_months: "number",
  last_trade_time: "number|null",
};
const ASSET_ACTIVITY_OUTLOOK: Spec = {
  score: "number",
  rank: "number",
  population: "number",
  horizon_days: "number",
  calculated_at: "number",
};
const ASSET_FEED_COUNTS: Spec = {
  sales: "number",
  issuances: "number",
  dispensers: "number",
  dispenses: "number",
  orders: "number",
  sends: "number",
  subassets: "number",
  from_issuer: "number",
  fairmints: "number",
  dividends: "number",
  destructions: "number",
  pools: "number",
};
const SEND_ROW: Spec = {
  tx_hash: "string",
  block_index: "number",
  block_time: "number|null",
  source: "string|null",
  destination: "string|null",
  asset: "string|null",
  quantity_normalized: "string|null",
  send_type: "string|null",
  status: "string|null",
};
const ORDER_ROW: Spec = {
  tx_hash: "string",
  block_index: "number",
  block_time: "number|null",
  source: "string|null",
  give_asset: "string|null",
  get_asset: "string|null",
  status: "string|null",
  give_quantity_normalized: "number",
  get_quantity_normalized: "number",
  give_remaining_normalized: "number",
  get_remaining_normalized: "number",
  expiration: "number|null",
  expire_index: "number|null",
};
const TRADE_ROW: Spec = {
  venue: "string",
  asset: "string|null",
  block_time: "number|null",
  block_index: "number|null",
  quantity: "number|null",
  currency: "string|null",
  total: "number|null",
  price: "number|null",
  usd_value: "number|null",
  usd_estimate: "number|null",
  usd_estimate_basis: "string|null",
  buyer: "string|null",
  seller: "string|null",
  tx_hash: "string|null",
};
const TRADE_VENUE_STATS: Spec = {
  venue: "string",
  trades: "number",
  assets: "number",
  last_time: "number|null",
  usd_known: "number|null",
};
const EXCHANGE_ROW: Spec = {
  address: "string",
  assets_received: "number",
  in_peers: "number",
  first_block: "number|null",
  last_block: "number|null",
  name: "string",
};
const ADDRESS_SUMMARY: Spec = {
  xcp: "string|null",
  assets: "number",
  issued: "number",
  dispensers: "number",
  open_dispensers: "number",
  open_orders: "number",
  first_block: "number|null",
  last_block: "number|null",
  dispenser_trust: "number|null",
};
const ADDRESS_REPUTATION: Spec = {
  track_record: "object",
  activity: "object|null",
  tags: "array",
  evidence: "object|null",
  raw: "number?",
  breakdown: "object?",
};
const MEMPOOL_ACTION: Spec = {
  tx_hash: "string|null",
  event: "string",
  source: "string|null",
  destination: "string|null",
  asset: "string|null",
  asset_longname: "string|null",
  quantity_normalized: "string|null",
  dispenser_tx_hash: "string|null",
  timestamp: "number|null",
};
const REP_EVIDENCE: Spec = {
  first_block: "number",
  last_block: "number",
  span_years: "number",
  survived_assets: "number",
  assets_distributed: "number",
  assets_hits: "number",
  dividends: "number",
  dispense_btc: "number",
  btc_fees: "number",
  btc_spent: "number",
  inbound_peers: "number",
  assets_held: "number",
  xcp: "number",
  assets_burned: "number",
  stamps_created: "number",
  stamps_collected: "number",
  src20_deploys: "number",
  btns_user: "boolean",
};

const ADDR = "1GQhaWqejcGJ4GhQar7SjcCfadxvf5DNBD";
const skipUnlessLive = (t: { skip(m?: string): void }) => {
  if (!LIVE) {
    t.skip("set LIVE_API to run the live wire-contract checks");
    return true;
  }
  return false;
};

/* ---------- the ~12 representative endpoints ---------- */

test("contract: GET /v2/ — StatsOverview envelope", async (t) => {
  if (skipUnlessLive(t)) return;
  const j = await getJson("/v2/");
  assertShape(
    j.result,
    { tip: "number|null", assets: "number", transactions: "number", balances: "number", indexed_block: "string|null" },
    "home.result.",
  );
});

test("contract: GET /v2/status - cheap SyncOverview heartbeat", async (t) => {
  if (skipUnlessLive(t)) return;
  const j = await getJson("/v2/status");
  assertShape(
    j.result,
    { tip: "number|null", indexed_block: "string|null", lag_blocks: "number", synced: "boolean" },
    "status.result.",
  );
  assert.ok(!("assets" in j.result), "status must not grow global COUNT(*) fields");
  assert.ok(!("transactions" in j.result), "status must not grow global COUNT(*) fields");
  assert.ok(!("balances" in j.result), "status must not grow global COUNT(*) fields");
});

test("contract: stats exposes one canonical all-chain payload", async (t) => {
  if (skipUnlessLive(t)) return;
  const contract = Date.now();
  const [stats, metrics] = await Promise.all([
    getJson(`/v2/stats?contract=${contract}`),
    getJson(`/v2/metrics?days=90&contract=${contract}`),
  ]);
  for (const field of ["assets", "transactions", "addresses", "sends", "btc_fees", "xcp_destroyed"])
    assert.equal(typeof stats.result[field], "number", `stats.${field} must be numeric`);
  assert.equal(typeof stats.result.btc_fees_complete, "boolean");

  for (const field of [
    "transactions",
    "bitcoin_transactions",
    "xcp_share",
    "issuances",
    "trades",
    "dispenses",
    "sends",
    "btc_fees",
    "xcp_burned",
  ]) {
    assert.ok(Array.isArray(metrics.result[field]), `metrics.${field} must be an array`);
    const total = (rows: Array<{ v: number }>) => rows.reduce((sum, row) => sum + row.v, 0);
    assert.ok(Number.isFinite(total(metrics.result[field])), `metrics.${field} total must be finite`);
  }
});

test("contract: GET /v2/blocks?limit=2 — BlockRow list", async (t) => {
  if (skipUnlessLive(t)) return;
  assertListEnvelope(await getJson("/v2/blocks?limit=2"), BLOCK_ROW, 2, "blocks");
});

test("contract: GET /v2/firsts — normalized historical catalog", async (t) => {
  if (skipUnlessLive(t)) return;
  const j = await getJson(`/v2/firsts?contract=${Date.now()}`);
  assert.ok(Array.isArray(j.result) && j.result.length >= 37, "firsts must contain the historical catalog");
  const keys = new Set(j.result.map((row: { key?: string }) => row.key));
  for (const key of [
    "bet_match",
    "rps",
    "rps_match",
    "enhanced_send",
    "dispenser_refill",
    "mpma",
    "attach",
    "move",
    "detach",
    "pool_deposit",
    "pool_swap",
    "priced_oracle",
    "send_memo",
    "sweep_memo",
    "oracle_dispenser",
    "description_lock",
    "fairminter_premint",
    "fairminter_commission",
    "fairminter_burn_payment",
    "inscription",
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
    "numeric",
    "asset_dividend",
    "multisig_address",
    "p2sh_address",
    "segwit_address",
    "taproot_address",
    "free_numeric_subasset",
    "locked_feed",
    "bundled_dispense",
    "indefinite_order",
    "sale_1000_xcp",
    "sale_10000_xcp",
    "sale_1_btc",
    "sale_10_btc",
    "sale_1000000_pepecash",
    "memo_only_address",
    "cex_deposit",
    "send_to_burn",
    "emblem_deposit",
    "emblem_withdrawal",
    "emblem_sale",
  ]) {
    assert.ok(keys.has(key), `firsts catalog is missing ${key}`);
  }
  assert.equal(keys.has("mime"), false, "migration-defaulted MIME values are not historical milestones");
  for (let index = 1; index < j.result.length; index += 1) {
    const previous = j.result[index - 1] as { date: string; block: number };
    const current = j.result[index] as { date: string; block: number };
    assert.ok(
      previous.date < current.date || (previous.date === current.date && previous.block <= current.block),
      `firsts must be ordered by date then block (${previous.date}/${previous.block} before ${current.date}/${current.block})`,
    );
  }
  const oneBtc = j.result.find((row: { key?: string }) => row.key === "sale_1_btc");
  assert.equal(oneBtc?.ref, "MPBTC", "the BTC threshold must use executed unit price, not total trade volume");
  assert.equal(oneBtc?.block, 290948);
  const stamp = j.result.find((row: { key?: string }) => row.key === "stamp");
  assert.deepEqual(
    stamp,
    {
      key: "stamp",
      label: "First Bitcoin Stamp",
      block: 779652,
      date: "2023-03-07",
      ref: "A7337447728884561000",
      type: "asset",
      tx: "17686488353b65b128d19031240478ba50f1387d0ea7e5f188ea7fda78ea06f4",
    },
    "the curated Stamp genesis must remain stable",
  );
  for (const row of j.result as Array<{ key: string; type: string; tx: string; tx_url?: string }>) {
    if (row.tx_url) {
      assert.match(row.tx, /^0x[0-9a-f]{64}$/, `${row.key} must expose its external causal transaction`);
      assert.equal(row.tx_url, `https://etherscan.io/tx/${row.tx}`, `${row.key} external transaction URL drifted`);
    } else assert.match(row.tx, /^[0-9a-f]{64}$/, `${row.key} must link to its causal transaction`);
    if (row.key !== "transaction") assert.notEqual(row.type, "tx", `${row.key} must display a meaningful subject`);
  }
});

test("contract: GET /v2/collections/candidates — compact discovery projection", async (t) => {
  if (skipUnlessLive(t)) return;
  const j = await getJson(`/v2/collections/candidates?contract=${Date.now()}`);
  assert.ok(Array.isArray(j.result?.candidates) && j.result.candidates.length > 0, "candidates must not be empty");
  assert.ok(Array.isArray(j.result.candidates[0].samples), "candidate samples must be an array");
});

test("contract: GET /v2/collections — descriptive collection profiles", async (t) => {
  if (skipUnlessLive(t)) return;
  const result = (await getJson(`/v2/collections?contract=${Date.now()}`)).result;
  assertRows(
    result,
    {
      tag: "string",
      name: "string",
      members: "number",
      rated_members: "number",
      rated_pct: "number",
      median_rating: "number|null",
      rating_exceptional: "number",
      rating_strong: "number",
      rating_developing: "number",
      rating_limited: "number",
      market_pct: "number",
      total_active_months: "number",
      total_paid_buyers: "number",
      issuers: "number",
      total_realized_usd: "number",
      holder_relationships: "number",
      unique_holders: "number",
      holder_overlap_pct: "number|null",
      top_asset_value_pct: "number|null",
      integrity_assets: "number",
      integrity_pct: "number",
    },
    "collections.result",
  );
  assert.ok(result.length > 0, "collection profiles must not be empty");
  for (const row of result) {
    assert.equal(
      row.rating_exceptional + row.rating_strong + row.rating_developing + row.rating_limited,
      row.rated_members,
      `${row.tag} Rating distribution must reconcile`,
    );
    assert.ok(row.rated_members <= row.members, `${row.tag} cannot rate more members than it contains`);
    assert.ok(row.unique_holders <= row.holder_relationships, `${row.tag} holder overlap must reconcile`);
  }
});

test("contract: GET /v2/assets/RAREPEPE/related — compact holder overlap", async (t) => {
  if (skipUnlessLive(t)) return;
  const j = await getJson(`/v2/assets/RAREPEPE/related?contract=${Date.now()}`);
  assert.ok(Array.isArray(j.result?.collection) && j.result.collection.length > 0, "collection overlap is required");
  assert.ok(Array.isArray(j.result?.cohort) && j.result.cohort.length > 0, "holder cohort is required");
  assert.equal(j.result.collection[0].asset, "PEPECASH", "Rare Pepe's strongest collection overlap changed");
  assert.equal(j.result.cohort[0].asset, "A363989999577646312", "Rare Pepe's strongest cohort overlap changed");
});

test("contract: GET /v2/assets?limit=2 — AssetIndexRow list", async (t) => {
  if (skipUnlessLive(t)) return;
  assertListEnvelope(await getJson("/v2/assets?limit=2"), ASSET_INDEX_ROW, 2, "assets");
});

test("contract: GET /v2/featured - compact Rating ranking with media", async (t) => {
  if (skipUnlessLive(t)) return;
  const result = (await getJson("/v2/featured?limit=12")).result;
  assertRows(result, { asset: "string", asset_longname: "string|null", rating: "number" }, "featured.result");
  assert.equal(result.length, 12, "featured should fill the requested page");
  assert.equal(
    new Set(result.map((row: { asset: string }) => row.asset)).size,
    result.length,
    "featured assets must be unique",
  );
  for (let index = 1; index < result.length; index += 1)
    assert.ok(result[index - 1].rating >= result[index].rating, "featured assets must remain Rating-sorted");
});

test("contract: GET /v2/assets/RAREPEPE — AssetDetail + Rating", async (t) => {
  if (skipUnlessLive(t)) return;
  const j = await getJson("/v2/assets/RAREPEPE");
  assertShape(j.result, ASSET_DETAIL, "RAREPEPE.");
  if (j.result.rating) assertShape(j.result.rating, ASSET_RATING, "RAREPEPE.rating.");
  if (j.result.activity) assertShape(j.result.activity, ASSET_ACTIVITY, "RAREPEPE.activity.");
  if (j.result.activity_outlook)
    assertShape(j.result.activity_outlook, ASSET_ACTIVITY_OUTLOOK, "RAREPEPE.activity_outlook.");
  assert.ok(!("tags" in j.result) || Array.isArray(j.result.tags), "RAREPEPE.tags must be an array when present");
});

test("contract: GET /v2/assets/RAREPEPE/quality — compact quality signals", async (t) => {
  if (skipUnlessLive(t)) return;
  const j = await getJson("/v2/assets/RAREPEPE/quality");
  assertShape(
    j.result,
    { holders: "number", trades: "number", low_quality: "number", wash_suspect: "boolean" },
    "quality.",
  );
  assert.ok(j.result.holders > 0, "RAREPEPE should have holders");
});

test("contract: GET /v2/assets/RAREPEPE/holder-makeup - compact holder accounting", async (t) => {
  if (skipUnlessLive(t)) return;
  const result = (await getJson("/v2/assets/RAREPEPE/holder-makeup")).result;
  assertShape(
    result,
    { asset: "string", holders: "number", tiers: "array", archetypes: "object", top_holder_pct: "number|null" },
    "holder-makeup.",
  );
  assertRows(result.tiers, { tier: "string", holders: "number", pct_supply: "number" }, "holder-makeup.tiers");
  assertShape(result.archetypes, { creators: "number", collectors: "number", whales: "number" }, "archetypes.");
  assert.equal(result.holders, 208, "RAREPEPE holder population changed");
  assert.equal(
    result.tiers.reduce((sum: number, row: { holders: number }) => sum + row.holders, 0),
    result.holders,
    "tier buckets must account for every holder exactly once",
  );
});

test("contract: GET /v2/assets/RAREPEPE/activity — compact monthly history", async (t) => {
  if (skipUnlessLive(t)) return;
  const j = await getJson("/v2/assets/RAREPEPE/activity");
  assert.ok(Array.isArray(j.result) && j.result.length >= 114, "RAREPEPE activity history is incomplete");
  assert.deepEqual(j.result[0], { month: "2016-09", orders: 232, dispensers: 0, sends: 17, supply: 6 });
});

test("contract: GET /v2/assets/RAREPEPE/active-users — compact ledger ranking", async (t) => {
  if (skipUnlessLive(t)) return;
  const j = await getJson("/v2/assets/RAREPEPE/active-users?limit=15");
  assert.ok(Array.isArray(j.result) && j.result.length === 15, "active-user ranking is incomplete");
  assert.deepEqual(j.result[0], {
    address: "17sn9SqZFtWEdyBKsiVoxpWS3nD2nw5k1r",
    credits: 37,
    debits: 60,
    activity: 97,
  });
});

test("contract: GET /v2/assets/XCP — AssetDetail native reduced path", async (t) => {
  if (skipUnlessLive(t)) return;
  // Native assets cache for five minutes; bust that cache so a post-deploy contract run validates the
  // version just uploaded instead of accepting the previous worker's response shape.
  const j = await getJson(`/v2/assets/XCP?contract=${Date.now()}`);
  assertShape(j.result, ASSET_DETAIL, "XCP.");
  assert.equal(j.result.type, "native", "XCP must report type=native");
  assertShape(j.result.feed_counts, ASSET_FEED_COUNTS, "XCP.feed_counts.");
  assertShape(j.result.rating, ASSET_RATING, "XCP.rating.");
  assert.equal(j.result.rating.status, "rated", "XCP must use the canonical Rating projection");
  assertShape(
    j.result.sales,
    {
      realized_usd: "number|null",
      last_price_usd: "number|null",
      last_sale_time: "number|null",
      current_price_estimate_usd: "number|null",
      current_price_estimate_time: "number|null",
    },
    "XCP.sales.",
  );
  assert.ok(j.result.sales.realized_usd > 0, "XCP must expose its historical market volume");
  assert.ok(j.result.feed_counts.sends > 0, "XCP should earn its Sends tab");
  assert.ok(j.result.feed_counts.orders > 0, "XCP should earn its Orders tab");
});

test("contract: GET /v2/sends?limit=2 — SendRow list", async (t) => {
  if (skipUnlessLive(t)) return;
  assertListEnvelope(await getJson("/v2/sends?limit=2"), SEND_ROW, 2, "sends");
});

test("contract: GET /v2/orders?limit=2 — OrderRow list (normalized give/get are REAL numbers)", async (t) => {
  if (skipUnlessLive(t)) return;
  assertListEnvelope(await getJson("/v2/orders?limit=2"), ORDER_ROW, 2, "orders");
});

test("contract: GET /v2/trades?limit=2 — TradeRow list", async (t) => {
  if (skipUnlessLive(t)) return;
  assertListEnvelope(await getJson("/v2/trades?limit=2"), TRADE_ROW, 2, "trades");
});

test("contract: GET /v2/trades/stats — TradeVenueStats[]", async (t) => {
  if (skipUnlessLive(t)) return;
  const j = await getJson("/v2/trades/stats");
  assertRows(j.result, TRADE_VENUE_STATS, "trades/stats.result");
});

test("contract: GET /v2/exchanges — ExchangesPayload", async (t) => {
  if (skipUnlessLive(t)) return;
  const j = await getJson("/v2/exchanges");
  const p = j.result;
  assert.ok(p && typeof p === "object", "exchanges.result must be an object");
  if (p.summary !== null)
    assertShape(p.summary, { exchanges: "number", deposit_addresses: "number" }, "exchanges.summary.");
  assertRows(p.exchanges, EXCHANGE_ROW, "exchanges.exchanges");
  assertRows(
    p.top_assets,
    { asset: "string", asset_longname: "string|null", depositors: "number" },
    "exchanges.top_assets",
  );
});

test("contract: GET /v2/vaults — VaultsPayload", async (t) => {
  if (skipUnlessLive(t)) return;
  const p = (await getJson("/v2/vaults")).result;
  assert.ok(p && typeof p === "object", "vaults.result must be an object");
  if (p.summary !== null) {
    assertShape(
      p.summary,
      {
        total_vaults: "number",
        counterparty_vaults: "number",
        foreign_vaults: "number",
        funded_vaults: "number",
        scam_shells: "number",
        sales: "number",
        realized_usd: "number",
      },
      "vaults.summary.",
    );
  }
  assertRows(p.top_assets, { asset: "string", asset_longname: "string|null", vaults: "number" }, "vaults.top_assets");
  assertRows(p.top_funders, { address: "string", vaults: "number" }, "vaults.top_funders");
  assertRows(p.top_crackers, { address: "string", vaults: "number" }, "vaults.top_crackers");
  assertRows(p.sales_activity, { t: "number", v: "number" }, "vaults.sales_activity");
});

test("contract: GET /v2/emblem/stats - compact EmblemStats projection", async (t) => {
  if (skipUnlessLive(t)) return;
  assertShape(
    (await getJson("/v2/emblem/stats")).result,
    {
      vaults: "number",
      funded: "number",
      cracked_to_user: "number",
      revaulted: "number",
      depositors: "number",
      all_holders: "number",
      real_users: "number",
      empty: "number",
    },
    "emblem/stats.result.",
  );
});

test("contract: GET /v2/emblem/assets?limit=2 - EmblemAssetRow list", async (t) => {
  if (skipUnlessLive(t)) return;
  assertListEnvelope(
    await getJson("/v2/emblem/assets?limit=2"),
    { asset: "string", vaults: "number" },
    2,
    "emblem/assets",
  );
});

test("contract: GET /v2/emblem/vaults?limit=2 - EmblemVaultRow list", async (t) => {
  if (skipUnlessLive(t)) return;
  assertListEnvelope(
    await getJson("/v2/emblem/vaults?limit=2"),
    { token_id: "string", contract: "string|null", btc_address: "string|null", held_assets: "number" },
    2,
    "emblem/vaults",
  );
});

test("contract: GET /v2/radar - established and available conviction rankings", async (t) => {
  if (skipUnlessLive(t)) return;
  const result = (await getJson("/v2/radar")).result;
  const asset = {
    asset: "string",
    asset_longname: "string|null",
    conviction: "number",
    market_usd: "number",
    holders: "number",
    supply: "number",
    holder_dex: "number",
    creator_pct: "number",
  };
  assert.ok(Array.isArray(result.established) && result.established.length > 0, "radar established rows required");
  assert.ok(Array.isArray(result.available) && result.available.length > 0, "radar available rows required");
  assertRows(result.established, asset, "radar.established");
  assertRows(
    result.available,
    {
      ...asset,
      venue: "string",
      ask_usd: "number",
      ask_btc: "number|null",
      marketplace: "string|null",
      listing_url: "string|null",
    },
    "radar.available",
  );
});

test("contract: GET /v2/radar/emergence - evidence-backed Fresh and Emerging assets", async (t) => {
  if (skipUnlessLive(t)) return;
  const result = (await getJson("/v2/radar/emergence")).result;
  assertShape(result, {
    model: "string",
    observed_at: "number",
    fresh: "array",
    emerging: "array",
  });
  assert.equal(result.model, "new-radar-2026-07");
  const evidence = {
    asset: "string",
    asset_longname: "string|null",
    issued_at: "number",
    observation_cutoff: "number",
    evidence_updated_at: "number",
    age_days: "number",
    trades: "number",
    buyers: "number",
    sellers: "number",
    active_days: "number",
    late_buyers: "number",
    late_active_days: "number",
    market_span_days: "number",
    venues: "number",
    fairmints: "number",
    minters: "number",
    paid_minters: "number",
    mint_active_days: "number",
    late_minters: "number",
    holders: "number",
    supply: "number",
    top1_pct: "number",
    reason: "string",
  };
  assertRows(result.fresh, evidence, "radar.emergence.fresh");
  assert.ok(result.emerging.length > 0, "emerging rows required");
  assertRows(result.emerging, { ...evidence, market_formation: "number" }, "radar.emergence.emerging");
});

test("contract: GET /v2/ratings - canonical Rating distribution", async (t) => {
  if (skipUnlessLive(t)) return;
  const result = (await getJson("/v2/ratings")).result;
  assertShape(result, {
    model_version: "number",
    calculated_at: "number",
    population: "number",
    distribution: "array",
    examples: "array",
  });
  assert.ok(result.population > 20_000, "Rating population is incomplete");
  assertRows(result.distribution, { rating: "number", count: "number" }, "ratings.distribution");
  assertRows(
    result.examples,
    { asset: "string", asset_longname: "string|null", rating: "number", rank: "number" },
    "ratings.examples",
  );
});

test("contract: GET /v2/leaderboards - all compact signal boards populated", async (t) => {
  if (skipUnlessLive(t)) return;
  const result = (await getJson(`/v2/leaderboards?contract=${Date.now()}`)).result;
  const boards = [
    "top_creators",
    "top_collectors",
    "top_merchants",
    "biggest_spenders",
    "richest_xcp",
    "most_held",
    "most_traded",
    "most_durable",
    "top_dispensed",
    "top_dispensers",
    "top_hits",
    "broadest_holders",
    "most_creator_held",
    "top_stamp_creators",
    "top_stamp_collectors",
    "top_src20_deployers",
    "most_held_stamps",
    "top_reputation",
    "top_rated",
  ];
  for (const board of boards)
    assert.equal(result[board]?.length, 12, `${board} must contain a full compact leaderboard`);
  assert.equal(result.most_held[0].asset, "XCP", "most-held leader changed");
  assert.ok(result.top_rated[0].rating <= 10 && result.top_rated[0].rating >= 0, "Rating leader is invalid");
  assert.equal(result.include_hidden, false, "default leaderboards must hide low-quality assets");
});

test("contract: GET /v2/mempool — MempoolActionRow envelope (may be empty)", async (t) => {
  if (skipUnlessLive(t)) return;
  const j = await getJson("/v2/mempool");
  // Mempool can legitimately be empty; assert the envelope always, per-row shape only when rows exist.
  assert.ok(j && typeof j === "object" && Array.isArray(j.result), "mempool.result must be an array");
  assertRows(j.result, MEMPOOL_ACTION, "mempool.result");
});

test("contract: GET /v2/addresses/:a/summary — AddressSummary", async (t) => {
  if (skipUnlessLive(t)) return;
  const j = await getJson(`/v2/addresses/${ADDR}/summary`);
  assertShape(j.result, ADDRESS_SUMMARY, "summary.");
});

test("contract: GET /v2/addresses/:a/reputation — AddressReputation + evidence", async (t) => {
  if (skipUnlessLive(t)) return;
  const j = await getJson(`/v2/addresses/${ADDR}/reputation`);
  assertShape(j.result, ADDRESS_REPUTATION, "reputation.");
  assertShape(j.result.track_record, { score: "number|null", tier: "string", meaning: "string|null" }, "track_record.");
  if (j.result.activity !== null)
    assertShape(j.result.activity, { last_active_at: "number", days_since_active: "number" }, "activity.");
  if (j.result.evidence !== null) assertShape(j.result.evidence, REP_EVIDENCE, "reputation.evidence.");
  assert.ok(Array.isArray(j.result.tags), "reputation.tags must be an array");
});

test("contract: asset graph reports bounded holder-network evidence", async (t) => {
  if (skipUnlessLive(t)) return;
  const result = (await getJson("/v2/graph/asset/RAREPEPE?limit=10")).result;
  assertShape(result, { center: "string", scope: "string", nodes: "array", edges: "array", stats: "object" }, "graph.");
  assert.equal(result.scope, "asset-holders");
  assert.ok(result.nodes.length <= 11, "asset graph exceeded its requested holder budget");
  assertShape(
    result.stats,
    { total: "number", edges_among: "number", cohesion: "number", strong_edges: "number" },
    "graph.stats.",
  );
});
