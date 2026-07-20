#!/usr/bin/env node

/** Materialize reviewed exact-day collection-currency bridges and no other recursive paths. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { executeRemoteD1 } from "./lib/remote-d1.mjs";

const BRIDGES = ["BITCORN", "WILLCOIN", "MAFIACASH", "DANKMEMECASH", "RUSTBITS"];
const quoted = BRIDGES.map((asset) => `'${asset}'`).join(",");
const metadata = executeRemoteD1(`SELECT dictionary.asset,asset.divisible
  FROM asset_dictionary dictionary JOIN assets asset USING(asset_id)
  WHERE dictionary.asset IN (${quoted})`).rows;
const scale = Object.fromEntries(metadata.map((row) => [row.asset, row.divisible ? 1e8 : 1]));
scale.XCP = 1e8;

const executions = executeRemoteD1(`SELECT date(match.block_time,'unixepoch') day,
    forward.asset forward_asset,CAST(match.forward_quantity AS REAL) forward_quantity,
    backward.asset backward_asset,CAST(match.backward_quantity AS REAL) backward_quantity,
    match.block_time,match.tx0_address_id,match.tx1_address_id,price.usd xcp_usd
  FROM order_matches match
  JOIN asset_dictionary forward ON forward.asset_id=match.forward_asset_id
  JOIN asset_dictionary backward ON backward.asset_id=match.backward_asset_id
  JOIN prices price ON price.day=date(match.block_time,'unixepoch') AND price.currency='XCP'
  WHERE match.status='completed' AND
    ((forward.asset IN (${quoted}) AND backward.asset='XCP') OR
     (backward.asset IN (${quoted}) AND forward.asset='XCP'))`).rows;

function weightedMedian(rows) {
  const sorted = [...rows].sort((left, right) => left.price - right.price);
  const midpoint = sorted.reduce((sum, row) => sum + row.weight, 0) / 2;
  let cumulative = 0;
  for (const row of sorted) {
    cumulative += row.weight;
    if (cumulative >= midpoint) return row.price;
  }
  throw new Error("Weighted median received no rows");
}

const candidates = [];
for (const bridge of BRIDGES) {
  const days = Map.groupBy(
    executions.filter((row) => row.forward_asset === bridge || row.backward_asset === bridge),
    (row) => row.day,
  );
  for (const [day, rows] of days) {
    const normalized = rows.map((row) => {
      const forward = row.forward_quantity / scale[row.forward_asset];
      const backward = row.backward_quantity / scale[row.backward_asset];
      const bridgeQuantity = row.forward_asset === bridge ? forward : backward;
      const xcpQuantity = row.forward_asset === "XCP" ? forward : backward;
      return { price: (xcpQuantity / bridgeQuantity) * row.xcp_usd, weight: bridgeQuantity };
    });
    const addressPairs = new Set(
      rows.map((row) => [row.tx0_address_id, row.tx1_address_id].sort((a, b) => a - b).join(":")),
    ).size;
    const minimum = Math.min(...normalized.map((row) => row.price));
    const maximum = Math.max(...normalized.map((row) => row.price));
    if (rows.length < 2 || addressPairs < 2 || maximum / minimum > 4) continue;
    candidates.push({
      day,
      bridge,
      usd: weightedMedian(normalized),
      executions: rows.length,
      addressPairs,
      volume: normalized.reduce((sum, row) => sum + row.weight, 0),
      firstTime: Math.min(...rows.map((row) => row.block_time)),
      lastTime: Math.max(...rows.map((row) => row.block_time)),
      dispersion: maximum / minimum,
    });
  }
}

const pepecashPath = resolve(
  process.env.PEPECASH_POST2020_INPUT || "../../docs/data/pepecash-post2020-census-2026-07-18.json",
);
const pepecash = JSON.parse(readFileSync(pepecashPath, "utf8"))
  .days.filter((row) => row.admitted)
  .map((row) => ({
    day: row.day,
    bridge: "PEPECASH",
    usd: row.selected_usd_per_pepecash,
    executions: row.dispenser_executions + row.xcp_executions,
    addressPairs: row.distinct_dispenser_sellers,
    volume: row.dispenser_volume_pepecash + row.xcp_volume_pepecash,
    firstTime: null,
    lastTime: null,
    dispersion: Math.exp(row.absolute_log_error ?? 0),
  }));
candidates.push(...pepecash);

const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
const number = (value) => (value == null ? "NULL" : String(value));
for (let offset = 0; offset < candidates.length; offset += 50) {
  const batch = candidates.slice(offset, offset + 50);
  const observations = batch
    .map(
      (row) =>
        `(${quote(row.day)},${quote(row.bridge)},'USD','counterparty','dex',${row.usd},${row.volume},${row.executions},${number(row.firstTime)},${number(row.lastTime)},'exact_day_bridge_vwm')`,
    )
    .join(",");
  executeRemoteD1(`INSERT INTO market_price_observations(
      day,base_currency,quote_currency,source,venue,price,volume_base,trades,first_time,last_time,method)
    VALUES ${observations}
    ON CONFLICT(day,base_currency,quote_currency,source,venue) DO UPDATE SET
      price=excluded.price,volume_base=excluded.volume_base,trades=excluded.trades,
      first_time=excluded.first_time,last_time=excluded.last_time,method=excluded.method`);
  const prices = batch
    .map(
      (row) =>
        `(${quote(row.day)},${quote(row.bridge)},${row.usd},'counterparty_dex_bridge',${quote(row.day)},1,'usd-payment-bridge-v1','derived',0,2,${row.executions},1,${row.volume},${quote(`within_${row.dispersion.toFixed(2)}x`)},'reviewed_exact_day_bridge')`,
    )
    .join(",");
  executeRemoteD1(`INSERT INTO prices(day,currency,usd,source,observed_day,fidelity,policy_version,price_kind,
      age_days,derivation_depth,observation_count,venue_count,volume_base,disagreement_class,selection_reason)
    VALUES ${prices}
    ON CONFLICT(day,currency) DO NOTHING`);
}

console.log(
  JSON.stringify({
    candidates: candidates.length,
    by_bridge: Object.fromEntries(
      [...new Set(candidates.map((row) => row.bridge))]
        .sort()
        .map((bridge) => [bridge, candidates.filter((row) => row.bridge === bridge).length]),
    ),
  }),
);
