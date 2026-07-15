/**
 * api.xcp.io — Counterparty read-mirror + wallet-extension compatibility worker.
 *
 * Composition root: defines the Env bindings, mounts the route modules, and runs the scheduled cron.
 *   read     -> explorer read API (/v2/*)            verify -> mirror-vs-Counterparty evaluation harness (/admin/verify)
 *   extension -> app.xcp.io/api/v1 wallet endpoints  admin  -> operational routes (/admin/*)
 * The scheduled handler advances the Counterparty event mirror, then (only while caught up) steps the reputation
 * signal rebuild, the Emblem crawl, and deterministic supply maintenance — so catch-up never contends.
 */
import { Hono } from "hono";
import type { Env } from "#api/env";
export type { Env } from "#api/env";
import { describeHttpError, requestId } from "#api/http/errors";
import { syncCoreEvents } from "#api/indexer/sync";
import { crawlEmblemStep, maybeRefreshEmblemStats } from "#api/indexer/emblem";
import { crawlAssetSupply } from "#api/indexer/asset-supply";
import { buildTags } from "#api/indexer/tags";
import { buildIssuerCollections } from "#api/indexer/issuer-collections";
import { buildCuratedCollections } from "#api/indexer/curated-collections";
import { crawlCollections } from "#api/indexer/collections";
import { crawlEmblemSales } from "#api/indexer/emblem-sales";
import { crawlScarceSales } from "#api/indexer/scarce-sales";
import { classifyVaults } from "#api/indexer/vault-contents";
import { crawlEmblemMeta } from "#api/indexer/emblem-meta";
import { crawlEmblemTransfers } from "#api/indexer/emblem-transfers";
import { crawlEmblemListings } from "#api/indexer/emblem-listings";
import { crawlTokenscanCollections } from "#api/indexer/tokenscan-collections";
import { buildScamAttribution } from "#api/indexer/emblem-scam";
import { maybeBuildGraph } from "#api/indexer/graph";
import { buildTrades } from "#api/indexer/trades";
import { crawlPrices, applyTradeUsd } from "#api/indexer/prices";
import { runScheduledJob } from "#api/scheduler/job";
import { read } from "#api/read/router";
import { verify } from "#api/verify";
import { extensionApi } from "#api/extension-api";
import { admin } from "#api/admin";
import { recoveryRead } from "#api/recovery/read";
import { maybeRefreshExchangeTopAssets } from "#api/indexer/exchange-top-assets";
import { runCoreAssetSignalsStep } from "#api/indexer/core-asset-signals";
import { maybeRefreshQualityNetworkStats } from "#api/indexer/quality-network-stats";
import { runCoreAddressSignalsStep } from "#api/indexer/core-address-signals";
import { runCoreBlockGated } from "#api/scheduler/core-block-gate";
import { backfillBitcoinBlockCounts } from "#api/indexer/bitcoin-block-counts";
import { reconcileStagedBitcoinFees } from "#api/indexer/bitcoin-fees";
import { scanRecoveryTransactions } from "#api/recovery/scanner";
import { verifyRecoveryTransactions } from "#api/recovery/verify";
import { reconcileRecoveryAttempts } from "#api/recovery/attempts";
import { refreshRecoveryStats } from "#api/recovery/stats";

// Periodic SQLite ANALYZE — keeps the query planner's stats fresh as the chain grows (~weekly, gated by
// block-delta since ANALYZE is ~10s). Stale/absent stats cause catastrophic join-order choices on D1.
async function maybeAnalyze(env: Env): Promise<void> {
  await runCoreBlockGated(env.CORE_DB, "last_analyze_blk", 1008, async () => {
    await env.CORE_DB.prepare(`ANALYZE`).run();
  });
}

// Refresh collection-membership tags (Rare Pepe / Fake Rare / …) from pepe.wtf ~daily. Gated by block-delta
// like ANALYZE — collections change rarely, and each run is ~11 fetches, so once a day is ample.
async function maybeCrawlCollections(env: Env): Promise<void> {
  await runCoreBlockGated(env.CORE_DB, "collections_synced_blk", 144, () => crawlCollections(env));
}

// Refresh the tokenscan collection directory (~60 projects + sites) → source='tokenscan' tags. A single
// static-file fetch; the directory changes rarely, so ~weekly is plenty.
async function maybeCrawlTokenscan(env: Env): Promise<void> {
  await runCoreBlockGated(env.CORE_DB, "tokenscan_synced_blk", 1008, () => crawlTokenscanCollections(env));
}

// Continue the Emblem-sales backfill a bounded step, gated to ~hourly so we crawl Alchemy getNFTSales
// steadily (rotating one contract per call) without hammering it every 2-min tick.
async function maybeCrawlEmblemSales(env: Env): Promise<void> {
  const tip =
    Number((await env.CORE_DB.prepare(`SELECT MAX(block_index) m FROM blocks`).first<{ m: number }>())?.m) || 0;
  const last = Number.parseInt(
    (
      await env.CORE_DB.prepare(`SELECT value FROM core_state WHERE key='emblem_sales_synced_blk'`).first<{
        value: string;
      }>()
    )?.value ?? "0",
    10,
  );
  if (tip - last < 6) return; // ~1 hour of blocks
  const result = await crawlEmblemSales(env);
  if ("err" in result || "skipped" in result) return;
  await env.CORE_DB.prepare(
    `INSERT INTO core_state(key,value) VALUES('emblem_sales_synced_blk',?)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
  )
    .bind(String(tip))
    .run();
}

// Refresh live Emblem listings (Sequence Marketplace API), gated to ~hourly. Rotates a subset of the ~36
// Emblem contracts per call, so a full listings refresh completes over a handful of hours without hammering
// the API. No-ops until SEQUENCE_ACCESS_KEY is set / Sequence has indexed orders for a contract.
async function maybeCrawlEmblemListings(env: Env): Promise<void> {
  const tip =
    Number((await env.CORE_DB.prepare(`SELECT MAX(block_index) m FROM blocks`).first<{ m: number }>())?.m) || 0;
  const last = Number.parseInt(
    (
      await env.CORE_DB.prepare(`SELECT value FROM core_state WHERE key='emblem_listings_synced_blk'`).first<{
        value: string;
      }>()
    )?.value ?? "0",
    10,
  );
  if (tip - last < 6) return; // ~1 hour of blocks
  const result = await crawlEmblemListings(env);
  if ("failed" in result || "skipped" in result) return;
  await env.CORE_DB.prepare(
    `INSERT INTO core_state(key,value) VALUES('emblem_listings_synced_blk',?)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
  )
    .bind(String(tip))
    .run();
}

// FULL tags self-heal (~daily). The per-tick cascade rebuilds computed tags only for the entities it touched;
// this full rebuild backstops it — reconciling anything the dirty set missed (e.g. an address that became a
// vault_funder because a NEW vault was crawled, not because it sent this tick). Gated by block-delta like
// ANALYZE/collections: the scoped rebuild keeps hot entities fresh, so once a day is ample for the sweep.
async function maybeRebuildTags(env: Env): Promise<void> {
  await runCoreBlockGated(env.CORE_DB, "tags_rebuilt_blk", 144, async () => {
    await buildTags(env, { includeTypes: false });
    await buildIssuerCollections(env);
    await buildCuratedCollections(env);
  });
}

// Refresh the daily USD price calendar (Coinbase BTC/ETH + DEX-derived XCP) ~daily. Gated by block-delta:
// daily candles only change once a day, and a full run is a handful of fetches.
async function maybeCrawlPrices(env: Env): Promise<void> {
  await runCoreBlockGated(env.CORE_DB, "prices_synced_blk", 144, () => crawlPrices(env));
}

const app = new Hono<{ Bindings: Env }>();

// D1 Sessions API: route every /v2 read through a replica-aware session ("first-unconstrained" —
// nearest replica; the whole read surface is stale-tolerant by design, already edge-cached 10-600s).
// Writes inside a session (the response-cache upsert) route to the primary automatically. A no-op
// until read replication is enabled on the database (Dashboard -> D1 -> xcpio -> enable replication).
// Deliberately NOT paired with Smart Placement: placement pins the worker near the primary, which
// would defeat replica-local reads (the docs call this out for replicated resources).
// The cast bridges workers-types predating withSession; D1DatabaseSession shares prepare()/batch().
app.use("/v2/*", async (c, next) => {
  const db = c.env.CORE_DB as unknown as { withSession?: (mode?: string) => D1Database };
  if (typeof db.withSession === "function") c.env = { ...c.env, CORE_DB: db.withSession("first-unconstrained") };
  await next();
});

app.get("/", (c) => c.text("api.xcp.io ok"));
app.get("/health", (c) => c.text("ok"));
app.route("/", read); // explorer read API: /v2/assets, /v2/addresses/{a}/balances, /v2/blocks, ...
app.route("/", verify); // /admin/verify — mirror-vs-Counterparty evaluation harness
app.route("/", extensionApi); // stable wallet-extension API
app.route("/", admin); // /admin/* — operational routes (token-gated)
app.route("/", recoveryRead); // native Counterparty bare-multisig recovery

// Consistent error envelope: any UNCAUGHT throw from a handler returns { error } (never a bare 500 HTML).
// A Hono HTTPException keeps its own status; anything else is an unexpected fault → 500 (and logged with the
// request path so it's traceable). Intentional not-found payloads are returned directly by handlers (c.json(
// { error }, 404)) — they never throw, so they don't pass through here and keep their exact shape.
app.onError((err, c) => {
  const failure = describeHttpError(err);
  const id = requestId(c.req.header("X-Request-Id"));
  console.error({
    event: "request_error",
    request_id: id,
    method: c.req.method,
    path: c.req.path,
    status: failure.status,
    error: failure.internal,
  });
  c.header("X-Request-Id", id);
  return c.json({ error: failure.publicMessage }, failure.status);
});

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext) {
    if (event.cron === "1-59/2 * * * *") {
      ctx.waitUntil(
        (async () => {
          // Recovery owns an independent database and provider budget. Keep it off the canonical ingestion lane
          // so slow Bitcoin evidence cannot delay protocol projections or public-read freshness.
          await runScheduledJob("scanRecoveryTransactions", () => scanRecoveryTransactions(env, 20));
          await runScheduledJob("verifyRecoveryTransactions", () => verifyRecoveryTransactions(env, 10));
          await runScheduledJob("reconcileRecoveryAttempts", () => reconcileRecoveryAttempts(env, 25));
          await runScheduledJob("refreshRecoveryStats", () => refreshRecoveryStats(env));
          // The graph is already built and internally block-gated. Its occasional rebuild follows recovery rather
          // than consuming the canonical lane's D1 budget.
          await runScheduledJob("maybeBuildGraph", () => maybeBuildGraph(env));
        })(),
      );
      return;
    }
    ctx.waitUntil(
      (async () => {
        // The canonical database's D1 lock serializes scheduled and manual syncs.
        const syncResult = await runScheduledJob("syncCoreEvents", () => syncCoreEvents(env, { maxEvents: 10000 }));
        const caughtUp = !!syncResult?.caught_up;
        // Maintenance runs ONLY when caught up, so a catch-up/rebuild never contends with the live sync.
        if (caughtUp) {
          // Canonical Bitcoin enrichment runs before independent provider-backed projections. A slow recovery
          // dependency must not starve fields used by the explorer's core transaction and block views.
          await runScheduledJob("backfillBitcoinBlockCounts", () => backfillBitcoinBlockCounts(env));
          await runScheduledJob("reconcileStagedBitcoinFees", () => reconcileStagedBitcoinFees(env));
          // Signal maintenance uses the same convergent writers for event refreshes and
          // bounded full-population repair. There is no source-database signal fallback.
          await runScheduledJob("runCoreAssetSignalsStep", () => runCoreAssetSignalsStep(env.CORE_DB));
          await runScheduledJob("runCoreAddressSignalsStep", () => runCoreAddressSignalsStep(env.CORE_DB));
          await runScheduledJob("maybeRefreshQualityNetworkStats", () => maybeRefreshQualityNetworkStats(env.CORE_DB));
          await runScheduledJob("maybeRefreshExchangeTopAssets", () => maybeRefreshExchangeTopAssets(env));
          // FULL tags rebuild as the daily self-healing backstop (reconciles anything the dirty set missed).
          await runScheduledJob("maybeRebuildTags", () => maybeRebuildTags(env));
          // Advance the Emblem Vault crawl (enumerate token ids via Alchemy + resolve BTC via /meta).
          await runScheduledJob("crawlEmblem", () => crawlEmblemStep(env));
          await runScheduledJob("refreshEmblemStats", () => maybeRefreshEmblemStats(env));
          // Maintain authoritative asset supply (+asset_id/mime_type): backfill all assets once, then
          // refetch only assets touched by a supply-changing event, plus XCP every tick (fee-burn drift).
          await runScheduledJob("crawlAssetSupply", () => crawlAssetSupply(env));
          // Refresh SQLite optimizer stats periodically (~weekly). Without stats D1 picked terrible join orders
          // (exchanges overview scanned all 1.75M sends = 18s); ANALYZE fixed plans globally (→0.5s). Gated by
          // block-delta because ANALYZE itself is ~10s — far too heavy to run every 2-min tick.
          await runScheduledJob("maybeAnalyze", () => maybeAnalyze(env));
          // Collection-membership tags (Rare Pepe / Fake Rare / Bitcorn / …) from pepe.wtf, ~daily.
          await runScheduledJob("crawlCollections", () => maybeCrawlCollections(env));
          // Fold in the tokenscan project directory (~60 collections + sites) as source='tokenscan' tags, ~weekly.
          await runScheduledJob("crawlTokenscan", () => maybeCrawlTokenscan(env));
          // Continue the Emblem-vault sales backfill (Alchemy getNFTSales), ~hourly, one contract per call.
          await runScheduledJob("crawlEmblemSales", () => maybeCrawlEmblemSales(env));
          // Recover post-April-2024 sales getNFTSales stopped indexing (getAssetTransfers + Seaport decode).
          await runScheduledJob("crawlEmblemTransfers", () => crawlEmblemTransfers(env));
          // Refresh live Emblem listings (Sequence Marketplace API) so the Radar can flag "buyable on ETH", ~hourly.
          await runScheduledJob("crawlEmblemListings", () => maybeCrawlEmblemListings(env));
          // Continue the Scarce.city sales sweep (Bitcoin-native marketplace; one bounded asset batch per tick).
          await runScheduledJob("crawlScarceSales", () => crawlScarceSales(env));
          // Classify Emblem vault contents/crack state (real vs scam sales) — one bounded vault batch per tick.
          await runScheduledJob("classifyVaults", () => classifyVaults(env));
          // Capture Emblem /meta (claim vs contents) for 'foreign' vaults — splits legit foreign from empty scams.
          await runScheduledJob("crawlEmblemMeta", () => crawlEmblemMeta(env));
          // Attribute Emblem empty-shell scams to BTC identities (creator bridge → address_signals.shell_scams). Daily-gated.
          await runScheduledJob("buildScamAttribution", () => buildScamAttribution(env));
          // Materialize the unified trades ledger: dex + dispense advance by Counterparty-block cursor, emblem re-folded.
          await runScheduledJob("buildTrades", () => buildTrades(env));
          // Daily USD price calendar (~daily), then map trades onto it (fills usd_value, bounded window per tick).
          await runScheduledJob("crawlPrices", () => maybeCrawlPrices(env));
          await runScheduledJob("applyTradeUsd", () => applyTradeUsd(env));
        }
      })(),
    );
  },
} satisfies ExportedHandler<Env>;
