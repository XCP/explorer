/**
 * Emblem sales via TRANSFERS + Seaport decode — recovers the sales Alchemy's getNFTSales stopped indexing
 * after ~April 2024 (confirmed: getNFTSales returns nothing past the cutoff, but getAssetTransfers still sees
 * the transfers, and the price lives in each transfer tx's Seaport OrderFulfilled event). This crawler walks
 * getAssetTransfers per Emblem contract from the cutoff forward, fetches each tx's receipt, decodes the
 * OrderFulfilled log (seaport.ts), and upserts recovered sales into the canonical emblem_sales table.
 * Seaport only for now — Blur/LooksRare use other
 * events (a trickle here; follow-up). Bounded + resumable (per-contract block cursor + pageKey). Cron/admin.
 */
import type { Env } from "#api/env";
import { callAlchemyRpc } from "#api/integrations/alchemy-rpc";
import { getCoreState, getCoreStateInt, getCoreStateStringArray, setCoreState } from "#api/indexer/core-state";
import { type EmblemSaleRow, upsertEmblemSales } from "#api/indexer/emblem-sales";
import { decodeOrderFulfilled, ORDER_FULFILLED_TOPIC } from "#api/indexer/seaport";

const PAGE = 25; // transfers per step ⇒ ≤25 receipt fetches/run (bounded subrequests)
const FLOOR = 19_600_000; // ~just before the getNFTSales cutoff (Apr 2024); INSERT OR IGNORE dedupes overlap

interface Transfer {
  hash: string;
  blockNum: string;
  tokenId?: string;
  erc1155Metadata?: { tokenId: string }[];
}
interface Receipt {
  logs?: { topics: string[]; data: string; logIndex: string }[];
}

/** One bounded, resumable step: recover Seaport sales for the active contract from getAssetTransfers. */
export async function crawlEmblemTransfers(env: Env): Promise<Record<string, unknown>> {
  if (!env.ALCHEMY_KEY) return { skipped: "no ALCHEMY_KEY" };
  const call = (method: string, params: unknown[]) => callAlchemyRpc(env.ALCHEMY_KEY, method, params);

  const contracts = await getCoreStateStringArray(env.CORE_DB, "emblem_contracts");
  if (contracts.length === 0) return { skipped: "no contracts" };
  let ci = await getCoreStateInt(env.CORE_DB, "emblem_tx_idx");
  if (ci < 0 || ci >= contracts.length) ci = 0;
  const contract = contracts[ci];
  const curKey = `emblem_tx_cur_${contract}`,
    pkKey = `emblem_tx_pk_${contract}`;
  const cursor = await getCoreStateInt(env.CORE_DB, curKey, FLOOR); // scan START (held constant while paginating)
  const pageKey = (await getCoreState(env.CORE_DB, pkKey)) || undefined;

  const params: Record<string, unknown> = {
    fromBlock: "0x" + cursor.toString(16),
    toBlock: "latest",
    contractAddresses: [contract],
    category: ["erc721", "erc1155"],
    order: "asc",
    maxCount: "0x" + PAGE.toString(16),
    withMetadata: false,
  };
  if (pageKey) params.pageKey = pageKey;
  let tr: { transfers?: Transfer[]; pageKey?: string };
  try {
    tr = (await call("alchemy_getAssetTransfers", [params])) as { transfers?: Transfer[]; pageKey?: string };
  } catch (e) {
    return { contract, err: String(e).slice(0, 80) };
  }
  const transfers = tr?.transfers || [];

  const out: Record<string, unknown> = { contract, ci, transfers: transfers.length, sales: 0 };

  // Group transfers by tx (one receipt fetch per tx); a tx may move several of our tokens.
  const byTx = new Map<string, { tokenIds: string[]; block: number }>();
  for (const t of transfers) {
    const tokHex = t.tokenId || t.erc1155Metadata?.[0]?.tokenId;
    if (!tokHex) continue;
    let tid: string;
    try {
      tid = BigInt(tokHex).toString();
    } catch {
      continue;
    }
    const e = byTx.get(t.hash) ?? { tokenIds: [], block: parseInt(t.blockNum, 16) };
    e.tokenIds.push(tid);
    byTx.set(t.hash, e);
  }

  let maxBlock = cursor;
  let receiptFailed = false;
  const sales: EmblemSaleRow[] = [];
  for (const [hash, { tokenIds, block }] of byTx) {
    maxBlock = Math.max(maxBlock, block);
    let rc: Receipt | null;
    try {
      rc = (await call("eth_getTransactionReceipt", [hash])) as Receipt | null;
    } catch {
      receiptFailed = true;
      continue;
    }
    for (const lg of rc?.logs || []) {
      if (lg.topics?.[0]?.toLowerCase() !== ORDER_FULFILLED_TOPIC) continue;
      for (const tid of tokenIds) {
        const sale = decodeOrderFulfilled(lg.topics, lg.data, contract, tid);
        if (sale && BigInt(sale.priceRaw) > 0n) {
          sales.push({
            transactionHash: hash,
            logIndex: Number.parseInt(lg.logIndex, 16),
            contract,
            tokenId: tid,
            priceRaw: sale.priceRaw,
            tokenAddress: sale.token,
            marketplace: "seaport",
            buyer: sale.buyer,
            seller: sale.seller,
            blockNumber: block,
          });
        }
      }
    }
  }
  await upsertEmblemSales(env.CORE_DB, sales);
  out.sales = sales.length;

  if (receiptFailed) {
    out.retry = true;
    return out;
  }

  // Advance: while a pageKey remains, keep the SAME fromBlock (cursor) and just save the pageKey. When the
  // page runs dry the contract is caught up to tip → bump its cursor past the last block and rotate contracts.
  if (tr?.pageKey) {
    await setCoreState(env.CORE_DB, pkKey, tr.pageKey);
    out.more = true;
  } else {
    await setCoreState(env.CORE_DB, pkKey, "");
    await setCoreState(env.CORE_DB, curKey, maxBlock + 1);
    await setCoreState(env.CORE_DB, "emblem_tx_idx", (ci + 1) % contracts.length);
    out.contract_done = true;
  }
  return out;
}
