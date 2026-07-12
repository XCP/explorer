/**
 * Mempool read surfaces — a best-effort read-through to the Counterparty node's mempool. Nothing here
 * touches D1: the mempool is volatile and per-entity, so it is never mirrored. Every handler fetches raw
 * mempool EVENTS from the node, keeps the ACTION events (dropping ledger plumbing + status echoes), and
 * flattens each into a MempoolActionRow. Caching is edge-only and short (10s) — this is the live "now"
 * view, and its per-entity cardinality makes the D1 response cache a poor fit.
 *
 *   GET /v2/mempool                          protocol-wide pending actions (?event= filters one event kind)
 *   GET /v2/addresses/:address/mempool          pending actions touching one address
 *   GET /v2/assets/:asset/mempool            pending actions on one asset
 *   GET /v2/dispensers/:tx_hash/mempool      pending DISPENSE actions against one dispenser
 *   GET /v2/mempool/transactions/:hash       pending actions of one specific tx (404 when the node has none)
 */
import type { Envelope } from "@xcp/shared/envelope";
import type { MempoolActionRow } from "@xcp/shared/mempool";
import { parseCounterpartyJson } from "../indexer/codec";
import { router, J, type Ctx } from "./respond";

// The subset of a raw Counterparty mempool event we read. `params` is an open bag of protocol fields;
// we pick only the ones that flatten into a display row — the field NAMES vary by message type (an order
// carries give_asset/get_asset, a send carries asset, a dispense carries dispense_quantity_normalized),
// so normalizeRow coalesces across the known aliases.
interface MempoolEventParams {
  source?: string | null;
  origin?: string | null;
  address?: string | null;
  destination?: string | null;
  asset?: string | null;
  give_asset?: string | null;
  asset_longname?: string | null;
  asset_info?: { asset_longname?: string | null } | null;
  give_asset_info?: { asset_longname?: string | null } | null;
  quantity_normalized?: string | null;
  dispense_quantity_normalized?: string | null;
  give_quantity_normalized?: string | null;
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

function normalizeRow(e: MempoolEvent): MempoolActionRow {
  const p = e.params ?? {};
  return {
    tx_hash: e.tx_hash,
    event: e.event,
    source: p.source ?? p.origin ?? p.address ?? null,
    destination: p.destination ?? null,
    asset: p.asset ?? p.give_asset ?? null,
    asset_longname: p.asset_longname ?? p.asset_info?.asset_longname ?? p.give_asset_info?.asset_longname ?? null,
    quantity_normalized: p.quantity_normalized ?? p.dispense_quantity_normalized ?? p.give_quantity_normalized ?? null,
    dispenser_tx_hash: p.dispenser_tx_hash ?? null,
    timestamp: e.timestamp,
  };
}

// Fetch a mempool events feed from the node and normalize it to action rows. parseCounterpartyJson keeps
// >2^53 integer quantities exact. Best-effort: any failure (timeout, non-2xx, parse error) yields [] so a
// mempool hiccup never 5xxs a page that embeds it.
async function fetchActions(c: Ctx, path: string): Promise<MempoolActionRow[]> {
  try {
    const r = await fetch(`${c.env.COUNTERPARTY_API_BASE}${path}`, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return [];
    const j = parseCounterpartyJson(await r.text()) as { result?: MempoolEvent[] };
    const rows: MempoolActionRow[] = [];
    for (const e of j.result ?? []) if (ACTION_EVENTS.has(e.event)) rows.push(normalizeRow(e));
    return rows;
  } catch {
    return [];
  }
}

const envelope = (result: MempoolActionRow[]): Envelope<MempoolActionRow[]> => ({ result });

export const mempool = router();

// Protocol-wide feed. ?event=OPEN_ORDER narrows to one event kind (exact, case-sensitive event name).
mempool.get("/v2/mempool", async (c) => {
  const rows = await fetchActions(c, `/mempool/events?verbose=true&limit=200`);
  const ev = c.req.query("event");
  return J(c, envelope(ev ? rows.filter((r) => r.event === ev) : rows), 10);
});

mempool.get("/v2/addresses/:address/mempool", async (c) => {
  const address = c.req.param("address");
  const rows = await fetchActions(c, `/addresses/mempool?addresses=${encodeURIComponent(address)}&verbose=true`);
  return J(c, envelope(rows), 10);
});

// No per-asset mempool route on the node — fetch the whole feed and filter (case-insensitive on either the
// asset symbol or its longname, both matched against the upper-cased path segment).
mempool.get("/v2/assets/:asset/mempool", async (c) => {
  const asset = c.req.param("asset").toUpperCase();
  const rows = await fetchActions(c, `/mempool/events?verbose=true&limit=500`);
  const hit = rows.filter(
    (r) => (r.asset ?? "").toUpperCase() === asset || (r.asset_longname ?? "").toUpperCase() === asset,
  );
  return J(c, envelope(hit), 10);
});

// Pending purchases against one dispenser — DISPENSE rows whose dispenser_tx_hash matches the path.
mempool.get("/v2/dispensers/:tx_hash/mempool", async (c) => {
  const dispenser = c.req.param("tx_hash");
  const rows = await fetchActions(c, `/mempool/events?verbose=true&limit=500`);
  const hit = rows.filter((r) => r.event === "DISPENSE" && r.dispenser_tx_hash === dispenser);
  return J(c, envelope(hit), 10);
});

/** One tx's pending mempool actions ([] when the node has none) — also consumed by the composed
 *  transaction view in read/chain.ts (a function import, not a route). */
export function mempoolTxActions(c: Ctx, hash: string): Promise<MempoolActionRow[]> {
  return fetchActions(c, `/mempool/transactions/${encodeURIComponent(hash)}/events?verbose=true`);
}

// One specific pending tx. 404 (same { error } shape as the other read 404s) when the node has no events
// for it — the tx page uses that to distinguish "not in mempool either" from "pending".
mempool.get("/v2/mempool/transactions/:hash", async (c) => {
  const rows = await mempoolTxActions(c, c.req.param("hash"));
  if (rows.length === 0) return c.json({ error: "not in mempool" }, 404);
  return J(c, envelope(rows), 10);
});
