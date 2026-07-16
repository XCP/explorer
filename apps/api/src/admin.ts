/**
 * Admin / operational routes (token-gated): drive the chronological event mirror, the stepped reputation
 * signal rebuild, the Emblem crawl, and deterministic supply maintenance.
 */
import { Hono } from "hono";
import type { Env } from "#api/env";
import { syncCoreEvents } from "#api/indexer/sync";
import { runCoreAddressSignalsStep } from "#api/indexer/core-address-signals";
import { runCoreAssetSignalsStep } from "#api/indexer/core-asset-signals";
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
import { operationalStatus } from "#api/operations/status";
import { refreshExchangeTopAssets } from "#api/indexer/exchange-top-assets";
import { refreshQualityNetworkStats } from "#api/indexer/quality-network-stats";
import { buildIssuerCollections } from "#api/indexer/issuer-collections";
import { buildCuratedCollections } from "#api/indexer/curated-collections";
import { listMissingBitcoinFees, storeBitcoinFees, validBitcoinFeeRows } from "#api/indexer/bitcoin-fees";

export const admin = new Hono<{ Bindings: Env }>();

// every route is gated by the shared admin token (Bearer header, or deprecated ?token=).
admin.use("/admin/*", requireAdmin);
admin.route("/", recoveryAdmin);

// Cheap, read-only snapshot for operators. Large tables are probed by indexed
// frontier lookups rather than repeatedly counted in full.
admin.get("/admin/status", async (c) => c.json(await operationalStatus(c.env)));

// Temporary, token-gated migration surface. Delete immediately after migration 0034 succeeds.
admin.get("/admin/bitcoin-fees", async (c) => {
  const limit = boundedInteger(c.req.query("limit"), { defaultValue: 5000, min: 1, max: 10_000 });
  const after = optionalBoundedInteger(c.req.query("after"), { min: 0 });
  const rows = await listMissingBitcoinFees(c.env.CORE_DB, after ?? null, limit);
  return c.json({ rows, next: rows.at(-1)?.tx_index ?? null });
});

admin.post("/admin/bitcoin-fees", async (c) => {
  const rows = validBitcoinFeeRows(await c.req.json().catch(() => null));
  if (!rows) return c.json({ error: "expected 1-100 rows with a 64-character tx_hash and integer fee" }, 400);
  return c.json({ ok: true, updated: await storeBitcoinFees(c.env.CORE_DB, rows) });
});

// Bitcoin-side address summaries ingest (see ops/export-btc-stats.mjs — the Counterparty mirror
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
  const validRows = rows.filter((row) => typeof row.address === "string" && row.address.length > 0);
  const statements = validRows.flatMap((row) => [
    c.env.CORE_DB.prepare(`INSERT OR IGNORE INTO address_dictionary(address) VALUES(?)`).bind(row.address),
    c.env.CORE_DB.prepare(
      `INSERT INTO btc_signals (address_id,btc_received,btc_sent,btc_balance,btc_txs,btc_first_block,btc_last_block,updated_at)
     VALUES ((SELECT address_id FROM address_dictionary WHERE address=?),?,?,?,?,?,?,?)
     ON CONFLICT(address_id) DO UPDATE SET btc_received=excluded.btc_received, btc_sent=excluded.btc_sent,
       btc_balance=excluded.btc_balance, btc_txs=excluded.btc_txs, btc_first_block=excluded.btc_first_block,
       btc_last_block=excluded.btc_last_block, updated_at=excluded.updated_at`,
    ).bind(
      row.address,
      row.btc_received ?? 0,
      row.btc_sent ?? 0,
      row.btc_balance ?? 0,
      row.btc_txs ?? 0,
      row.btc_first_block ?? null,
      row.btc_last_block ?? null,
      now,
    ),
  ]);
  for (let index = 0; index < statements.length; index += 90)
    await c.env.CORE_DB.batch(statements.slice(index, index + 90));
  return c.json({ ok: true, upserted: validRows.length });
});

// Export the address universe the BTC exporter should cover (real users + anything scored/curated).
admin.get("/admin/btc-stats/addresses", async (c) => {
  const limit = boundedInteger(c.req.query("limit"), { defaultValue: 5000, min: 1, max: 10_000 });
  const offset = boundedInteger(c.req.query("offset"), { defaultValue: 0, min: 0 });
  const r = await c.env.CORE_DB.prepare(
    `SELECT dictionary.address FROM address_signals signal
     JOIN address_dictionary dictionary ON dictionary.address_id=signal.address_id
     ORDER BY dictionary.address LIMIT ? OFFSET ?`,
  )
    .bind(limit, offset)
    .all<{ address: string }>();
  return c.json({
    result: r.results.map((x) => x.address),
    next_offset: r.results.length === limit ? offset + limit : null,
  });
});

// Drive the canonical Counterparty database. The same locked replay runs from cron.
admin.post("/admin/sync", async (c) => {
  const events = optionalBoundedInteger(c.req.query("events"), { min: 1, max: 50_000 });
  return c.json(await syncCoreEvents(c.env, { maxEvents: events }));
});

// Advance both reputation projections. Cron runs the same bounded repair steps.
admin.post("/admin/refresh-signals", async (c) => {
  const limit = boundedInteger(c.req.query("limit"), { defaultValue: 400, min: 1, max: 1000 });
  const [assets, addresses] = await Promise.all([
    runCoreAssetSignalsStep(c.env.CORE_DB, limit, true),
    runCoreAddressSignalsStep(c.env.CORE_DB, limit, true),
  ]);
  return c.json({ assets, addresses });
});

// Address projection is intentionally isolated from the larger asset batch because D1 applies a compound-statement
// budget across one Worker invocation. This route is also the operator control for advancing an initial rebuild.
admin.post("/admin/refresh-address-signals", async (c) => {
  const limit = boundedInteger(c.req.query("limit"), { defaultValue: 60, min: 1, max: 1000 });
  return c.json(await runCoreAddressSignalsStep(c.env.CORE_DB, limit, true));
});

// Force an atomic rebuild of the tiny exchange leaderboard. Normally maintained daily by cron.
admin.post("/admin/refresh-exchange-top-assets", async (c) => {
  return c.json(await refreshExchangeTopAssets(c.env));
});

// Force the filtered lifetime snapshot; normally refreshed out of band before its cache lifetime expires.
admin.post("/admin/refresh-quality-stats", async (c) => c.json(await refreshQualityNetworkStats(c.env.CORE_DB)));

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
  const rows = await c.env.CORE_DB.prepare(
    `SELECT dictionary.asset,entity.entity_id FROM assets asset
      JOIN asset_dictionary dictionary ON dictionary.asset_id=asset.asset_id
      JOIN address_dictionary issuer ON issuer.address_id=asset.issuer_id
      JOIN entity_dictionary entity ON entity.entity_type='asset' AND entity.entity_key=dictionary.asset
      WHERE issuer.address=? AND asset.mime_type IS NOT NULL
        AND entity.entity_id NOT IN (SELECT entity_id FROM tags WHERE source IN ('collection','tokenscan','digirare','discovered'))
        AND entity.entity_id NOT IN (SELECT entity_id FROM tags WHERE tag IN ('stamp','src20','src721'))`,
  )
    .bind(issuer)
    .all<{ asset: string; entity_id: number }>();
  for (let i = 0; i < rows.results.length; i += 90) {
    await c.env.CORE_DB.batch(
      rows.results.slice(i, i + 90).map((row) =>
        c.env.CORE_DB.prepare(
          `INSERT INTO tags(entity_id,tag,source,meta) VALUES(?,?,'discovered',?)
             ON CONFLICT(entity_id,tag) DO UPDATE SET source=excluded.source,meta=excluded.meta`,
        ).bind(row.entity_id, slug, meta),
      ),
    );
  }
  await c.env.CORE_DB.prepare(`DELETE FROM cache WHERE key IN ('tags:all','collection-candidates')`).run();
  return c.json({ issuer, slug, name: name || slug, tagged: rows.results.length });
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

admin.post("/admin/build-curated-collections", async (c) => {
  return c.json(await buildCuratedCollections(c.env));
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
// (emblem-transfers.ts). Loop until it cycles the contracts; canonical sale identity deduplicates overlap.
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
    const r = await c.env.CORE_DB.prepare(sql).first<Record<string, number>>();
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
  return c.json({ kind, rows: await curatedList(c.env.CORE_DB, kind) });
});

admin.post("/admin/curated", async (c) => {
  const body = await c.req
    .json<{ kind?: string; key?: string; value?: string | null; note?: string | null }>()
    .catch(() => null);
  if (!body?.kind || !body?.key) return c.json({ error: "need {kind,key}" }, 400);
  await curatedUpsert(c.env.CORE_DB, { kind: body.kind, key: body.key, value: body.value, note: body.note });
  return c.json({ ok: true, kind: body.kind, key: body.key });
});

admin.delete("/admin/curated", async (c) => {
  const kind = c.req.query("kind"),
    key = c.req.query("key");
  if (!kind || !key) return c.json({ error: "need ?kind= and ?key=" }, 400);
  const r = await curatedDelete(c.env.CORE_DB, kind, key);
  return c.json({ ok: true, kind, key, deleted: r.meta?.changes ?? 0 });
});
