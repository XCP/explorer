/** Chain primitives (blocks, transaction detail) + the recent-first record feeds. SQL lives in
 *  queries/chain.ts (blocks/tx) and queries/records.ts (the 21 per-kind feeds). */
import { RECORD_KINDS } from "@xcp/shared/records";
import type { BitcoinTxIo, BitcoinTxSummary, TxAction, TxEvent, TxView } from "@xcp/shared/chain";
import { parseCounterpartyJson } from "#api/indexer/codec";
import { router, J, lim, off, type Ctx } from "#api/read/respond";
import { listBlocks, getBlock, blockTransactions, getTransaction, blockTip } from "#api/queries/chain";
import {
  listRecords,
  classifyTx,
  recordsByTxHash,
  dispensesOfDispenser,
  dispenserTotals,
  matchesOfOrder,
} from "#api/queries/records";
import { assetCollection, assetBrief } from "#api/queries/assets";
import { mempoolTxActions } from "#api/read/mempool";
import { boundedInteger } from "#api/http/numbers";

export const chain = router();

/* ---------- blocks ---------- */
chain.get("/v2/blocks", async (c) => {
  const l = lim(c),
    o = off(c);
  const rows = await listBlocks(c.env.DB, l, o);
  return J(c, { result: rows, next_offset: rows.length === l ? o + l : null }, 15);
});

chain.get("/v2/blocks/:n", async (c) => {
  const n = boundedInteger(c.req.param("n"), { defaultValue: -1, min: -1 });
  const b = await getBlock(c.env.DB, n);
  if (!b) return c.json({ error: "Block not found" }, 404);
  const transactions = await blockTransactions(c.env.DB, n);
  return J(c, { result: { ...b, transactions } });
});

/* ---------- transactions ---------- */

// Compose a confirmed tx's TxAction: classify its message type, fetch its record row(s), and pull the
// parent context the row references (a dispense/refill's dispenser, a fairmint's fairminter, a cancel's
// order) — the price/terms the reader needs live on the parent, not the triggering tx.
// the card an offer is ABOUT (the non-currency side) — its collection tag is the provenance line
const offerArt = (give?: string | null, get?: string | null): string | null =>
  give && give !== "XCP" && give !== "BTC" ? give : get && get !== "XCP" && get !== "BTC" ? get : null;
const collectionOf = (db: D1Database, asset: string | null) =>
  asset ? assetCollection(db, asset).catch(() => null) : Promise.resolve(null);
const supplyOf = (db: D1Database, asset: string | null) =>
  asset ? assetBrief(db, asset).catch(() => null) : Promise.resolve(null);

async function composeAction(db: D1Database, hash: string, blockIndex: number): Promise<TxAction | null> {
  const kind = await classifyTx(db, hash, blockIndex);
  if (!kind) return null;
  switch (kind) {
    case "sends":
      return { kind: "send", sends: await recordsByTxHash(db, "sends", hash, blockIndex) };
    case "dispenses": {
      const dispenses = await recordsByTxHash(db, "dispenses", hash, blockIndex);
      const parent = dispenses[0]?.dispenser_tx_hash;
      const dispenser = parent ? ((await recordsByTxHash(db, "dispensers", parent))[0] ?? null) : null;
      return { kind: "dispense", dispenses, dispenser };
    }
    case "dispensers": {
      // The dispenser tx page IS the machine's storefront — carry its sales history + lifetime totals.
      const dispenser = (await recordsByTxHash(db, "dispensers", hash, blockIndex))[0];
      const [sales, totals, collection, supply] = await Promise.all([
        dispensesOfDispenser(db, hash).catch(() => []),
        dispenserTotals(db, hash).catch(() => null),
        collectionOf(db, dispenser?.asset ?? null),
        supplyOf(db, dispenser?.asset ?? null),
      ]);
      return { kind: "dispenser", dispenser, sales, totals, collection, supply };
    }
    case "dispenser_refills": {
      const refill = (await recordsByTxHash(db, "dispenser_refills", hash, blockIndex))[0];
      const parent = refill.dispenser_tx_hash;
      const [dispenser, sales, totals] = await Promise.all([
        parent ? recordsByTxHash(db, "dispensers", parent).then((r) => r[0] ?? null) : Promise.resolve(null),
        parent ? dispensesOfDispenser(db, parent).catch(() => []) : Promise.resolve([]),
        parent ? dispenserTotals(db, parent).catch(() => null) : Promise.resolve(null),
      ]);
      const [collection, supply] = await Promise.all([
        collectionOf(db, dispenser?.asset ?? refill.asset ?? null),
        supplyOf(db, dispenser?.asset ?? refill.asset ?? null),
      ]);
      return { kind: "refill", refill, dispenser, sales, totals, collection, supply };
    }
    case "orders": {
      // the offer + its tape: matches this order participated in (either side)
      const order = (await recordsByTxHash(db, "orders", hash, blockIndex))[0];
      const [matches, collection, supply] = await Promise.all([
        matchesOfOrder(db, hash).catch(() => []),
        collectionOf(db, offerArt(order?.give_asset, order?.get_asset)),
        supplyOf(db, offerArt(order?.give_asset, order?.get_asset)),
      ]);
      return { kind: "order", order, matches, collection, supply };
    }
    case "cancels": {
      const cancel = (await recordsByTxHash(db, "cancels", hash, blockIndex))[0];
      const order = cancel.offer_hash ? ((await recordsByTxHash(db, "orders", cancel.offer_hash))[0] ?? null) : null;
      return { kind: "cancel", cancel, order };
    }
    case "btcpays":
      return { kind: "btcpay", btcpay: (await recordsByTxHash(db, "btcpays", hash, blockIndex))[0] };
    case "issuances":
      return { kind: "issuance", issuance: (await recordsByTxHash(db, "issuances", hash, blockIndex))[0] };
    case "fairminters":
      return { kind: "fairminter", fairminter: (await recordsByTxHash(db, "fairminters", hash, blockIndex))[0] };
    case "fairmints": {
      const fairmint = (await recordsByTxHash(db, "fairmints", hash, blockIndex))[0];
      const fairminter = fairmint.fairminter_tx_hash
        ? ((await recordsByTxHash(db, "fairminters", fairmint.fairminter_tx_hash))[0] ?? null)
        : null;
      return { kind: "fairmint", fairmint, fairminter };
    }
    case "broadcasts":
      return { kind: "broadcast", broadcast: (await recordsByTxHash(db, "broadcasts", hash, blockIndex))[0] };
    case "sweeps":
      return { kind: "sweep", sweep: (await recordsByTxHash(db, "sweeps", hash, blockIndex))[0] };
    case "dividends":
      return { kind: "dividend", dividend: (await recordsByTxHash(db, "dividends", hash, blockIndex))[0] };
    case "burns":
      return { kind: "burn", burn: (await recordsByTxHash(db, "burns", hash, blockIndex))[0] };
    case "destructions":
      return { kind: "destruction", destruction: (await recordsByTxHash(db, "destructions", hash, blockIndex))[0] };
    case "bets":
      return { kind: "bet", bet: (await recordsByTxHash(db, "bets", hash, blockIndex))[0] };
    case "rps":
      return { kind: "rps", rps: (await recordsByTxHash(db, "rps", hash, blockIndex))[0] };
    case "pool_liquidity":
      return { kind: "pool_liquidity", liquidity: (await recordsByTxHash(db, "pool_liquidity", hash, blockIndex))[0] };
    case "pool_matches":
      return { kind: "pool_swap", swap: (await recordsByTxHash(db, "pool_matches", hash, blockIndex))[0] };
    default:
      return null;
  }
}

// Counterparty-protocol validity from the classified action's own status field. Only a literal
// "invalid:*" is invalid — expired/cancelled/filled are valid protocol OUTCOMES, not rejections.
// Kinds without a validity-bearing status (dispense, dispenser state codes, pool swaps) return null.
function actionValidity(a: TxAction | null): TxView["protocol"] {
  if (!a) return null;
  const status =
    a.kind === "send"
      ? a.sends[0]?.status
      : a.kind === "order"
        ? a.order.status
        : a.kind === "cancel"
          ? a.cancel.status
          : a.kind === "btcpay"
            ? a.btcpay.status
            : a.kind === "issuance"
              ? a.issuance.status
              : a.kind === "fairminter"
                ? a.fairminter.status
                : a.kind === "fairmint"
                  ? a.fairmint.status
                  : a.kind === "broadcast"
                    ? a.broadcast.status
                    : a.kind === "sweep"
                      ? a.sweep.status
                      : a.kind === "dividend"
                        ? a.dividend.status
                        : a.kind === "burn"
                          ? a.burn.status
                          : a.kind === "destruction"
                            ? a.destruction.status
                            : a.kind === "bet"
                              ? a.bet.status
                              : a.kind === "rps"
                                ? a.rps.status
                                : a.kind === "pool_liquidity"
                                  ? a.liquidity.status
                                  : null;
  if (status == null) return null;
  const s = String(status);
  return { valid: !s.toLowerCase().startsWith("invalid"), status: s };
}

// The mempool-aware transaction view (TxView): confirmed txs get confirmations-vs-tip + the classified
// Counterparty action; unconfirmed ones fall through to the node's mempool (pending actions, 0 confs).
// 404 only when the hash is in neither. Short TTLs — this page is watched live by both sides of a payment.
chain.get("/v2/transactions/:hash", async (c) => {
  const hash = c.req.param("hash");
  const t = await getTransaction(c.env.DB, hash);
  if (t) {
    const [tip, action] = await Promise.all([
      blockTip(c.env.DB),
      composeAction(c.env.DB, t.tx_hash, t.block_index).catch((e) => {
        console.log("tx action compose failed:", e instanceof Error ? e.message : String(e));
        return null;
      }),
    ]);
    const body: TxView = {
      ...t,
      status: "confirmed",
      confirmations: tip ? Math.max(1, tip - t.block_index + 1) : 1,
      tip,
      action,
      pending: [],
      protocol: actionValidity(action),
    };
    return J(c, { result: body }, 15);
  }
  const pending = await mempoolTxActions(c as Ctx, hash);
  if (!pending.length) return c.json({ error: "Transaction not found" }, 404);
  const body: TxView = {
    tx_hash: hash,
    status: "mempool",
    confirmations: 0,
    tip: null,
    action: null,
    pending,
    protocol: null,
    source: pending[0].source,
    destination: pending[0].destination,
  };
  return J(c, { result: body }, 5);
});

// A confirmed tx's raw Counterparty events, proxied from the node (the tx page's Events tab). The
// mirror stores PROCESSED tables, not raw events, so this is a read-through — best-effort ([] on any
// node hiccup), 5-min edge cache (confirmed events never change).
chain.get("/v2/transactions/:hash/events", async (c) => {
  const hash = c.req.param("hash");
  try {
    const r = await fetch(
      `${c.env.COUNTERPARTY_API_BASE}/transactions/${encodeURIComponent(hash)}/events?verbose=true&limit=100`,
      { signal: AbortSignal.timeout(8000) },
    );
    if (!r.ok) return J(c, { result: [] as TxEvent[] }, 30);
    const j = parseCounterpartyJson(await r.text()) as {
      result?: { event?: string; event_index?: number; params?: Record<string, unknown> }[];
    };
    const events: TxEvent[] = (j.result ?? []).map((e) => ({
      event: String(e.event ?? ""),
      event_index: e.event_index ?? null,
      params: e.params ?? null,
    }));
    return J(c, { result: events }, 300);
  } catch {
    return J(c, { result: [] as TxEvent[] }, 30);
  }
});

// The Bitcoin-level tx via the Counterparty node's bitcoind proxy (GET /v2/bitcoin/transactions/:hash),
// normalized to sats. The web's Bitcoin tab tries mempool.space first and falls back here — two
// independent sources so neither's rate limit breaks the page. bitcoind omits input prevout detail
// below verbosity 2; those fields normalize to null and the UI renders them honestly.
interface BitcoindVout {
  value?: number;
  n?: number;
  scriptPubKey?: { address?: string; type?: string };
}
interface BitcoindVin {
  coinbase?: string;
  txid?: string;
  vout?: number;
  prevout?: BitcoindVout;
}
interface BitcoindTx {
  fee?: number;
  size?: number;
  vsize?: number;
  weight?: number;
  vin?: BitcoindVin[];
  vout?: BitcoindVout[];
}
const sats = (btc?: number) => (btc != null && Number.isFinite(btc) ? Math.round(btc * 1e8) : null);

chain.get("/v2/transactions/:hash/bitcoin", async (c) => {
  const hash = c.req.param("hash");
  try {
    const r = await fetch(
      `${c.env.COUNTERPARTY_API_BASE}/bitcoin/transactions/${encodeURIComponent(hash)}?verbose=true`,
      { signal: AbortSignal.timeout(8000) },
    );
    if (!r.ok) return c.json({ error: "bitcoin tx unavailable" }, 502);
    const j = parseCounterpartyJson(await r.text()) as { result?: BitcoindTx };
    const t = j.result;
    if (!t) return c.json({ error: "bitcoin tx unavailable" }, 502);
    const vin: BitcoinTxIo[] = (t.vin ?? []).map((v) =>
      v.coinbase
        ? { address: null, sats: null, type: "coinbase", prev: null }
        : {
            address: v.prevout?.scriptPubKey?.address ?? null,
            sats: sats(v.prevout?.value),
            type: v.prevout?.scriptPubKey?.type ?? null,
            prev: v.txid != null ? `${v.txid}:${v.vout ?? 0}` : null,
          },
    );
    const vout: BitcoinTxIo[] = (t.vout ?? []).map((v) => ({
      address: v.scriptPubKey?.address ?? null,
      sats: sats(v.value),
      type: v.scriptPubKey?.type ?? null,
      prev: null,
    }));
    const body: BitcoinTxSummary = {
      fee_sats: sats(t.fee),
      size: t.size ?? null,
      vsize: t.vsize ?? null,
      weight: t.weight ?? null,
      vin,
      vout,
    };
    return J(c, { result: body }, 300); // confirmed bitcoin txs are immutable
  } catch {
    return c.json({ error: "bitcoin tx unavailable" }, 502);
  }
});

/* ---------- index lists (recent-first feeds; one per Counterparty record kind) ----------
   Offset pagination only — next_offset is null at the end (a short page), so the UI gets correct
   Prev/Next without an expensive COUNT(*) over millions of rows. Each kind maps to GET /v2/<kind>;
   the per-kind SELECT lives in queries/records.ts. */
for (const kind of RECORD_KINDS) {
  chain.get(`/v2/${kind}`, async (c) => {
    const l = lim(c),
      o = off(c);
    const rows = await listRecords(c.env.DB, kind, l, o);
    return J(c, { result: rows, next_offset: rows.length === l ? o + l : null });
  });
}
