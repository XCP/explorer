/**
 * Emblem vault SALES history — the full secondary-market history of the Ethereum NFTs that wrap Counterparty
 * cards. Source: Alchemy getNFTSales per Emblem contract (every ETH-marketplace sale, not just the last one).
 * Each sale is attributed to the wrapped Counterparty asset via emblem_vaults(token_id -> btc_address -> its balance).
 * Feeds the unified sales stream as the 'emblem' venue (priced in ETH). Resumable per-contract pageKey cursor.
 */
import type { Env } from "../index";

const ALCHEMY_SALES = (key: string) => `https://eth-mainnet.g.alchemy.com/nft/v3/${key}/getNFTSales`;
const PAGE = 1000;
const MAX_PAGES_PER_RUN = 25; // big contracts need ~46 pages; complete them in fewer cron cycles

export const EMBLEM_SALES_DDL = `CREATE TABLE IF NOT EXISTS emblem_sales (
  tx_hash TEXT, log_index INTEGER, contract TEXT, token_id TEXT,
  price_raw TEXT, token_addr TEXT, marketplace TEXT,
  buyer TEXT, seller TEXT, block_number INTEGER, PRIMARY KEY (tx_hash, log_index))`;
export const EMBLEM_SALES_IDX = `CREATE INDEX IF NOT EXISTS idx_emblem_sales_token ON emblem_sales(contract, token_id)`;

// Minimal shape of an Alchemy getNFTSales row — only the fields this crawler reads.
interface NftSale {
  sellerFee?: { amount?: string; tokenAddress?: string };
  protocolFee?: { amount?: string; tokenAddress?: string };
  royaltyFee?: { amount?: string; tokenAddress?: string };
  transactionHash?: string;
  logIndex?: number;
  tokenId?: string | number;
  marketplace?: string;
  buyerAddress?: string;
  sellerAddress?: string;
  blockNumber?: number;
}

// Total paid = seller proceeds + protocol + royalty fees, kept as the RAW integer string in the payment
// token's own units (Alchemy leaves symbol/decimals blank, so we normalize downstream with a token map).
// Native-ETH sales report no tokenAddress -> label 'ETH'. BigInt so we never lose precision.
function priceOf(s: NftSale): { raw: string; token: string } {
  let amt = 0n;
  for (const f of [s?.sellerFee, s?.protocolFee, s?.royaltyFee]) {
    try { if (f?.amount) amt += BigInt(f.amount); } catch { /* skip */ }
  }
  const token = (s?.sellerFee?.tokenAddress || s?.protocolFee?.tokenAddress || "ETH").toLowerCase();
  return { raw: amt.toString(), token };
}

async function getState(env: Env, k: string): Promise<string | null> {
  return ((await env.DB.prepare(`SELECT value FROM indexer_state WHERE key=?`).bind(k).first<{ value: string }>())?.value) ?? null;
}
async function setState(env: Env, k: string, v: string): Promise<void> {
  await env.DB.prepare(`INSERT INTO indexer_state (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).bind(k, v).run();
}

/** One bounded, resumable step: pull the next pages of getNFTSales for the active Emblem contract. */
export async function crawlEmblemSales(env: Env): Promise<Record<string, unknown>> {
  const key = (env as { ALCHEMY_KEY?: string }).ALCHEMY_KEY;
  if (!key) return { skipped: "no ALCHEMY_KEY" };
  await env.DB.prepare(EMBLEM_SALES_DDL).run();
  await env.DB.prepare(EMBLEM_SALES_IDX).run();

  const contracts: string[] = JSON.parse((await getState(env, "emblem_contracts")) || "[]");
  if (!contracts.length) return { skipped: "no contracts" };
  let ci = parseInt((await getState(env, "emblem_sales_idx")) || "0", 10);
  if (ci >= contracts.length) ci = 0;
  const contract = contracts[ci];
  let cursor = (await getState(env, `emblem_sales_cur_${contract}`)) || "";

  const out: {
    contract: string; inserted: number; pages: number;
    err?: string; sample?: NftSale; contract_done?: boolean;
  } = { contract, inserted: 0, pages: 0 };
  for (; out.pages < MAX_PAGES_PER_RUN; out.pages++) {
    let url = `${ALCHEMY_SALES(key)}?contractAddress=${contract}&order=asc&limit=${PAGE}`;
    if (cursor) url += `&pageKey=${encodeURIComponent(cursor)}`;
    let d: { nftSales?: NftSale[]; pageKey?: string };
    try { d = (await (await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(25000) })).json()) as { nftSales?: NftSale[]; pageKey?: string }; }
    catch (e) { out.err = String(e).slice(0, 80); break; }
    const sales: NftSale[] = d?.nftSales || [];
    if (!out.sample && sales[0]) out.sample = sales[0]; // surface the raw shape on the first run
    // Alchemy's asc pagination CAN return an empty page mid-stream with a valid pageKey — do NOT
    // treat empty as end-of-contract (that bug capped the main contract at 30k of its 45k sales).
    // Only a MISSING pageKey means we've reached the end.
    if (!sales.length) { cursor = d?.pageKey || ""; if (!cursor) break; continue; }
    const stmts = sales.map((s) => {
      const p = priceOf(s);
      return env.DB.prepare(
        `INSERT OR IGNORE INTO emblem_sales (tx_hash,log_index,contract,token_id,price_raw,token_addr,marketplace,buyer,seller,block_number)
         VALUES (?,?,?,?,?,?,?,?,?,?)`
      ).bind(s.transactionHash, s.logIndex ?? 0, contract, String(s.tokenId), p.raw, p.token, s.marketplace ?? null, s.buyerAddress ?? null, s.sellerAddress ?? null, s.blockNumber ?? null);
    });
    for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
    out.inserted += sales.length;
    cursor = d?.pageKey || "";
    if (!cursor) break;
  }
  await setState(env, `emblem_sales_cur_${contract}`, cursor);
  if (!cursor) { await setState(env, "emblem_sales_idx", String((ci + 1) % contracts.length)); out.contract_done = true; }
  return out;
}
