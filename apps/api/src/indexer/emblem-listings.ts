/** Live asks for Ethereum NFTs that wrap Counterparty assets, sourced from Sequence Marketplace. */
import type { Env } from "#api/env";
import { fetchSequenceListingsPage } from "#api/integrations/sequence";
import { getCoreStateInt, getCoreStateStringArray, setCoreState } from "#api/indexer/core-state";

const MAX_PAGES_PER_CONTRACT = 5;
const CONTRACTS_PER_RUN = 6;
const MAP_CHUNK = 90;

export interface Ask {
  tokenId: string;
  orderId: string | null;
  marketplace: string;
  priceUsd: number;
  priceAmount: string | null;
  currency: string;
  expiry: number;
}

export interface ListingRow extends Ask {
  assetId: number | null;
}

/** A contract sweep is accepted only when every provider page is present. */
async function sweepContract(key: string, contract: string): Promise<Ask[]> {
  const asks: Ask[] = [];
  for (let page = 1; page <= MAX_PAGES_PER_CONTRACT; page++) {
    const response = await fetchSequenceListingsPage(key, contract, page);
    for (const item of response.collectibles ?? []) {
      const order = item.listing ?? item.order;
      const tokenId = order?.tokenId ?? item.metadata?.tokenId;
      if (!order || !tokenId || order.priceUSD == null) continue;
      const expiry = order.validUntil ? Math.floor(new Date(order.validUntil).getTime() / 1000) : 0;
      asks.push({
        tokenId: String(tokenId),
        orderId: order.orderId ?? null,
        marketplace: String(order.marketplace ?? ""),
        priceUsd: order.priceUSD,
        priceAmount: order.priceAmount ?? null,
        currency: (order.priceCurrencyAddress ?? "").toLowerCase(),
        expiry: Number.isFinite(expiry) ? expiry : 0,
      });
    }
    if (!response.page?.more) return asks;
  }
  throw new Error(`Sequence listing sweep exceeded ${MAX_PAGES_PER_CONTRACT} pages for ${contract}`);
}

async function resolveAssets(db: D1Database, contract: string, asks: Ask[]): Promise<ListingRow[]> {
  const assetByToken = new Map<string, number>();
  const tokenIds = [...new Set(asks.map((ask) => ask.tokenId))];
  for (let index = 0; index < tokenIds.length; index += MAP_CHUNK) {
    const chunk = tokenIds.slice(index, index + MAP_CHUNK);
    const rows = await db
      .prepare(
        `SELECT vault.token_id,vault.contents_asset_id
         FROM emblem_vaults vault
         JOIN address_dictionary contract ON contract.address_id=vault.contract_id
        WHERE contract.address=? AND vault.token_id IN (${chunk.map(() => "?").join(",")})`,
      )
      .bind(contract, ...chunk)
      .all<{ token_id: string; contents_asset_id: number | null }>();
    for (const row of rows.results)
      if (row.contents_asset_id != null) assetByToken.set(row.token_id, row.contents_asset_id);
  }
  return asks.map((ask) => ({ ...ask, assetId: assetByToken.get(ask.tokenId) ?? null }));
}

/** Reconcile one fully observed contract inside an unpublished generation. */
export async function upsertEmblemListingContract(
  db: D1Database,
  generation: number,
  contract: string,
  rows: ListingRow[],
  observedAt: number,
): Promise<void> {
  const addresses = [...new Set([contract, ...rows.map((row) => row.currency)].filter((value) => value !== ""))];
  for (let index = 0; index < addresses.length; index += 80)
    await db.batch(
      addresses
        .slice(index, index + 80)
        .map((address) => db.prepare(`INSERT OR IGNORE INTO address_dictionary(address) VALUES(?)`).bind(address)),
    );
  for (let index = 0; index < rows.length; index += 50)
    await db.batch(
      rows.slice(index, index + 50).map((row) =>
        db
          .prepare(
            `INSERT INTO emblem_listings(
         generation,contract_id,token_id,asset_id,order_id,marketplace,price_usd,
         price_amount,currency_id,url,expiry,updated_at
       ) VALUES(
         ?,(SELECT address_id FROM address_dictionary WHERE address=?),?,?,?,?,?,?,
         (SELECT address_id FROM address_dictionary WHERE address=?),?,?,?
       )
       ON CONFLICT(generation,contract_id,token_id) DO UPDATE SET
         asset_id=excluded.asset_id,order_id=excluded.order_id,marketplace=excluded.marketplace,
         price_usd=excluded.price_usd,price_amount=excluded.price_amount,
         currency_id=excluded.currency_id,url=excluded.url,expiry=excluded.expiry,
         updated_at=excluded.updated_at`,
          )
          .bind(
            generation,
            contract,
            row.tokenId,
            row.assetId,
            row.orderId,
            row.marketplace,
            row.priceUsd,
            row.priceAmount,
            row.currency || null,
            `https://opensea.io/assets/ethereum/${contract}/${row.tokenId}`,
            row.expiry,
            observedAt,
          ),
      ),
    );
  // Rows not observed in this complete sweep are genuine delistings. The generation is not public yet.
  await db
    .prepare(
      `DELETE FROM emblem_listings
      WHERE generation=? AND contract_id=(SELECT address_id FROM address_dictionary WHERE address=?)
        AND updated_at<>?`,
    )
    .bind(generation, contract, observedAt)
    .run();
}

/** Advance a complete generation in bounded contract groups; publish only after every contract succeeds. */
export async function crawlEmblemListings(env: Env): Promise<Record<string, unknown>> {
  if (!env.SEQUENCE_ACCESS_KEY) return { skipped: "no SEQUENCE_ACCESS_KEY" };
  const contracts = await getCoreStateStringArray(env.CORE_DB, "emblem_contracts");
  if (contracts.length === 0) return { skipped: "no contracts" };

  const published = await getCoreStateInt(env.CORE_DB, "emblem_listings_generation");
  const generation = published + 1;
  let cursor = await getCoreStateInt(env.CORE_DB, "emblem_listings_contract_cursor");
  if (cursor < 0 || cursor >= contracts.length) cursor = 0;
  let live = 0;
  let upserts = 0;
  const processed: string[] = [];

  for (let count = 0; count < CONTRACTS_PER_RUN && cursor < contracts.length; count++) {
    const contract = contracts[cursor].toLowerCase();
    let asks: Ask[];
    try {
      asks = await sweepContract(env.SEQUENCE_ACCESS_KEY, contract);
    } catch (error) {
      return { generation, processed: processed.length, failed: contract, error: String(error).slice(0, 120) };
    }
    const observedAt = Date.now();
    const rows = await resolveAssets(env.CORE_DB, contract, asks);
    await upsertEmblemListingContract(env.CORE_DB, generation, contract, rows, observedAt);
    cursor++;
    await setCoreState(env.CORE_DB, "emblem_listings_contract_cursor", cursor);
    live += rows.length;
    upserts += rows.length;
    processed.push(contract);
  }

  if (cursor >= contracts.length) {
    await env.CORE_DB.batch([
      env.CORE_DB.prepare(
        `INSERT INTO core_state(key,value) VALUES('emblem_listings_generation',?)
         ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
      ).bind(String(generation)),
      env.CORE_DB.prepare(
        `INSERT INTO core_state(key,value) VALUES('emblem_listings_contract_cursor','0')
         ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
      ),
      env.CORE_DB.prepare(`DELETE FROM emblem_listings WHERE generation<?`).bind(generation),
    ]);
  }
  return { generation, published: cursor >= contracts.length, processed: processed.length, live, upserts };
}
