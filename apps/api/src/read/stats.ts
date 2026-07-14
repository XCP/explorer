/** Network-wide read surfaces: home summary, daily chart series, lifetime stats, leaderboards. */
import { router, cached, J } from "#api/read/respond";
import { rawSqlExpr, ADDRESS_FACTORS, ASSET_FACTORS } from "#api/reputation/score";
import { ASSET_PENALTY } from "#api/reputation/config";
import { boundedInteger } from "#api/http/numbers";
import { maxBlock, leaderboards, type MetricName } from "#api/queries/stats";
import {
  coreHomeOverview,
  coreMetricSeries,
  coreNetworkCounts,
  coreNetworkTotals,
  coreSyncOverview,
} from "#api/queries/core-stats";

export const stats = router();

/* ---------- home / stats ---------- */
// Home summary is a singleton lookup; edge stays short so `tip`/`indexed_block` feel live.
stats.get("/v2/", async (c) =>
  cached(c, "home", { ttl: 3600, edge: 120, swr: 86400 }, async () => ({
    result: await coreHomeOverview(c.env.CORE_DB),
  })),
);

// Live footer/status-strip heartbeat. This intentionally excludes global row counts: D1 Insights showed
// the old 60-second home query scanning ~5.2m rows per refresh (~20bn rows/week) for counts the heartbeat
// consumers never render.
stats.get("/v2/status", async (c) => J(c, { result: await coreSyncOverview(c.env.CORE_DB) }, 15));

/* ---------- metrics: daily time-series for charts (cached; GROUP BY day on block_time) ---------- */
stats.get("/v2/metrics", async (c) => {
  const days = boundedInteger(c.req.query("days"), { defaultValue: 90, min: 7, max: 365 });
  // Daily buckets do not justify full-history regrouping every 30 minutes. Six hours keeps today's partial
  // bucket useful while bounding each low-cardinality days variant to four producers/day.
  return cached(c, `metrics:${days}`, { ttl: 21600, edge: 300, swr: 86400 }, async () => {
    // each series is newest-first daily buckets; map to {t,v} points and reverse to oldest-first for the chart
    const series = async (name: MetricName) =>
      (await coreMetricSeries(c.env.CORE_DB, name, days))
        .map((r) => ({ t: r.d * 86400, v: Number(r.v) || 0 }))
        .reverse();
    const [transactions, issuances, dispenses, trades, sends, btc_fees, xcp_burned] = await Promise.all([
      series("transactions"),
      series("issuances"),
      series("dispenses"),
      series("trades"),
      series("sends"),
      series("btc_fees"),
      series("xcp_burned"),
    ]);
    return { result: { transactions, issuances, trades, dispenses, sends, btc_fees, xcp_burned } };
  });
});

/* ---------- network stats panel: all model counts + lifetime BTC fees / XCP destroyed (cached) ---------- */
stats.get("/v2/stats", async (c) =>
  cached(c, "stats", { ttl: 3600, edge: 120, swr: 86400 }, async () => {
    const counts = await coreNetworkCounts(c.env.CORE_DB);
    const totals = await coreNetworkTotals(c.env.CORE_DB);
    return { result: { ...counts, ...totals } };
  }),
);

/* ---------- leaderboards: derived relationships across the whole dataset (cached) ---------- */
stats.get("/v2/leaderboards", async (c) => {
  // Fast reads from precomputed signal tables. Low-quality assets (bridge/exchange tokens + wash) are
  // HIDDEN by default — they distort the BTC/dispense boards (?include_hidden=1 to show them).
  const incl = c.req.query("include_hidden") === "1";
  return cached(c, `lb:${incl ? 1 : 0}`, { ttl: 600, edge: 120, swr: 86400 }, async () => {
    // reputation/quality boards use the composed score (same config as the read scorer). tip ages the terms.
    const tip = await maxBlock(c.env.DB);
    const addrExpr = rawSqlExpr(ADDRESS_FACTORS, tip);
    const assetExpr = `(${rawSqlExpr(ASSET_FACTORS, 0)}) - (CASE WHEN low_quality=1 THEN ${-ASSET_PENALTY.lowQuality} ELSE 0 END)`;
    const boards = await leaderboards(c.env.DB, { includeHidden: incl, addrExpr, assetExpr });
    return { result: { ...boards, include_hidden: incl } };
  });
});
