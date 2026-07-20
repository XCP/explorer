#!/usr/bin/env node

import { executeRemoteD1 } from "./lib/remote-d1.mjs";
import { fetchEcbReferenceRates } from "./lib/ecb-fx-data.mjs";

const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
const history = await fetchEcbReferenceRates();
let written = 0;
for (let offset = 0; offset < history.rows.length; offset += 60) {
  const values = history.rows
    .slice(offset, offset + 60)
    .map(
      (row) =>
        `(${[
          quote(row.day),
          quote(row.baseCurrency),
          quote(row.quoteCurrency),
          quote("ecb"),
          quote("reference"),
          row.price,
          0,
          0,
          quote("official_daily_reference"),
        ].join(",")})`,
    )
    .join(",");
  const result = executeRemoteD1(`INSERT INTO market_price_observations(
    day,base_currency,quote_currency,source,venue,price,volume_base,trades,method
  ) VALUES ${values}
  ON CONFLICT(day,base_currency,quote_currency,source,venue) DO UPDATE SET
    price=excluded.price,method=excluded.method
  WHERE market_price_observations.price IS NOT excluded.price
    OR market_price_observations.method IS NOT excluded.method`);
  written += Number(result.meta.changes ?? result.meta.rows_written ?? 0);
}
executeRemoteD1(`INSERT INTO market_price_imports(
  source,venue,dataset,source_url,sha256,fetched_at,rows
) VALUES('ecb','reference','eur_fx',${quote(history.url)},${quote(history.sha256)},${history.fetchedAt},${history.rows.length})
ON CONFLICT(source,dataset,source_url) DO UPDATE SET
  venue=excluded.venue,sha256=excluded.sha256,fetched_at=excluded.fetched_at,rows=excluded.rows
WHERE market_price_imports.venue IS NOT excluded.venue
  OR market_price_imports.sha256 IS NOT excluded.sha256
  OR market_price_imports.rows IS NOT excluded.rows`);
console.log(JSON.stringify({ observations_written: written, source_rows: history.rows.length }, null, 2));
