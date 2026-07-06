/**
 * Admin / operational routes (token-gated): drive the chronological event mirror, the stepped reputation
 * signal rebuild, the Emblem crawl, and deterministic supply maintenance.
 */
import { Hono } from "hono";
import type { Env } from "./index";
import { syncEvents } from "./indexer/sync";
import { runSignalsStep, runSignalsCascade, verifySignals } from "./indexer/signals";
import { crawlEmblemStep } from "./indexer/emblem";
import { crawlAssetSupply } from "./indexer/asset-supply";
import { buildTags } from "./indexer/tags";
import { crawlCollections } from "./indexer/collections";
import { crawlEmblemSales } from "./indexer/emblem-sales";
import { buildTrades } from "./indexer/trades";
import { crawlPrices, applyTradeUsd } from "./indexer/prices";
import { curatedList, curatedUpsert, curatedDelete } from "./queries/curated";

export const admin = new Hono<{ Bindings: Env }>();

// Pull the admin token from `Authorization: Bearer <token>` (preferred) or the legacy `?token=` query
// param. TODO: drop the ?token= fallback once ops scripts have migrated to the Bearer header.
const adminToken = (c: { req: { header(name: string): string | undefined; query(name: string): string | undefined } }): string | undefined => {
  const auth = c.req.header("Authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7).trim();
  return c.req.query("token");
};

// every route is gated by the shared admin token (Bearer header, or deprecated ?token=).
admin.use("/admin/*", async (c, next) => {
  if (adminToken(c) !== c.env.ADMIN_TOKEN) return c.json({ error: "forbidden" }, 403);
  await next();
});

// Drive the full Counterparty mirror (chronological event replay). Repeat until caught_up.
admin.post("/admin/sync", async (c) => {
  const events = c.req.query("events") ? parseInt(c.req.query("events")!, 10) : undefined;
  return c.json(await syncEvents(c.env, { maxEvents: events }));
});

// Full re-index: reset the event cursor to -1 so the next /admin/sync (or cron) WIPES balances + snapshots
// and replays from event 0. Needed to heal balances corrupted by the old reorg high-water bug — the
// per-balance high-water makes a plain replay a no-op on existing balances, so they must be wiped first. Heavy.
admin.post("/admin/reindex", async (c) => {
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO indexer_state (key,value) VALUES ('last_event_index','-1') ON CONFLICT(key) DO UPDATE SET value='-1'`),
    c.env.DB.prepare(`INSERT INTO indexer_state (key,value) VALUES ('last_block_index','0') ON CONFLICT(key) DO UPDATE SET value='0'`),
    c.env.DB.prepare(`DELETE FROM indexer_state WHERE key='last_block_hash'`),
  ]);
  return c.json({ ok: true, note: "cursor reset to -1; next sync wipes balances+snapshots and replays from event 0" });
});

// Rebuild precomputed reputation signal tables (address_signals + asset_signals). Heavy; cron advances
// it a couple bounded passes per caught-up tick. Manual trigger here for on-demand refresh.
admin.post("/admin/refresh-signals", async (c) => {
  const steps = Math.min(6, Math.max(1, parseInt(c.req.query("steps") || "3", 10)));
  return c.json(await runSignalsStep(c.env, steps));
});

// Per-block dirty CASCADE (Layer B): recompute only the entities touched since the cascade cursor. Loop until
// caught_up. Returns needs_backfill until a full runSignalsStep cycle has anchored the cursor at tip.
admin.post("/admin/cascade-signals", async (c) => {
  return c.json(await runSignalsCascade(c.env));
});

// VERIFIER (safety gate): recompute one entity's non-periodic feature columns via the dirty `.scoped` SQL and
// diff against the value the full rebuild left. identical:true ⇒ the cascade matches the canonical rebuild.
//   /admin/verify-signals?scope=asset&id=RAREPEPE   ·   ?scope=address&id=1GQ...
admin.post("/admin/verify-signals", async (c) => {
  const scope = c.req.query("scope") === "address" ? "address" : "asset";
  const id = c.req.query("id");
  if (!id) return c.json({ error: "need ?id=" }, 400);
  return c.json(await verifySignals(c.env, scope, id));
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

// Refresh collection-membership tags (Rare Pepe / Fake Rare / Bitcorn / …) from pepe.wtf. Cron runs it ~daily;
// manual trigger here to rebuild on demand.
admin.post("/admin/crawl-collections", async (c) => {
  return c.json(await crawlCollections(c.env));
});

// Index Emblem vault sales (Alchemy getNFTSales) into emblem_sales. Loop until contract_done cycles; the
// `sample` field returns the raw Alchemy shape on the first run so we can confirm the fields.
admin.post("/admin/crawl-emblem-sales", async (c) => {
  return c.json(await crawlEmblemSales(c.env));
});

// Materialize the polymorphic `trades` ledger (dex + dispense + emblem). Loop until {done:true}; on-chain
// venues advance a Counterparty-block window per call, Emblem is re-folded whole each pass.
admin.post("/admin/build-trades", async (c) => {
  return c.json(await buildTrades(c.env));
});

// Backfill the daily USD price calendar (Coinbase BTC/ETH + DEX-derived XCP). Loop a couple times to backfill.
admin.post("/admin/crawl-prices", async (c) => {
  return c.json(await crawlPrices(c.env));
});

// Map trades onto the price calendar (fills usd_value). Loop until {done:true}.
admin.post("/admin/apply-usd", async (c) => {
  return c.json(await applyTradeUsd(c.env));
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
    const r = await c.env.DB.prepare(sql).first<Record<string, number>>();
    const lift = r && r.mean_rest ? Math.round((r.mean_target / r.mean_rest) * 100) / 100 : null;
    return c.json({ table, expr, target, corr, lift, ...r });
  } catch (e) {
    return c.json({ error: String((e as { message?: string })?.message ?? e).slice(0, 200), sql }, 400);
  }
});

// CURATED-LIST CRUD — edit the `curated` table (kind='lowq'|'burn'|'exchange'|'exchange_name'|'grail', …)
// without a redeploy. Changes take effect on the next signals/tags rebuild (lowq/burn/exchange) or next
// /v2/exchanges request (exchange_name). See queries/curated.ts + migration 0022.
//   GET    /admin/curated?kind=lowq                 — list rows of a kind
//   POST   /admin/curated  {kind,key,value?,note?}  — upsert one row
//   DELETE /admin/curated?kind=lowq&key=SCAMCOIN    — remove one row
admin.get("/admin/curated", async (c) => {
  const kind = c.req.query("kind");
  if (!kind) return c.json({ error: "need ?kind=" }, 400);
  return c.json({ kind, rows: await curatedList(c.env.DB, kind) });
});

admin.post("/admin/curated", async (c) => {
  const body = await c.req.json<{ kind?: string; key?: string; value?: string | null; note?: string | null }>().catch(() => null);
  if (!body?.kind || !body?.key) return c.json({ error: "need {kind,key}" }, 400);
  await curatedUpsert(c.env.DB, { kind: body.kind, key: body.key, value: body.value, note: body.note });
  return c.json({ ok: true, kind: body.kind, key: body.key });
});

admin.delete("/admin/curated", async (c) => {
  const kind = c.req.query("kind"), key = c.req.query("key");
  if (!kind || !key) return c.json({ error: "need ?kind= and ?key=" }, 400);
  const r = await curatedDelete(c.env.DB, kind, key);
  return c.json({ ok: true, kind, key, deleted: r.meta?.changes ?? 0 });
});
