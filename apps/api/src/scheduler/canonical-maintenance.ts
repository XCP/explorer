import type { Env } from "#api/env";
import { crawlAssetSupply } from "#api/indexer/asset-supply";
import { refreshAssetEmergence } from "#api/indexer/asset-emergence";
import { backfillBitcoinBlockCounts } from "#api/indexer/bitcoin-block-counts";
import { reconcileStagedBitcoinFees } from "#api/indexer/bitcoin-fees";
import { crawlCollections } from "#api/indexer/collections";
import { runCoreAssetSignalsStep } from "#api/indexer/core-asset-signals";
import { buildCuratedCollections } from "#api/indexer/curated-collections";
import { reconcileRecentDailyTransactions } from "#api/indexer/daily-metrics";
import { crawlEmblemListings } from "#api/indexer/emblem-listings";
import { crawlEmblemMeta } from "#api/indexer/emblem-meta";
import { crawlEmblemSales } from "#api/indexer/emblem-sales";
import { buildScamAttribution } from "#api/indexer/emblem-scam";
import { crawlEmblemTransfers } from "#api/indexer/emblem-transfers";
import { backfillEthereumBlockTimes } from "#api/indexer/ethereum-block-times";
import { crawlEmblemStep, maybeRefreshEmblemStats } from "#api/indexer/emblem";
import { maybeRefreshExchangeTopAssets } from "#api/indexer/exchange-top-assets";
import { buildIssuerCollections } from "#api/indexer/issuer-collections";
import { crawlPrices, applyTradeUsd } from "#api/indexer/prices";
import { maybeRefreshAssetActivityOutlook } from "#api/indexer/asset-activity-outlook";
import { maybeRefreshAssetRatings } from "#api/indexer/asset-rating";
import { crawlScarceSales } from "#api/indexer/scarce-sales";
import { buildTags } from "#api/indexer/tags";
import { crawlTokenscanCollections } from "#api/indexer/tokenscan-collections";
import { buildTrades } from "#api/indexer/trades";
import { classifyVaults } from "#api/indexer/vault-contents";
import { runCoreBlockGated } from "#api/scheduler/core-block-gate";
import { runScheduledJob } from "#api/scheduler/job";
import { withCanonicalMaintenanceLease } from "#api/scheduler/maintenance-lease";

const maybeAnalyze = (env: Env) =>
  runCoreBlockGated(env.CORE_DB, "last_analyze_blk", 1008, () => env.CORE_DB.prepare(`ANALYZE`).run());

const maybeCrawlCollections = (env: Env) =>
  runCoreBlockGated(env.CORE_DB, "collections_synced_blk", 144, () => crawlCollections(env));

const maybeCrawlTokenscan = (env: Env) =>
  runCoreBlockGated(env.CORE_DB, "tokenscan_synced_blk", 1008, () => crawlTokenscanCollections(env));

async function blockGatedProviderJob(
  env: Env,
  stateKey: string,
  interval: number,
  run: () => Promise<{ err?: unknown; failed?: unknown; skipped?: unknown }>,
): Promise<void> {
  const tip =
    Number((await env.CORE_DB.prepare(`SELECT MAX(block_index) tip FROM blocks`).first<{ tip: number }>())?.tip) || 0;
  const last = Number(
    (await env.CORE_DB.prepare(`SELECT value FROM core_state WHERE key=?`).bind(stateKey).first<{ value: string }>())
      ?.value ?? 0,
  );
  if (tip - last < interval) return;
  const result = await run();
  if (result.err !== undefined || result.failed !== undefined || result.skipped !== undefined) return;
  await env.CORE_DB.prepare(
    `INSERT INTO core_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
  )
    .bind(stateKey, String(tip))
    .run();
}

const maybeCrawlEmblemSales = (env: Env) =>
  blockGatedProviderJob(env, "emblem_sales_synced_blk", 6, () => crawlEmblemSales(env));

const maybeCrawlEmblemListings = (env: Env) =>
  blockGatedProviderJob(env, "emblem_listings_synced_blk", 6, () => crawlEmblemListings(env));

const maybeRebuildTags = (env: Env) =>
  runCoreBlockGated(env.CORE_DB, "tags_rebuilt_blk", 144, async () => {
    await buildTags(env);
    await buildIssuerCollections(env);
    await buildCuratedCollections(env);
  });

const maybeCrawlPrices = (env: Env) => runCoreBlockGated(env.CORE_DB, "prices_synced_blk", 144, () => crawlPrices(env));

const maybeRefreshAssetEmergence = (env: Env) =>
  runCoreBlockGated(env.CORE_DB, "asset_emergence_refreshed_blk", 6, () => refreshAssetEmergence(env.CORE_DB));

/** Serialized, replay-safe projections derived from the canonical mirror. */
export async function runCanonicalMaintenance(env: Env): Promise<boolean> {
  return withCanonicalMaintenanceLease(
    env.CORE_DB,
    async () => {
      await runScheduledJob("backfillBitcoinBlockCounts", () => backfillBitcoinBlockCounts(env));
      await runScheduledJob("reconcileStagedBitcoinFees", () => reconcileStagedBitcoinFees(env));
      await runScheduledJob("reconcileRecentDailyTransactions", () => reconcileRecentDailyTransactions(env.CORE_DB));
      await runScheduledJob("runCoreAssetSignalsStep", () => runCoreAssetSignalsStep(env.CORE_DB));
      await runScheduledJob("maybeRefreshAssetRatings", () => maybeRefreshAssetRatings(env.CORE_DB));
      await runScheduledJob("maybeRefreshAssetActivityOutlook", () => maybeRefreshAssetActivityOutlook(env.CORE_DB));
      await runScheduledJob("maybeRefreshExchangeTopAssets", () => maybeRefreshExchangeTopAssets(env));
      await runScheduledJob("maybeRebuildTags", () => maybeRebuildTags(env));
      await runScheduledJob("crawlEmblem", () => crawlEmblemStep(env));
      await runScheduledJob("refreshEmblemStats", () => maybeRefreshEmblemStats(env));
      await runScheduledJob("crawlAssetSupply", () => crawlAssetSupply(env));
      await runScheduledJob("maybeAnalyze", () => maybeAnalyze(env));
      await runScheduledJob("crawlCollections", () => maybeCrawlCollections(env));
      await runScheduledJob("crawlTokenscan", () => maybeCrawlTokenscan(env));
      await runScheduledJob("crawlEmblemSales", () => maybeCrawlEmblemSales(env));
      await runScheduledJob("crawlEmblemTransfers", () => crawlEmblemTransfers(env));
      await runScheduledJob("backfillEthereumBlockTimes", () => backfillEthereumBlockTimes(env));
      await runScheduledJob("crawlEmblemListings", () => maybeCrawlEmblemListings(env));
      await runScheduledJob("crawlScarceSales", () => crawlScarceSales(env));
      await runScheduledJob("classifyVaults", () => classifyVaults(env));
      await runScheduledJob("crawlEmblemMeta", () => crawlEmblemMeta(env));
      await runScheduledJob("buildScamAttribution", () => buildScamAttribution(env));
      await runScheduledJob("buildTrades", () => buildTrades(env));
      await runScheduledJob("refreshAssetEmergence", () => maybeRefreshAssetEmergence(env));
      await runScheduledJob("crawlPrices", () => maybeCrawlPrices(env));
      await runScheduledJob("applyTradeUsd", () => applyTradeUsd(env));
    },
    15 * 60,
  );
}
