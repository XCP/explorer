/** Asset surfaces: index, detail (with derived supply/burned/circulating), per-asset record tabs,
 *  market data (xcpdex), and the research reads (collector cohort, holder quality). Handlers stay thin:
 *  parse → query (queries/assets.ts owns the SQL) → respond. The BigInt supply derivation and the
 *  config-driven scoring composition are business logic and live here; every DB statement is a query fn. */
import type { AssetDetail } from "@xcp/shared/assets";
import { router, J, lim, off, round, cached } from "./respond";
import { scoreAsset, assetScore, assetTier, type MarketState, rawSqlExpr, ASSET_FACTORS, ADDRESS_FACTORS } from "../reputation/score";
import { ASSET_PENALTY, ADDRESS_TIERS } from "../reputation/config";
import {
  listAssets, featuredAssets, getAsset, holderCount, xcpNativeSupply, assetSupplyText, assetBurnedText,
  assetSignalsRow, assetTags, chainTip, holderTiers, holderArchetypes, assetTop1Pct,
  assetReviewDistribution, assetReviewTop, listAssetBalances, listAssetIssuances, listAssetSends,
  listAssetDispensers, listAssetDispenses, listAssetOrders, listSubassets, assetCohort, assetQualitySignals,
} from "../queries/assets";

export const assets = router();

assets.get("/v2/assets", async (c) => {
  const rows = await listAssets(c.env.DB, { query: c.req.query("query"), limit: lim(c), offset: off(c) });
  return J(c, { result: rows, next_offset: rows.length === lim(c) ? off(c) + lim(c) : null });
});

// Featured grid — highest-quality MARKET assets that actually have art (the has_media tag). Powers a
// "feature only assets with media" curation grid. Default 12 (the leaderboard card design); up to 144 (12x12).
assets.get("/v2/featured", async (c) => {
  const n = lim(c, 12, 144);
  return cached(c, `featured:${n}`, { ttl: 600, edge: 120 }, async () => {
    const expr = `(${rawSqlExpr(ASSET_FACTORS, 0)}) - (CASE WHEN low_quality=1 THEN ${-ASSET_PENALTY.lowQuality} ELSE 0 END)`;
    return { result: await featuredAssets(c.env.DB, expr, n) };
  });
});

assets.get("/v2/assets/:asset", async (c) => {
  const a = c.req.param("asset");
  const r = await getAsset(c.env.DB, a);
  if (!r) {
    // XCP and BTC are native assets with no issuance row. XCP supply = proof-of-burn minus all XCP
    // destroyed (destructions + issuance/sweep/dividend fees). BTC has no Counterparty supply.
    const A = a.toUpperCase();
    if (A === "XCP" || A === "BTC") {
      let supply_normalized: string | null = null;
      if (A === "XCP") {
        const sup = await xcpNativeSupply(c.env.DB);
        supply_normalized = (Number(sup?.supply ?? 0) / 1e8).toFixed(8);
      }
      const holder_count = await holderCount(c.env.DB, A);
      const body: AssetDetail = {
        asset: A, asset_longname: null, type: "native", divisible: 1, locked: 1,
        description: A === "XCP" ? "Counterparty native currency" : "Bitcoin",
        issuer: null, owner: null, supply_normalized, holder_count,
      };
      return J(c, { result: body });
    }
    return c.json({ error: "Asset not found" }, 404);
  }
  const holder_count = await holderCount(c.env.DB, r.asset);
  // supply isn't stored during event replay -> derive it: minted (valid issuances) minus destructions.
  // CAST the result to TEXT so D1 returns a STRING — a JS number would silently lose precision for
  // supplies > 2^53 (e.g. PEPECASH ~1e17 minor-units). The SUM itself is exact int64 inside SQLite.
  const sup = await assetSupplyText(c.env.DB, r.asset);
  const raw = BigInt(sup?.supply ?? 0);
  // Burned = supply sitting in known burn addresses; circulating = total issued minus that. Canonical
  // supply is left intact — burned/circulating sit alongside.
  const burn = await assetBurnedText(c.env.DB, r.asset);
  const burnedRaw = BigInt(burn?.burned ?? 0);
  const circRaw = raw - burnedRaw;
  // exact BigInt -> normalized decimal string (pure string math; no float, preserves >2^53 precision).
  const norm = (x: bigint) => {
    if (!r.divisible) return x.toString();
    const neg = x < 0n, s = (neg ? -x : x).toString().padStart(9, "0");
    return (neg ? "-" : "") + s.slice(0, -8) + "." + s.slice(-8);
  };
  // composed asset quality score (config-driven, src/reputation) from the precomputed asset_signals row
  const sig = await assetSignalsRow(c.env.DB, r.asset).catch(() => null);
  const scored = sig ? scoreAsset(sig) : null;
  // market state: ranked into a tier only if it ever traded/dispensed; else Untraded (held) / Dormant (no holders).
  const state: MarketState = sig && ((sig.trades ?? 0) > 0 || (sig.dispenses ?? 0) > 0) ? "market"
    : sig && (sig.holders ?? 0) > 0 ? "held" : "none";
  const score = scored && state === "market" ? assetScore(scored.raw) : null; // score = percentile among market assets only
  // tags are the categorical layer — stamp/src20/src721 classification + behavioral labels live here.
  const tags = await assetTags(c.env.DB, r.asset).catch(() => []);
  const body: AssetDetail = {
    ...r, supply: raw.toString(), supply_normalized: norm(raw), holder_count,
    burned: burnedRaw.toString(), burned_normalized: norm(burnedRaw),
    circulating: circRaw.toString(), circulating_normalized: norm(circRaw),
    quality: scored && sig
      ? { tier: assetTier(scored.raw, state), score, raw: round(scored.raw, 2), breakdown: scored.breakdown, low_quality: sig.low_quality === 1 }
      : { tier: "Dormant", score: null },
    tags,
  };
  return J(c, { result: body });
});

// Holder makeup — "who holds this asset?" by reputation tier + archetype + concentration. Surfaces the
// quality of the holder base (a real asset is held by established collectors; a sybil-minted one by Casual
// wallets — e.g. MINTS is ~94% Casual). Infra holders (exchange/vault/burn) are bucketed out.
assets.get("/v2/assets/:asset/holder-makeup", async (c) => {
  const a = c.req.param("asset").toUpperCase();
  const tip = await chainTip(c.env.DB);
  const expr = rawSqlExpr(ADDRESS_FACTORS, tip);
  const [og, est, act] = [ADDRESS_TIERS[0].minRaw, ADDRESS_TIERS[1].minRaw, ADDRESS_TIERS[2].minRaw];
  const rows = await holderTiers(c.env.DB, a, expr, og, est, act).catch(() => []);
  const arche = await holderArchetypes(c.env.DB, a).catch(() => null);
  const top1 = await assetTop1Pct(c.env.DB, a).catch(() => null);
  const order = ["OG", "Established", "Active", "Casual", "Infra"];
  const tiers = rows.sort((x, y) => order.indexOf(x.tier) - order.indexOf(y.tier));
  return J(c, { result: { asset: a, holders: arche?.holders ?? 0, tiers, archetypes: { creators: arche?.creators ?? 0, collectors: arche?.collectors ?? 0, whales: arche?.whales ?? 0 }, top_holder_pct: top1?.t ?? null } }, 300);
});

// Asset-quality calibration view (parallel to /v2/reputation/review for addresses): the population quality
// distribution + top/bottom for face-validity after a weight change.
assets.get("/v2/reputation/asset-review", async (c) => {
  const expr = `(${rawSqlExpr(ASSET_FACTORS, 0)}) - (CASE WHEN low_quality=1 THEN ${-ASSET_PENALTY.lowQuality} ELSE 0 END)`;
  const dist = await assetReviewDistribution(c.env.DB, expr).catch(() => null);
  const top = await assetReviewTop(c.env.DB, expr).catch(() => []);
  return J(c, { result: { distribution: dist, top } }, 60);
});

assets.get("/v2/assets/:asset/balances", async (c) => {
  const rows = await listAssetBalances(c.env.DB, c.req.param("asset").toUpperCase(), lim(c), off(c));
  return J(c, { result: rows, next_offset: rows.length === lim(c) ? off(c) + lim(c) : null });
});

assets.get("/v2/assets/:asset/issuances", async (c) => {
  const rows = await listAssetIssuances(c.env.DB, c.req.param("asset").toUpperCase(), lim(c), off(c));
  return J(c, { result: rows, next_offset: rows.length === lim(c) ? off(c) + lim(c) : null });
});

assets.get("/v2/assets/:asset/sends", async (c) => {
  const rows = await listAssetSends(c.env.DB, c.req.param("asset").toUpperCase(), lim(c), off(c));
  return J(c, { result: rows, next_offset: rows.length === lim(c) ? off(c) + lim(c) : null });
});

assets.get("/v2/assets/:asset/dispensers", async (c) => {
  const rows = await listAssetDispensers(c.env.DB, c.req.param("asset").toUpperCase(), lim(c), off(c));
  return J(c, { result: rows, next_offset: rows.length === lim(c) ? off(c) + lim(c) : null });
});

assets.get("/v2/assets/:asset/dispenses", async (c) => {
  const rows = await listAssetDispenses(c.env.DB, c.req.param("asset").toUpperCase(), lim(c), off(c));
  return J(c, { result: rows, next_offset: rows.length === lim(c) ? off(c) + lim(c) : null });
});

assets.get("/v2/assets/:asset/orders", async (c) => {
  const rows = await listAssetOrders(c.env.DB, c.req.param("asset").toUpperCase(), lim(c), off(c));
  return J(c, { result: rows, next_offset: rows.length === lim(c) ? off(c) + lim(c) : null });
});

// market data for an asset (vs XCP) from xcpdex — cross-app composition via the service binding
assets.get("/v2/assets/:asset/market", async (c) => {
  const a = c.req.param("asset").toUpperCase();
  try {
    const res = await c.env.XCPDEX.fetch(`https://xcpdex-api/pair/${encodeURIComponent(a)}_XCP`);
    if (!res.ok) return J(c, { result: null }, 120);
    const p = await res.json<{ last_price?: number | null; volume_7d?: number | null; trade_count_7d?: number | null; price_change_7d?: number | null }>();
    return J(c, { result: {
      pair: `${a}/XCP`, last_price: p.last_price ?? null, volume_7d: p.volume_7d ?? null,
      trades_7d: p.trade_count_7d ?? null, price_change_7d: p.price_change_7d ?? null,
    } }, 120);
  } catch { return J(c, { result: null }, 60); }
});

assets.get("/v2/assets/:asset/subassets", async (c) => {
  const rows = await listSubassets(c.env.DB, c.req.param("asset").toUpperCase(), lim(c), off(c));
  return J(c, { result: rows, next_offset: rows.length === lim(c) ? off(c) + lim(c) : null });
});

// Collector cohort: "holders of X also collect…" — the holders-also-hold graph. Excludes XCP (currency,
// held by everyone). Returns related assets ranked by shared-holder count, with art-ready names.
assets.get("/v2/assets/:asset/cohort", async (c) => {
  const rows = await assetCohort(c.env.DB, c.req.param("asset").toUpperCase(), lim(c, 18, 36));
  return J(c, { result: rows }, 300);
});

// Holder quality (aggregate, non-creepy) + trading integrity for an asset — the "is this cap table
// real?" read (fairmint due-diligence). Reads precomputed signals; trading integrity uses the CANONICAL
// low-quality flag (self-trade% wash + curated), NOT trades-per-trader (which mistakes genuine liquidity
// like PEPECASH/XCP for manipulation).
assets.get("/v2/assets/:asset/quality", async (c) => {
  const r = await assetQualitySignals(c.env.DB, c.req.param("asset").toUpperCase());
  if (!r) return J(c, { result: { holders: 0, trades: 0, low_quality: 0 } }, 300);
  return J(c, { result: {
    holders: r.holders ?? 0,
    top1_pct: round(r.top1_pct),
    trades: r.trades ?? 0,
    self_trade_pct: round(r.self_trade_pct),
    holder_breadth: round(r.holder_breadth, 0),
    pct_creator_holders: round(r.pct_creator_holders),
    burned_pct: round(r.burned_pct),
    low_quality: r.low_quality ?? 0,
    wash_suspect: (r.low_quality ?? 0) === 1,
  } }, 300);
});
