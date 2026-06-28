/** Asset surfaces: index, detail (with derived supply/burned/circulating), per-asset record tabs,
 *  market data (xcpdex), and the research reads (collector cohort, holder quality). */
import { router, J, lim, off, ORDER_SELECT, activeBalance, round } from "./shared";
import { scoreAsset, assetScore, assetTier, type MarketState, rawSqlExpr, ASSET_FACTORS, ADDRESS_FACTORS } from "../reputation/score";
import { ASSET_PENALTY, ADDRESS_TIERS } from "../reputation/config";

export const assets = router();

assets.get("/v2/assets", async (c) => {
  const q = (c.req.query("query") || "").trim();
  const where = q ? `WHERE a.asset LIKE ? OR a.asset_longname LIKE ?` : "";
  const binds = q ? [q.toUpperCase() + "%", q + "%"] : [];
  const rows = await c.env.DB.prepare(
    `SELECT a.asset, a.asset_longname, a.type, a.issuer, a.owner, a.divisible, a.locked, a.supply_normalized,
            a.description, a.mime_type,
            EXISTS(SELECT 1 FROM tags t WHERE t.entity_type='asset' AND t.entity_id=a.asset AND t.tag='stamp') stamp,
            a.first_issuance_block_time, a.last_issuance_block_index
     FROM assets a ${where} ORDER BY a.last_issuance_block_index DESC LIMIT ? OFFSET ?`
  ).bind(...binds, lim(c), off(c)).all();
  return J(c, { result: rows.results, next_offset: off(c) + lim(c) });
});

assets.get("/v2/assets/:asset", async (c) => {
  const a = c.req.param("asset");
  const r = await c.env.DB.prepare(`SELECT * FROM assets WHERE asset=? OR asset_longname=?`)
    .bind(a.toUpperCase(), a).first<any>();
  if (!r) {
    // XCP and BTC are native assets with no issuance row. XCP supply = proof-of-burn minus all XCP
    // destroyed (destructions + issuance/sweep/dividend fees). BTC has no Counterparty supply.
    const A = a.toUpperCase();
    if (A === "XCP" || A === "BTC") {
      let supply_normalized: string | null = null;
      if (A === "XCP") {
        const sup: any = await c.env.DB.prepare(
          `SELECT (SELECT COALESCE(SUM(CAST(earned AS INTEGER)),0) FROM burns)
                - (SELECT COALESCE(SUM(CAST(quantity AS INTEGER)),0) FROM destructions WHERE asset='XCP' AND status LIKE 'valid%')
                - (SELECT COALESCE(SUM(CAST(amt AS INTEGER)),0) FROM (
                    SELECT fee_paid amt FROM issuances WHERE status LIKE 'valid%' AND fee_paid IS NOT NULL
                    UNION ALL SELECT fee_paid FROM sweeps WHERE fee_paid IS NOT NULL
                    UNION ALL SELECT fee_paid FROM dividends WHERE fee_paid IS NOT NULL)) supply`
        ).first();
        supply_normalized = (Number(sup?.supply ?? 0) / 1e8).toFixed(8);
      }
      const h: any = await c.env.DB.prepare(`SELECT COUNT(*) c FROM balances WHERE asset=? AND CAST(quantity AS INTEGER)>0`).bind(A).first();
      return J(c, { result: {
        asset: A, asset_longname: null, type: "native", divisible: 1, locked: 1,
        description: A === "XCP" ? "Counterparty native currency" : "Bitcoin",
        issuer: null, owner: null, supply_normalized, holder_count: h?.c ?? 0,
      } });
    }
    return c.json({ error: "Asset not found" }, 404);
  }
  const holders = await c.env.DB.prepare(`SELECT COUNT(*) c FROM balances WHERE asset=? AND CAST(quantity AS INTEGER)>0`).bind(r.asset).first<any>();
  // supply isn't stored during event replay -> derive it: minted (valid issuances) minus destructions.
  // CAST the result to TEXT so D1 returns a STRING — a JS number would silently lose precision for
  // supplies > 2^53 (e.g. PEPECASH ~1e17 minor-units). The SUM itself is exact int64 inside SQLite.
  const sup = await c.env.DB.prepare(
    `SELECT CAST((SELECT COALESCE(SUM(CAST(quantity AS INTEGER)),0) FROM issuances WHERE asset=? AND status LIKE 'valid%')
              - (SELECT COALESCE(SUM(CAST(quantity AS INTEGER)),0) FROM destructions WHERE asset=? AND status LIKE 'valid%') AS TEXT) supply`
  ).bind(r.asset, r.asset).first<any>();
  const raw = BigInt(sup?.supply ?? 0);
  // Burned = supply sitting in known burn addresses; circulating = total issued minus that. CAST AS TEXT
  // for the same precision reason. Canonical supply is left intact — burned/circulating sit alongside.
  const burn = await c.env.DB.prepare(
    `SELECT CAST(COALESCE(SUM(CAST(b.quantity AS INTEGER)),0) AS TEXT) burned
     FROM balances b JOIN address_signals s ON s.addr=b.holder WHERE b.asset=? AND s.is_burn=1`
  ).bind(r.asset).first<any>();
  const burnedRaw = BigInt(burn?.burned ?? 0);
  const circRaw = raw - burnedRaw;
  // exact BigInt -> normalized decimal string (pure string math; no float, preserves >2^53 precision).
  const norm = (x: bigint) => {
    if (!r.divisible) return x.toString();
    const neg = x < 0n, s = (neg ? -x : x).toString().padStart(9, "0");
    return (neg ? "-" : "") + s.slice(0, -8) + "." + s.slice(-8);
  };
  // composed asset quality score (config-driven, src/reputation) from the precomputed asset_signals row
  const sig = await c.env.DB.prepare(`SELECT * FROM asset_signals WHERE asset=?`).bind(r.asset).first<any>().catch(() => null);
  const q = sig ? scoreAsset(sig) : null;
  // market state: ranked into a tier only if it ever traded/dispensed; else Untraded (held) / Dormant (no holders).
  const state: MarketState = sig && ((sig.trades ?? 0) > 0 || (sig.dispenses ?? 0) > 0) ? "market"
    : sig && (sig.holders ?? 0) > 0 ? "held" : "none";
  const score = q && state === "market" ? assetScore(q.raw) : null; // score = percentile among market assets only
  // tags are the categorical layer — stamp/src20/src721 classification + behavioral labels live here.
  const tags: string[] = await c.env.DB.prepare(`SELECT tag FROM tags WHERE entity_type='asset' AND entity_id=?`).bind(r.asset).all().then((x) => x.results.map((t: any) => String(t.tag))).catch(() => []);
  return J(c, { result: {
    ...r, supply: raw.toString(), supply_normalized: norm(raw), holder_count: holders?.c ?? 0,
    burned: burnedRaw.toString(), burned_normalized: norm(burnedRaw),
    circulating: circRaw.toString(), circulating_normalized: norm(circRaw),
    quality: q ? { tier: assetTier(q.raw, state), score, raw: round(q.raw, 2), breakdown: q.breakdown, low_quality: sig.low_quality === 1 } : { tier: "Dormant", score: null },
    tags,
  } });
});

// Holder makeup — "who holds this asset?" by reputation tier + archetype + concentration. Surfaces the
// quality of the holder base (a real asset is held by established collectors; a sybil-minted one by Casual
// wallets — e.g. MINTS is ~94% Casual). Infra holders (exchange/vault/burn) are bucketed out.
assets.get("/v2/assets/:asset/holder-makeup", async (c) => {
  const a = c.req.param("asset").toUpperCase();
  const tip = Number((await c.env.DB.prepare(`SELECT MAX(block_index) m FROM blocks`).first<any>())?.m) || 0;
  const expr = rawSqlExpr(ADDRESS_FACTORS, tip);
  const [og, est, act] = [ADDRESS_TIERS[0].minRaw, ADDRESS_TIERS[1].minRaw, ADDRESS_TIERS[2].minRaw];
  const where = `b.asset=? AND b.holder_type='address' AND CAST(b.quantity AS INTEGER)>0`;
  const rows = await c.env.DB.prepare(
    `WITH h AS (
       SELECT CAST(b.quantity AS REAL) q,
         (sg.is_exchange=1 OR sg.is_deposit=1 OR sg.is_burn=1 OR sg.is_emblem_vault=1 OR sg.likely_service=1) infra,
         (${expr}) raw, sg.survived_assets surv, sg.assets_held held
       FROM balances b JOIN address_signals sg ON sg.addr=b.holder WHERE ${where}),
     tot AS (SELECT SUM(q) s FROM h)
     SELECT CASE WHEN infra THEN 'Infra' WHEN raw>=${og} THEN 'OG' WHEN raw>=${est} THEN 'Established'
                 WHEN raw>=${act} THEN 'Active' ELSE 'Casual' END tier,
       COUNT(*) holders, ROUND(100.0*SUM(q)/(SELECT s FROM tot),1) pct_supply
     FROM h GROUP BY tier`
  ).bind(a).all().then((x) => x.results).catch(() => []);
  // archetype counts among holders + concentration (top holder share from the precomputed signal)
  const arche = await c.env.DB.prepare(
    `SELECT SUM(CASE WHEN sg.survived_assets>=20 THEN 1 ELSE 0 END) creators,
            SUM(CASE WHEN sg.assets_held>=500 THEN 1 ELSE 0 END) whales,
            SUM(CASE WHEN sg.assets_held>=100 THEN 1 ELSE 0 END) collectors,
            COUNT(*) holders
     FROM balances b JOIN address_signals sg ON sg.addr=b.holder WHERE ${where}`
  ).bind(a).first<any>().catch(() => null);
  const top1 = await c.env.DB.prepare(`SELECT ROUND(top1_pct,1) t FROM asset_signals WHERE asset=?`).bind(a).first<any>().catch(() => null);
  const order = ["OG", "Established", "Active", "Casual", "Infra"];
  const tiers = (rows as any[]).sort((x, y) => order.indexOf(x.tier) - order.indexOf(y.tier));
  return J(c, { result: { asset: a, holders: arche?.holders ?? 0, tiers, archetypes: { creators: arche?.creators ?? 0, collectors: arche?.collectors ?? 0, whales: arche?.whales ?? 0 }, top_holder_pct: top1?.t ?? null } }, 300);
});

// Asset-quality calibration view (parallel to /v2/reputation/review for addresses): the population quality
// distribution + top/bottom for face-validity after a weight change.
assets.get("/v2/reputation/asset-review", async (c) => {
  const expr = `(${rawSqlExpr(ASSET_FACTORS, 0)}) - (CASE WHEN low_quality=1 THEN ${-ASSET_PENALTY.lowQuality} ELSE 0 END)`;
  const dist = await c.env.DB.prepare(
    `WITH r AS (SELECT (${expr}) raw FROM asset_signals)
     SELECT COUNT(*) n, ROUND(AVG(raw),2) mean, ROUND(MAX(raw),2) max, ROUND(MIN(raw),2) min,
       SUM(CASE WHEN raw>=16 THEN 1 ELSE 0 END) top1pct, SUM(CASE WHEN raw>=9 THEN 1 ELSE 0 END) top10pct FROM r`
  ).first<any>().catch(() => null);
  const top = await c.env.DB.prepare(
    `SELECT asset, asset_longname, holders, trades, ROUND((${expr}),2) raw FROM asset_signals ORDER BY (${expr}) DESC LIMIT 20`
  ).all().then((x) => x.results).catch(() => []);
  return J(c, { result: { distribution: dist, top } }, 60);
});

assets.get("/v2/assets/:asset/balances", async (c) => {
  const a = c.req.param("asset").toUpperCase();
  const rows = await c.env.DB.prepare(
    `SELECT b.holder, b.holder_type, b.quantity, b.quantity_normalized,
            COALESCE(s.is_burn,0) is_burn, COALESCE(s.is_exchange,0) is_exchange
     FROM balances b LEFT JOIN address_signals s ON s.addr=b.holder
     WHERE b.asset=? AND CAST(b.quantity AS INTEGER)>0 ORDER BY CAST(b.quantity AS INTEGER) DESC LIMIT ? OFFSET ?`
  ).bind(a, lim(c), off(c)).all();
  return J(c, { result: rows.results, next_offset: off(c) + lim(c) });
});

assets.get("/v2/assets/:asset/issuances", async (c) => {
  const a = c.req.param("asset").toUpperCase();
  const rows = await c.env.DB.prepare(
    `SELECT tx_hash, block_index, block_time, source, issuer, transfer, quantity_normalized, description, status
     FROM issuances WHERE asset=? ORDER BY block_index DESC LIMIT ? OFFSET ?`
  ).bind(a, lim(c), off(c)).all();
  return J(c, { result: rows.results, next_offset: off(c) + lim(c) });
});

assets.get("/v2/assets/:asset/sends", async (c) => {
  const a = c.req.param("asset").toUpperCase();
  const rows = await c.env.DB.prepare(
    `SELECT tx_hash,block_index,block_time,source,destination,asset,quantity_normalized,send_type,status FROM sends WHERE asset=? ORDER BY block_index DESC LIMIT ? OFFSET ?`
  ).bind(a, lim(c), off(c)).all();
  return J(c, { result: rows.results, next_offset: off(c) + lim(c) });
});

assets.get("/v2/assets/:asset/dispensers", async (c) => {
  const a = c.req.param("asset").toUpperCase();
  // operator_trust = the source operator's precomputed dispenser track-record score (longevity-weighted),
  // so competing dispensers for the same asset are comparable.
  const rows = await c.env.DB.prepare(
    `SELECT d.tx_hash,d.block_index,d.block_time,d.source,d.asset,d.give_quantity_normalized,d.give_remaining_normalized,
            d.satoshirate,d.satoshirate_normalized,d.dispense_count,d.status, ROUND(COALESCE(sg.disp_trust,0),1) operator_trust
     FROM dispensers d LEFT JOIN address_signals sg ON sg.addr=d.source
     WHERE d.asset=? ORDER BY d.block_index DESC LIMIT ? OFFSET ?`
  ).bind(a, lim(c), off(c)).all();
  return J(c, { result: rows.results, next_offset: off(c) + lim(c) });
});

assets.get("/v2/assets/:asset/dispenses", async (c) => {
  const a = c.req.param("asset").toUpperCase();
  const rows = await c.env.DB.prepare(
    `SELECT tx_hash,block_index,block_time,source,destination,asset,dispense_quantity_normalized FROM dispenses WHERE asset=? ORDER BY block_index DESC LIMIT ? OFFSET ?`
  ).bind(a, lim(c), off(c)).all();
  return J(c, { result: rows.results, next_offset: off(c) + lim(c) });
});

assets.get("/v2/assets/:asset/orders", async (c) => {
  const a = c.req.param("asset").toUpperCase();
  const rows = await c.env.DB.prepare(
    `${ORDER_SELECT} WHERE o.give_asset=? OR o.get_asset=? ORDER BY o.block_index DESC LIMIT ? OFFSET ?`
  ).bind(a, a, lim(c), off(c)).all();
  return J(c, { result: rows.results, next_offset: off(c) + lim(c) });
});

// market data for an asset (vs XCP) from xcpdex — cross-app composition via the service binding
assets.get("/v2/assets/:asset/market", async (c) => {
  const a = c.req.param("asset").toUpperCase();
  try {
    const res = await c.env.XCPDEX.fetch(`https://xcpdex-api/pair/${encodeURIComponent(a)}_XCP`);
    if (!res.ok) return J(c, { result: null }, 120);
    const p: any = await res.json();
    return J(c, { result: {
      pair: `${a}/XCP`, last_price: p.last_price ?? null, volume_7d: p.volume_7d ?? null,
      trades_7d: p.trade_count_7d ?? null, price_change_7d: p.price_change_7d ?? null,
    } }, 120);
  } catch { return J(c, { result: null }, 60); }
});

assets.get("/v2/assets/:asset/subassets", async (c) => {
  const a = c.req.param("asset").toUpperCase();
  const rows = await c.env.DB.prepare(
    `SELECT asset, asset_longname, divisible, locked, issuer, first_issuance_block_index FROM assets
     WHERE asset_longname LIKE ? ORDER BY first_issuance_block_index DESC LIMIT ? OFFSET ?`
  ).bind(a + ".%", lim(c), off(c)).all();
  return J(c, { result: rows.results, next_offset: off(c) + lim(c) });
});

// Collector cohort: "holders of X also collect…" — the holders-also-hold graph. Excludes XCP (currency,
// held by everyone). Returns related assets ranked by shared-holder count, with art-ready names.
assets.get("/v2/assets/:asset/cohort", async (c) => {
  const a = c.req.param("asset").toUpperCase();
  const rows = await c.env.DB.prepare(
    `SELECT b2.asset, a.asset_longname, COUNT(*) shared
     FROM balances b1 JOIN balances b2 ON b1.holder=b2.holder
     LEFT JOIN assets a ON a.asset=b2.asset
     WHERE b1.asset=? AND ${activeBalance("b1.")}
       AND b2.asset<>? AND b2.asset<>'XCP' AND CAST(b2.quantity AS INTEGER)>0
     GROUP BY b2.asset ORDER BY shared DESC LIMIT ?`
  ).bind(a, a, lim(c, 18, 36)).all();
  return J(c, { result: rows.results }, 300);
});

// Holder quality (aggregate, non-creepy) + trading integrity for an asset — the "is this cap table
// real?" read (fairmint due-diligence). Reads precomputed signals; trading integrity uses the CANONICAL
// low-quality flag (self-trade% wash + curated), NOT trades-per-trader (which mistakes genuine liquidity
// like PEPECASH/XCP for manipulation).
assets.get("/v2/assets/:asset/quality", async (c) => {
  const a = c.req.param("asset").toUpperCase();
  const r: any = await c.env.DB.prepare(
    `SELECT holders, top1_pct, trades, self_trade_pct, low_quality, holder_breadth, pct_creator_holders, burned_pct FROM asset_signals WHERE asset=?`
  ).bind(a).first();
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
