/**
 * Admin / operational routes (token-gated): drive the chronological event mirror, the stepped reputation
 * signal rebuild, the Emblem crawl, and deterministic supply maintenance.
 */
import { Hono } from "hono";
import type { Env } from "./index";
import { syncEvents } from "./indexer/sync";
import { runSignalsStep } from "./indexer/signals";
import { crawlEmblemStep } from "./indexer/emblem";
import { crawlAssetSupply } from "./indexer/asset-supply";
import { buildTags } from "./indexer/tags";

export const admin = new Hono<{ Bindings: Env }>();

// every route is gated by the shared admin token (?token=…).
admin.use("/admin/*", async (c, next) => {
  if (c.req.query("token") !== c.env.ADMIN_TOKEN) return c.json({ error: "forbidden" }, 403);
  await next();
});

// Drive the full Counterparty mirror (chronological event replay). Repeat until caught_up.
admin.post("/admin/sync", async (c) => {
  const events = c.req.query("events") ? parseInt(c.req.query("events")!, 10) : undefined;
  return c.json(await syncEvents(c.env, { maxEvents: events }));
});

// Rebuild precomputed reputation signal tables (address_signals + asset_signals). Heavy; cron advances
// it a couple bounded passes per caught-up tick. Manual trigger here for on-demand refresh.
admin.post("/admin/refresh-signals", async (c) => {
  const steps = Math.min(6, Math.max(1, parseInt(c.req.query("steps") || "3", 10)));
  return c.json(await runSignalsStep(c.env, steps));
});

// Advance the Emblem Vault crawl one step: enumerate token ids (Alchemy, per-contract pageKey cursor) +
// resolve BTC addresses (keyless /meta). Stores only (contract, token id, btc address); contents come
// from our own Counterparty ledger. Loop this to backfill.
admin.post("/admin/crawl-emblem", async (c) => {
  return c.json(await crawlEmblemStep(c.env));
});

// Advance deterministic asset-supply maintenance one step (recomputes supply from our own ledger —
// BACKFILL phase walks all assets once; MAINTENANCE recomputes dirty assets + XCP + fairminter/pool derivations).
admin.post("/admin/crawl-supply", async (c) => {
  return c.json(await crawlAssetSupply(c.env));
});

// Rebuild the polymorphic tags table from signals + curated lists (the categorical layer). Cron runs it
// after the signals refresh; manual trigger here.
admin.post("/admin/build-tags", async (c) => {
  return c.json(await buildTags(c.env));
});

// SIGNAL-TEST HARNESS — the research loop's measuring stick. Score a CANDIDATE signal (any SQL expression
// over the signal table, no column/rebuild needed) against a proxy TARGET, in one call:
//   table=asset|address  expr=<sql>  target=<sql bool>  where=<sql>  corr=<existing-signal sql>
// Returns coverage, distribution, separation (mean for target=1 vs 0 + lift = how many× higher in the
// target population = discriminative power), and Pearson corr vs an existing signal (the duplicate detector).
// Admin-only, so raw SQL in expr/target is intentional. Example:
//   /admin/signal-test?table=asset&expr=trades*1.0/NULLIF(holders,0)&target=holders>=5&corr=trades&where=holders>=5
admin.post("/admin/signal-test", async (c) => {
  const table = c.req.query("table") === "address" ? "address_signals" : "asset_signals";
  const expr = c.req.query("expr");
  if (!expr) return c.json({ error: "need ?expr=" }, 400);
  const target = c.req.query("target") || "0";
  const where = c.req.query("where") || "1=1";
  const corr = c.req.query("corr") || "0";
  const sql = `WITH b AS (SELECT (${expr})*1.0 x, (CASE WHEN ${target} THEN 1 ELSE 0 END) t, (${corr})*1.0 c FROM ${table} WHERE ${where})
    SELECT COUNT(*) n,
      SUM(CASE WHEN x IS NOT NULL AND x<>0 THEN 1 ELSE 0 END) nonzero,
      ROUND(AVG(x),4) mean, ROUND(MIN(x),4) min, ROUND(MAX(x),4) max,
      SUM(t) n_target, ROUND(AVG(CASE WHEN t=1 THEN x END),4) mean_target, ROUND(AVG(CASE WHEN t=0 THEN x END),4) mean_rest,
      ROUND((COUNT(*)*SUM(x*c)-SUM(x)*SUM(c))/NULLIF(SQRT((COUNT(*)*SUM(x*x)-SUM(x)*SUM(x))*(COUNT(*)*SUM(c*c)-SUM(c)*SUM(c))),0),3) corr_with
    FROM b WHERE x IS NOT NULL`;
  try {
    const r = await c.env.DB.prepare(sql).first<any>();
    const lift = r && r.mean_rest ? Math.round((r.mean_target / r.mean_rest) * 100) / 100 : null;
    return c.json({ table, expr, target, corr, lift, ...r });
  } catch (e: any) {
    return c.json({ error: String(e?.message ?? e).slice(0, 200), sql }, 400);
  }
});
