import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import r2IncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/r2-incremental-cache";
import doQueue from "@opennextjs/cloudflare/overrides/queue/do-queue";
import queueCache from "@opennextjs/cloudflare/overrides/queue/queue-cache";

// R2-backed incremental cache so Next's Data Cache (`getJson({ revalidate })`) actually PERSISTS. Without
// this the config was empty and every SSR asset-page load re-queried D1 cold. Now revalidate hints hold and
// stale-while-revalidate serves fast while refreshing in the background. Bucket: xcp-web-inc-cache.
export default defineCloudflareConfig({
  incrementalCache: r2IncrementalCache,
  /**
   * R2 stores renders; a queue is what refreshes an expired one. Without this
   * key `resolveQueue` defaults to "dummy", whose `send()` throws
   * `Dummy queue is not implemented` on every call — so `revalidateIfRequired`
   * caught it and logged `Failed to revalidate stale page` and nothing was ever
   * refreshed. That is the single largest source of errors on this worker
   * (/ratings alone, all day), and it means a cached page stayed stale until
   * its R2 object hit the 30-day lifecycle expiry below rather than its own
   * `revalidate` window.
   *
   * Same shape the launchpad worker uses: a Durable Object queue, wrapped in
   * the regional cache so a burst of requests for one stale page enqueues one
   * refresh instead of one per request.
   */
  queue: queueCache(doQueue, { regionalCacheTtlSec: 5, waitForQueueAck: true }),
});
