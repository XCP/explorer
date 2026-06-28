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
import { runSignalsStep } from "./indexer/signals";
import { crawlEmblemStep } from "./indexer/emblem";
import { crawlAssetSupply } from "./indexer/asset-supply";
import { buildTags } from "./indexer/tags";
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
      // assets (incl. supply) are maintained deterministically from the event stream — no CP refetch.
      let caughtUp = false;
      try { const r: any = await syncEvents(env, { maxEvents: 10000 }); caughtUp = !!r?.caught_up; } catch (e) { console.error("syncEvents", e); }
      // Maintenance runs ONLY when caught up, so a catch-up/rebuild never contends with the live sync.
      if (caughtUp) {
        // Advance the reputation signal rebuild a couple bounded passes per tick (cursor cycles ->
        // tables stay continuously fresh without ever timing out a single invocation).
        try { await runSignalsStep(env, 2); } catch (e) { console.error("runSignalsStep", e); }
        // Rebuild the polymorphic tags table (categorical layer) from the refreshed signals + curated lists.
        try { await buildTags(env); } catch (e) { console.error("buildTags", e); }
        // Advance the Emblem Vault crawl (enumerate token ids via Alchemy + resolve BTC via /meta).
        try { await crawlEmblemStep(env); } catch (e) { console.error("crawlEmblem", e); }
        // Maintain authoritative asset supply (+asset_id/mime_type): backfill all assets once, then
        // refetch only assets touched by a supply-changing event, plus XCP every tick (fee-burn drift).
        try { await crawlAssetSupply(env); } catch (e) { console.error("crawlAssetSupply", e); }
        // Refresh SQLite optimizer stats periodically (~weekly). Without stats D1 picked terrible join orders
        // (exchanges overview scanned all 1.75M sends = 18s); ANALYZE fixed plans globally (→0.5s). Gated by
        // block-delta because ANALYZE itself is ~10s — far too heavy to run every 2-min tick.
        try { await maybeAnalyze(env); } catch (e) { console.error("maybeAnalyze", e); }
      }
    })());
  },
} satisfies ExportedHandler<Env>;
