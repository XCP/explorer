/** Chain primitives (blocks, transaction detail) + the recent-first record feeds. SQL lives in
 *  queries/chain.ts (blocks/tx) and queries/records.ts (the 21 per-kind feeds). */
import { RECORD_KINDS, type RecordKind } from "@xcp/shared/records";
import type { BitcoinTxIo, BitcoinTxSummary, TxAction, TxEvent, TxView } from "@xcp/shared/chain";
import { counterpartyJson } from "#api/integrations/counterparty";
import { router, J, lim, off, type Ctx } from "#api/read/respond";
import { listBlocks, getBlock, blockTransactions, getTransaction, blockTip } from "#api/queries/chain";
import {
  listTransactions,
  listSends,
  listIssuances,
  listDispensers,
  listDispenses,
  listSweeps,
  listDestructions,
  listBurns,
  listDividends,
  listBroadcasts,
  listFairminters,
  listFairmints,
  listBtcpays,
  listBets,
  listBetMatches,
  listRps,
  listRpsMatches,
  listPools,
  listPoolMatches,
  classifyCoreTx,
  coreStatelessRecordsByTx,
  coreContextRecordsByTx,
  corePoolLiquidityByTx,
  coreDispensersByTx,
  coreDispensesByTx,
  coreRefillsByTx,
  coreCancelsByTx,
  coreDispensesOfDispenser,
  coreDispenserTotals,
  coreParentTxIndex,
} from "#api/queries/records";
import { coreAssetBrief, coreAssetCollection } from "#api/queries/core-assets";
import { mempoolTxActions } from "#api/read/mempool";
import { boundedInteger } from "#api/http/numbers";
import { listOrderMatches, listOrders, matchesOfOrderIndex, orderByTxIndex } from "#api/queries/core-orders";

export const chain = router();

/* ---------- blocks ---------- */
chain.get("/v2/blocks", async (c) => {
  const l = lim(c),
    o = off(c);
  const rows = await listBlocks(c.env.CORE_DB, l, o);
  return J(c, { result: rows, next_offset: rows.length === l ? o + l : null }, 15);
});

chain.get("/v2/blocks/:n", async (c) => {
  const n = boundedInteger(c.req.param("n"), { defaultValue: -1, min: -1 });
  const b = await getBlock(c.env.CORE_DB, n);
  if (!b) return c.json({ error: "Block not found" }, 404);
  const transactions = await blockTransactions(c.env.CORE_DB, n);
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
  asset ? coreAssetCollection(db, asset).catch(() => null) : Promise.resolve(null);
const supplyOf = (db: D1Database, asset: string | null) =>
  asset ? coreAssetBrief(db, asset).catch(() => null) : Promise.resolve(null);

async function composeAction(db: D1Database, txIndex: number): Promise<TxAction | null> {
  const kind = await classifyCoreTx(db, txIndex);
  if (!kind) return null;
  switch (kind) {
    case "sends":
      return { kind: "send", sends: await coreStatelessRecordsByTx(db, "sends", txIndex) };
    case "dispenses": {
      const [dispenses, parent] = await Promise.all([
        coreDispensesByTx(db, txIndex),
        coreParentTxIndex(db, "dispenses", txIndex),
      ]);
      const dispenser = parent == null ? null : ((await coreDispensersByTx(db, parent))[0] ?? null);
      return { kind: "dispense", dispenses, dispenser };
    }
    case "dispensers": {
      // The dispenser tx page IS the machine's storefront — carry its sales history + lifetime totals.
      const dispenser = (await coreDispensersByTx(db, txIndex))[0];
      const [sales, totals, collection, supply] = await Promise.all([
        coreDispensesOfDispenser(db, txIndex).catch(() => []),
        coreDispenserTotals(db, txIndex).catch(() => null),
        collectionOf(db, dispenser?.asset ?? null),
        supplyOf(db, dispenser?.asset ?? null),
      ]);
      return { kind: "dispenser", dispenser, sales, totals, collection, supply };
    }
    case "dispenser_refills": {
      const [refills, parent] = await Promise.all([
        coreRefillsByTx(db, txIndex),
        coreParentTxIndex(db, "dispenser_refills", txIndex),
      ]);
      const refill = refills[0];
      const [dispenser, sales, totals] = await Promise.all([
        parent == null ? Promise.resolve(null) : coreDispensersByTx(db, parent).then((r) => r[0] ?? null),
        parent == null ? Promise.resolve([]) : coreDispensesOfDispenser(db, parent).catch(() => []),
        parent == null ? Promise.resolve(null) : coreDispenserTotals(db, parent).catch(() => null),
      ]);
      const [collection, supply] = await Promise.all([
        collectionOf(db, dispenser?.asset ?? refill.asset ?? null),
        supplyOf(db, dispenser?.asset ?? refill.asset ?? null),
      ]);
      return { kind: "refill", refill, dispenser, sales, totals, collection, supply };
    }
    case "orders": {
      // the offer + its tape: matches this order participated in (either side)
      const order = (await orderByTxIndex(db, txIndex))[0];
      const [matches, collection, supply] = await Promise.all([
        matchesOfOrderIndex(db, txIndex).catch(() => []),
        collectionOf(db, offerArt(order?.give_asset, order?.get_asset)),
        supplyOf(db, offerArt(order?.give_asset, order?.get_asset)),
      ]);
      return { kind: "order", order, matches, collection, supply };
    }
    case "cancels": {
      const [cancels, parent] = await Promise.all([
        coreCancelsByTx(db, txIndex),
        coreParentTxIndex(db, "cancels", txIndex),
      ]);
      const cancel = cancels[0];
      const order = parent == null ? null : ((await orderByTxIndex(db, parent))[0] ?? null);
      return { kind: "cancel", cancel, order };
    }
    case "btcpays":
      return { kind: "btcpay", btcpay: (await coreContextRecordsByTx(db, "btcpays", txIndex))[0] };
    case "issuances":
      return { kind: "issuance", issuance: (await coreContextRecordsByTx(db, "issuances", txIndex))[0] };
    case "fairminters":
      return { kind: "fairminter", fairminter: (await coreContextRecordsByTx(db, "fairminters", txIndex))[0] };
    case "fairmints": {
      const [fairmints, parent] = await Promise.all([
        coreContextRecordsByTx(db, "fairmints", txIndex),
        coreParentTxIndex(db, "fairmints", txIndex),
      ]);
      const fairmint = fairmints[0];
      const fairminter = parent == null ? null : ((await coreContextRecordsByTx(db, "fairminters", parent))[0] ?? null);
      return { kind: "fairmint", fairmint, fairminter };
    }
    case "broadcasts":
      return { kind: "broadcast", broadcast: (await coreStatelessRecordsByTx(db, "broadcasts", txIndex))[0] };
    case "sweeps":
      return { kind: "sweep", sweep: (await coreStatelessRecordsByTx(db, "sweeps", txIndex))[0] };
    case "dividends":
      return { kind: "dividend", dividend: (await coreStatelessRecordsByTx(db, "dividends", txIndex))[0] };
    case "burns":
      return { kind: "burn", burn: (await coreStatelessRecordsByTx(db, "burns", txIndex))[0] };
    case "destructions":
      return { kind: "destruction", destruction: (await coreStatelessRecordsByTx(db, "destructions", txIndex))[0] };
    case "bets":
      return { kind: "bet", bet: (await coreStatelessRecordsByTx(db, "bets", txIndex))[0] };
    case "rps":
      return { kind: "rps", rps: (await coreStatelessRecordsByTx(db, "rps", txIndex))[0] };
    case "pool_liquidity":
      return { kind: "pool_liquidity", liquidity: (await corePoolLiquidityByTx(db, txIndex))[0] };
    case "pool_matches":
      return { kind: "pool_swap", swap: (await coreContextRecordsByTx(db, "pool_matches", txIndex))[0] };
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
  const t = await getTransaction(c.env.CORE_DB, hash);
  if (t) {
    const [tip, action] = await Promise.all([
      blockTip(c.env.CORE_DB),
      composeAction(c.env.CORE_DB, t.tx_index).catch((e) => {
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
    const j = await counterpartyJson<{
      result?: { event?: string; event_index?: number; params?: Record<string, unknown> }[];
    }>(c.env.COUNTERPARTY_API_BASE, `/transactions/${encodeURIComponent(hash)}/events?verbose=true&limit=100`, {
      timeoutMs: 8_000,
      maxRetries: 0,
      malformedRetries: 0,
    });
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
    const j = await counterpartyJson<{ result?: BitcoindTx }>(
      c.env.COUNTERPARTY_API_BASE,
      `/bitcoin/transactions/${encodeURIComponent(hash)}?verbose=true`,
      { timeoutMs: 8_000, maxRetries: 0, malformedRetries: 0 },
    );
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
function recordFeed(c: Ctx, kind: RecordKind, limit: number, offset: number) {
  switch (kind) {
    case "orders": return listOrders(c.env.CORE_DB, limit, offset);
    case "order_matches": return listOrderMatches(c.env.CORE_DB, limit, offset);
    case "transactions": return listTransactions(c.env.CORE_DB, limit, offset);
    case "sends": return listSends(c.env.CORE_DB, limit, offset);
    case "issuances": return listIssuances(c.env.CORE_DB, limit, offset);
    case "dispensers": return listDispensers(c.env.CORE_DB, limit, offset);
    case "dispenses": return listDispenses(c.env.CORE_DB, limit, offset);
    case "sweeps": return listSweeps(c.env.CORE_DB, limit, offset);
    case "destructions": return listDestructions(c.env.CORE_DB, limit, offset);
    case "burns": return listBurns(c.env.CORE_DB, limit, offset);
    case "dividends": return listDividends(c.env.CORE_DB, limit, offset);
    case "broadcasts": return listBroadcasts(c.env.CORE_DB, limit, offset);
    case "fairminters": return listFairminters(c.env.CORE_DB, limit, offset);
    case "fairmints": return listFairmints(c.env.CORE_DB, limit, offset);
    case "btcpays": return listBtcpays(c.env.CORE_DB, limit, offset);
    case "bets": return listBets(c.env.CORE_DB, limit, offset);
    case "bet_matches": return listBetMatches(c.env.CORE_DB, limit, offset);
    case "rps": return listRps(c.env.CORE_DB, limit, offset);
    case "rps_matches": return listRpsMatches(c.env.CORE_DB, limit, offset);
    case "pools": return listPools(c.env.CORE_DB, limit, offset);
    case "pool_matches": return listPoolMatches(c.env.CORE_DB, limit, offset);
  }
}

for (const kind of RECORD_KINDS) {
  chain.get(`/v2/${kind}`, async (c) => {
    const l = lim(c),
      o = off(c);
    const rows = await recordFeed(c, kind, l, o);
    return J(c, { result: rows, next_offset: rows.length === l ? o + l : null });
  });
}
