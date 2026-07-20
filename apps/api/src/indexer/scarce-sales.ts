/**
 * Scarce.city SALES history — the Bitcoin-native card marketplace, a venue our Ethereum/Alchemy Emblem
 * crawl is entirely blind to. Source: scarce.city's live public API (the old app's
 * ProcessScarceCityTradeHistoryJob used the same): GET /api/marketplace/digital/{asset}/sales →
 * [{ assetName, priceInBtc, timestamp (RFC-1123) }]. No listing endpoint exists, so we sweep our own
 * asset universe (resumable rowid cursor), query per asset, and keep the hits. Feeds the unified sales
 * stream as the 'scarce.city' venue (BTC-priced). Idempotent on (asset, sold_at).
 */
import type { Env } from "#api/env";
import { fetchScarceCitySales } from "#api/integrations/scarce-city";
import { getCoreStateInt, setCoreState } from "#api/indexer/core-state";

const ASSETS_PER_RUN = 90; // bounded per cron tick (stays well under the Worker subrequest/CPU budget)
const CONCURRENCY = 5;
export const SCARCE_SALE_UPSERT_SQL = `INSERT INTO scarce_city_sales(asset_id,sold_at,price_btc)
  SELECT asset_id,?,? FROM asset_dictionary WHERE asset=?
  ON CONFLICT(asset_id,sold_at) DO UPDATE SET price_btc=excluded.price_btc`;

export function nextScarceCursor(rows: Array<{ asset_id: number }>, firstFailedAssetId: number | null): number {
  if (!rows.length) return 0;
  return firstFailedAssetId === null ? rows[rows.length - 1].asset_id : firstFailedAssetId - 1;
}

/** One bounded, resumable step: sweep the next ASSETS_PER_RUN assets by rowid, query scarce.city for
 *  each, upsert any sales. Wraps the cursor at the end of the universe to re-sweep for new sales. */
export async function crawlScarceSales(env: Env): Promise<Record<string, unknown>> {
  const cursor = await getCoreStateInt(env.CORE_DB, "scarce_cursor");
  const rows =
    (
      await env.CORE_DB.prepare(
        `SELECT asset_id,asset FROM asset_dictionary WHERE asset_id>? ORDER BY asset_id LIMIT ?`,
      )
        .bind(cursor, ASSETS_PER_RUN)
        .all<{ asset_id: number; asset: string }>()
    ).results || [];

  const out: { from: number; to: number; assets: number; sales_found: number; failed: number; wrapped?: boolean } = {
    from: cursor,
    to: cursor,
    assets: rows.length,
    sales_found: 0,
    failed: 0,
  };
  if (!rows.length) {
    // past the end — wrap to re-sweep for new sales next tick
    await setCoreState(env.CORE_DB, "scarce_cursor", 0);
    out.wrapped = true;
    return out;
  }

  // fetch in small concurrent waves; collect upserts
  const upserts: { asset: string; sold_at: number; price: number }[] = [];
  let firstFailedAssetId: number | null = null;
  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    const wave = rows.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      wave.map(async (row) => {
        try {
          return { row, sales: await fetchScarceCitySales(row.asset), failed: false };
        } catch {
          return { row, sales: [], failed: true };
        }
      }),
    );
    for (const { row, sales, failed } of results) {
      if (failed) {
        out.failed++;
        firstFailedAssetId = firstFailedAssetId === null ? row.asset_id : Math.min(firstFailedAssetId, row.asset_id);
        continue;
      }
      for (const s of sales) {
        const t = s.timestamp ? Math.floor(Date.parse(s.timestamp) / 1000) : NaN;
        const p = Number(s.priceInBtc);
        if (!Number.isFinite(t) || !Number.isFinite(p) || p <= 0) continue;
        upserts.push({ asset: row.asset, sold_at: t, price: p });
      }
    }
  }

  if (upserts.length) {
    const stmts = upserts.map((u) => env.CORE_DB.prepare(SCARCE_SALE_UPSERT_SQL).bind(u.sold_at, u.price, u.asset));
    for (let i = 0; i < stmts.length; i += 50) await env.CORE_DB.batch(stmts.slice(i, i + 50));
    out.sales_found = upserts.length;
  }

  const last = nextScarceCursor(rows, firstFailedAssetId);
  await setCoreState(env.CORE_DB, "scarce_cursor", last);
  out.to = last;
  return out;
}
