/** Network-wide read surfaces: home summary, daily chart series, lifetime stats, leaderboards. */
import { router, cached, J } from "./respond";
import { rawSqlExpr, ADDRESS_FACTORS, ASSET_FACTORS } from "../reputation/score";
import { ASSET_PENALTY } from "../reputation/config";
import {
  homeOverview, syncOverview, networkCounts, networkTotals, metricSeries, maxBlock, leaderboards, type MetricName,
} from "../queries/stats";

export const stats = router();

/* ---------- home / stats ---------- */
// home summary — counts are O(n) covering-index scans (millions of rows); the D1 response cache runs them at
// most once/ttl globally instead of once per colo. Edge stays short so `tip`/`indexed_block` feel live.
stats.get("/v2/", async (c) =>
  cached(c, "home", { ttl: 3600, edge: 120, swr: 86400 }, async () => ({
    result: await homeOverview(c.env.DB),
  })));

// Live footer/status-strip heartbeat. This intentionally excludes global row counts: D1 Insights showed
// the old 60-second home query scanning ~5.2m rows per refresh (~20bn rows/week) for counts the heartbeat
// consumers never render.
stats.get("/v2/status", async (c) =>
  J(c, { result: await syncOverview(c.env.DB) }, 15));

/* ---------- metrics: daily time-series for charts (cached; GROUP BY day on block_time) ---------- */
stats.get("/v2/metrics", async (c) => {
  const days = Math.min(365, Math.max(7, parseInt(c.req.query("days") || "90", 10)));
  return cached(c, `metrics:${days}`, { ttl: 1800, edge: 300 }, async () => {
  // each series is newest-first daily buckets; map to {t,v} points and reverse to oldest-first for the chart
  const series = async (name: MetricName) => (await metricSeries(c.env.DB, name, days))
    .map((r) => ({ t: r.d * 86400, v: Number(r.v) || 0 })).reverse();
  const [transactions, issuances, dispenses, trades, sends, btc_fees, xcp_burned] = await Promise.all([
    series("transactions"), series("issuances"), series("dispenses"), series("trades"),
    series("sends"), series("btc_fees"), series("xcp_burned"),
  ]);
  return { result: { transactions, issuances, trades, dispenses, sends, btc_fees, xcp_burned } };
  });
});

/* ---------- network stats panel: all model counts + lifetime BTC fees / XCP destroyed (cached) ---------- */
stats.get("/v2/stats", async (c) =>
  cached(c, "stats", { ttl: 3600, edge: 120, swr: 86400 }, async () => { // day-long stale window: nobody ever blocks on the full recount
  const counts = await networkCounts(c.env.DB);
  const totals = await networkTotals(c.env.DB);
  return { result: { ...counts, ...totals } };
  }));

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
