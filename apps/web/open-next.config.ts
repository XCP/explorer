import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import r2IncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/r2-incremental-cache";

// R2-backed incremental cache so Next's Data Cache (`getJson({ revalidate })`) actually PERSISTS. Without
// this the config was empty and every SSR asset-page load re-queried D1 cold. Now revalidate hints hold and
// stale-while-revalidate serves fast while refreshing in the background. Bucket: xcp-web-inc-cache.
export default defineCloudflareConfig({
  incrementalCache: r2IncrementalCache,
});
