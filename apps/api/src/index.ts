/**
 * api.xcp.io — Counterparty read-mirror + wallet-extension compatibility worker.
 *
 * Composition root: defines the Env bindings, mounts the route modules, and runs the scheduled cron.
 *   read     -> explorer read API (/v2/*)            verify -> mirror-vs-CP evaluation harness (/admin/verify)
 *   legacy   -> app.xcp.io/api/v1 wallet endpoints   admin  -> operational routes (/admin/*)
 * The scheduled handler advances the CP event mirror, then (only while caught up) steps the reputation
 * signal rebuild, the Emblem crawl, and deterministic supply maintenance — so catch-up never contends.
 */
import { Hono } from "hono";
import { syncEvents } from "./indexer/sync";
import { runSignalsStep, runSignalsCascade } from "./indexer/signals";
import { crawlEmblemStep } from "./indexer/emblem";
import { crawlAssetSupply } from "./indexer/asset-supply";
import { buildTags, buildTagsScoped } from "./indexer/tags";
import { crawlCollections } from "./indexer/collections";
import { crawlEmblemSales } from "./indexer/emblem-sales";
import { buildTrades } from "./indexer/trades";
import { crawlPrices, applyTradeUsd } from "./indexer/prices";
import { read } from "./read/router";
import { verify } from "./verify";
import { legacy } from "./legacy";
import { admin } from "./admin";

export interface Env {
  DB: D1Database;
  XCPDEX: Fetcher;              // service binding -> xcpdex-api worker (swap market data)
  CP_API_BASE: string;          // https://api.counterparty.io:4000/v2
  XCPDEX_API: string;           // https://xcpdex-api.me-bbe.workers.dev (fallback/ref)
  CONSOLIDATION_API: string;    // Hetzner consolidation origin (api.xcp.io today; grey-cloud origin after cutover)
  ADMIN_TOKEN: string;
  ALCHEMY_KEY: string;          // Alchemy NFT API key (Emblem Vault token-id enumeration, primary)
  ETHERSCAN_KEY: string;        // Etherscan API key (Emblem enumeration fallback)
}

// Periodic SQLite ANALYZE — keeps the query planner's stats fresh as the chain grows (~weekly, gated by
// block-delta since ANALYZE is ~10s). Stale/absent stats cause catastrophic join-order choices on D1.
async function maybeAnalyze(env: Env): Promise<void> {
  const tip = Number((await env.DB.prepare(`SELECT MAX(block_index) m FROM blocks`).first<{ m: number }>())?.m) || 0;
  const last = parseInt(((await env.DB.prepare(`SELECT value FROM indexer_state WHERE key='last_analyze_blk'`).first<{ value: string }>())?.value) || "0", 10);
  if (tip - last < 1008) return; // ~1 week of blocks
  await env.DB.prepare(`ANALYZE`).run();
  await env.DB.prepare(`INSERT INTO indexer_state (key,value) VALUES ('last_analyze_blk',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).bind(String(tip)).run();
}

// Refresh collection-membership tags (Rare Pepe / Fake Rare / …) from pepe.wtf ~daily. Gated by block-delta
// like ANALYZE — collections change rarely, and each run is ~11 fetches, so once a day is ample.
async function maybeCrawlCollections(env: Env): Promise<void> {
  const tip = Number((await env.DB.prepare(`SELECT MAX(block_index) m FROM blocks`).first<{ m: number }>())?.m) || 0;
  const last = parseInt(((await env.DB.prepare(`SELECT value FROM indexer_state WHERE key='collections_synced_blk'`).first<{ value: string }>())?.value) || "0", 10);
  if (tip - last < 144) return; // ~1 day of blocks
  await crawlCollections(env);
  await env.DB.prepare(`INSERT INTO indexer_state (key,value) VALUES ('collections_synced_blk',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).bind(String(tip)).run();
}

// Continue the Emblem-sales backfill a bounded step, gated to ~hourly so we crawl Alchemy getNFTSales
// steadily (rotating one contract per call) without hammering it every 2-min tick.
async function maybeCrawlEmblemSales(env: Env): Promise<void> {
  const tip = Number((await env.DB.prepare(`SELECT MAX(block_index) m FROM blocks`).first<{ m: number }>())?.m) || 0;
  const last = parseInt(((await env.DB.prepare(`SELECT value FROM indexer_state WHERE key='emblem_sales_synced_blk'`).first<{ value: string }>())?.value) || "0", 10);
  if (tip - last < 6) return; // ~1 hour of blocks
  await crawlEmblemSales(env);
  await env.DB.prepare(`INSERT INTO indexer_state (key,value) VALUES ('emblem_sales_synced_blk',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).bind(String(tip)).run();
}

// FULL tags self-heal (~daily). The per-tick cascade rebuilds computed tags only for the entities it touched;
// this full rebuild backstops it — reconciling anything the dirty set missed (e.g. an address that became a
// vault_funder because a NEW vault was crawled, not because it sent this tick). Gated by block-delta like
// ANALYZE/collections: the scoped rebuild keeps hot entities fresh, so once a day is ample for the sweep.
async function maybeRebuildTags(env: Env): Promise<void> {
  const tip = Number((await env.DB.prepare(`SELECT MAX(block_index) m FROM blocks`).first<{ m: number }>())?.m) || 0;
  const last = parseInt(((await env.DB.prepare(`SELECT value FROM indexer_state WHERE key='tags_rebuilt_blk'`).first<{ value: string }>())?.value) || "0", 10);
  if (tip - last < 144) return; // ~1 day of blocks
  await buildTags(env);
  await env.DB.prepare(`INSERT INTO indexer_state (key,value) VALUES ('tags_rebuilt_blk',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).bind(String(tip)).run();
}

// Refresh the daily USD price calendar (Coinbase BTC/ETH + DEX-derived XCP) ~daily. Gated by block-delta:
// daily candles only change once a day, and a full run is a handful of fetches.
async function maybeCrawlPrices(env: Env): Promise<void> {
  const tip = Number((await env.DB.prepare(`SELECT MAX(block_index) m FROM blocks`).first<{ m: number }>())?.m) || 0;
  const last = parseInt(((await env.DB.prepare(`SELECT value FROM indexer_state WHERE key='prices_synced_blk'`).first<{ value: string }>())?.value) || "0", 10);
  if (tip - last < 144) return; // ~1 day of blocks
  await crawlPrices(env);
  await env.DB.prepare(`INSERT INTO indexer_state (key,value) VALUES ('prices_synced_blk',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).bind(String(tip)).run();
}

const app = new Hono<{ Bindings: Env }>();

app.get("/", (c) => c.text("api.xcp.io ok"));
app.get("/health", (c) => c.text("ok"));
app.route("/", read);     // explorer read API: /v2/assets, /v2/addresses/{a}/balances, /v2/blocks, ...
app.route("/", verify);   // /admin/verify — mirror-vs-CP evaluation harness
app.route("/", legacy);   // /api/v1/* — wallet-extension compatibility surface
app.route("/", admin);    // /admin/* — operational routes (token-gated)

export default {
  fetch: app.fetch,
  async scheduled(_e: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil((async () => {
      // BOOTSTRAP PAUSE: while a full reindex/bootstrap is driven manually, set indexer_state 'cron_paused'='1'
      // so the cron stands down entirely. A cron sync running CONCURRENTLY with the bootstrap driver means two
      // large D1 write transactions at once → SQLITE_NOMEM (D1 out of memory). One driver at a time avoids it.
      try {
        const p = await env.DB.prepare("SELECT value FROM indexer_state WHERE key='cron_paused'").first<{ value: string }>();
        if (p?.value === "1") return;
      } catch (e) { console.error("cron_paused check", e); }
      // assets (incl. supply) are maintained deterministically from the event stream — no CP refetch.
      let caughtUp = false;
      try { const r: any = await syncEvents(env, { maxEvents: 10000 }); caughtUp = !!r?.caught_up; } catch (e) { console.error("syncEvents", e); }
      // Maintenance runs ONLY when caught up, so a catch-up/rebuild never contends with the live sync.
      if (caughtUp) {
        // Layer-B per-block cascade: recompute only the entities touched since the last tick (cheap, fresh).
        // Returns needs_backfill until the first full rebuild cycle completes and anchors the cursor at tip.
        // Its return carries the dirty entity sets, which we reuse for the scoped tag rebuild below (one
        // derivation shared by signals + tags).
        let cascade: any = null;
        try { cascade = await runSignalsCascade(env); } catch (e) { console.error("runSignalsCascade", e); }
        // Layer-C backstop: advance the FULL rebuild a couple bounded passes per tick. It maintains the
        // periodic/fan-out globals (community avgs, low-quality propagation, recent-window, tip-ages, infra
        // flags) AND self-heals any cascade gap — so a scoped-SQL miss is at worst briefly stale, never corrupt.
        try { await runSignalsStep(env, 2); } catch (e) { console.error("runSignalsStep", e); }
        // Rebuild the polymorphic tags (categorical layer) for JUST the entities the cascade touched — the
        // dirty-scoped equivalent of buildTags (no 430k-row global DELETE+reinsert every tick).
        try { if (cascade?.dirty) await buildTagsScoped(env, cascade.dirty); } catch (e) { console.error("buildTagsScoped", e); }
        // FULL tags rebuild as the daily self-healing backstop (reconciles anything the dirty set missed).
        try { await maybeRebuildTags(env); } catch (e) { console.error("maybeRebuildTags", e); }
        // Advance the Emblem Vault crawl (enumerate token ids via Alchemy + resolve BTC via /meta).
        try { await crawlEmblemStep(env); } catch (e) { console.error("crawlEmblem", e); }
        // Maintain authoritative asset supply (+asset_id/mime_type): backfill all assets once, then
        // refetch only assets touched by a supply-changing event, plus XCP every tick (fee-burn drift).
        try { await crawlAssetSupply(env); } catch (e) { console.error("crawlAssetSupply", e); }
        // Refresh SQLite optimizer stats periodically (~weekly). Without stats D1 picked terrible join orders
        // (exchanges overview scanned all 1.75M sends = 18s); ANALYZE fixed plans globally (→0.5s). Gated by
        // block-delta because ANALYZE itself is ~10s — far too heavy to run every 2-min tick.
        try { await maybeAnalyze(env); } catch (e) { console.error("maybeAnalyze", e); }
        // Collection-membership tags (Rare Pepe / Fake Rare / Bitcorn / …) from pepe.wtf, ~daily.
        try { await maybeCrawlCollections(env); } catch (e) { console.error("crawlCollections", e); }
        // Continue the Emblem-vault sales backfill (Alchemy getNFTSales), ~hourly, one contract per call.
        try { await maybeCrawlEmblemSales(env); } catch (e) { console.error("crawlEmblemSales", e); }
        // Materialize the unified trades ledger: dex + dispense advance by CP-block cursor, emblem re-folded.
        try { await buildTrades(env); } catch (e) { console.error("buildTrades", e); }
        // Daily USD price calendar (~daily), then map trades onto it (fills usd_value, bounded window per tick).
        try { await maybeCrawlPrices(env); } catch (e) { console.error("crawlPrices", e); }
        try { await applyTradeUsd(env); } catch (e) { console.error("applyTradeUsd", e); }
      }
    })());
  },
} satisfies ExportedHandler<Env>;
