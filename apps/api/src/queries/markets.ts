export interface UsdQuoteRow {
  usd: number;
  day: string;
}

export function latestUsdQuote(db: D1Database, asset: string): Promise<UsdQuoteRow | null> {
  return db
    .prepare(`SELECT usd, day FROM prices WHERE currency=? ORDER BY day DESC LIMIT 1`)
    .bind(asset)
    .first<UsdQuoteRow>();
}
