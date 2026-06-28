/** Network-wide read surfaces: home summary, daily chart series, lifetime stats, leaderboards, mempool. */
import { parseCpJson } from "../indexer/codec";
import { router, J, xcpDestroyed } from "./shared";
import { rawSqlExpr, ADDRESS_FACTORS, ASSET_FACTORS } from "../reputation/score";
import { ASSET_PENALTY } from "../reputation/config";

export const stats = router();

/* ---------- home / stats ---------- */
stats.get("/v2/", async (c) => {
  const s = await c.env.DB.prepare(
    `SELECT (SELECT MAX(block_index) FROM blocks) tip,
            (SELECT COUNT(*) FROM assets) assets,
            (SELECT COUNT(*) FROM transactions) transactions,
            (SELECT COUNT(*) FROM balances) balances,
            (SELECT value FROM indexer_state WHERE key='last_block_index') indexed_block`
  ).first<any>();
  return J(c, { result: s }, 15);
});

/* ---------- metrics: daily time-series for charts (cached; GROUP BY day on block_time) ---------- */
stats.get("/v2/metrics", async (c) => {
  const days = Math.min(365, Math.max(7, parseInt(c.req.query("days") || "90", 10)));
  const series = async (sql: string) => (await c.env.DB.prepare(sql).bind(days).all<{ d: number; v: number }>()).results
    .map((r) => ({ t: r.d * 86400, v: Number(r.v) || 0 })).reverse();
  // transactions from blocks (cheap: 1 row/block carries CP's tx_count); issuances + dispenses by count
  const transactions = await series(`SELECT block_time/86400 d, SUM(transaction_count) v FROM blocks WHERE block_time>0 GROUP BY d ORDER BY d DESC LIMIT ?`);
  const issuances = await series(`SELECT block_time/86400 d, COUNT(*) v FROM issuances WHERE block_time>0 GROUP BY d ORDER BY d DESC LIMIT ?`);
  const dispenses = await series(`SELECT block_time/86400 d, COUNT(*) v FROM dispenses WHERE block_time>0 GROUP BY d ORDER BY d DESC LIMIT ?`);
  // BTC miner fees paid (every CP tx is a BTC tx) and XCP destroyed (issuance/sweep/dividend fees +
  // XCP destructions) — XCP is deflationary, so this is the daily burn rate.
  const btc_fees = await series(`SELECT block_time/86400 d, SUM(CAST(fee AS REAL))/100000000.0 v FROM transactions WHERE block_time>0 AND fee IS NOT NULL GROUP BY d ORDER BY d DESC LIMIT ?`);
  const xcp_burned = await series(`SELECT block_time/86400 d, SUM(CAST(amt AS REAL))/100000000.0 v
    FROM (${xcpDestroyed("block_time, ")}) WHERE block_time>0 GROUP BY d ORDER BY d DESC LIMIT ?`);
  return J(c, { result: { transactions, issuances, dispenses, btc_fees, xcp_burned } }, 1800);
});

/* ---------- network stats panel: all model counts + lifetime BTC fees / XCP destroyed (cached) ---------- */
stats.get("/v2/stats", async (c) => {
  const counts: any = await c.env.DB.prepare(
    `SELECT (SELECT MAX(block_index) FROM blocks) tip,
            (SELECT COUNT(*) FROM assets) assets,
            (SELECT COUNT(*) FROM transactions) transactions,
            (SELECT COUNT(*) FROM sends) sends,
            (SELECT COUNT(*) FROM issuances) issuances,
            (SELECT COUNT(*) FROM dispensers) dispensers,
            (SELECT COUNT(*) FROM dispenses) dispenses,
            (SELECT COUNT(*) FROM orders) orders,
            (SELECT COUNT(*) FROM order_matches) order_matches,
            (SELECT COUNT(*) FROM sweeps) sweeps,
            (SELECT COUNT(*) FROM broadcasts) broadcasts,
            (SELECT COUNT(*) FROM dividends) dividends,
            (SELECT COUNT(*) FROM fairmints) fairmints,
            (SELECT COUNT(*) FROM destructions) destructions,
            (SELECT COUNT(*) FROM balances WHERE CAST(quantity AS INTEGER)>0) holders`
  ).first();
  const totals: any = await c.env.DB.prepare(
    `SELECT (SELECT COALESCE(SUM(CAST(fee AS REAL)),0)/100000000.0 FROM transactions) btc_fees,
            (SELECT COALESCE(SUM(CAST(amt AS REAL)),0)/100000000.0 FROM (${xcpDestroyed()})) xcp_destroyed`
  ).first();
  return J(c, { result: { ...counts, ...totals } }, 3600);
});

/* ---------- leaderboards: derived relationships across the whole dataset (cached) ---------- */
stats.get("/v2/leaderboards", async (c) => {
  // Fast reads from precomputed signal tables. Low-quality assets (bridge/exchange tokens + wash) are
  // HIDDEN by default — they distort the BTC/dispense boards (?include_hidden=1 to show them).
  const incl = c.req.query("include_hidden") === "1";
  // address boards use CLEAN (low-quality-excluded) BTC so bridge deposit flow doesn't inflate merchants/spenders
  const dispCol = incl ? "dispense_btc" : "clean_dispense_btc";
  const spendCol = incl ? "btc_spent" : "clean_btc_spent";
  const lowqF = incl ? "" : " AND COALESCE(low_quality,0)=0";
  const q = (sql: string) => c.env.DB.prepare(sql).all().then((r) => r.results).catch(() => []);
  // reputation/quality boards — the composed score (same config as the read scorer). tip for age terms.
  const tip = Number((await c.env.DB.prepare(`SELECT MAX(block_index) m FROM blocks`).first<any>())?.m) || 0;
  const addrExpr = rawSqlExpr(ADDRESS_FACTORS, tip);
  const assetExpr = `(${rawSqlExpr(ASSET_FACTORS, 0)}) - (CASE WHEN low_quality=1 THEN ${-ASSET_PENALTY.lowQuality} ELSE 0 END)`;
  const [topCreators, topCollectors, topMerchants, bigSpenders, richXcp, mostHeld, mostTraded, durable, topDispensed,
         topDispensers, topHits, broadestHolders, mostCreatorHeld,
         stampCreators, stampCollectors, src20Deployers, mostHeldStamps, topReputation, topQuality] = await Promise.all([
    q(`SELECT addr, survived_assets, assets_held FROM address_signals WHERE survived_assets>0 ORDER BY survived_assets DESC LIMIT 12`),
    q(`SELECT addr, assets_held, survived_assets FROM address_signals WHERE assets_held>0 ORDER BY assets_held DESC LIMIT 12`),
    q(`SELECT addr, ROUND(${dispCol},3) dispense_btc FROM address_signals WHERE ${dispCol}>0 ORDER BY ${dispCol} DESC LIMIT 12`),
    q(`SELECT addr, ROUND(${spendCol},3) btc_spent FROM address_signals WHERE ${spendCol}>0 ORDER BY ${spendCol} DESC LIMIT 12`),
    q(`SELECT holder, quantity_normalized FROM balances WHERE asset='XCP' AND holder_type='address' AND CAST(quantity AS INTEGER)>0 ORDER BY CAST(quantity AS INTEGER) DESC LIMIT 12`),
    q(`SELECT asset, asset_longname, holders FROM asset_signals WHERE holders>0${lowqF} ORDER BY holders DESC LIMIT 12`),
    q(`SELECT asset, asset_longname, trades FROM asset_signals WHERE trades>0${lowqF} ORDER BY trades DESC LIMIT 12`),
    q(`SELECT asset, asset_longname, ROUND((last_trade_blk-first_trade_blk)/4320.0,1) months_traded FROM asset_signals WHERE trades>=50 AND self_trade_pct<30${lowqF} ORDER BY (last_trade_blk-first_trade_blk) DESC LIMIT 12`),
    q(`SELECT asset, asset_longname, ROUND(dispense_btc,3) dispense_btc FROM asset_signals WHERE dispense_btc>0${lowqF} ORDER BY dispense_btc DESC LIMIT 12`),
    // new boards (signals built this session): trusted dispenser operators, creator "hits", and two asset-quality lenses
    q(`SELECT addr, ROUND(disp_trust,1) disp_trust, dispenses FROM address_signals WHERE disp_trust>0 AND is_exchange=0 ORDER BY disp_trust DESC LIMIT 12`),
    q(`SELECT addr, assets_hits, survived_assets FROM address_signals WHERE assets_hits>0 ORDER BY assets_hits DESC LIMIT 12`),
    q(`SELECT asset, asset_longname, ROUND(holder_breadth,0) holder_breadth, holders FROM asset_signals WHERE holders>=25${lowqF} ORDER BY holder_breadth DESC LIMIT 12`),
    q(`SELECT asset, asset_longname, ROUND(pct_creator_holders,1) pct_creator_holders, holders FROM asset_signals WHERE holders>=25${lowqF} ORDER BY pct_creator_holders DESC LIMIT 12`),
    // Bitcoin Stamps / SRC-20 segmentation boards
    q(`SELECT addr, stamps_created, src20_deploys FROM address_signals WHERE stamps_created>0 ORDER BY stamps_created DESC LIMIT 12`),
    q(`SELECT addr, stamps_collected FROM address_signals WHERE stamps_collected>0 ORDER BY stamps_collected DESC LIMIT 12`),
    q(`SELECT addr, src20_deploys, stamps_created FROM address_signals WHERE src20_deploys>0 ORDER BY src20_deploys DESC LIMIT 12`),
    q(`SELECT s.asset, s.asset_longname, s.holders FROM asset_signals s JOIN tags t ON t.entity_type='asset' AND t.entity_id=s.asset AND t.tag='stamp' WHERE s.holders>0 ORDER BY s.holders DESC LIMIT 12`),
    // reputation: highest-scoring real users (OG board) and highest-quality assets (Bluechip board)
    q(`SELECT addr, ROUND((${addrExpr}),1) score FROM address_signals WHERE is_exchange=0 AND is_deposit=0 AND is_burn=0 AND COALESCE(is_emblem_vault,0)=0 AND COALESCE(likely_service,0)=0 ORDER BY (${addrExpr}) DESC LIMIT 12`),
    q(`SELECT asset, asset_longname, ROUND((${assetExpr}),1) score FROM asset_signals WHERE (trades>0 OR dispenses>0)${lowqF} ORDER BY (${assetExpr}) DESC LIMIT 12`),
  ]);
  return J(c, { result: {
    top_creators: topCreators, top_collectors: topCollectors, top_merchants: topMerchants, biggest_spenders: bigSpenders,
    richest_xcp: richXcp, most_held: mostHeld, most_traded: mostTraded, most_durable: durable, top_dispensed: topDispensed,
    top_dispensers: topDispensers, top_hits: topHits, broadest_holders: broadestHolders, most_creator_held: mostCreatorHeld,
    top_stamp_creators: stampCreators, top_stamp_collectors: stampCollectors, top_src20_deployers: src20Deployers,
    most_held_stamps: mostHeldStamps, top_reputation: topReputation, top_quality: topQuality,
    include_hidden: incl,
  } }, 600);
});

/* ---------- mempool (live "what's happening now") — cached read-through to CP, not mirrored ---------- */
stats.get("/v2/mempool", async (c) => {
  try {
    const r = await fetch(`${c.env.CP_API_BASE}/mempool/events?limit=40&verbose=true`, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return J(c, { result: [] }, 5);
    const j: any = parseCpJson(await r.text()); // preserve >2^53 quantities in pending tx params
    // keep one meaningful ACTION row per pending tx; skip ledger/parse noise
    const NOISE = new Set(["TRANSACTION_PARSED", "NEW_TRANSACTION", "CREDIT", "DEBIT", "ASSET_CREATION", "BLOCK_PARSED", "NEW_BLOCK"]);
    const seen = new Set<string>();
    const rows: any[] = [];
    for (const e of (j.result || [])) {
      const p = e.params || {};
      if (NOISE.has(e.event)) continue;
      if (!p.source && !p.asset) continue;
      if (e.tx_hash && seen.has(e.tx_hash)) continue;
      if (e.tx_hash) seen.add(e.tx_hash);
      rows.push({
        tx_hash: e.tx_hash, event: e.event,
        source: p.source ?? null, destination: p.destination ?? null,
        asset: p.asset ?? null, quantity_normalized: p.quantity_normalized ?? null, timestamp: e.timestamp ?? null,
      });
    }
    return J(c, { result: rows }, 10); // 10s edge cache shields CP from the home's traffic
  } catch { return J(c, { result: [] }, 5); }
});
