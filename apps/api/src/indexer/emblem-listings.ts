/**
 * Emblem-vault LISTINGS — the live Ethereum asks for the NFTs that wrap Counterparty cards, so the Radar can
 * say "buyable now on ETH." Source: the Sequence Marketplace API (ListCollectiblesWithLowestListing), which
 * aggregates OpenSea / Blur / Magic Eden orders for our registered Emblem collections and prices each in USD
 * directly (priceUSD). Each listed token maps to its wrapped Counterparty asset via emblem_vaults(token_id →
 * contents_asset). Bounded + resumable: a rotating subset of contracts per call, upsert live asks, prune
 * stale/expired ones. Requires SEQUENCE_ACCESS_KEY; no-ops without it (so the rest of the cron is unaffected).
 */
import type { Env } from "../index";

const SEQ_BASE = "https://marketplace-api.sequence.app/mainnet/rpc/Marketplace/ListCollectiblesWithLowestListing";
const PAGE_SIZE = 100;
const MAX_PAGES_PER_CONTRACT = 5;   // includeEmpty=false returns only listed tokens, so this is plenty
const CONTRACTS_PER_RUN = 6;        // rotate through all ~36 Emblem contracts over several hourly runs
const MAP_CHUNK = 90;               // stay under D1's 100 bound-param cap on the token_id IN-list
const REQUEST_TIMEOUT_MS = 20_000;

// The lowest-listing order fields we read (Sequence webrpc Order — services/marketplace/marketplace.gen.go).
interface SeqOrder {
  orderId?: string;
  marketplace?: string | number;
  tokenId?: string | null;
  priceUSD?: number;
  priceAmount?: string;
  priceCurrencyAddress?: string;
  validUntil?: string; // ISO-8601
}
interface CollectibleOrder { metadata?: { tokenId?: string }; order?: SeqOrder | null; listing?: SeqOrder | null; }
interface ListResp { collectibles?: CollectibleOrder[]; page?: { more?: boolean }; error?: string; msg?: string; }

async function getState(env: Env, k: string): Promise<string | null> {
  return ((await env.DB.prepare(`SELECT value FROM indexer_state WHERE key=?`).bind(k).first<{ value: string }>())?.value) ?? null;
}
async function setState(env: Env, k: string, v: string): Promise<void> {
  await env.DB.prepare(`INSERT INTO indexer_state (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).bind(k, v).run();
}

async function fetchPage(key: string, contract: string, page: number): Promise<ListResp> {
  const r = await fetch(SEQ_BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Access-Key": key },
    body: JSON.stringify({ contractAddress: contract, filter: { includeEmpty: false }, page: { page, pageSize: PAGE_SIZE } }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!r.ok) throw new Error(`Sequence listings request failed: ${r.status}`);
  return r.json() as Promise<ListResp>;
}

// A live ask flattened to what emblem_listings stores (asset resolved separately, in a batched lookup).
interface Ask { tokenId: string; orderId: string | null; marketplace: string; priceUsd: number; priceAmount: string | null; currency: string; expiry: number; }

/** Sweep one contract's active listings across pages; returns the flattened live asks. */
async function sweepContract(key: string, contract: string): Promise<Ask[]> {
  const asks: Ask[] = [];
  for (let page = 1; page <= MAX_PAGES_PER_CONTRACT; page++) {
    const resp = await fetchPage(key, contract, page);
    if (resp.error) break; // registered-but-empty contracts just return no collectibles; a hard error stops this contract
    for (const it of resp.collectibles ?? []) {
      const o = it.listing ?? it.order;
      const tokenId = o?.tokenId ?? it.metadata?.tokenId;
      if (!o || !tokenId || o.priceUSD == null) continue;
      const expiry = o.validUntil ? Math.floor(new Date(o.validUntil).getTime() / 1000) : 0;
      asks.push({
        tokenId: String(tokenId), orderId: o.orderId ?? null, marketplace: String(o.marketplace ?? ""),
        priceUsd: o.priceUSD, priceAmount: o.priceAmount ?? null, currency: (o.priceCurrencyAddress ?? "").toLowerCase(),
        expiry: Number.isFinite(expiry) ? expiry : 0,
      });
    }
    if (!resp.page?.more) break;
  }
  return asks;
}

/** Resolve each token to its wrapped Counterparty asset (emblem_vaults), in bound-param-safe chunks. */
async function mapAssets(env: Env, contract: string, tokenIds: string[]): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>();
  for (let i = 0; i < tokenIds.length; i += MAP_CHUNK) {
    const chunk = tokenIds.slice(i, i + MAP_CHUNK);
    const rows = await env.DB.prepare(
      `SELECT token_id, contents_asset FROM emblem_vaults WHERE contract=? AND token_id IN (${chunk.map(() => "?").join(",")})`
    ).bind(contract, ...chunk).all<{ token_id: string; contents_asset: string | null }>();
    for (const r of rows.results ?? []) map.set(String(r.token_id), r.contents_asset ?? null);
  }
  return map;
}

/** One bounded step: sweep the next rotating batch of Emblem contracts and refresh their live asks. */
export async function crawlEmblemListings(env: Env): Promise<Record<string, unknown>> {
  const key = (env as { SEQUENCE_ACCESS_KEY?: string }).SEQUENCE_ACCESS_KEY;
  if (!key) return { skipped: "no SEQUENCE_ACCESS_KEY" };
  const contracts: string[] = JSON.parse((await getState(env, "emblem_contracts")) || "[]");
  if (!contracts.length) return { skipped: "no contracts" };

  const now = Math.floor(Date.now() / 1000);
  const start = parseInt((await getState(env, "emblem_listings_ci")) || "0", 10) % contracts.length;
  let upserts = 0, live = 0, failed = 0;
  const processed: string[] = [];

  for (let n = 0; n < CONTRACTS_PER_RUN; n++) {
    const contract = contracts[(start + n) % contracts.length].toLowerCase();
    let asks: Ask[];
    try {
      asks = await sweepContract(key, contract);
    } catch {
      // Preserve the last known rows for a contract when its refresh fails. Pruning here would
      // turn a transient upstream outage into false delistings for every token in the contract.
      failed++;
      continue;
    }
    live += asks.length;
    if (asks.length) {
      const assetOf = await mapAssets(env, contract, asks.map((a) => a.tokenId));
      const stmts = asks.map((a) => env.DB.prepare(
        `INSERT INTO emblem_listings (token_id,contract,asset,order_id,marketplace,price_usd,price_amount,currency,url,expiry,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(contract,token_id) DO UPDATE SET asset=excluded.asset, order_id=excluded.order_id,
           marketplace=excluded.marketplace, price_usd=excluded.price_usd, price_amount=excluded.price_amount,
           currency=excluded.currency, url=excluded.url, expiry=excluded.expiry, updated_at=excluded.updated_at`
      ).bind(a.tokenId, contract, assetOf.get(a.tokenId) ?? null, a.orderId, a.marketplace, a.priceUsd,
        a.priceAmount, a.currency, `https://opensea.io/assets/ethereum/${contract}/${a.tokenId}`, a.expiry, now));
      await env.DB.batch(stmts);
      upserts += stmts.length;
    }
    // prune this contract's delisted rows (not refreshed this sweep)
    await env.DB.prepare(`DELETE FROM emblem_listings WHERE contract=? AND updated_at < ?`).bind(contract, now).run();
    processed.push(contract);
  }
  // global expiry sweep
  await env.DB.prepare(`DELETE FROM emblem_listings WHERE expiry > 0 AND expiry < ?`).bind(now).run();
  await setState(env, "emblem_listings_ci", String((start + CONTRACTS_PER_RUN) % contracts.length));
  return { processed: processed.length, failed, live, upserts };
}
