/** Network-wide read surfaces: home summary, daily chart series, lifetime stats, leaderboards. */
import { router, cached, J } from "#api/read/respond";
import { boundedInteger } from "#api/http/numbers";
import { leaderboards, type MetricName } from "#api/queries/stats";
import {
  coreHomeOverview,
  coreMetricSeriesSet,
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
  const days = boundedInteger(c.req.query("days"), { defaultValue: 90, min: 7, max: 5000 });
  // Daily buckets do not justify full-history regrouping every 30 minutes. Six hours keeps today's partial
  // bucket useful while bounding each low-cardinality days variant to four producers/day.
  return cached(c, `metrics:v2:${days}`, { ttl: 21600, edge: 300, swr: 86400 }, async () => {
    // each series is newest-first daily buckets; map to {t,v} points and reverse to oldest-first for the chart
    const names: MetricName[] = [
      "transactions",
      "bitcoin_transactions",
      "xcp_share",
      "issuances",
      "dispenses",
      "trades",
      "sends",
      "btc_fees",
      "xcp_burned",
    ];
    const rows = await coreMetricSeriesSet(c.env.CORE_DB, names, days);
    const series = (name: MetricName) => rows[name].map((r) => ({ t: r.d * 86400, v: Number(r.v) || 0 })).reverse();
    const [transactions, bitcoin_transactions, xcp_share, issuances, dispenses, trades, sends, btc_fees, xcp_burned] =
      names.map(series);
    return {
      result: {
        transactions,
        bitcoin_transactions,
        xcp_share,
        issuances,
        trades,
        dispenses,
        sends,
        btc_fees,
        xcp_burned,
      },
    };
  });
});

/* ---------- network stats panel: all model counts + lifetime BTC fees / XCP destroyed (cached) ---------- */
stats.get("/v2/stats", async (c) => {
  // Network counts are materialized by the canonical maintenance lane. A 24-hour cache made newly
  // issued assets appear absent from /stats even while /assets was current; keep the edge short and
  // let stale-while-revalidate absorb the occasional D1 refresh without hiding a whole day's work.
  return cached(c, "stats:all-chain:v2", { ttl: 300, edge: 120, swr: 1800 }, async () => {
    const counts = await coreNetworkCounts(c.env.CORE_DB);
    const totals = await coreNetworkTotals(c.env.CORE_DB);
    return { result: { ...counts, ...totals } };
  });
});

/* ---------- leaderboards: derived relationships across the whole dataset (cached) ---------- */
stats.get("/v2/leaderboards", async (c) => {
  // Fast reads from precomputed signal tables. Low-quality assets (bridge/exchange tokens + wash) are
  // HIDDEN by default — they distort the BTC/dispense boards (?include_hidden=1 to show them).
  const incl = c.req.query("include_hidden") === "1";
  return cached(c, `leaderboards:ratings:v1:${incl ? 1 : 0}`, { ttl: 3600, edge: 300, swr: 86400 }, async () => {
    const boards = await leaderboards(c.env.CORE_DB, { includeHidden: incl });
    return { result: { ...boards, include_hidden: incl } };
  });
});
