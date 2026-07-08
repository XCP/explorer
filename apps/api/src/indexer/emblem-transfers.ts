/**
 * Emblem sales via TRANSFERS + Seaport decode — recovers the sales Alchemy's getNFTSales stopped indexing
 * after ~April 2024 (confirmed: getNFTSales returns nothing past the cutoff, but getAssetTransfers still sees
 * the transfers, and the price lives in each transfer tx's Seaport OrderFulfilled event). This crawler walks
 * getAssetTransfers per Emblem contract from the cutoff forward, fetches each tx's receipt, decodes the
 * OrderFulfilled log (seaport.ts), and writes recovered sales into the SAME emblem_sales table (INSERT OR
 * IGNORE dedupes the overlap with the getNFTSales era). Seaport only for now — Blur/LooksRare use other
 * events (a trickle here; follow-up). Bounded + resumable (per-contract block cursor + pageKey). Cron/admin.
 */
import type { Env } from "../index";
import { decodeOrderFulfilled, ORDER_FULFILLED_TOPIC } from "./seaport";

const PAGE = 25;              // transfers per step ⇒ ≤25 receipt fetches/run (bounded subrequests)
const FLOOR = 19_600_000;    // ~just before the getNFTSales cutoff (Apr 2024); INSERT OR IGNORE dedupes overlap

async function getState(env: Env, k: string): Promise<string | null> {
  return ((await env.DB.prepare(`SELECT value FROM indexer_state WHERE key=?`).bind(k).first<{ value: string }>())?.value) ?? null;
}
async function setState(env: Env, k: string, v: string): Promise<void> {
  await env.DB.prepare(`INSERT INTO indexer_state (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).bind(k, v).run();
}

interface Transfer { hash: string; blockNum: string; tokenId?: string; erc1155Metadata?: { tokenId: string }[] }
interface Receipt { logs?: { topics: string[]; data: string; logIndex: string }[] }

/** One bounded, resumable step: recover Seaport sales for the active contract from getAssetTransfers. */
export async function crawlEmblemTransfers(env: Env): Promise<Record<string, unknown>> {
  const key = (env as { ALCHEMY_KEY?: string }).ALCHEMY_KEY;
  if (!key) return { skipped: "no ALCHEMY_KEY" };
  const rpc = `https://eth-mainnet.g.alchemy.com/v2/${key}`;
  const call = async (method: string, params: unknown[]) => {
    const r = await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: 1, jsonrpc: "2.0", method, params }), signal: AbortSignal.timeout(25000) });
    return ((await r.json()) as { result?: unknown }).result;
  };

  const contracts: string[] = JSON.parse((await getState(env, "emblem_contracts")) || "[]");
  if (!contracts.length) return { skipped: "no contracts" };
  let ci = parseInt((await getState(env, "emblem_tx_idx")) || "0", 10);
  if (ci >= contracts.length) ci = 0;
  const contract = contracts[ci];
  const curKey = `emblem_tx_cur_${contract}`, pkKey = `emblem_tx_pk_${contract}`;
  const cursor = parseInt((await getState(env, curKey)) || String(FLOOR), 10); // scan START (held constant while paginating)
  const pageKey = (await getState(env, pkKey)) || undefined;

  const params: Record<string, unknown> = { fromBlock: "0x" + cursor.toString(16), toBlock: "latest", contractAddresses: [contract], category: ["erc721", "erc1155"], order: "asc", maxCount: "0x" + PAGE.toString(16), withMetadata: false };
  if (pageKey) params.pageKey = pageKey;
  let tr: { transfers?: Transfer[]; pageKey?: string };
  try { tr = (await call("alchemy_getAssetTransfers", [params])) as { transfers?: Transfer[]; pageKey?: string }; }
  catch (e) { return { contract, err: String(e).slice(0, 80) }; }
  const transfers = tr?.transfers || [];

  const out: Record<string, unknown> = { contract, ci, transfers: transfers.length, sales: 0 };

  // Group transfers by tx (one receipt fetch per tx); a tx may move several of our tokens.
  const byTx = new Map<string, { tokenIds: string[]; block: number }>();
  for (const t of transfers) {
    const tokHex = t.tokenId || t.erc1155Metadata?.[0]?.tokenId;
    if (!tokHex) continue;
    let tid: string; try { tid = BigInt(tokHex).toString(); } catch { continue; }
    const e = byTx.get(t.hash) ?? { tokenIds: [], block: parseInt(t.blockNum, 16) };
    e.tokenIds.push(tid); byTx.set(t.hash, e);
  }

  let maxBlock = cursor;
  const inserts: ReturnType<typeof env.DB.prepare>[] = [];
  for (const [hash, { tokenIds, block }] of byTx) {
    maxBlock = Math.max(maxBlock, block);
    let rc: Receipt | null;
    try { rc = (await call("eth_getTransactionReceipt", [hash])) as Receipt | null; } catch { continue; }
    for (const lg of rc?.logs || []) {
      if (lg.topics?.[0]?.toLowerCase() !== ORDER_FULFILLED_TOPIC) continue;
      for (const tid of tokenIds) {
        const sale = decodeOrderFulfilled(lg.topics, lg.data, contract, tid);
        if (sale && BigInt(sale.priceRaw) > 0n) {
          inserts.push(env.DB.prepare(
            `INSERT OR IGNORE INTO emblem_sales (tx_hash,log_index,contract,token_id,price_raw,token_addr,marketplace,buyer,seller,block_number)
             VALUES (?,?,?,?,?,?,?,?,?,?)`
          ).bind(hash, parseInt(lg.logIndex, 16), contract, tid, sale.priceRaw, sale.token, "seaport", sale.buyer, sale.seller, block));
        }
      }
    }
  }
  for (let i = 0; i < inserts.length; i += 50) await env.DB.batch(inserts.slice(i, i + 50));
  out.sales = inserts.length;

  // Advance: while a pageKey remains, keep the SAME fromBlock (cursor) and just save the pageKey. When the
  // page runs dry the contract is caught up to tip → bump its cursor past the last block and rotate contracts.
  if (tr?.pageKey) { await setState(env, pkKey, tr.pageKey); out.more = true; }
  else { await setState(env, pkKey, ""); await setState(env, curKey, String(maxBlock + 1)); await setState(env, "emblem_tx_idx", String((ci + 1) % contracts.length)); out.contract_done = true; }
  out.total_sales = (await env.DB.prepare(`SELECT COUNT(*) c FROM emblem_sales`).first<{ c: number }>())?.c ?? 0;
  return out;
}
