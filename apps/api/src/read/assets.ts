/** Asset surfaces: index, detail (with derived supply/burned/circulating), per-asset record tabs,
 *  market data (xcpdex), and the research reads (collector cohort, holder quality). Handlers stay thin:
 *  parse → query (queries/assets.ts owns the SQL) → respond. The BigInt supply derivation and the
 *  config-driven scoring composition are business logic and live here; every DB statement is a query fn. */
import type { AssetDetail, AssetActivityMonth } from "@xcp/shared/assets";
import { fetchExternalMetadata } from "#api/integrations/external-metadata";
import { router, J, lim, off, round, cached } from "#api/read/respond";
import {
  scoreAsset,
  assetScore,
  assetTier,
  scoreConviction,
  convictionScore,
  type MarketState,
  rawSqlExpr,
  ASSET_FACTORS,
  ADDRESS_FACTORS,
} from "#api/reputation/score";
import { ASSET_PENALTY, ASSET_TIERS, ADDRESS_TIERS } from "#api/reputation/config";
import {
  featuredAssets,
  chainTip,
  holderTiers,
  holderArchetypes,
  assetTop1Pct,
  assetReviewDistribution,
  assetReviewTop,
  assetValidation,
  latestUsdRate,
} from "#api/queries/assets";
import {
  listCoreAssets,
  getCoreAsset,
  coreAssetAccounting,
  coreAssetSignals,
  coreAssetTags,
  coreAssetSales,
  coreAssetFeedCounts,
  coreXcpSupply,
  coreAssetCollection,
  coreAssetArtist,
  listAssetBalances,
  listAssetIssuances,
  listAssetSends,
  listAssetDispensers,
  listAssetDispenses,
  listAssetDividends,
  listAssetDestructions,
  listAssetPools,
  listAssetPoolMatches,
  listAssetFairmints,
  listCoreSubassets,
  coreAssetCohort,
  coreAssetRelated,
  coreAssetQualitySignals,
  coreAssetActivityVenues,
  coreAssetActivityFlows,
  coreAssetActiveUsers,
} from "#api/queries/core-assets";
import { listAssetOrders } from "#api/queries/core-orders";

export const assets = router();

assets.get("/v2/assets", async (c) => {
  const filter = {
    query: c.req.query("query"),
    limit: lim(c),
    offset: off(c),
    sort: c.req.query("sort"),
    dir: c.req.query("dir") === "asc" ? "asc" : c.req.query("dir") === "desc" ? "desc" : undefined,
  } as const;
  const rows = await listCoreAssets(c.env.CORE_DB, filter);
  return J(c, { result: rows, next_offset: rows.length === lim(c) ? off(c) + lim(c) : null });
});

// Featured grid — highest-quality MARKET assets that actually have art (the has_media tag). Powers a
// "feature only assets with media" curation grid. Default 12 (the leaderboard card design); up to 144 (12x12).
assets.get("/v2/featured", async (c) => {
  const n = lim(c, 12, 144);
  return cached(c, `featured:quality:${n}`, { ttl: 600, edge: 120 }, async () => {
    const expr = `(${rawSqlExpr(ASSET_FACTORS, 0)}) - (CASE WHEN low_quality=1 THEN ${-ASSET_PENALTY.lowQuality} ELSE 0 END)`;
    return { result: await featuredAssets(c.env.CORE_DB, expr, n) };
  });
});

assets.get("/v2/assets/:asset", async (c) => {
  const a = c.req.param("asset");
  let r = await getCoreAsset(c.env.CORE_DB, a);
  if (!r) {
    // XCP and BTC are native assets with no issuance row. XCP supply = proof-of-burn minus all XCP
    // destroyed (destructions + issuance/sweep/dividend fees). BTC has no Counterparty supply.
    const A = a.toUpperCase();
    if (A === "XCP" || A === "BTC") {
      const [sup, holder_count, feed_counts] = await Promise.all([
        A === "XCP" ? coreXcpSupply(c.env.CORE_DB) : Promise.resolve(null),
        coreAssetAccounting(c.env.CORE_DB, A).then((accounting) => accounting?.holder_count ?? 0),
        coreAssetFeedCounts(c.env.CORE_DB, A, null).catch(() => null),
      ]);
      const supply_normalized = A === "XCP" ? (Number(sup?.supply ?? 0) / 1e8).toFixed(8) : null;
      const body: AssetDetail = {
        asset: A,
        asset_longname: null,
        type: "native",
        divisible: 1,
        locked: 1,
        description: A === "XCP" ? "Counterparty native currency" : "Bitcoin",
        issuer: null,
        owner: null,
        supply_normalized,
        holder_count,
        feed_counts,
      };
      return J(c, { result: body }, 300); // native token — near-static
    }
    // Not native and not found — retry ONCE before declaring 404. `one()` throws (→ 500) on a real DB error,
    // so a null here is either a genuine miss or a transient empty read (a D1 hiccup, or a read landing mid
    // full-reindex when `assets` is being rebuilt). A retry confirms real absence, so we only ever emit — and
    // let the web cache — a 404 for an asset that truly isn't there.
    r = await getCoreAsset(c.env.CORE_DB, a);
    if (!r) return c.json({ error: "Asset not found" }, 404);
  }
  // These reads are independent — run them concurrently (wall-time = slowest, not the sum;
  // the sequential version was the classic multiple-round-trips D1 anti-pattern).
  const [accounting, sigRes, tagsRes, salesRes, collectionRes, artistRes, feedCountsRes] = await Promise.all([
    // Supply stays exact TEXT across SQLite/JS; holders, supply, burned, and escrow share one trip.
    coreAssetAccounting(c.env.CORE_DB, r.asset),
    coreAssetSignals(c.env.CORE_DB, r.asset).catch(() => null),
    coreAssetTags(c.env.CORE_DB, r.asset).catch((): string[] => []),
    // money stats from the unified trades ledger — the header's Realized / Last sale strip entries
    coreAssetSales(c.env.CORE_DB, r.asset).catch(() => null),
    coreAssetCollection(c.env.CORE_DB, r.asset).catch(() => null),
    coreAssetArtist(c.env.CORE_DB, r.asset).catch(() => null),
    // per-feed tab counts (the detail page's tab bar) — same filters as the feed list endpoints
    coreAssetFeedCounts(c.env.CORE_DB, r.asset, r.issuer).catch(() => null),
  ]);
  const holder_count = accounting?.holder_count ?? 0;
  const raw = BigInt(accounting?.supply ?? 0);
  const burnedRaw = BigInt(accounting?.burned ?? 0);
  const escrowRaw = BigInt(accounting?.escrow ?? 0);
  const circRaw = raw - burnedRaw;
  // exact BigInt -> normalized decimal string (pure string math; no float, preserves >2^53 precision).
  const norm = (x: bigint) => {
    if (!r.divisible) return x.toString();
    const neg = x < 0n,
      s = (neg ? -x : x).toString().padStart(9, "0");
    return (neg ? "-" : "") + s.slice(0, -8) + "." + s.slice(-8);
  };
  // composed asset quality score (config-driven, src/reputation) from the precomputed asset_signals row
  const sig = sigRes;
  const scored = sig ? scoreAsset(sig) : null;
  // market state: ranked into a tier only if it ever traded/dispensed; else Untraded (held) / Dormant (no holders).
  const state: MarketState =
    sig && ((sig.trades ?? 0) > 0 || (sig.dispenses ?? 0) > 0)
      ? "market"
      : sig && (sig.holders ?? 0) > 0
        ? "held"
        : "none";
  const score = scored && state === "market" ? assetScore(scored.raw) : null; // score = percentile among market assets only
  // tags are the categorical layer — stamp/src20/src721 classification + behavioral labels live here.
  const tags = tagsRes;
  // Conviction describes holder participation and scarcity without using market prices.
  const convictionEligible =
    sig &&
    sig.low_quality !== 1 &&
    (sig.holders ?? 0) >= 15 &&
    !tags.includes("numeric");
  const convictionRaw = convictionEligible ? scoreConviction(sig).raw : null;
  const body: AssetDetail = {
    ...r,
    supply: raw.toString(),
    supply_normalized: norm(raw),
    holder_count,
    burned: burnedRaw.toString(),
    burned_normalized: norm(burnedRaw),
    escrow: escrowRaw.toString(),
    escrow_normalized: norm(escrowRaw),
    circulating: circRaw.toString(),
    circulating_normalized: norm(circRaw),
    quality:
      scored && sig
        ? {
            tier: assetTier(scored.raw, state, sig.low_quality === 1),
            score,
            raw: round(scored.raw, 2),
            breakdown: scored.breakdown,
            low_quality: sig.low_quality === 1,
          }
        : { tier: "Dormant", score: null },
    tags,
    sales: salesRes ?? { realized_usd: null, last_price_usd: null, last_sale_time: null },
    collection: collectionRes?.tag ?? null,
    collection_site: collectionRes?.site ?? null,
    collection_series: collectionRes?.series ?? null,
    collection_card: collectionRes?.card ?? null,
    artist: artistRes ? { tag: artistRes.tag, name: artistRes.name, slug: artistRes.slug } : null,
    feed_counts: feedCountsRes,
    // holder cohesion: edges among top holders ÷ holders. Median among traded assets ~4, so only the top decile
    // (≥9) is an insular holder base — the holders overwhelmingly trade among themselves. That alone is often a
    // harmless airdrop cohort ($0 volume), so `insular` flags only the market-integrity case: insular AND real
    // realized volume (≥$1k) ⇒ the wash / inflated-volume suspect. Score/edges/strong are stored for all so a
    // future diagnostic view can rank the broader insular set.
    cohesion:
      sig && sig.holder_cohesion != null
        ? {
            score: sig.holder_cohesion,
            edges: sig.cohesion_edges ?? 0,
            strong: sig.cohesion_strong ?? 0,
            insular: sig.holder_cohesion >= 9 && (sig.max_realized_usd ?? 0) >= 1000,
          }
        : null,
    conviction: convictionRaw != null ? { score: convictionScore(convictionRaw) } : null,
  };
  // 120s: the asset's headline data (supply, holders, score, tags) drifts slowly; a 2-min cache window cuts
  // cold-miss recomputes 4× vs the 30s default while staying fresh enough for an explorer.
  return J(c, { result: body }, 120);
});

// Holder makeup — "who holds this asset?" by reputation tier + archetype + concentration. Surfaces the
// quality of the holder base (a real asset is held by established collectors; a sybil-minted one by Casual
// wallets — e.g. MINTS is ~94% Casual). Non-reputation holders get their specific label
// (Exchange/Deposit/Vault/Burn/Service), never a generic bucket. Rows sort by supply share, high→low.
assets.get("/v2/assets/:asset/holder-makeup", async (c) => {
  const a = c.req.param("asset").toUpperCase();
  const tip = await chainTip(c.env.CORE_DB);
  const expr = rawSqlExpr(ADDRESS_FACTORS, tip);
  const [og, est, act] = [ADDRESS_TIERS[0].minRaw, ADDRESS_TIERS[1].minRaw, ADDRESS_TIERS[2].minRaw];
  const rows = await holderTiers(c.env.CORE_DB, a, expr, og, est, act);
  const arche = await holderArchetypes(c.env.CORE_DB, a);
  const top1 = await assetTop1Pct(c.env.CORE_DB, a);
  const tiers = rows.sort((x, y) => y.pct_supply - x.pct_supply);
  return J(
    c,
    {
      result: {
        asset: a,
        holders: arche?.holders ?? 0,
        tiers,
        archetypes: { creators: arche?.creators ?? 0, collectors: arche?.collectors ?? 0, whales: arche?.whales ?? 0 },
        top_holder_pct: top1?.t ?? null,
      },
    },
    300,
  );
});

// Asset-quality calibration view (parallel to /v2/reputation/review for addresses): the population quality
// distribution + top/bottom for face-validity after a weight change.
assets.get("/v2/reputation/asset-review", (c) =>
  cached(c, "asset-review:market-tier-partition-complete", { ttl: 600, edge: 60 }, async () => {
    const expr = `(${rawSqlExpr(ASSET_FACTORS, 0)}) - (CASE WHEN low_quality=1 THEN ${-ASSET_PENALTY.lowQuality} ELSE 0 END)`;
    const cut = (tier: string) => {
      const value = ASSET_TIERS.find((entry) => entry.tier === tier)?.minRaw;
      if (value === undefined) throw new Error(`${tier} asset tier is required for reputation calibration`);
      return value;
    };
    const [distribution, top] = await Promise.all([
      assetReviewDistribution(c.env.CORE_DB, expr, cut("Bluechip"), cut("Premium"), cut("Notable")),
      assetReviewTop(c.env.CORE_DB, expr),
    ]);
    return { result: { distribution, top } };
  }),
);

// Live convergent-validity guard for the asset-quality weights: vaulted-tagged assets should keep scoring far
// above non-vaulted market assets (H4). `lift` = vaulted mean ÷ non-vaulted mean; watch it stays >2.5 and
// stable across weight changes — a collapse means a re-dial broke the "quality" signal. Same raw expr as
// /v2/reputation/asset-review (rawSqlExpr − the flat low_quality penalty).
assets.get("/v2/reputation/asset-validation", async (c) => {
  return cached(c, "asset-validation:quality", { ttl: 600 }, async () => {
    const expr = `(${rawSqlExpr(ASSET_FACTORS, 0)}) - (CASE WHEN low_quality=1 THEN ${-ASSET_PENALTY.lowQuality} ELSE 0 END)`;
    const rows = await assetValidation(c.env.CORE_DB, expr);
    const grp = (v: 0 | 1) => rows.find((r) => r.v === v) ?? { v, n: 0, mean: 0, median: 0 };
    const vaulted = grp(1),
      non_vaulted = grp(0);
    const lift = non_vaulted.mean ? round(vaulted.mean / non_vaulted.mean, 2) : null;
    return {
      result: {
        vaulted: { n: vaulted.n, mean: vaulted.mean, median: vaulted.median },
        non_vaulted: { n: non_vaulted.n, mean: non_vaulted.mean, median: non_vaulted.median },
        lift,
        median_gap: round(vaulted.median - non_vaulted.median, 2),
        note: "market assets only (trades>0 OR dispenses>0). median_gap (vaulted − non-vaulted median raw) is the PRIMARY gauge under the realized-value-dominant model — the mean RATIO compresses as the shared USD term lifts every asset, so read `lift` only alongside the gap. Watch for degradation from the post-Phase-B baseline across weight changes (H4).",
      },
    };
  });
});

assets.get("/v2/assets/:asset/balances", async (c) => {
  const asset = c.req.param("asset").toUpperCase();
  const rows = await listAssetBalances(c.env.CORE_DB, asset, lim(c), off(c));
  return J(c, { result: rows, next_offset: rows.length === lim(c) ? off(c) + lim(c) : null });
});

assets.get("/v2/assets/:asset/issuances", async (c) => {
  const asset = c.req.param("asset").toUpperCase();
  const rows = await listAssetIssuances(c.env.CORE_DB, asset, lim(c), off(c));
  return J(c, { result: rows, next_offset: rows.length === lim(c) ? off(c) + lim(c) : null });
});

assets.get("/v2/assets/:asset/sends", async (c) => {
  const asset = c.req.param("asset").toUpperCase();
  const rows = await listAssetSends(c.env.CORE_DB, asset, lim(c), off(c));
  return J(c, { result: rows, next_offset: rows.length === lim(c) ? off(c) + lim(c) : null });
});

assets.get("/v2/assets/:asset/dispensers", async (c) => {
  const asset = c.req.param("asset").toUpperCase();
  const rows = await listAssetDispensers(c.env.CORE_DB, asset, lim(c), off(c));
  return J(c, { result: rows, next_offset: rows.length === lim(c) ? off(c) + lim(c) : null });
});

assets.get("/v2/assets/:asset/dispenses", async (c) => {
  const asset = c.req.param("asset").toUpperCase();
  const rows = await listAssetDispenses(c.env.CORE_DB, asset, lim(c), off(c));
  return J(c, { result: rows, next_offset: rows.length === lim(c) ? off(c) + lim(c) : null });
});

assets.get("/v2/assets/:asset/orders", async (c) => {
  const asset = c.req.param("asset").toUpperCase();
  const rows = await listAssetOrders(c.env.CORE_DB, asset, lim(c), off(c));
  return J(c, { result: rows, next_offset: rows.length === lim(c) ? off(c) + lim(c) : null });
});

assets.get("/v2/assets/:asset/fairmints", async (c) => {
  const asset = c.req.param("asset").toUpperCase();
  const rows = await listAssetFairmints(c.env.CORE_DB, asset, lim(c), off(c));
  return J(c, { result: rows, next_offset: rows.length === lim(c) ? off(c) + lim(c) : null });
});

assets.get("/v2/assets/:asset/dividends", async (c) => {
  const asset = c.req.param("asset").toUpperCase();
  const rows = await listAssetDividends(c.env.CORE_DB, asset, lim(c), off(c));
  return J(c, { result: rows, next_offset: rows.length === lim(c) ? off(c) + lim(c) : null });
});

assets.get("/v2/assets/:asset/destructions", async (c) => {
  const asset = c.req.param("asset").toUpperCase();
  const rows = await listAssetDestructions(c.env.CORE_DB, asset, lim(c), off(c));
  return J(c, { result: rows, next_offset: rows.length === lim(c) ? off(c) + lim(c) : null });
});

assets.get("/v2/assets/:asset/pools", async (c) => {
  const asset = c.req.param("asset").toUpperCase();
  const rows = await listAssetPools(c.env.CORE_DB, asset, lim(c), off(c));
  return J(c, { result: rows, next_offset: rows.length === lim(c) ? off(c) + lim(c) : null });
});

assets.get("/v2/assets/:asset/pool-matches", async (c) => {
  const asset = c.req.param("asset").toUpperCase();
  const rows = await listAssetPoolMatches(c.env.CORE_DB, asset, lim(c), off(c));
  return J(c, { result: rows, next_offset: rows.length === lim(c) ? off(c) + lim(c) : null });
});

// Comprehensive monthly on-chain activity for the Activity tab — built from OUR mirror across every event
// kind (DEX orders/matches, dispensers/dispenses, sends, issuances/fairmints/destructions/dividends). Two
// union reads (kept under D1's term cap) merged by month.
assets.get("/v2/assets/:asset/activity", async (c) => {
  const a = c.req.param("asset").toUpperCase();
  // D1 accounts concurrent statements against one request's database CPU budget.
  // Run these independently indexed aggregates in sequence: in parallel, a busy
  // venue scan can reset the cheap flow query and the old fallback cached `[]`.
  const venues = await coreAssetActivityVenues(c.env.CORE_DB, a);
  const flows = await coreAssetActivityFlows(c.env.CORE_DB, a);
  const byMonth = new Map<string, AssetActivityMonth>();
  const row = (m: string) => byMonth.get(m) ?? { month: m, orders: 0, dispensers: 0, sends: 0, supply: 0 };
  for (const v of venues) byMonth.set(v.month, { ...row(v.month), orders: v.orders, dispensers: v.dispensers });
  for (const f of flows) byMonth.set(f.month, { ...row(f.month), sends: f.sends, supply: f.supply });
  const result = [...byMonth.values()].sort((x, y) => x.month.localeCompare(y.month));
  return J(c, { result }, 300);
});

// Most active users of the asset — addresses ranked by lifetime credits + debits (how much they've USED it,
// not their balance). From the credits/debits ledger.
assets.get("/v2/assets/:asset/active-users", async (c) => {
  const result = await coreAssetActiveUsers(c.env.CORE_DB, c.req.param("asset").toUpperCase(), lim(c, 15, 50));
  return J(c, { result }, 300);
});

// CIP-25 JSON descriptor: a description that points to a .json file (optionally `;<sha256>`, and the legacy
// `@`/`*` prefixes). Returns the https URL + optional hash, or null if the description isn't a JSON pointer.
function parseJsonDescriptor(desc: string): { url: string; hash: string | null } | null {
  let s = desc.trim();
  if (!s) return null;
  if (s.startsWith("@") || s.startsWith("*")) s = s.slice(1).trim();
  const semi = s.indexOf(";");
  let url = (semi >= 0 ? s.slice(0, semi) : s).trim();
  const hashPart = semi >= 0 ? s.slice(semi + 1).trim() : "";
  if (!/\.json(\?|#|$)/i.test(url) && !url.toLowerCase().includes(".json")) return null;
  if (!/^https?:\/\//i.test(url)) url = "https://" + url; // default a schemeless pointer to TLS…
  // …but do NOT force explicit http -> https: many early hosts (rarepepedirectory.com, coinsite) are http-only
  // with broken/absent certs, and forcing TLS just yields a 526. Server-side fetch has no mixed-content limit.
  return { url, hash: /^[a-f0-9]{64}$/i.test(hashPart) ? hashPart.toLowerCase() : null };
}

// Arweave's minted metadata/image URLs frequently carry a filename sub-path ("/SILKR.json", "/x.png") that
// 404s, while the data itself is addressable at the bare transaction id. Drop the sub-path to recover it.
// (Community-confirmed workaround: the tx hash is the real address — https://viewblock.io/arweave/tx/<id>.)
function arweaveBareUrl(url: string): string | null {
  const m = url.match(/^(https?:\/\/(?:[a-z0-9-]+\.)?arweave\.net\/[A-Za-z0-9_-]{20,})\/.+$/i);
  return m ? m[1] : null;
}

// Ordered fetch candidates for a JSON pointer: the URL as-given, then the arweave bare-tx fallback, then an
// http downgrade for hosts whose https is broken. First 2xx wins.
function jsonCandidates(url: string): string[] {
  const out = [url];
  const bare = arweaveBareUrl(url);
  if (bare) out.push(bare);
  if (/^https:\/\//i.test(url)) out.push(url.replace(/^https:/i, "http:"));
  return [...new Set(out)];
}

// The image URLs *inside* these arweave JSONs carry the same "/<filename>.png" sub-path that 404s, so rewrite
// any arweave image URL to its bare tx id before handing the JSON to the client to render. Only touches URLs
// ending in an image extension — website/external_url links are left alone.
function fixArweaveImageUrls<T>(v: T): T {
  if (typeof v === "string") {
    const m = v.match(
      /^(https?:\/\/(?:[a-z0-9-]+\.)?arweave\.net\/[A-Za-z0-9_-]{20,})\/[^/]+\.(png|jpe?g|gif|webp|svg|avif)(\?.*)?$/i,
    );
    return (m ? m[1] : v) as T;
  }
  if (Array.isArray(v)) return v.map(fixArweaveImageUrls) as T;
  if (v && typeof v === "object") {
    const o: Record<string, unknown> = {};
    for (const k in v as Record<string, unknown>) o[k] = fixArweaveImageUrls((v as Record<string, unknown>)[k]);
    return o as T;
  }
  return v;
}

// Enhanced asset info (CIP-25): if the description points to a JSON file, fetch it SERVER-SIDE (fixes the CORS
// failures a client fetch hits on non-CORS hosts), cap size/time, and verify the optional ;sha256 hash. We
// return the parsed object only — never execute anything; the client sanitizes HTML fields with DOMPurify.
assets.get("/v2/assets/:asset/enhanced", async (c) => {
  const r = await getCoreAsset(c.env.CORE_DB, c.req.param("asset").toUpperCase());
  const ptr = parseJsonDescriptor(r?.description || "");
  if (!ptr) return J(c, { result: null }, 300);
  try {
    // Try the pointer as-given, then the arweave bare-tx and http fallbacks (retrying flaky gateways).
    const { text, lastStatus } = await fetchExternalMetadata(jsonCandidates(ptr.url));
    if (text === null) {
      // Distinguish a permanently-dead metadata host (DNS gone / Cloudflare 52x origin errors) from a transient
      // blip, and say so plainly — the asset's art is served separately and is unaffected. Cache dead hosts longer.
      let host = "the metadata source";
      try {
        host = new URL(ptr.url).host;
      } catch {
        /* keep default */
      }
      const offline = !lastStatus || (lastStatus >= 520 && lastStatus <= 530);
      const error = offline ? `The metadata host (${host}) is offline.` : `source returned ${lastStatus}`;
      return J(c, { result: { url: ptr.url, error } }, offline ? 3600 : 60);
    }
    if (ptr.hash) {
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
      const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
      if (hex !== ptr.hash)
        return J(c, { result: { url: ptr.url, error: "content hash does not match the on-chain hash" } }, 300);
    }
    const json = fixArweaveImageUrls(JSON.parse(text));
    return J(c, { result: { json, url: ptr.url, verified: !!ptr.hash } }, 300);
  } catch {
    return J(c, { result: { url: ptr.url, error: "could not load or parse the JSON" } }, 60);
  }
});

// market data for an asset (vs XCP) from xcpdex — cross-app composition via the service binding
assets.get("/v2/assets/:asset/market", async (c) => {
  const a = c.req.param("asset").toUpperCase();
  try {
    const res = await c.env.XCPDEX.fetch(`https://xcpdex-api/pair/${encodeURIComponent(a)}_XCP`);
    if (!res.ok) return J(c, { result: null }, 120);
    const p = await res.json<{
      last_price?: number | null;
      volume_7d?: number | null;
      trade_count_7d?: number | null;
      price_change_7d?: number | null;
      best_ask?: number | null;
    }>();
    // Floor price = the lowest open DEX ask (best_ask, in XCP) converted to USD via the current XCP rate.
    // Only when there's actually an ask standing; source labels where it came from (an order, for now).
    let floor_usd: number | null = null,
      floor_source: string | null = null;
    if (p.best_ask != null) {
      const rate = await latestUsdRate(c.env.CORE_DB, "XCP").catch(() => null);
      if (rate?.usd) {
        floor_usd = p.best_ask * rate.usd;
        floor_source = "Order";
      }
    }
    return J(
      c,
      {
        result: {
          pair: `${a}/XCP`,
          last_price: p.last_price ?? null,
          volume_7d: p.volume_7d ?? null,
          trades_7d: p.trade_count_7d ?? null,
          price_change_7d: p.price_change_7d ?? null,
          floor_usd,
          floor_source,
        },
      },
      120,
    );
  } catch {
    return J(c, { result: null }, 60);
  }
});

assets.get("/v2/assets/:asset/subassets", async (c) => {
  const rows = await listCoreSubassets(c.env.CORE_DB, c.req.param("asset").toUpperCase(), lim(c), off(c));
  return J(c, { result: rows, next_offset: rows.length === lim(c) ? off(c) + lim(c) : null });
});

// Collector cohort: "holders of X also collect…" — the holders-also-hold graph. Excludes XCP (currency,
// held by everyone). Returns related assets ranked by shared-holder count, with art-ready names.
assets.get("/v2/assets/:asset/cohort", async (c) => {
  const rows = await coreAssetCohort(c.env.CORE_DB, c.req.param("asset").toUpperCase(), lim(c, 18, 36));
  return J(c, { result: rows }, 3600);
});

// The Related tab's two strips — each related asset carries WHY it's related: the % of the subject's
// holders that also hold it. `collection` = same-collection siblings ranked by that overlap; `cohort` =
// the broadest co-held assets OUTSIDE the collection (so the two strips never repeat). The collection is
// resolved server-side, so the tab needs only the asset.
assets.get("/v2/assets/:asset/related", async (c) => {
  const asset = c.req.param("asset").toUpperCase();
  return cached(c, `asset-related:${asset}`, { ttl: 3600, edge: 300, swr: 86400 }, async () => {
    const coll = await coreAssetCollection(c.env.CORE_DB, asset).catch(() => null);
    const tag = coll?.tag ?? null;
    const related = await coreAssetRelated(c.env.CORE_DB, asset, tag, 12, 6);
    const rows = related.map(({ in_collection: _, ...row }) => row);
    const collection = tag ? rows.filter((_, index) => related[index]?.in_collection === 1) : [];
    const cohort = rows.filter((_, index) => related[index]?.in_collection === 0);
    return { result: { collection, cohort } };
  });
});

// Holder quality (aggregate, non-creepy) + trading integrity for an asset — the "is this cap table
// real?" read (fairmint due-diligence). Reads precomputed signals; trading integrity uses the CANONICAL
// low-quality flag (self-trade% wash + curated), NOT trades-per-trader (which mistakes genuine liquidity
// like PEPECASH/XCP for manipulation).
assets.get("/v2/assets/:asset/quality", async (c) => {
  const r = await coreAssetQualitySignals(c.env.CORE_DB, c.req.param("asset").toUpperCase());
  if (!r) return J(c, { result: { holders: 0, trades: 0, low_quality: 0 } }, 300);
  return J(
    c,
    {
      result: {
        holders: r.holders ?? 0,
        top1_pct: round(r.top1_pct),
        trades: r.trades ?? 0,
        self_trade_pct: round(r.self_trade_pct),
        holder_breadth: round(r.holder_breadth, 0),
        pct_creator_holders: round(r.pct_creator_holders),
        burned_pct: round(r.burned_pct),
        low_quality: r.low_quality ?? 0,
        wash_suspect: (r.low_quality ?? 0) === 1,
      },
    },
    300,
  );
});
