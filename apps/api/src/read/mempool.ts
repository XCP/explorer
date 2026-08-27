/**
 * Mempool read surfaces — a best-effort read-through to the Counterparty node's mempool. The mempool
 * itself is volatile and per-entity, so it is never mirrored into D1. Every handler fetches raw
 * mempool EVENTS from the node (non-verbose — verbose enrichment inlines each touched asset's full
 * description, and stamp assets carry multi-MB blobs), keeps the ACTION events (dropping ledger
 * plumbing + status echoes), and flattens each into a MempoolActionRow. The two display derivations
 * verbose used to provide come from our own data instead: asset longname + divisibility resolve from
 * the mirror's asset rows, and quantities normalize with the same string math the replay uses.
 * Caching is edge-only and short (10s) — this is the live "now" view, and its per-entity cardinality
 * makes the D1 response cache a poor fit.
 *
 *   GET /v2/mempool                          protocol-wide pending actions (?event= filters one event kind)
 *   GET /v2/addresses/:address/mempool          pending actions touching one address
 *   GET /v2/assets/:asset/mempool            pending actions on one asset
 *   GET /v2/dispensers/:tx_hash/mempool      pending DISPENSE actions against one dispenser
 *   GET /v2/mempool/transactions/:hash       pending actions of one specific tx (404 when the node has none)
 */
import type { Envelope } from "@xcp/shared/envelope";
import type { MempoolActionRow } from "@xcp/shared/mempool";
import { counterpartyJson } from "#api/integrations/counterparty";
import { normalize } from "#api/indexer/codec";
import { coreAssetDisplayFacts } from "#api/queries/core-assets";
import { router, J, type Ctx } from "#api/read/respond";

// The subset of a raw Counterparty mempool event we read. `params` is an open bag of protocol fields;
// we pick only the ones that flatten into a display row — the field NAMES vary by message type (an
// order carries give_asset/give_quantity, a send carries asset/quantity, a dispense carries
// dispense_quantity), so the flattener coalesces across the known aliases. Issuance-style events
// state divisible/asset_longname themselves — the only case where the asset may be unknown to D1.
interface MempoolEventParams {
  source?: string | null;
  origin?: string | null;
  address?: string | null;
  destination?: string | null;
  asset?: string | null;
  give_asset?: string | null;
  asset_longname?: string | null;
  divisible?: boolean | number | null;
  quantity?: string | number | null;
  dispense_quantity?: string | number | null;
  give_quantity?: string | number | null;
  dispenser_tx_hash?: string | null;
}
interface MempoolEvent {
  event: string;
  tx_hash: string | null;
  timestamp: number | null;
  params: MempoolEventParams | null;
}

// The Counterparty message types we surface as pending ACTIONS. This is an ALLOW-list on purpose: the
// mempool stream also carries ledger plumbing (NEW_TRANSACTION, TRANSACTION_PARSED, CREDIT, DEBIT,
// ASSET_CREATION) and status echoes (ORDER_UPDATE, DISPENSER_UPDATE, …) that are not user-facing actions,
// so allow-listing keeps one tx to just its real action(s) and never leaks bookkeeping rows. Names cover
// the v2 node vocabulary and the older ledger names where they differ (ASSET_ISSUANCE vs NEW_ISSUANCE).
const ACTION_EVENTS = new Set<string>([
  "ENHANCED_SEND",
  "MPMA_SEND",
  "SEND",
  "ASSET_ISSUANCE",
  "NEW_ISSUANCE",
  "RESET_ISSUANCE",
  "NEW_FAIRMINTER",
  "NEW_FAIRMINT",
  "ASSET_DESTRUCTION",
  "DESTRUCTION",
  "ASSET_DIVIDEND",
  "DIVIDEND",
  "OPEN_ORDER",
  "ORDER_MATCH",
  "CANCEL_ORDER",
  "BTC_PAY",
  "OPEN_DISPENSER",
  "REFILL_DISPENSER",
  "DISPENSE",
  "SWEEP",
  "BROADCAST",
  "BURN",
  "OPEN_BET",
  "BET_MATCH",
  "ATTACH_TO_UTXO",
  "DETACH_FROM_UTXO",
  "UTXO_MOVE",
  "ATTACH",
  "DETACH",
]);

interface AssetDisplay {
  asset_longname: string | null;
  divisible: boolean | null;
}

// One D1 round trip for every asset the kept events touch. XCP/BTC are natively divisible with no
// row of their own; an asset the mirror has never seen (its issuance is itself still unconfirmed)
// resolves to divisibility-unknown, and its quantity stays null rather than guessing a scale.
async function assetDisplayByName(c: Ctx, events: MempoolEvent[]): Promise<Map<string, AssetDisplay>> {
  const display = new Map<string, AssetDisplay>([
    ["XCP", { asset_longname: null, divisible: true }],
    ["BTC", { asset_longname: null, divisible: true }],
  ]);
  const wanted = new Set<string>();
  for (const e of events) {
    const asset = e.params?.asset ?? e.params?.give_asset;
    if (typeof asset === "string" && asset && !display.has(asset)) wanted.add(asset);
  }
  for (const fact of await coreAssetDisplayFacts(c.env.CORE_DB, [...wanted])) {
    display.set(fact.asset, { asset_longname: fact.asset_longname, divisible: fact.divisible === 1 });
  }
  return display;
}

function actionRow(e: MempoolEvent, display: Map<string, AssetDisplay>): MempoolActionRow {
  const p = e.params ?? {};
  const asset = p.asset ?? p.give_asset ?? null;
  const facts = asset ? display.get(asset) : undefined;
  // The event's own divisible (issuances) beats the mirror's; unknown divisibility leaves quantity null.
  const divisible = p.divisible != null ? Boolean(p.divisible) : (facts?.divisible ?? null);
  const quantity = p.quantity ?? p.dispense_quantity ?? p.give_quantity ?? null;
  return {
    tx_hash: e.tx_hash,
    event: e.event,
    source: p.source ?? p.origin ?? p.address ?? null,
    destination: p.destination ?? null,
    asset,
    asset_longname: p.asset_longname ?? facts?.asset_longname ?? null,
    quantity_normalized: quantity != null && divisible != null ? normalize(quantity, divisible) : null,
    dispenser_tx_hash: p.dispenser_tx_hash ?? null,
    timestamp: e.timestamp,
  };
}

// Fetch a mempool events feed from the node and normalize it to action rows. parseCounterpartyJson keeps
// >2^53 integer quantities exact. Best-effort: any failure (timeout, non-2xx, parse error) yields [] so a
// mempool hiccup never 5xxs a page that embeds it.
async function fetchActions(c: Ctx, path: string): Promise<MempoolActionRow[]> {
  try {
    const j = await counterpartyJson<{ result?: MempoolEvent[] }>(c.env.COUNTERPARTY_API_BASE, path, {
      timeoutMs: 8_000,
      maxRetries: 0,
      malformedRetries: 0,
    });
    const kept = (j.result ?? []).filter((e) => ACTION_EVENTS.has(e.event));
    const display = await assetDisplayByName(c, kept);
    return kept.map((e) => actionRow(e, display));
  } catch {
    return [];
  }
}

/** Pending XCP dispenser fills for the live XCP ask. Kept as the same read-through as the public
 * mempool routes so price projection and the explorer's pending UI cannot disagree. */
export async function pendingXcpDispenses(c: Ctx): Promise<MempoolActionRow[]> {
  const rows = await fetchActions(c, `/mempool/events/DISPENSE?limit=500`);
  return rows.filter((row) => row.event === "DISPENSE" && row.asset === "XCP" && row.dispenser_tx_hash);
}

const envelope = (result: MempoolActionRow[]): Envelope<MempoolActionRow[]> => ({ result });

export const mempool = router();

// Protocol-wide feed. ?event=OPEN_ORDER narrows to one event kind (exact, case-sensitive event name).
mempool.get("/v2/mempool", async (c) => {
  const rows = await fetchActions(c, `/mempool/events?limit=200`);
  const ev = c.req.query("event");
  return J(c, envelope(ev ? rows.filter((r) => r.event === ev) : rows), 10);
});

mempool.get("/v2/addresses/:address/mempool", async (c) => {
  const address = c.req.param("address");
  const rows = await fetchActions(c, `/addresses/mempool?addresses=${encodeURIComponent(address)}`);
  return J(c, envelope(rows), 10);
});

// No per-asset mempool route on the node — fetch the whole feed and filter (case-insensitive on either the
// asset symbol or its longname, both matched against the upper-cased path segment).
mempool.get("/v2/assets/:asset/mempool", async (c) => {
  const asset = c.req.param("asset").toUpperCase();
  const rows = await fetchActions(c, `/mempool/events?limit=500`);
  const hit = rows.filter(
    (r) => (r.asset ?? "").toUpperCase() === asset || (r.asset_longname ?? "").toUpperCase() === asset,
  );
  return J(c, envelope(hit), 10);
});

// Pending purchases against one dispenser — DISPENSE rows whose dispenser_tx_hash matches the path.
mempool.get("/v2/dispensers/:tx_hash/mempool", async (c) => {
  const dispenser = c.req.param("tx_hash");
  const rows = await fetchActions(c, `/mempool/events?limit=500`);
  const hit = rows.filter((r) => r.event === "DISPENSE" && r.dispenser_tx_hash === dispenser);
  return J(c, envelope(hit), 10);
});

/** One tx's pending mempool actions ([] when the node has none) — also consumed by the composed
 *  transaction view in read/chain.ts (a function import, not a route). */
export function mempoolTxActions(c: Ctx, hash: string): Promise<MempoolActionRow[]> {
  return fetchActions(c, `/mempool/transactions/${encodeURIComponent(hash)}/events`);
}

// One specific pending tx. 404 (same { error } shape as the other read 404s) when the node has no events
// for it — the tx page uses that to distinguish "not in mempool either" from "pending".
mempool.get("/v2/mempool/transactions/:hash", async (c) => {
  const rows = await mempoolTxActions(c, c.req.param("hash"));
  if (rows.length === 0) return c.json({ error: "not in mempool" }, 404);
  return J(c, envelope(rows), 10);
});
