#!/usr/bin/env node

/** Read-only evaluation of the Zaif history authorized for XCP.io production use. */
import { executeRemoteD1 } from "./lib/remote-d1.mjs";
import { fetchZaifHistory, summarizePriceAgreement } from "./lib/zaif-market-data.mjs";

const [btc, jpy] = await Promise.all([fetchZaifHistory("xcp_btc"), fetchZaifHistory("xcp_jpy")]);
const production = executeRemoteD1(`SELECT date(block_time,'unixepoch') day,COUNT(*) trades,
  SUM(usd_value IS NULL) missing FROM trades WHERE currency='XCP' GROUP BY 1`).rows;
const onchain = new Map(
  executeRemoteD1(`SELECT day,price xcpbtc,volume_base volume_xcp,trades
    FROM market_price_observations
    WHERE source='counterparty' AND venue='dex' AND base_currency='XCP' AND quote_currency='BTC'`).rows.map((row) => [
    row.day,
    row,
  ]),
);
const cmcUsd = executeRemoteD1(`SELECT day,price FROM market_price_observations
  WHERE source='coinmarketcap' AND venue='aggregate'
    AND base_currency='XCP' AND quote_currency='USD' ORDER BY day`).rows;
const btcUsd = new Map(
  executeRemoteD1(`SELECT day,usd FROM prices WHERE currency='BTC'`).rows.map((row) => [row.day, Number(row.usd)]),
);
const ecbRows = executeRemoteD1(`SELECT day,quote_currency,price FROM market_price_observations
  WHERE source='ecb' AND venue='reference' AND base_currency='EUR'
    AND quote_currency IN ('JPY','USD') ORDER BY day`).rows;
const ecb = new Map(ecbRows.map((row) => [`${row.day}:${row.quote_currency}`, Number(row.price)]));

function priorDays(day, maximumAge) {
  const start = Date.parse(`${day}T00:00:00Z`);
  return Array.from({ length: maximumAge + 1 }, (_, age) => ({
    age,
    day: new Date(start - age * 86_400_000).toISOString().slice(0, 10),
  }));
}

function ecbCross(day) {
  for (const candidate of priorDays(day, 4)) {
    const jpy = ecb.get(`${candidate.day}:JPY`);
    const usd = ecb.get(`${candidate.day}:USD`);
    if (jpy > 0 && usd > 0) return { usdPerJpy: usd / jpy, fxDay: candidate.day, ageDays: candidate.age };
  }
  return null;
}

const zaifJpyUsd = jpy.daily.flatMap((row) => {
  const cross = ecbCross(row.day);
  return cross
    ? [
        {
          day: row.day,
          price: row.price * cross.usdPerJpy,
          fx_day: cross.fxDay,
          fx_age_days: cross.ageDays,
          volume_xcp: row.volumeBase,
          executions: row.trades,
        },
      ]
    : [];
});
const zaifBtcUsd = btc.daily.flatMap((row) => {
  const usd = btcUsd.get(row.day);
  return usd > 0 ? [{ day: row.day, price: row.price * usd, volume_xcp: row.volumeBase, executions: row.trades }] : [];
});

function summary(history) {
  const days = new Set(history.daily.map((row) => row.day));
  const affected = production.filter((row) => days.has(row.day));
  return {
    files: history.urls.length,
    executions: history.trades.length,
    active_days: days.size,
    first_utc_day: history.daily[0]?.day ?? null,
    last_utc_day: history.daily.at(-1)?.day ?? null,
    counterparty_trade_days: affected.length,
    counterparty_trades: affected.reduce((sum, row) => sum + Number(row.trades), 0),
    currently_missing_rows: affected.reduce((sum, row) => sum + Number(row.missing), 0),
    missing_days_reached: affected.filter((row) => Number(row.missing) > 0).length,
  };
}

const overlaps = btc.daily
  .filter((row) => onchain.has(row.day))
  .map((row) => {
    const core = onchain.get(row.day);
    return {
      day: row.day,
      zaif: row.price,
      counterparty: Number(core.xcpbtc),
      absolute_log_error: Math.abs(Math.log(row.price / Number(core.xcpbtc))),
      zaif_volume: row.volumeBase,
      counterparty_volume: Number(core.volume_xcp),
    };
  })
  .sort((a, b) => a.absolute_log_error - b.absolute_log_error);

const percentile = (values, fraction) => values[Math.floor((values.length - 1) * fraction)] ?? null;
const errors = overlaps.map((row) => row.absolute_log_error);
const union = new Set([...btc.daily.map((row) => row.day), ...jpy.daily.map((row) => row.day)]);
const unionAffected = production.filter((row) => union.has(row.day));

console.log(
  JSON.stringify(
    {
      generated_at: new Date().toISOString(),
      provenance: { source: "zaif", venue: "cex", production_use: "permission_granted" },
      xcp_btc: summary(btc),
      xcp_jpy: summary(jpy),
      combined: {
        active_days: union.size,
        counterparty_trade_days: unionAffected.length,
        currently_missing_rows: unionAffected.reduce((sum, row) => sum + Number(row.missing), 0),
        missing_days_reached: unionAffected.filter((row) => Number(row.missing) > 0).length,
      },
      xcp_btc_overlap: {
        days: overlaps.length,
        median_absolute_log_error: percentile(errors, 0.5),
        p90_absolute_log_error: percentile(errors, 0.9),
        p99_absolute_log_error: percentile(errors, 0.99),
        worst: overlaps.slice(-10).reverse(),
      },
      usd_corroboration: {
        policy:
          "Zaif daily volume-weighted median; selected daily BTC/USD or official ECB JPY/USD with <=4-day weekend carry",
        xcp_jpy_vs_cmc: {
          ...summarizePriceAgreement(zaifJpyUsd, cmcUsd),
          candidate_days: zaifJpyUsd.length,
          maximum_fx_age_days: Math.max(...zaifJpyUsd.map((row) => row.fx_age_days)),
        },
        xcp_btc_vs_cmc: {
          ...summarizePriceAgreement(zaifBtcUsd, cmcUsd),
          candidate_days: zaifBtcUsd.length,
        },
        jpy_path_vs_btc_path: summarizePriceAgreement(zaifJpyUsd, zaifBtcUsd),
      },
    },
    null,
    2,
  ),
);
