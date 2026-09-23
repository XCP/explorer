/** Recompute only already-selected bridges using their original admission rules. */
const CURRENCIES = ["BITCORN", "WILLCOIN", "MAFIACASH", "DANKMEMECASH", "RUSTBITS", "PEPECASH"];
const quoted = CURRENCIES.map((value) => `'${value}'`).join(",");

function median(rows) {
  const sorted = [...rows].sort((a, b) => a.price - b.price);
  const total = sorted.reduce((sum, row) => sum + row.weight, 0);
  let cumulative = 0;
  return sorted.find((row) => (cumulative += row.weight) * 2 >= total)?.price ?? null;
}

export function selectBridgePrice(currency, dex, dispenses) {
  if (dex.length < 2) return null;
  const xcpPrice = median(dex);
  if (currency === "PEPECASH") {
    if (dispenses.length < 2 || new Set(dispenses.map((row) => row.seller)).size < 2) return null;
    const btcPrice = median(dispenses);
    return btcPrice > 0 && xcpPrice > 0 && Math.abs(Math.log(btcPrice / xcpPrice)) <= Math.log(1.1) ? btcPrice : null;
  }
  const pairs = new Set(dex.map((row) => row.pair));
  const low = Math.min(...dex.map((row) => row.price));
  const high = Math.max(...dex.map((row) => row.price));
  return pairs.size >= 2 && low > 0 && high / low <= 4 ? xcpPrice : null;
}

export function repairPaymentBridges(run) {
  const selected = run(
    "bridge-days",
    `SELECT day,currency FROM prices
    WHERE source='counterparty_dex_bridge' AND currency IN (${quoted})`,
  );
  const dex = run(
    "bridge-dex-executions",
    `WITH fills AS (
    SELECT date(m.block_time,'unixepoch') day,
      CASE WHEN f.asset='XCP' THEN b.asset ELSE f.asset END currency,
      CAST(CASE WHEN f.asset='XCP' THEN m.forward_quantity ELSE m.backward_quantity END AS REAL)/1e8 xcp,
      CAST(CASE WHEN f.asset='XCP' THEN m.backward_quantity ELSE m.forward_quantity END AS REAL)
        /CASE WHEN a.divisible=1 THEN 1e8 ELSE 1 END weight,
      MIN(m.tx0_address_id,m.tx1_address_id)||':'||MAX(m.tx0_address_id,m.tx1_address_id) pair
    FROM order_matches m JOIN asset_dictionary f ON f.asset_id=m.forward_asset_id
    JOIN asset_dictionary b ON b.asset_id=m.backward_asset_id
    JOIN assets a ON a.asset_id=CASE WHEN f.asset='XCP' THEN m.backward_asset_id ELSE m.forward_asset_id END
    WHERE m.status='completed' AND CAST(m.forward_quantity AS REAL)>0 AND CAST(m.backward_quantity AS REAL)>0
      AND ((f.asset='XCP' AND b.asset IN (${quoted})) OR (b.asset='XCP' AND f.asset IN (${quoted})))
  ) SELECT fills.day,fills.currency,fills.weight,fills.pair,fills.xcp/fills.weight*xcp.usd price
    FROM fills JOIN prices selected ON selected.day=fills.day AND selected.currency=fills.currency
      AND selected.source='counterparty_dex_bridge'
    JOIN prices xcp ON xcp.day=fills.day AND xcp.currency='XCP' WHERE fills.weight>0`,
  );
  const dispenses = run(
    "bridge-dispense-executions",
    `SELECT date(d.block_time,'unixepoch') day,
      d.source_id seller,CAST(d.dispense_quantity AS REAL)/1e8 weight,
      d.quote_sats/CAST(d.dispense_quantity AS REAL)*btc.usd price
    FROM dispenses d JOIN prices selected ON selected.day=date(d.block_time,'unixepoch')
      AND selected.currency='PEPECASH' AND selected.source='counterparty_dex_bridge'
    JOIN prices btc ON btc.day=selected.day AND btc.currency='BTC'
    WHERE d.asset_id=(SELECT asset_id FROM asset_dictionary WHERE asset='PEPECASH')
      AND d.quote_sats>0 AND CAST(d.dispense_quantity AS REAL)>0`,
  );
  const sqlString = (value) => `'${String(value).replaceAll("'", "''")}'`;
  let removed = 0;
  const updates = selected.map(({ day, currency }) => {
    const price = selectBridgePrice(
      currency,
      dex.filter((row) => row.day === day && row.currency === currency),
      dispenses.filter((row) => row.day === day),
    );
    if (price === null) removed++;
    else if (!Number.isFinite(price) || price <= 0) throw new Error("Invalid bridge price");
    return `(${sqlString(day)},${sqlString(currency)},${price ?? "NULL"})`;
  });
  for (let offset = 0; offset < updates.length; offset += 50) {
    const cte = `WITH corrected(day,currency,usd) AS (VALUES ${updates.slice(offset, offset + 50).join(",")})`;
    run(
      "bridge-price-update",
      `${cte} UPDATE prices SET usd=c.usd FROM corrected c
      WHERE prices.day=c.day AND prices.currency=c.currency AND prices.source='counterparty_dex_bridge'
        AND c.usd IS NOT NULL AND prices.usd IS NOT c.usd`,
    );
    run(
      "bridge-observation-update",
      `${cte} UPDATE market_price_observations SET price=c.usd FROM corrected c
      WHERE market_price_observations.day=c.day AND base_currency=c.currency AND quote_currency='USD'
        AND source='counterparty' AND venue='dex' AND method='exact_day_bridge_vwm'
        AND c.usd IS NOT NULL AND price IS NOT c.usd`,
    );
    run(
      "bridge-price-prune",
      `${cte} DELETE FROM prices WHERE source='counterparty_dex_bridge'
      AND EXISTS(SELECT 1 FROM corrected c WHERE c.day=prices.day AND c.currency=prices.currency AND c.usd IS NULL)`,
    );
    run(
      "bridge-observation-prune",
      `${cte} DELETE FROM market_price_observations
      WHERE quote_currency='USD' AND source='counterparty' AND venue='dex' AND method='exact_day_bridge_vwm'
      AND EXISTS(SELECT 1 FROM corrected c WHERE c.day=market_price_observations.day
        AND c.currency=base_currency AND c.usd IS NULL)`,
    );
  }
  console.log(JSON.stringify({ bridgeDays: selected.length, withdrawnAfterCorrection: removed }));
}
