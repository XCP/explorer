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
import { getIndexerState as getState, setIndexerState as setState } from "#api/indexer/state";

const ASSETS_PER_RUN = 90; // bounded per cron tick (stays well under the Worker subrequest/CPU budget)
const CONCURRENCY = 5;

export function nextScarceCursor(rows: Array<{ rowid: number }>, firstFailedRowid: number | null): number {
  if (!rows.length) return 0;
  return firstFailedRowid === null ? rows[rows.length - 1].rowid : firstFailedRowid - 1;
}

export const SCARCE_SALES_DDL = `CREATE TABLE IF NOT EXISTS scarce_city_sales (
  asset TEXT NOT NULL, sold_at INTEGER NOT NULL, price_btc REAL NOT NULL, PRIMARY KEY (asset, sold_at))`;
export const SCARCE_SALES_IDX = `CREATE INDEX IF NOT EXISTS idx_scarce_asset ON scarce_city_sales(asset)`;

/** One bounded, resumable step: sweep the next ASSETS_PER_RUN assets by rowid, query scarce.city for
 *  each, upsert any sales. Wraps the cursor at the end of the universe to re-sweep for new sales. */
export async function crawlScarceSales(env: Env): Promise<Record<string, unknown>> {
  await env.DB.prepare(SCARCE_SALES_DDL).run();
  await env.DB.prepare(SCARCE_SALES_IDX).run();

  const cursor = parseInt((await getState(env.DB, "scarce_cursor")) || "0", 10);
  const rows =
    (
      await env.DB.prepare(`SELECT rowid, asset FROM assets WHERE rowid > ? ORDER BY rowid LIMIT ?`)
        .bind(cursor, ASSETS_PER_RUN)
        .all<{ rowid: number; asset: string }>()
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
    await setState(env.DB, "scarce_cursor", "0");
    out.wrapped = true;
    return out;
  }

  // fetch in small concurrent waves; collect upserts
  const upserts: { asset: string; sold_at: number; price: number }[] = [];
  let firstFailedRowid: number | null = null;
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
        firstFailedRowid = firstFailedRowid === null ? row.rowid : Math.min(firstFailedRowid, row.rowid);
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
    const stmts = upserts.map((u) =>
      env.DB.prepare(`INSERT OR IGNORE INTO scarce_city_sales (asset,sold_at,price_btc) VALUES (?,?,?)`).bind(
        u.asset,
        u.sold_at,
        u.price,
      ),
    );
    for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
    out.sales_found = upserts.length;
  }

  const last = nextScarceCursor(rows, firstFailedRowid);
  await setState(env.DB, "scarce_cursor", String(last));
  out.to = last;
  return out;
}
