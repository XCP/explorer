/**
 * Live wire-contract checks — assert the DEPLOYED read API's JSON still matches the @xcp/shared DTOs.
 *
 * HERMETIC BY DEFAULT: every test skips unless process.env.LIVE_API is set, so `npm test -w xcpdex-api`
 * (and CI) never touches the network. Run the live checks with either:
 *     npm run test:contract -w xcpdex-api      (sets LIVE_API for you via tests/contract-runner.mjs)
 *     LIVE_API=1 npm test -w xcpdex-api         (POSIX shells; runs the whole suite incl. these)
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
const BASE = process.env.LIVE_API && process.env.LIVE_API !== "1"
  ? process.env.LIVE_API.replace(/\/$/, "")
  : "https://xcp-api.me-bbe.workers.dev";

/* ---------- generic structural matcher ---------- */
// spec: field -> "string" | "number" | "boolean" | "object" | "array" | "null" | "any", "|"-unioned,
// with a trailing "?" marking the field OPTIONAL (absent is allowed; present must still match).
type Spec = Record<string, string>;
const typeOf = (v: unknown): string =>
  v === null ? "null" : Array.isArray(v) ? "array" : typeof v;

function assertShape(obj: any, spec: Spec, path = ""): void {
  assert.ok(obj && typeof obj === "object" && !Array.isArray(obj), `${path || "value"} should be an object, got ${typeOf(obj)}`);
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
    assert.ok(allowed.includes(actual), `${path}${field}: DTO expects ${type}, API sent ${actual} (${JSON.stringify(obj[field])})`);
  }
}
function assertRows(arr: any, spec: Spec, path: string): void {
  assert.ok(Array.isArray(arr), `${path} should be an array, got ${typeOf(arr)}`);
  arr.forEach((r: any, i: number) => assertShape(r, spec, `${path}[${i}].`));
}

async function getJson(path: string): Promise<any> {
  const res = await fetch(BASE + path);
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
    assert.ok(json.next_offset === null || typeof json.next_offset === "number", `${name}: short page → null or number next_offset`);
  }
}

/* ---------- DTO specs (hand-written from packages/shared/src) ---------- */
const BLOCK_ROW: Spec = { block_index: "number", block_hash: "string|null", block_time: "number|null", transaction_count: "number|null" };
const ASSET_INDEX_ROW: Spec = {
  asset: "string", asset_longname: "string|null", type: "string", issuer: "string|null", owner: "string|null",
  divisible: "number", locked: "number", supply_normalized: "string|null", description: "string|null",
  stamp: "number", first_issuance_block_time: "number|null", last_issuance_block_index: "number|null",
};
// AssetDetail — the REQUIRED (non-optional) DTO fields; the native XCP/BTC path omits the optional ones.
const ASSET_DETAIL: Spec = {
  asset: "string", asset_longname: "string|null", type: "string", issuer: "string|null", owner: "string|null",
  divisible: "number", locked: "number", description: "string|null", supply_normalized: "string|null", holder_count: "number",
};
const ASSET_QUALITY: Spec = { tier: "string", score: "number|null", raw: "number?", breakdown: "object?", low_quality: "boolean?" };
const SEND_ROW: Spec = {
  tx_hash: "string", block_index: "number", block_time: "number|null", source: "string|null", destination: "string|null",
  asset: "string|null", quantity_normalized: "string|null", send_type: "string|null", status: "string|null",
};
const ORDER_ROW: Spec = {
  tx_hash: "string", block_index: "number", block_time: "number|null", source: "string|null",
  give_asset: "string|null", get_asset: "string|null", status: "string|null",
  give_quantity_normalized: "number", get_quantity_normalized: "number",
};
const TRADE_ROW: Spec = {
  venue: "string", asset: "string|null", block_time: "number|null", block_index: "number|null", quantity: "number|null",
  currency: "string|null", total: "number|null", price: "number|null", usd_value: "number|null",
  buyer: "string|null", seller: "string|null", tx_hash: "string|null",
};
const TRADE_VENUE_STATS: Spec = { venue: "string", trades: "number", assets: "number", last_time: "number|null", usd_known: "number|null" };
const EXCHANGE_ROW: Spec = { addr: "string", assets_received: "number", in_peers: "number", first_blk: "number|null", last_blk: "number|null", name: "string" };
const ADDRESS_SUMMARY: Spec = {
  xcp: "string|null", assets: "number", issued: "number", dispensers: "number", open_dispensers: "number",
  open_orders: "number", first_block: "number|null", last_block: "number|null", dispenser_trust: "number|null",
};
const ADDRESS_REPUTATION: Spec = {
  score: "number|null", tier: "string", band: "string", tier_meaning: "string|null", tags: "array",
  evidence: "object|null", raw: "number?", breakdown: "object?",
};
const REP_EVIDENCE: Spec = {
  first_block: "number", last_block: "number", span_years: "number", survived_assets: "number", assets_distributed: "number",
  assets_hits: "number", dividends: "number", dispense_btc: "number", btc_fees: "number", btc_spent: "number",
  inbound_peers: "number", assets_held: "number", xcp: "number", assets_burned: "number", stamps_created: "number",
  stamps_collected: "number", src20_deploys: "number", btns_user: "boolean",
};

const ADDR = "1GQhaWqejcGJ4GhQar7SjcCfadxvf5DNBD";
const skipUnlessLive = (t: { skip(m?: string): void }) => { if (!LIVE) { t.skip("set LIVE_API to run the live wire-contract checks"); return true; } return false; };

/* ---------- the ~12 representative endpoints ---------- */

test("contract: GET /v2/ — StatsOverview envelope", async (t) => {
  if (skipUnlessLive(t)) return;
  const j = await getJson("/v2/");
  assertShape(j.result, { tip: "number|null", assets: "number", transactions: "number", balances: "number", indexed_block: "string|null" }, "home.result.");
});

test("contract: GET /v2/blocks?limit=2 — BlockRow list", async (t) => {
  if (skipUnlessLive(t)) return;
  assertListEnvelope(await getJson("/v2/blocks?limit=2"), BLOCK_ROW, 2, "blocks");
});

test("contract: GET /v2/assets?limit=2 — AssetIndexRow list", async (t) => {
  if (skipUnlessLive(t)) return;
  assertListEnvelope(await getJson("/v2/assets?limit=2"), ASSET_INDEX_ROW, 2, "assets");
});

test("contract: GET /v2/assets/RAREPEPE — AssetDetail + AssetQuality", async (t) => {
  if (skipUnlessLive(t)) return;
  const j = await getJson("/v2/assets/RAREPEPE");
  assertShape(j.result, ASSET_DETAIL, "RAREPEPE.");
  if (j.result.quality) assertShape(j.result.quality, ASSET_QUALITY, "RAREPEPE.quality.");
  assert.ok(!("tags" in j.result) || Array.isArray(j.result.tags), "RAREPEPE.tags must be an array when present");
});

test("contract: GET /v2/assets/XCP — AssetDetail native reduced path", async (t) => {
  if (skipUnlessLive(t)) return;
  const j = await getJson("/v2/assets/XCP");
  assertShape(j.result, ASSET_DETAIL, "XCP.");
  assert.equal(j.result.type, "native", "XCP must report type=native");
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
  if (p.summary !== null) assertShape(p.summary, { exchanges: "number", deposit_addresses: "number" }, "exchanges.summary.");
  assertRows(p.exchanges, EXCHANGE_ROW, "exchanges.exchanges");
  assertRows(p.top_assets, { asset: "string", asset_longname: "string|null", depositors: "number" }, "exchanges.top_assets");
});

test("contract: GET /v2/vaults — VaultsPayload", async (t) => {
  if (skipUnlessLive(t)) return;
  const p = (await getJson("/v2/vaults")).result;
  assert.ok(p && typeof p === "object", "vaults.result must be an object");
  if (p.summary !== null) {
    assertShape(p.summary, { vault_records: "number", funded_vaults: "number", assets_vaulted: "number", funders: "number", crackers: "number" }, "vaults.summary.");
  }
  assertRows(p.top_assets, { asset: "string", asset_longname: "string|null", vaults: "number" }, "vaults.top_assets");
  assertRows(p.top_funders, { addr: "string", vaults: "number" }, "vaults.top_funders");
  assertRows(p.top_crackers, { addr: "string", vaults: "number" }, "vaults.top_crackers");
  assertRows(p.activity, { t: "number", v: "number" }, "vaults.activity");
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
  if (j.result.evidence !== null) assertShape(j.result.evidence, REP_EVIDENCE, "reputation.evidence.");
  assert.ok(Array.isArray(j.result.tags), "reputation.tags must be an array");
});
