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
      }
    })());
  },
} satisfies ExportedHandler<Env>;
