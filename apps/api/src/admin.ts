/**
 * Admin / operational routes (token-gated): drive the chronological event mirror, the stepped reputation
 * signal rebuild, the Emblem crawl, and deterministic supply maintenance.
 */
import { Hono } from "hono";
import type { Env } from "#api/env";
import { syncEvents, syncCompactEvents, backfillLedger } from "#api/indexer/sync";
import { runSignalsStep, runSignalsCascade, verifySignals } from "#api/indexer/signals";
import { crawlEmblemStep } from "#api/indexer/emblem";
import { crawlAssetSupply } from "#api/indexer/asset-supply";
import { buildTags } from "#api/indexer/tags";
import { crawlCollections } from "#api/indexer/collections";
import { buildHolderCohesion } from "#api/indexer/holder-cohesion";
import { crawlEmblemSales } from "#api/indexer/emblem-sales";
import { crawlScarceSales } from "#api/indexer/scarce-sales";
import { classifyVaults } from "#api/indexer/vault-contents";
import { crawlEmblemMeta } from "#api/indexer/emblem-meta";
import { crawlEmblemTransfers } from "#api/indexer/emblem-transfers";
import { crawlEmblemListings } from "#api/indexer/emblem-listings";
import { crawlTokenscanCollections } from "#api/indexer/tokenscan-collections";
import { buildScamAttribution } from "#api/indexer/emblem-scam";
import { graphEval } from "#api/indexer/graph-eval";
import { buildTrades } from "#api/indexer/trades";
import { buildGraphTrust } from "#api/indexer/graph";
import { crawlPrices, applyTradeUsd } from "#api/indexer/prices";
import { curatedList, curatedUpsert, curatedDelete } from "#api/queries/curated";
import { requireAdmin } from "#api/middleware/admin-auth";
import { boundedInteger, optionalBoundedInteger } from "#api/http/numbers";
import { recoveryAdmin } from "#api/recovery/admin";
import { auditLedgerReadiness } from "#api/indexer/ledger-readiness";
import { operationalStatus } from "#api/operations/status";
import { activateLedgerReadCutover, rollbackLedgerReadCutover } from "#api/indexer/ledger-cutover";
import { refreshExchangeTopAssets } from "#api/indexer/exchange-top-assets";
import { auditCoreTableCoverage } from "#api/indexer/core-manifest";
import { coreSnapshotPage, coreSnapshotSchema } from "#api/indexer/core-snapshot";
import { activateCoreForwardWrites, auditCoreDataParity, rollbackCoreForwardWrites } from "#api/indexer/core-parity";
import {
  CORE_RECENT_PROJECTIONS,
  reconcileCoreProjection,
  reconcileRecentCoreProjection,
} from "#api/indexer/core-projections";
import { buildIssuerCollections } from "#api/indexer/issuer-collections";

export const admin = new Hono<{ Bindings: Env }>();

// every route is gated by the shared admin token (Bearer header, or deprecated ?token=).
admin.use("/admin/*", requireAdmin);
admin.route("/", recoveryAdmin);

// Cheap, read-only snapshot for operators. Large tables are probed by indexed
// frontier lookups rather than repeatedly counted in full.
admin.get("/admin/status", async (c) => c.json(await operationalStatus(c.env)));

// Fail-closed schema inventory: every live source table must have one explicit compact/rebuild/preserve rule,
// and every resulting target relation must exist before the compact database can be considered complete.
admin.get("/admin/core-coverage", async (c) => c.json(await auditCoreTableCoverage(c.env)));

// Read-only source snapshot stream for the offline compact builder. Table names are a closed manifest and
// rowid keysets keep large history reads indexed; the one WITHOUT ROWID projection is tiny and offset-paged.
admin.get("/admin/core-snapshot/schema", async (c) => c.json(await coreSnapshotSchema(c.env.DB)));
admin.get("/admin/core-snapshot/:table", async (c) => {
  const after = boundedInteger(c.req.query("after"), { defaultValue: 0, min: 0 });
  const rows = boundedInteger(c.req.query("rows"), { defaultValue: 1_000, min: 1, max: 2_000 });
  try {
    return c.json(await coreSnapshotPage(c.env.DB, c.req.param("table"), after, rows));
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "snapshot failed" }, 400);
  }
});

// Bitcoin-side address summaries ingest (see migrations/0027 + ops/export-btc-stats.mjs — the mirror
// is blind to plain BTC activity; a local Core+Fulcrum node computes summaries and pushes them here).
// Body: JSON array of rows (max 100/call); upserted atomically via batch.
interface BtcStatsRow {
  address: string;
  btc_received?: number;
  btc_sent?: number;
  btc_balance?: number;
  btc_txs?: number;
  btc_first_block?: number | null;
  btc_last_block?: number | null;
}
admin.post("/admin/btc-stats", async (c) => {
  const rows = await c.req.json<BtcStatsRow[]>().catch(() => null);
  if (!Array.isArray(rows) || rows.length === 0) return c.json({ error: "expected a non-empty JSON array" }, 400);
  if (rows.length > 100) return c.json({ error: "max 100 rows per call" }, 400);
  const now = Math.floor(Date.now() / 1000);
  const stmt = c.env.DB.prepare(
    `INSERT INTO btc_signals (address, btc_received, btc_sent, btc_balance, btc_txs, btc_first_block, btc_last_block, updated_at)
     VALUES (?,?,?,?,?,?,?,?)
     ON CONFLICT(address) DO UPDATE SET btc_received=excluded.btc_received, btc_sent=excluded.btc_sent,
       btc_balance=excluded.btc_balance, btc_txs=excluded.btc_txs, btc_first_block=excluded.btc_first_block,
       btc_last_block=excluded.btc_last_block, updated_at=excluded.updated_at`,
  );
  await c.env.DB.batch(
    rows
      .filter((r) => typeof r.address === "string" && r.address.length > 0)
      .map((r) =>
        stmt.bind(
          r.address,
          r.btc_received ?? 0,
          r.btc_sent ?? 0,
          r.btc_balance ?? 0,
          r.btc_txs ?? 0,
          r.btc_first_block ?? null,
          r.btc_last_block ?? null,
          now,
        ),
      ),
  );
  return c.json({ ok: true, upserted: rows.length });
});

// Export the address universe the BTC exporter should cover (real users + anything scored/curated).
admin.get("/admin/btc-stats/addresses", async (c) => {
  const limit = boundedInteger(c.req.query("limit"), { defaultValue: 5000, min: 1, max: 10_000 });
  const offset = boundedInteger(c.req.query("offset"), { defaultValue: 0, min: 0 });
  const r = await c.env.DB.prepare(`SELECT address FROM address_signals ORDER BY address LIMIT ? OFFSET ?`)
    .bind(limit, offset)
    .all<{ address: string }>();
  return c.json({
    result: r.results.map((x) => x.address),
    next_offset: r.results.length === limit ? offset + limit : null,
  });
});

// Drive the full Counterparty mirror (chronological event replay). Repeat until caught_up.
admin.post("/admin/sync", async (c) => {
  const events = optionalBoundedInteger(c.req.query("events"), { min: 1, max: 50_000 });
  return c.json(await syncEvents(c.env, { maxEvents: events }));
});

// Advance the compact database from its immutable seed frontier using its own cursor. This never writes the
// current source mirror and remains available before forward dual-writes are enabled.
admin.post("/admin/core-replay", async (c) => {
  const events = optionalBoundedInteger(c.req.query("events"), { min: 1, max: 50_000 });
  return c.json(await syncCompactEvents(c.env, { maxEvents: events }));
});

admin.post("/admin/core-projections/reconcile/:table", async (c) => {
  const rows = boundedInteger(c.req.query("rows"), { defaultValue: 250, min: 1, max: 500 });
  try {
    const result = await reconcileCoreProjection(c.env, c.req.param("table"), rows);
    return c.json(result, "skipped" in result ? 409 : 200);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "projection reconciliation failed" }, 400);
  }
});

admin.post("/admin/core-projections/reconcile-recent/:table", async (c) => {
  const table = c.req.param("table");
  if (!CORE_RECENT_PROJECTIONS.some((candidate) => candidate === table)) return c.json({ error: "unknown table" }, 400);
  return c.json(await reconcileRecentCoreProjection(c.env, table as (typeof CORE_RECENT_PROJECTIONS)[number]));
});

// Exact source/compact relation counts at one shared event cursor. A failed check closes the parity gate;
// success records the checked frontier for the later forward-write and read cutovers.
admin.post("/admin/core-parity", async (c) => {
  const result = await auditCoreDataParity(c.env, { accept: true });
  return c.json(result, result.ok ? 200 : 409);
});

admin.post("/admin/core-forward-writes/activate", async (c) => {
  const result = await activateCoreForwardWrites(c.env);
  return c.json(result, result.ok ? 200 : 409);
});

admin.post("/admin/core-forward-writes/rollback", async (c) => {
  return c.json(await rollbackCoreForwardWrites(c.env.CORE_DB));
});

// Backfill the historical credits/debits ledger (migration 0038) — isolated & non-destructive: inserts only
// CREDIT/DEBIT rows, never touches balances/mirror/signals, so it's safe to loop against the live DB. Repeat
// until {caught_up:true}. ?events=N tunes the per-call batch (default 10000). Its own cursor; forward capture
// (events/balance.ts) handles new events.
admin.post("/admin/backfill-ledger", async (c) => {
  const events = optionalBoundedInteger(c.req.query("events"), { min: 1, max: 50_000 });
  return c.json(await backfillLedger(c.env, { maxEvents: events }));
});

// Read-only safety audit. This reports readiness but deliberately cannot change `read_cutover`.
admin.get("/admin/ledger-readiness", async (c) => {
  const radius = boundedInteger(c.req.query("sample_radius"), { defaultValue: 2_000, min: 1, max: 10_000 });
  return c.json(await auditLedgerReadiness(c.env, radius));
});

// Explicit activation is fail-closed: it reruns the complete readiness audit and can only set read_cutover=1.
admin.post("/admin/ledger-cutover/activate", async (c) => {
  const radius = boundedInteger(c.req.query("sample_radius"), { defaultValue: 2_000, min: 1, max: 10_000 });
  const result = await activateLedgerReadCutover(c.env, radius);
  return c.json(result, result.ok ? 200 : 409);
});

// Emergency rollback is deliberately a separate protected operation and can only set read_cutover=0.
admin.post("/admin/ledger-cutover/rollback", async (c) => {
  return c.json(await rollbackLedgerReadCutover(c.env.LEDGER_DB));
});

// Full re-index: reset the event cursor to -1 so the next /admin/sync (or cron) WIPES balances + snapshots
// and replays from event 0. Needed to heal balances corrupted by the old reorg high-water bug — the
// per-balance high-water makes a plain replay a no-op on existing balances, so they must be wiped first. Heavy.
admin.post("/admin/reindex", async (c) => {
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO indexer_state (key,value) VALUES ('last_event_index','-1') ON CONFLICT(key) DO UPDATE SET value='-1'`,
    ),
    c.env.DB.prepare(
      `INSERT INTO indexer_state (key,value) VALUES ('last_block_index','0') ON CONFLICT(key) DO UPDATE SET value='0'`,
    ),
    c.env.DB.prepare(`DELETE FROM indexer_state WHERE key='last_block_hash'`),
  ]);
  return c.json({ ok: true, note: "cursor reset to -1; next sync wipes balances+snapshots and replays from event 0" });
});

// Rebuild precomputed reputation signal tables (address_signals + asset_signals). Heavy; cron advances
// it a couple bounded passes per caught-up tick. Manual trigger here for on-demand refresh.
admin.post("/admin/refresh-signals", async (c) => {
  const steps = boundedInteger(c.req.query("steps"), { defaultValue: 3, min: 1, max: 6 });
  return c.json(await runSignalsStep(c.env, steps));
});

// Force an atomic rebuild of the tiny exchange leaderboard. Normally maintained daily by cron.
admin.post("/admin/refresh-exchange-top-assets", async (c) => {
  return c.json(await refreshExchangeTopAssets(c.env));
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
admin.post("/admin/crawl-scarce", async (c) => c.json(await crawlScarceSales(c.env)));

admin.post("/admin/crawl-emblem", async (c) => {
  return c.json(await crawlEmblemStep(c.env));
});

// Refresh live Emblem listings from the Sequence Marketplace API (rotating contract subset per call). Loop
// this to sweep all ~36 contracts; the cron also advances it ~hourly.
admin.post("/admin/crawl-emblem-listings", async (c) => c.json(await crawlEmblemListings(c.env)));

// Fold in the tokenscan project directory (~60 collections + sites) as source='tokenscan' collection tags.
admin.post("/admin/crawl-tokenscan", async (c) => c.json(await crawlTokenscanCollections(c.env)));

// Promote a reviewed collection candidate to a real collection: tag ALL of an issuer's uncollected media
// assets with {slug, name, site?} as source='discovered'. Body: { issuer, slug, name?, site? }. The
// candidate discovery board (/v2/collections/candidates) is where issuers are eyeballed before promotion.
admin.post("/admin/promote-collection", async (c) => {
  const { issuer, slug, name, site } = await c.req.json<{
    issuer?: string;
    slug?: string;
    name?: string;
    site?: string;
  }>();
  if (!issuer || !slug) return c.json({ error: "issuer and slug are required" }, 400);
  const meta = JSON.stringify({ collection: name || slug, ...(site ? { site } : {}) });
  const rows = await c.env.DB.prepare(
    `SELECT a.asset FROM assets a
      WHERE a.issuer=? AND a.mime_type IS NOT NULL
        AND a.asset NOT IN (SELECT entity_id FROM tags WHERE entity_type='asset' AND source IN ('collection','tokenscan','digirare','discovered'))
        AND a.asset NOT IN (SELECT entity_id FROM tags WHERE entity_type='asset' AND tag IN ('stamp','src20','src721'))`,
  )
    .bind(issuer)
    .all<{ asset: string }>();
  const assets = (rows.results ?? []).map((r) => r.asset);
  for (let i = 0; i < assets.length; i += 100) {
    await c.env.DB.batch(
      assets
        .slice(i, i + 100)
        .map((a) =>
          c.env.DB.prepare(
            `INSERT OR IGNORE INTO tags (entity_type,entity_id,tag,source,meta) VALUES ('asset',?,?,'discovered',?)`,
          ).bind(a, slug, meta),
        ),
    );
  }
  await c.env.DB.prepare(`DELETE FROM cache WHERE key IN ('tags:all','collection-candidates')`).run();
  return c.json({ issuer, slug, name: name || slug, tagged: assets.length });
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

admin.post("/admin/build-issuer-collections", async (c) => {
  return c.json(await buildIssuerCollections(c.env));
});

// Refresh collection-membership tags (Rare Pepe / Fake Rare / Bitcorn / …) from pepe.wtf. Cron runs it ~daily;
// manual trigger here to rebuild on demand.
admin.post("/admin/crawl-collections", async (c) => {
  return c.json(await crawlCollections(c.env));
});

// Batch-compute holder cohesion onto asset_signals. Cursored: body {after, limit} → {processed, next, sample}.
admin.post("/admin/cohesion", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { after?: string; limit?: number };
  const limit = Math.min(Math.max(body?.limit ?? 40, 1), 120);
  return c.json(await buildHolderCohesion(c.env, body?.after ?? "", limit));
});

// Index Emblem vault sales (Alchemy getNFTSales) into emblem_sales. Loop until contract_done cycles; the
// `sample` field returns the raw Alchemy shape on the first run so we can confirm the fields.
admin.post("/admin/crawl-emblem-sales", async (c) => {
  return c.json(await crawlEmblemSales(c.env));
});

// Recover post-April-2024 Emblem sales that getNFTSales stopped indexing: getAssetTransfers + Seaport decode
// (emblem-transfers.ts). Loop until it cycles the contracts; INSERT OR IGNORE dedupes the getNFTSales overlap.
admin.post("/admin/crawl-emblem-transfers", async (c) => {
  return c.json(await crawlEmblemTransfers(c.env));
});

// Rebuild Emblem empty-shell scam attribution → address_signals.shell_scams (creator bridge). force=1 for on-demand.
admin.post("/admin/build-scam-attribution", async (c) => {
  return c.json(await buildScamAttribution(c.env, true));
});

// Graph-reputation SCORECARD: objective success criteria for the current graph (recall, false-flags,
// distrust contamination, watchlist coverage, tier sizes). Run after each rebuild; compare across variants.
admin.get("/admin/graph-eval", async (c) => c.json(await graphEval(c.env)));

// Classify Emblem vault contents + crack state (real vs scam sales). Loop until {wrapped:true} to sweep
// the whole vault universe; bounded batch per call. Run before build-trades so the fold sees fresh classes.
admin.post("/admin/classify-vaults", async (c) => {
  return c.json(await classifyVaults(c.env));
});

// Capture Emblem /meta for 'foreign' vaults (claim vs actual contents). Loop until {done:true} to drain
// the ~15.7k foreign vaults; splits legit foreign (Ordinals/Namecoin/…) from empty Counterparty scams.
admin.post("/admin/crawl-emblem-meta", async (c) => {
  return c.json(await crawlEmblemMeta(c.env));
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

// Graph-reputation trait (Phase C): advance the bounded Min-k-PPR TrustRank + Anti-TrustRank build one step
// (build -> iterate -> finalize). Loop until {done:true}; POST ?reset=1 to restart from scratch, ?work=N to
// tune the units advanced per call. See src/indexer/graph.ts + docs/graph-reputation.md.
//   POST /admin/build-graph?reset=1   then   POST /admin/build-graph  (repeat until done)
admin.post("/admin/build-graph", async (c) => {
  const work = optionalBoundedInteger(c.req.query("work"), { min: 1, max: 40 });
  const reset = c.req.query("reset") === "1";
  const bipartite = c.req.query("bipartite") === "1"; // experiment: include holder<->asset edges
  return c.json(await buildGraphTrust(c.env, { work, reset, bipartite }));
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
  const body = await c.req
    .json<{ kind?: string; key?: string; value?: string | null; note?: string | null }>()
    .catch(() => null);
  if (!body?.kind || !body?.key) return c.json({ error: "need {kind,key}" }, 400);
  await curatedUpsert(c.env.DB, { kind: body.kind, key: body.key, value: body.value, note: body.note });
  return c.json({ ok: true, kind: body.kind, key: body.key });
});

admin.delete("/admin/curated", async (c) => {
  const kind = c.req.query("kind"),
    key = c.req.query("key");
  if (!kind || !key) return c.json({ error: "need ?kind= and ?key=" }, 400);
  const r = await curatedDelete(c.env.DB, kind, key);
  return c.json({ ok: true, kind, key, deleted: r.meta?.changes ?? 0 });
});
