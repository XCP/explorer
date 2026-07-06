/**
 * Precomputed reputation signal tables — address_signals + asset_signals (Layer 2 features).
 *
 * Organized as documented FEATURE UNITS (see docs/architecture.md). Each unit declares:
 *   - scope:   the entity key it writes ("asset" | "address" | "global")
 *   - reads:   the raw mirror tables it aggregates (also = what dirties it per block)
 *   - dependsOn: upstream unit outputs it consumes (the cascade dependency edges)
 *   - periodic: true ⇒ whole-population / fan-out computation that CANNOT be cheaply dirty-scoped, so it
 *               only runs in the full rebuild + the periodic cron (Layer C), never the per-block cascade.
 *   - full:    the full-table SQL (ground truth — used by runSignalsStep, the canonical rebuild)
 *   - scoped:  (ph) => SQL that recomputes only the dirty keys (ph = bound "?,?,…"). Same aggregation as
 *              `full`, just filtered to the dirty entity set — a RECOMPUTE-from-raw, so there is no
 *              incremental drift (the failure mode of hand-maintained counters). Omitted ⇔ periodic.
 *
 * TWO drivers over the SAME units (one source of truth for the SQL):
 *   - runSignalsStep()    — STEPPED FULL REBUILD. Runs every unit's `.full` from a cursor, a few per call
 *                           (a whole rebuild is too long for one Worker request). Canonical / repair / backfill.
 *   - runSignalsCascade() — PER-BLOCK DIRTY CASCADE (Layer B). Advances a block cursor, derives the entities
 *                           touched in that block range straight from the mirror tables, and runs each
 *                           non-periodic unit's `.scoped` for just those keys. Bounded by what changed, not
 *                           table size. The full rebuild keeps cycling on cron as a self-healing backstop, so
 *                           a cascade gap is at worst briefly stale, never corrupt.
 *
 * Note: address_signals.rep_score (personalized-PageRank) is maintained separately (expensive); untouched here.
 */
import type { Env } from "../index";
import { CURATED_LOWQ_SQL, EXCHANGES_SQL, CURATED_BURNS_SQL } from "./curated";
import { EMBLEM_DDL } from "./emblem";


const ADDR_DDL = `CREATE TABLE IF NOT EXISTS address_signals (
  addr TEXT PRIMARY KEY, first_blk INTEGER, last_blk INTEGER DEFAULT 0, out_peers INTEGER DEFAULT 0,
  in_peers INTEGER DEFAULT 0, dispense_btc REAL DEFAULT 0, dispenses INTEGER DEFAULT 0,
  dividends INTEGER DEFAULT 0, assets_issued INTEGER DEFAULT 0, locked_assets INTEGER DEFAULT 0,
  btc_spent REAL DEFAULT 0, btc_fees REAL DEFAULT 0, assets_held INTEGER DEFAULT 0,
  assets_received INTEGER DEFAULT 0, survived_assets INTEGER DEFAULT 0,
  assets_distributed INTEGER DEFAULT 0, assets_hits INTEGER DEFAULT 0, rep_score REAL DEFAULT 1.0,
  clean_dispense_btc REAL DEFAULT 0, clean_btc_spent REAL DEFAULT 0,
  is_exchange INTEGER DEFAULT 0, is_deposit INTEGER DEFAULT 0, is_burn INTEGER DEFAULT 0,
  assets_burned INTEGER DEFAULT 0, disp_trust REAL DEFAULT 0, is_emblem_vault INTEGER DEFAULT 0,
  likely_service INTEGER DEFAULT 0, dex_trades INTEGER DEFAULT 0,
  stamps_created INTEGER DEFAULT 0, stamps_collected INTEGER DEFAULT 0, src20_deploys INTEGER DEFAULT 0, is_btns_user INTEGER DEFAULT 0)`;
const ASSET_DDL = `CREATE TABLE IF NOT EXISTS asset_signals (
  asset TEXT PRIMARY KEY, asset_longname TEXT, issuer TEXT, divisible INTEGER, locked INTEGER,
  holders INTEGER DEFAULT 0, top1_pct REAL DEFAULT 0, trades INTEGER DEFAULT 0,
  self_trade_pct REAL DEFAULT 0, first_trade_blk INTEGER DEFAULT 0, last_trade_blk INTEGER DEFAULT 0,
  dispenses INTEGER DEFAULT 0, dispense_btc REAL DEFAULT 0, low_quality INTEGER DEFAULT 0,
  holder_breadth REAL DEFAULT 0, pct_creator_holders REAL DEFAULT 0, burned_pct REAL DEFAULT 0,
  distinct_traders INTEGER DEFAULT 0, distinct_dispensers INTEGER DEFAULT 0, age_blocks INTEGER DEFAULT 0, avg_holder_dex REAL DEFAULT 0,
  recent_events INTEGER DEFAULT 0, recency_blocks INTEGER DEFAULT 0,
  max_dispense_btc REAL DEFAULT 0, max_trade_xcp REAL DEFAULT 0)`;

// Indexes on the hot leaderboard sort/filter columns — without these each board does a full SCAN +
// temp-B-tree sort (one board read 309k rows for a 12-row result). With them it's a ~12-row index walk.
const INDEX_DDL = [
  "CREATE INDEX IF NOT EXISTS idx_as_holders ON asset_signals(holders)",
  "CREATE INDEX IF NOT EXISTS idx_as_trades ON asset_signals(trades)",
  "CREATE INDEX IF NOT EXISTS idx_as_disp ON asset_signals(dispense_btc)",
  "CREATE INDEX IF NOT EXISTS idx_as_lowq ON asset_signals(low_quality)",
  // tiny partial index so the exchanges overview finds the ~23 exchange wallets instantly (else it scanned
  // all 1.75M sends — 18s). Pairs with periodic ANALYZE (see index.ts) which fixes the join orders globally.
  "CREATE INDEX IF NOT EXISTS idx_adr_exchange ON address_signals(is_exchange) WHERE is_exchange=1",
  "CREATE INDEX IF NOT EXISTS idx_adr_surv ON address_signals(survived_assets)",
  "CREATE INDEX IF NOT EXISTS idx_adr_held ON address_signals(assets_held)",
  "CREATE INDEX IF NOT EXISTS idx_adr_cdisp ON address_signals(clean_dispense_btc)",
  "CREATE INDEX IF NOT EXISTS idx_adr_cspent ON address_signals(clean_btc_spent)",
  // read-path query optimizations (verified via EXPLAIN QUERY PLAN):
  // top-holders: serve `WHERE asset=? ORDER BY CAST(quantity AS INTEGER) DESC` from the index (no temp sort).
  "CREATE INDEX IF NOT EXISTS idx_bal_asset_qty ON balances(asset, CAST(quantity AS INTEGER) DESC)",
  // address connections: index the other side of order_matches so `tx0_address OR tx1_address` uses a
  // multi-index OR instead of a full 216k-row scan on every address page.
  "CREATE INDEX IF NOT EXISTS idx_om_addr1 ON order_matches(tx1_address, block_index DESC)",
];

type Scope = "asset" | "address" | "global";
interface FeatureUnit {
  name: string;
  scope: Scope;
  reads: string[];               // raw mirror tables this unit aggregates (doc + dirties-it set)
  dependsOn?: string[];          // upstream UNIT names whose output it consumes (cascade edges)
  periodic?: boolean;            // whole-population / fan-out → full-rebuild + cron only (Layer C), no per-block scope
  heavyEveryBlocks?: number;     // gate this unit's `.full` in runSignalsStep to a block-delta cadence (a heavy
                                 // global scan whose population output doesn't need sub-cycle freshness). The
                                 // per-block cascade still runs the `.scoped` variant every tick (dirty stays
                                 // fresh); only the expensive global self-heal is throttled. Cursor: one
                                 // indexer_state gen-key per unit (see runSignalsStep).
  full: string;                  // full-table SQL (ground truth)
  scoped?: (ph: string) => string; // dirty-scoped recompute (ph = "?,?,…" bound to the dirty keys)
}

// ~1 day of blocks. THE GATING CRITERION (applied to the whole class, not a hand-picked few): any unit whose
// `.full` aggregates over a >~1M-row mirror table — sends (~1.75M), balances (~3M), transactions (~3.4M) —
// carries this gate. Population aggregates (fees, burns, holders, breadth, creator-share, …) move slowly, so
// daily is ample; the per-block cascade (`.scoped`) keeps DIRTY entities fresh every tick regardless, and the
// full pass is only the self-healing backstop. Units that scan smaller tables (order_matches ~216k, assets
// ~250k, dispenses/dispensers/dividends/broadcasts) stay per-cycle. A reset→re-correct pair MUST share the
// gate (same generation ⇒ same cycle) or the reset out-runs the correction: (asset_holders, asset_burn_adjust)
// on burned_pct, and (addr_iss, addr_surv) on locked_assets — so the resetter is co-gated even if it alone is
// under the row threshold.
const HEAVY_DAILY_BLOCKS = 144;

// ---------------------------------------------------------------------------------------------------
// FEATURE UNITS. Order matters: a unit may read an earlier unit's output (see dependsOn). The cascade
// runs the non-periodic units in this same order so intra-run dependencies (asset_holders → burn_adjust)
// are respected.
// ---------------------------------------------------------------------------------------------------
const UNITS: FeatureUnit[] = [
  // ===== schema (cheap, idempotent; full-rebuild only) =====
  { name: "ddl_addr", scope: "global", reads: [], periodic: true, full: ADDR_DDL },

  // ===== ADDRESS · peers & activity span (from sends ~1.75M → heavy full scan, gated daily) =====
  { name: "addr_send_out", scope: "address", reads: ["sends"], heavyEveryBlocks: HEAVY_DAILY_BLOCKS,
    full: `INSERT INTO address_signals (addr,first_blk,out_peers) SELECT source,MIN(block_index),COUNT(DISTINCT destination) FROM sends WHERE source IS NOT NULL GROUP BY source ON CONFLICT(addr) DO UPDATE SET first_blk=MIN(address_signals.first_blk,excluded.first_blk),out_peers=excluded.out_peers`,
    scoped: (ph) => `INSERT INTO address_signals (addr,first_blk,out_peers) SELECT source,MIN(block_index),COUNT(DISTINCT destination) FROM sends WHERE source IS NOT NULL AND source IN (${ph}) GROUP BY source ON CONFLICT(addr) DO UPDATE SET first_blk=MIN(address_signals.first_blk,excluded.first_blk),out_peers=excluded.out_peers` },
  { name: "addr_send_in", scope: "address", reads: ["sends"], heavyEveryBlocks: HEAVY_DAILY_BLOCKS,
    full: `INSERT INTO address_signals (addr,in_peers,first_blk,last_blk) SELECT destination,COUNT(DISTINCT source),MIN(block_index),MAX(block_index) FROM sends WHERE destination IS NOT NULL GROUP BY destination ON CONFLICT(addr) DO UPDATE SET in_peers=excluded.in_peers,first_blk=MIN(address_signals.first_blk,excluded.first_blk),last_blk=MAX(address_signals.last_blk,excluded.last_blk)`,
    scoped: (ph) => `INSERT INTO address_signals (addr,in_peers,first_blk,last_blk) SELECT destination,COUNT(DISTINCT source),MIN(block_index),MAX(block_index) FROM sends WHERE destination IS NOT NULL AND destination IN (${ph}) GROUP BY destination ON CONFLICT(addr) DO UPDATE SET in_peers=excluded.in_peers,first_blk=MIN(address_signals.first_blk,excluded.first_blk),last_blk=MAX(address_signals.last_blk,excluded.last_blk)` },
  { name: "addr_last", scope: "address", reads: ["sends"], heavyEveryBlocks: HEAVY_DAILY_BLOCKS,
    full: `INSERT INTO address_signals (addr,last_blk) SELECT source,MAX(block_index) FROM sends WHERE source IS NOT NULL GROUP BY source ON CONFLICT(addr) DO UPDATE SET last_blk=MAX(address_signals.last_blk,excluded.last_blk)`,
    scoped: (ph) => `INSERT INTO address_signals (addr,last_blk) SELECT source,MAX(block_index) FROM sends WHERE source IS NOT NULL AND source IN (${ph}) GROUP BY source ON CONFLICT(addr) DO UPDATE SET last_blk=MAX(address_signals.last_blk,excluded.last_blk)` },

  // ===== ADDRESS · dispenser economics (from dispenses) =====
  { name: "addr_disp_earn", scope: "address", reads: ["dispenses"],
    full: `INSERT INTO address_signals (addr,dispense_btc,dispenses) SELECT source,COALESCE(SUM(btc_amount),0)/1e8,COUNT(*) FROM dispenses WHERE source IS NOT NULL GROUP BY source ON CONFLICT(addr) DO UPDATE SET dispense_btc=excluded.dispense_btc,dispenses=excluded.dispenses`,
    scoped: (ph) => `INSERT INTO address_signals (addr,dispense_btc,dispenses) SELECT source,COALESCE(SUM(btc_amount),0)/1e8,COUNT(*) FROM dispenses WHERE source IS NOT NULL AND source IN (${ph}) GROUP BY source ON CONFLICT(addr) DO UPDATE SET dispense_btc=excluded.dispense_btc,dispenses=excluded.dispenses` },
  { name: "addr_disp_spend", scope: "address", reads: ["dispenses"],
    full: `INSERT INTO address_signals (addr,btc_spent) SELECT destination,COALESCE(SUM(btc_amount),0)/1e8 FROM dispenses WHERE destination IS NOT NULL GROUP BY destination ON CONFLICT(addr) DO UPDATE SET btc_spent=excluded.btc_spent`,
    scoped: (ph) => `INSERT INTO address_signals (addr,btc_spent) SELECT destination,COALESCE(SUM(btc_amount),0)/1e8 FROM dispenses WHERE destination IS NOT NULL AND destination IN (${ph}) GROUP BY destination ON CONFLICT(addr) DO UPDATE SET btc_spent=excluded.btc_spent` },
  { name: "addr_div", scope: "address", reads: ["dividends"],
    full: `INSERT INTO address_signals (addr,dividends) SELECT source,COUNT(*) FROM dividends WHERE source IS NOT NULL GROUP BY source ON CONFLICT(addr) DO UPDATE SET dividends=excluded.dividends`,
    scoped: (ph) => `INSERT INTO address_signals (addr,dividends) SELECT source,COUNT(*) FROM dividends WHERE source IS NOT NULL AND source IN (${ph}) GROUP BY source ON CONFLICT(addr) DO UPDATE SET dividends=excluded.dividends` },

  // assets_issued = raw count (FLOOD-gameable, so scored at weight 0). locked_assets is RESET to 0 here and
  // re-set in addr_surv gated by holders — else spam-issuing 1000 locked assets in one block games "no-rug".
  // heavyEveryBlocks: CO-GATED with addr_surv (its locked_assets re-corrector) even though issuances alone is
  // under the row threshold — same daily generation so the reset and re-correction always run in one cycle.
  { name: "addr_iss", scope: "address", reads: ["issuances"], heavyEveryBlocks: HEAVY_DAILY_BLOCKS,
    full: `INSERT INTO address_signals (addr,assets_issued,locked_assets) SELECT issuer,COUNT(*),0 FROM issuances WHERE issuer IS NOT NULL GROUP BY issuer ON CONFLICT(addr) DO UPDATE SET assets_issued=excluded.assets_issued,locked_assets=0`,
    scoped: (ph) => `INSERT INTO address_signals (addr,assets_issued,locked_assets) SELECT issuer,COUNT(*),0 FROM issuances WHERE issuer IS NOT NULL AND issuer IN (${ph}) GROUP BY issuer ON CONFLICT(addr) DO UPDATE SET assets_issued=excluded.assets_issued,locked_assets=0` },
  // transactions ~3.4M → heaviest full scan (measured 14.4s); gated daily. Cascade .scoped keeps dirty fresh.
  { name: "addr_fees", scope: "address", reads: ["transactions"], heavyEveryBlocks: HEAVY_DAILY_BLOCKS,
    full: `INSERT INTO address_signals (addr,btc_fees) SELECT source,SUM(CAST(fee AS REAL))/1e8 FROM transactions WHERE source IS NOT NULL AND fee IS NOT NULL GROUP BY source ON CONFLICT(addr) DO UPDATE SET btc_fees=excluded.btc_fees`,
    scoped: (ph) => `INSERT INTO address_signals (addr,btc_fees) SELECT source,SUM(CAST(fee AS REAL))/1e8 FROM transactions WHERE source IS NOT NULL AND fee IS NOT NULL AND source IN (${ph}) GROUP BY source ON CONFLICT(addr) DO UPDATE SET btc_fees=excluded.btc_fees` },
  { name: "addr_held", scope: "address", reads: ["balances"], heavyEveryBlocks: HEAVY_DAILY_BLOCKS,
    full: `INSERT INTO address_signals (addr,assets_held) SELECT holder,COUNT(DISTINCT asset) FROM balances WHERE holder_type='address' AND CAST(quantity AS INTEGER)>0 GROUP BY holder ON CONFLICT(addr) DO UPDATE SET assets_held=excluded.assets_held`,
    scoped: (ph) => `INSERT INTO address_signals (addr,assets_held) SELECT holder,COUNT(DISTINCT asset) FROM balances WHERE holder_type='address' AND CAST(quantity AS INTEGER)>0 AND holder IN (${ph}) GROUP BY holder ON CONFLICT(addr) DO UPDATE SET assets_held=excluded.assets_held` },
  { name: "addr_recv", scope: "address", reads: ["sends"], heavyEveryBlocks: HEAVY_DAILY_BLOCKS,
    full: `INSERT INTO address_signals (addr,assets_received) SELECT destination,COUNT(DISTINCT asset) FROM sends WHERE destination IS NOT NULL GROUP BY destination ON CONFLICT(addr) DO UPDATE SET assets_received=excluded.assets_received`,
    scoped: (ph) => `INSERT INTO address_signals (addr,assets_received) SELECT destination,COUNT(DISTINCT asset) FROM sends WHERE destination IS NOT NULL AND destination IN (${ph}) GROUP BY destination ON CONFLICT(addr) DO UPDATE SET assets_received=excluded.assets_received` },

  // ===== ADDRESS · creator track record (CASCADE: an asset's holder count changing dirties its issuer) =====
  // Creator track record in tiers by an asset's holder count (validated: cold-start assets survive ~1%,
  // a creator with prior 'landed' assets 18-28% — a ~30-40x predictive lift). survived_assets is the
  // 'landed' tier (>=10 holders) — the predictive sweet spot; >=2 'distributed' (left the wallet) is the
  // weak floor; >=50 'hits' is the elite cut. The cascade includes issuers-of-dirty-assets in the dirty
  // address set, so a holder change on any asset recomputes that asset's issuer here.
  { name: "addr_surv", scope: "address", reads: ["balances", "assets"], dependsOn: ["asset_holders"], heavyEveryBlocks: HEAVY_DAILY_BLOCKS,
    full: `WITH hc AS (SELECT asset, COUNT(*) h FROM balances WHERE holder_type='address' AND CAST(quantity AS INTEGER)>0 GROUP BY asset) INSERT INTO address_signals (addr,assets_distributed,survived_assets,assets_hits,locked_assets) SELECT a.issuer, SUM(CASE WHEN hc.h>=2 THEN 1 ELSE 0 END), SUM(CASE WHEN hc.h>=10 THEN 1 ELSE 0 END), SUM(CASE WHEN hc.h>=50 THEN 1 ELSE 0 END), SUM(CASE WHEN a.locked=1 AND hc.h>=2 THEN 1 ELSE 0 END) FROM assets a JOIN hc ON hc.asset=a.asset WHERE a.issuer IS NOT NULL GROUP BY a.issuer ON CONFLICT(addr) DO UPDATE SET assets_distributed=excluded.assets_distributed, survived_assets=excluded.survived_assets, assets_hits=excluded.assets_hits, locked_assets=excluded.locked_assets`,
    // scoped to dirty issuers: only their assets' holder counts (heavy balance scan limited to those assets).
    scoped: (ph) => `WITH ia AS (SELECT asset, issuer, locked FROM assets WHERE issuer IS NOT NULL AND issuer IN (${ph})), hc AS (SELECT b.asset, COUNT(*) h FROM balances b JOIN ia ON ia.asset=b.asset WHERE b.holder_type='address' AND CAST(b.quantity AS INTEGER)>0 GROUP BY b.asset) INSERT INTO address_signals (addr,assets_distributed,survived_assets,assets_hits,locked_assets) SELECT ia.issuer, SUM(CASE WHEN COALESCE(hc.h,0)>=2 THEN 1 ELSE 0 END), SUM(CASE WHEN COALESCE(hc.h,0)>=10 THEN 1 ELSE 0 END), SUM(CASE WHEN COALESCE(hc.h,0)>=50 THEN 1 ELSE 0 END), SUM(CASE WHEN ia.locked=1 AND COALESCE(hc.h,0)>=2 THEN 1 ELSE 0 END) FROM ia LEFT JOIN hc ON hc.asset=ia.asset GROUP BY ia.issuer ON CONFLICT(addr) DO UPDATE SET assets_distributed=excluded.assets_distributed, survived_assets=excluded.survived_assets, assets_hits=excluded.assets_hits, locked_assets=excluded.locked_assets` },

  // ===== ADDRESS · infra classification (curated/heuristic gates — rarely change → PERIODIC) =====
  // archetype: exchange/hub (CURATED hard-coded list; heuristics false-positived whales + treasuries) then
  // burn (curated list) then deposit/forwarding (out_peers=1, holds nothing, sole dest is an exchange).
  { name: "addr_is_exchange", scope: "address", reads: [], periodic: true,
    full: `UPDATE address_signals SET is_exchange = CASE WHEN addr IN (${EXCHANGES_SQL}) THEN 1 ELSE 0 END` },
  { name: "addr_is_burn", scope: "address", reads: [], periodic: true,
    full: `UPDATE address_signals SET is_burn = CASE WHEN addr IN (${CURATED_BURNS_SQL}) THEN 1 ELSE 0 END` },
  // NOT heavyEveryBlocks: its sends access is an INDEXED SEEK via the ~23 exchange destinations (idx_adr_exchange),
  // not a 1.75M full scan, and it's a cheap infra-flag UPDATE — not in the measured heavy set. Same for the other
  // infra flag UPDATEs below (is_exchange/is_burn/is_emblem/likely_service): they rewrite the derived
  // address_signals with a small membership CASE, they don't aggregate a >1M-row mirror table.
  { name: "addr_is_deposit", scope: "address", reads: ["sends"], dependsOn: ["addr_is_exchange", "addr_send_out", "addr_held"], periodic: true,
    full: `UPDATE address_signals SET is_deposit = CASE WHEN out_peers=1 AND assets_held=0 AND addr IN (SELECT s.source FROM sends s JOIN address_signals e ON e.addr=s.destination WHERE e.is_exchange=1) THEN 1 ELSE 0 END` },

  // ===== schema (asset) =====
  { name: "ddl_asset", scope: "global", reads: [], periodic: true, full: ASSET_DDL },

  // ===== ASSET · holders & concentration (from balances) =====
  // Resets burned_pct=0 for every (dirty) asset (cleared here, then re-set by asset_burn_adjust for assets
  // that still have burns) so assets that lost their burn holders don't keep a stale burned_pct.
  // heavyEveryBlocks: the `.full` is a ~3M-row balance scan; gate it (with asset_burn_adjust, its coupled
  // re-corrector) to daily so the two always rebuild TOGETHER — asset_holders resets holders/top1/burned_pct
  // and asset_burn_adjust re-states them for burn-holding assets, so they must share a cadence or the reset
  // would out-run the re-correction. Same daily generation ⇒ they run in the same cycle. Cascade `.scoped`
  // keeps dirty assets fresh every tick regardless.
  { name: "asset_holders", scope: "asset", reads: ["balances"], heavyEveryBlocks: HEAVY_DAILY_BLOCKS,
    full: `INSERT INTO asset_signals (asset,holders,top1_pct) SELECT asset,COUNT(*),MAX(CAST(quantity AS REAL))*100.0/NULLIF(SUM(CAST(quantity AS REAL)),0) FROM balances WHERE holder_type='address' AND CAST(quantity AS INTEGER)>0 GROUP BY asset ON CONFLICT(asset) DO UPDATE SET holders=excluded.holders,top1_pct=excluded.top1_pct,burned_pct=0`,
    scoped: (ph) => `INSERT INTO asset_signals (asset,holders,top1_pct) SELECT asset,COUNT(*),MAX(CAST(quantity AS REAL))*100.0/NULLIF(SUM(CAST(quantity AS REAL)),0) FROM balances WHERE holder_type='address' AND CAST(quantity AS INTEGER)>0 AND asset IN (${ph}) GROUP BY asset ON CONFLICT(asset) DO UPDATE SET holders=excluded.holders,top1_pct=excluded.top1_pct,burned_pct=0` },
  // burn adjustment: for assets with burns, re-state holders & top1 as CIRCULATING (exclude burn addrs) and
  // record burned_pct (= supply − circulating). Depends on holders' is_burn flag + must run AFTER asset_holders
  // (which resets burned_pct=0). is_burn is curated/stable, so the per-block trigger is a balance change.
  { name: "asset_burn_adjust", scope: "asset", reads: ["balances"], dependsOn: ["asset_holders", "addr_is_burn"], heavyEveryBlocks: HEAVY_DAILY_BLOCKS,
    full: `WITH adj AS (SELECT b.asset, COUNT(CASE WHEN COALESCE(sg.is_burn,0)=0 THEN 1 END) ch, MAX(CASE WHEN COALESCE(sg.is_burn,0)=0 THEN CAST(b.quantity AS REAL) END)*100.0/NULLIF(SUM(CASE WHEN COALESCE(sg.is_burn,0)=0 THEN CAST(b.quantity AS REAL) END),0) ct, SUM(CASE WHEN sg.is_burn=1 THEN CAST(b.quantity AS REAL) ELSE 0 END)*100.0/NULLIF(SUM(CAST(b.quantity AS REAL)),0) bp FROM balances b JOIN address_signals sg ON sg.addr=b.holder WHERE b.holder_type='address' AND CAST(b.quantity AS INTEGER)>0 GROUP BY b.asset HAVING SUM(CASE WHEN sg.is_burn=1 THEN 1 ELSE 0 END)>0) UPDATE asset_signals SET holders=adj.ch, top1_pct=COALESCE(adj.ct,0), burned_pct=adj.bp FROM adj WHERE adj.asset=asset_signals.asset`,
    scoped: (ph) => `WITH adj AS (SELECT b.asset, COUNT(CASE WHEN COALESCE(sg.is_burn,0)=0 THEN 1 END) ch, MAX(CASE WHEN COALESCE(sg.is_burn,0)=0 THEN CAST(b.quantity AS REAL) END)*100.0/NULLIF(SUM(CASE WHEN COALESCE(sg.is_burn,0)=0 THEN CAST(b.quantity AS REAL) END),0) ct, SUM(CASE WHEN sg.is_burn=1 THEN CAST(b.quantity AS REAL) ELSE 0 END)*100.0/NULLIF(SUM(CAST(b.quantity AS REAL)),0) bp FROM balances b JOIN address_signals sg ON sg.addr=b.holder WHERE b.holder_type='address' AND CAST(b.quantity AS INTEGER)>0 AND b.asset IN (${ph}) GROUP BY b.asset HAVING SUM(CASE WHEN sg.is_burn=1 THEN 1 ELSE 0 END)>0) UPDATE asset_signals SET holders=adj.ch, top1_pct=COALESCE(adj.ct,0), burned_pct=adj.bp FROM adj WHERE adj.asset=asset_signals.asset` },

  // ===== ASSET · trading (from order_matches) =====
  { name: "asset_trades", scope: "asset", reads: ["order_matches"],
    full: `WITH m AS (SELECT forward_asset asset,tx0_address a0,tx1_address a1,block_index b FROM order_matches UNION ALL SELECT backward_asset,tx0_address,tx1_address,block_index FROM order_matches) INSERT INTO asset_signals (asset,trades,self_trade_pct,first_trade_blk,last_trade_blk) SELECT asset,COUNT(*),SUM(CASE WHEN a0=a1 THEN 1.0 ELSE 0 END)*100.0/NULLIF(COUNT(*),0),MIN(b),MAX(b) FROM m WHERE asset IS NOT NULL GROUP BY asset ON CONFLICT(asset) DO UPDATE SET trades=excluded.trades,self_trade_pct=excluded.self_trade_pct,first_trade_blk=excluded.first_trade_blk,last_trade_blk=excluded.last_trade_blk`,
    scoped: (ph) => `WITH m AS (SELECT forward_asset asset,tx0_address a0,tx1_address a1,block_index b FROM order_matches UNION ALL SELECT backward_asset,tx0_address,tx1_address,block_index FROM order_matches) INSERT INTO asset_signals (asset,trades,self_trade_pct,first_trade_blk,last_trade_blk) SELECT asset,COUNT(*),SUM(CASE WHEN a0=a1 THEN 1.0 ELSE 0 END)*100.0/NULLIF(COUNT(*),0),MIN(b),MAX(b) FROM m WHERE asset IS NOT NULL AND asset IN (${ph}) GROUP BY asset ON CONFLICT(asset) DO UPDATE SET trades=excluded.trades,self_trade_pct=excluded.self_trade_pct,first_trade_blk=excluded.first_trade_blk,last_trade_blk=excluded.last_trade_blk` },
  { name: "asset_disp", scope: "asset", reads: ["dispenses"],
    full: `INSERT INTO asset_signals (asset,dispenses,dispense_btc) SELECT asset,COUNT(*),COALESCE(SUM(btc_amount),0)/1e8 FROM dispenses WHERE asset IS NOT NULL GROUP BY asset ON CONFLICT(asset) DO UPDATE SET dispenses=excluded.dispenses,dispense_btc=excluded.dispense_btc`,
    scoped: (ph) => `INSERT INTO asset_signals (asset,dispenses,dispense_btc) SELECT asset,COUNT(*),COALESCE(SUM(btc_amount),0)/1e8 FROM dispenses WHERE asset IS NOT NULL AND asset IN (${ph}) GROUP BY asset ON CONFLICT(asset) DO UPDATE SET dispenses=excluded.dispenses,dispense_btc=excluded.dispense_btc` },

  // ===== ASSET · quality flags (from own columns) =====
  // low-quality flag (deterministic): intrinsic wash (>=50% self-trade among >=30 trades — the trade floor
  // avoids flagging legit assets with 1-2 coincidental self-trades) OR the curated list.
  { name: "asset_lowq", scope: "asset", reads: [], dependsOn: ["asset_trades"],
    full: `UPDATE asset_signals SET low_quality = CASE WHEN (self_trade_pct>=50 AND trades>=30) OR asset IN (${CURATED_LOWQ_SQL}) THEN 1 ELSE 0 END`,
    scoped: (ph) => `UPDATE asset_signals SET low_quality = CASE WHEN (self_trade_pct>=50 AND trades>=30) OR asset IN (${CURATED_LOWQ_SQL}) THEN 1 ELSE 0 END WHERE asset IN (${ph})` },
  // propagate to siblings of BAD OPERATORS (issuers whose portfolio is >=50% flagged with >=4 flagged) —
  // guilt-by-association across the issuer's WHOLE portfolio → fan-out → PERIODIC.
  { name: "asset_lowq_propagate", scope: "asset", reads: [], dependsOn: ["asset_lowq"], periodic: true,
    full: `UPDATE asset_signals SET low_quality=1 WHERE low_quality=0 AND issuer IN (SELECT issuer FROM asset_signals WHERE issuer IS NOT NULL GROUP BY issuer HAVING SUM(low_quality)>=4 AND SUM(low_quality)*1.0/COUNT(*)>=0.5)` },

  // ===== ASSET · community (averages over the asset's HOLDERS' address features → fan-out → PERIODIC) =====
  // community quality (un-confounded, fairmint-safe): avg holder breadth + % of holders that are creators.
  // Reverse-direction fan-out (one address changing affects every asset it holds), so kept periodic per the
  // architecture doc (Layer C); a per-block asset scope would miss assets whose holders changed elsewhere.
  { name: "asset_community", scope: "asset", reads: ["balances"], dependsOn: ["addr_held", "addr_surv"], periodic: true, heavyEveryBlocks: HEAVY_DAILY_BLOCKS,
    full: `INSERT INTO asset_signals (asset, holder_breadth, pct_creator_holders) SELECT b.asset, AVG(COALESCE(sg.assets_held,0)), AVG(CASE WHEN sg.survived_assets>0 THEN 1.0 ELSE 0 END)*100 FROM balances b LEFT JOIN address_signals sg ON sg.addr=b.holder WHERE b.holder_type='address' AND CAST(b.quantity AS INTEGER)>0 GROUP BY b.asset HAVING COUNT(*)>=3 ON CONFLICT(asset) DO UPDATE SET holder_breadth=excluded.holder_breadth, pct_creator_holders=excluded.pct_creator_holders` },

  // ===== ADDRESS · clean (low-quality-excluded) economics + burner (depend on asset low_quality → PERIODIC) =====
  { name: "addr_clean_disp", scope: "address", reads: ["dispenses"], dependsOn: ["asset_lowq"], periodic: true,
    full: `INSERT INTO address_signals (addr,clean_dispense_btc) SELECT d.source,SUM(d.btc_amount)/1e8 FROM dispenses d JOIN asset_signals a ON a.asset=d.asset WHERE a.low_quality=0 AND d.source IS NOT NULL GROUP BY d.source ON CONFLICT(addr) DO UPDATE SET clean_dispense_btc=excluded.clean_dispense_btc` },
  { name: "addr_clean_spent", scope: "address", reads: ["dispenses"], dependsOn: ["asset_lowq"], periodic: true,
    full: `INSERT INTO address_signals (addr,clean_btc_spent) SELECT d.destination,SUM(d.btc_amount)/1e8 FROM dispenses d JOIN asset_signals a ON a.asset=d.asset WHERE a.low_quality=0 AND d.destination IS NOT NULL GROUP BY d.destination ON CONFLICT(addr) DO UPDATE SET clean_btc_spent=excluded.clean_btc_spent` },
  // Burner signal: distinct CLEAN assets sent to a known burn address (creators burning their own supply —
  // PEPECASH, Bitcorn — is a credible pro-holder/deflation act). Depends on is_burn + asset low_quality.
  { name: "addr_burned_out", scope: "address", reads: ["sends"], dependsOn: ["addr_is_burn", "asset_lowq"], periodic: true, heavyEveryBlocks: HEAVY_DAILY_BLOCKS,
    full: `INSERT INTO address_signals (addr,assets_burned) SELECT s.source,COUNT(DISTINCT s.asset) FROM sends s JOIN address_signals b ON b.addr=s.destination AND b.is_burn=1 LEFT JOIN asset_signals a ON a.asset=s.asset WHERE s.source IS NOT NULL AND COALESCE(a.low_quality,0)=0 GROUP BY s.source ON CONFLICT(addr) DO UPDATE SET assets_burned=excluded.assets_burned` },

  // ===== ADDRESS · dispenser-operator trust (from dispensers + dispenses) =====
  // Dispenser-operator trust = longevity-weighted track record (validated: at the top it's 100% legit
  // operators, 0 wash). span(months)*2 + repeat-operation*1.5 + distinct buyers + a small volume term.
  { name: "addr_disp_trust", scope: "address", reads: ["dispensers", "dispenses"],
    full: `INSERT INTO address_signals (addr,disp_trust) SELECT o.source, 2*LN(1+(MAX(o.block_index)-MIN(o.block_index))/4320.0)+1.5*LN(1+COUNT(DISTINCT o.tx_hash))+LN(1+COALESCE(MAX(b.buyers),0))+0.5*LN(1+COALESCE(MAX(b.dx),0)) FROM dispensers o LEFT JOIN (SELECT source,COUNT(*) dx,COUNT(DISTINCT destination) buyers FROM dispenses WHERE source IS NOT NULL GROUP BY source) b ON b.source=o.source WHERE o.source IS NOT NULL GROUP BY o.source ON CONFLICT(addr) DO UPDATE SET disp_trust=excluded.disp_trust`,
    scoped: (ph) => `INSERT INTO address_signals (addr,disp_trust) SELECT o.source, 2*LN(1+(MAX(o.block_index)-MIN(o.block_index))/4320.0)+1.5*LN(1+COUNT(DISTINCT o.tx_hash))+LN(1+COALESCE(MAX(b.buyers),0))+0.5*LN(1+COALESCE(MAX(b.dx),0)) FROM dispensers o LEFT JOIN (SELECT source,COUNT(*) dx,COUNT(DISTINCT destination) buyers FROM dispenses WHERE source IS NOT NULL GROUP BY source) b ON b.source=o.source WHERE o.source IS NOT NULL AND o.source IN (${ph}) GROUP BY o.source ON CONFLICT(addr) DO UPDATE SET disp_trust=excluded.disp_trust` },

  // ===== ADDRESS · Emblem vault + service heuristic (crawler/heuristic driven → PERIODIC) =====
  { name: "ddl_emblem", scope: "global", reads: [], periodic: true, full: EMBLEM_DDL },
  { name: "addr_is_emblem", scope: "address", reads: [], periodic: true,
    full: `UPDATE address_signals SET is_emblem_vault = CASE WHEN addr IN (SELECT btc_address FROM emblem_vaults) THEN 1 ELSE 0 END` },
  // likely_service: HEURISTIC flag for service-like addresses (huge inbound, no creation, not already infra).
  { name: "addr_likely_service", scope: "address", reads: [], dependsOn: ["addr_is_exchange", "addr_is_burn", "addr_is_emblem", "addr_iss", "addr_send_in"], periodic: true,
    full: `UPDATE address_signals SET likely_service = CASE WHEN is_exchange=0 AND is_burn=0 AND is_emblem_vault=0 AND assets_issued=0 AND in_peers>=500 THEN 1 ELSE 0 END` },

  // ===== ADDRESS · cross-protocol cohorts (stamps / SRC-20 / BTNS) =====
  { name: "addr_stamps_created", scope: "address", reads: ["assets", "tags"],
    full: `INSERT INTO address_signals (addr,stamps_created,src20_deploys) SELECT a.issuer, COUNT(DISTINCT CASE WHEN t.tag='stamp' THEN a.asset END), COUNT(DISTINCT CASE WHEN t.tag='src20_deploy' THEN a.asset END) FROM assets a JOIN tags t ON t.entity_type='asset' AND t.entity_id=a.asset AND t.tag IN ('stamp','src20_deploy') WHERE a.issuer IS NOT NULL GROUP BY a.issuer ON CONFLICT(addr) DO UPDATE SET stamps_created=excluded.stamps_created, src20_deploys=excluded.src20_deploys`,
    scoped: (ph) => `INSERT INTO address_signals (addr,stamps_created,src20_deploys) SELECT a.issuer, COUNT(DISTINCT CASE WHEN t.tag='stamp' THEN a.asset END), COUNT(DISTINCT CASE WHEN t.tag='src20_deploy' THEN a.asset END) FROM assets a JOIN tags t ON t.entity_type='asset' AND t.entity_id=a.asset AND t.tag IN ('stamp','src20_deploy') WHERE a.issuer IS NOT NULL AND a.issuer IN (${ph}) GROUP BY a.issuer ON CONFLICT(addr) DO UPDATE SET stamps_created=excluded.stamps_created, src20_deploys=excluded.src20_deploys` },
  { name: "addr_stamps_collected", scope: "address", reads: ["balances", "tags"], heavyEveryBlocks: HEAVY_DAILY_BLOCKS,
    full: `INSERT INTO address_signals (addr,stamps_collected) SELECT b.holder, COUNT(DISTINCT b.asset) FROM balances b JOIN tags t ON t.entity_type='asset' AND t.entity_id=b.asset AND t.tag='stamp' WHERE b.holder_type='address' AND CAST(b.quantity AS INTEGER)>0 GROUP BY b.holder ON CONFLICT(addr) DO UPDATE SET stamps_collected=excluded.stamps_collected`,
    scoped: (ph) => `INSERT INTO address_signals (addr,stamps_collected) SELECT b.holder, COUNT(DISTINCT b.asset) FROM balances b JOIN tags t ON t.entity_type='asset' AND t.entity_id=b.asset AND t.tag='stamp' WHERE b.holder_type='address' AND CAST(b.quantity AS INTEGER)>0 AND b.holder IN (${ph}) GROUP BY b.holder ON CONFLICT(addr) DO UPDATE SET stamps_collected=excluded.stamps_collected` },
  { name: "addr_is_btns", scope: "address", reads: ["broadcasts"],
    full: `UPDATE address_signals SET is_btns_user = CASE WHEN addr IN (SELECT DISTINCT source FROM broadcasts WHERE btns=1 AND source IS NOT NULL) THEN 1 ELSE 0 END`,
    scoped: (ph) => `UPDATE address_signals SET is_btns_user = CASE WHEN addr IN (SELECT DISTINCT source FROM broadcasts WHERE btns=1 AND source IS NOT NULL) THEN 1 ELSE 0 END WHERE addr IN (${ph})` },
  // DEX trading activity — order-match participation per address.
  { name: "addr_dex_trades", scope: "address", reads: ["order_matches"],
    full: `INSERT INTO address_signals (addr,dex_trades) SELECT addr, COUNT(*) FROM (SELECT tx0_address addr FROM order_matches WHERE tx0_address IS NOT NULL UNION ALL SELECT tx1_address FROM order_matches WHERE tx1_address IS NOT NULL) GROUP BY addr ON CONFLICT(addr) DO UPDATE SET dex_trades=excluded.dex_trades`,
    scoped: (ph) => `INSERT INTO address_signals (addr,dex_trades) SELECT addr, COUNT(*) FROM (SELECT tx0_address addr FROM order_matches WHERE tx0_address IS NOT NULL UNION ALL SELECT tx1_address FROM order_matches WHERE tx1_address IS NOT NULL) WHERE addr IN (${ph}) GROUP BY addr ON CONFLICT(addr) DO UPDATE SET dex_trades=excluded.dex_trades` },

  // ===== ASSET · distinct participants (wash-resistant breadth) =====
  // distinct market participants per asset — WASH-RESISTANT (self-trading inflates `trades` but can't fake
  // distinct addresses). Strongest additive asset signal found (lift 10.3x vs vaulted).
  { name: "asset_distinct_traders", scope: "asset", reads: ["order_matches"],
    full: `WITH m AS (SELECT forward_asset asset,tx0_address a FROM order_matches UNION ALL SELECT forward_asset,tx1_address FROM order_matches UNION ALL SELECT backward_asset,tx0_address FROM order_matches UNION ALL SELECT backward_asset,tx1_address FROM order_matches) INSERT INTO asset_signals (asset,distinct_traders) SELECT asset,COUNT(DISTINCT a) FROM m WHERE asset IS NOT NULL GROUP BY asset ON CONFLICT(asset) DO UPDATE SET distinct_traders=excluded.distinct_traders`,
    scoped: (ph) => `WITH m AS (SELECT forward_asset asset,tx0_address a FROM order_matches UNION ALL SELECT forward_asset,tx1_address FROM order_matches UNION ALL SELECT backward_asset,tx0_address FROM order_matches UNION ALL SELECT backward_asset,tx1_address FROM order_matches) INSERT INTO asset_signals (asset,distinct_traders) SELECT asset,COUNT(DISTINCT a) FROM m WHERE asset IS NOT NULL AND asset IN (${ph}) GROUP BY asset ON CONFLICT(asset) DO UPDATE SET distinct_traders=excluded.distinct_traders` },
  { name: "asset_distinct_dispensers", scope: "asset", reads: ["dispensers"],
    full: `INSERT INTO asset_signals (asset,distinct_dispensers) SELECT asset,COUNT(DISTINCT source) FROM dispensers WHERE asset IS NOT NULL GROUP BY asset ON CONFLICT(asset) DO UPDATE SET distinct_dispensers=excluded.distinct_dispensers`,
    scoped: (ph) => `INSERT INTO asset_signals (asset,distinct_dispensers) SELECT asset,COUNT(DISTINCT source) FROM dispensers WHERE asset IS NOT NULL AND asset IN (${ph}) GROUP BY asset ON CONFLICT(asset) DO UPDATE SET distinct_dispensers=excluded.distinct_dispensers` },
  // holder sophistication: avg DEX activity of the asset's holders (depends on holders' dex_trades → PERIODIC).
  { name: "asset_holder_dex", scope: "asset", reads: ["balances"], dependsOn: ["addr_dex_trades"], periodic: true, heavyEveryBlocks: HEAVY_DAILY_BLOCKS,
    full: `INSERT INTO asset_signals (asset,avg_holder_dex) SELECT b.asset, AVG(COALESCE(sg.dex_trades,0)) FROM balances b LEFT JOIN address_signals sg ON sg.addr=b.holder WHERE b.holder_type='address' AND CAST(b.quantity AS INTEGER)>0 GROUP BY b.asset HAVING COUNT(*)>=3 ON CONFLICT(asset) DO UPDATE SET avg_holder_dex=excluded.avg_holder_dex` },

  // ===== ASSET · current activity + realized value =====
  // CURRENT ACTIVITY: trailing-~12mo trades+dispenses. The window slides with the tip, so EVERY asset's value
  // can change as blocks pass even when the asset isn't touched (old events fall out) → PERIODIC (reset + recount).
  { name: "asset_recent_reset", scope: "asset", reads: [], periodic: true,
    full: `UPDATE asset_signals SET recent_events=0` },
  { name: "asset_recent", scope: "asset", reads: ["order_matches", "dispenses"], periodic: true,
    full: `INSERT INTO asset_signals (asset,recent_events) SELECT asset,COUNT(*) FROM (SELECT forward_asset asset FROM order_matches WHERE block_index>=(SELECT MAX(block_index)-52560 FROM blocks) UNION ALL SELECT backward_asset FROM order_matches WHERE block_index>=(SELECT MAX(block_index)-52560 FROM blocks) UNION ALL SELECT asset FROM dispenses WHERE block_index>=(SELECT MAX(block_index)-52560 FROM blocks)) WHERE asset IS NOT NULL GROUP BY asset ON CONFLICT(asset) DO UPDATE SET recent_events=excluded.recent_events` },
  // REALIZED VALUE: biggest BTC actually paid in a dispense, biggest XCP that changed hands in a DEX match.
  // Captures worth, not volume — THE grail/scam discriminator (see reputation.md realized-value re-dial).
  { name: "asset_max_disp_btc", scope: "asset", reads: ["dispenses"],
    full: `INSERT INTO asset_signals (asset,max_dispense_btc) SELECT asset, MAX(btc_amount)/1e8 FROM dispenses WHERE btc_amount>0 AND asset IS NOT NULL GROUP BY asset ON CONFLICT(asset) DO UPDATE SET max_dispense_btc=excluded.max_dispense_btc`,
    scoped: (ph) => `INSERT INTO asset_signals (asset,max_dispense_btc) SELECT asset, MAX(btc_amount)/1e8 FROM dispenses WHERE btc_amount>0 AND asset IS NOT NULL AND asset IN (${ph}) GROUP BY asset ON CONFLICT(asset) DO UPDATE SET max_dispense_btc=excluded.max_dispense_btc` },
  { name: "asset_max_trade_xcp", scope: "asset", reads: ["order_matches"],
    full: `INSERT INTO asset_signals (asset,max_trade_xcp) SELECT asset, MAX(x)/1e8 FROM (SELECT forward_asset asset, CAST(backward_quantity AS REAL) x FROM order_matches WHERE backward_asset='XCP' UNION ALL SELECT backward_asset, CAST(forward_quantity AS REAL) FROM order_matches WHERE forward_asset='XCP') WHERE asset IS NOT NULL GROUP BY asset ON CONFLICT(asset) DO UPDATE SET max_trade_xcp=excluded.max_trade_xcp`,
    scoped: (ph) => `INSERT INTO asset_signals (asset,max_trade_xcp) SELECT asset, MAX(x)/1e8 FROM (SELECT forward_asset asset, CAST(backward_quantity AS REAL) x FROM order_matches WHERE backward_asset='XCP' UNION ALL SELECT backward_asset, CAST(forward_quantity AS REAL) FROM order_matches WHERE forward_asset='XCP') WHERE asset IS NOT NULL AND asset IN (${ph}) GROUP BY asset ON CONFLICT(asset) DO UPDATE SET max_trade_xcp=excluded.max_trade_xcp` },

  // ===== ASSET · metadata + tip-relative ages (age/recency slide with tip → PERIODIC) =====
  // seed asset metadata + precomputed age (tip − first issuance) + recency. age_blocks/recency_blocks are
  // tip-relative (change for all assets as blocks pass) so this is periodic. (A full INSERT...SELECT of all
  // assets exceeds D1's per-statement write cap, so it's an UPDATE of existing rows.)
  { name: "asset_seed", scope: "asset", reads: ["assets", "blocks"], periodic: true,
    full: `UPDATE asset_signals SET asset_longname=(SELECT asset_longname FROM assets a WHERE a.asset=asset_signals.asset), issuer=(SELECT issuer FROM assets a WHERE a.asset=asset_signals.asset), divisible=(SELECT divisible FROM assets a WHERE a.asset=asset_signals.asset), locked=(SELECT locked FROM assets a WHERE a.asset=asset_signals.asset), supply=(SELECT CAST(supply_normalized AS REAL) FROM assets a WHERE a.asset=asset_signals.asset), age_blocks=((SELECT MAX(block_index) FROM blocks)-(SELECT first_issuance_block_index FROM assets a WHERE a.asset=asset_signals.asset)), recency_blocks=((SELECT MAX(block_index) FROM blocks)-last_trade_blk) WHERE EXISTS (SELECT 1 FROM assets a WHERE a.asset=asset_signals.asset)` },

  // ===== indexes (full-rebuild only) =====
  ...INDEX_DDL.map((sql, i) => ({ name: `idx_${i}`, scope: "global" as Scope, reads: [], periodic: true, full: sql })),
];

async function getState(env: Env, k: string): Promise<string | null> {
  return ((await env.DB.prepare(`SELECT value FROM indexer_state WHERE key=?`).bind(k).first<{ value: string }>())?.value) ?? null;
}
async function setState(env: Env, k: string, v: string): Promise<void> {
  await env.DB.prepare(`INSERT INTO indexer_state (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).bind(k, v).run();
}

/**
 * STEPPED FULL REBUILD (canonical / repair / backfill). Runs the next `max` units' `.full` from a cursor,
 * wrapping to 0 when a cycle completes. On a completed cycle it hands the per-block cascade its starting
 * point (signals_cascade_block = current tip) so the cascade takes over from a known-good full rebuild.
 */
export async function runSignalsStep(env: Env, max = 3): Promise<any> {
  let i = parseInt((await getState(env, "signals_step")) || "0", 10);
  if (i >= UNITS.length || i < 0) i = 0;
  const tip = (await env.DB.prepare(`SELECT MAX(block_index) m FROM blocks`).first<{ m: number | null }>())?.m ?? 0;
  const ran: Record<string, number> = {};
  const gated: string[] = [];
  const start = i;
  for (let k = 0; k < max && i < UNITS.length; k++, i++) {
    const u = UNITS[i];
    if (u.heavyEveryBlocks) {
      // Block-delta gate: run at most once per generation = floor(tip / heavyEveryBlocks). Coupled heavy units
      // share the same generation function of `tip`, so they always run in the same generation (never desync).
      const gen = Math.floor(tip / u.heavyEveryBlocks);
      const gkey = `signals_heavy_${u.name}_gen`;
      const lastGen = parseInt((await getState(env, gkey)) ?? "-1", 10);
      if (lastGen >= gen) { gated.push(u.name); continue; } // still fresh this generation → skip the global scan
      const r: any = await env.DB.prepare(u.full).run();
      ran[u.name] = r?.meta?.rows_written ?? 0;
      await setState(env, gkey, String(gen));
      continue;
    }
    const r: any = await env.DB.prepare(u.full).run();
    ran[u.name] = r?.meta?.rows_written ?? 0;
  }
  const done = i >= UNITS.length;
  await setState(env, "signals_step", done ? "0" : String(i));
  if (done) {
    // full rebuild just reproduced the whole feature matrix → anchor the cascade cursor at the current tip.
    await setState(env, "signals_cascade_block", String(tip));
  }
  return { ran_passes: `${start}..${i - 1}`, of: UNITS.length, cycle_done: done, ran, gated };
}

// ----- per-block dirty cascade (Layer B) -----

const CASCADE_MAX_BLOCKS = 1500; // block window per cascade tick (bounds work; cron keeps up at 2-min cadence)
const KEY_CHUNK = 800;           // dirty keys per statement (SQLite var limit is 999)

const chunk = <T>(a: T[], n: number): T[][] => { const o: T[][] = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };

// Dirty ASSET set for a block range: every asset whose raw rows changed in [lo,hi]. Mirror-table-derived
// (no per-handler annotation to miss) — includes balances via updated_block_index so holder changes count.
async function dirtyAssets(env: Env, lo: number, hi: number): Promise<string[]> {
  const sql = `SELECT DISTINCT asset FROM (
      SELECT asset FROM issuances WHERE block_index BETWEEN ?1 AND ?2
      UNION SELECT asset FROM sends WHERE block_index BETWEEN ?1 AND ?2
      UNION SELECT asset FROM dispenses WHERE block_index BETWEEN ?1 AND ?2
      UNION SELECT asset FROM dispensers WHERE block_index BETWEEN ?1 AND ?2
      UNION SELECT asset FROM destructions WHERE block_index BETWEEN ?1 AND ?2
      UNION SELECT forward_asset FROM order_matches WHERE block_index BETWEEN ?1 AND ?2
      UNION SELECT backward_asset FROM order_matches WHERE block_index BETWEEN ?1 AND ?2
      UNION SELECT asset FROM balances WHERE updated_block_index BETWEEN ?1 AND ?2
    ) WHERE asset IS NOT NULL`;
  const r = await env.DB.prepare(sql).bind(lo, hi).all<{ asset: string }>();
  return r.results.map((x) => x.asset);
}

// Dirty ADDRESS set for a block range: every address whose raw rows changed in [lo,hi], PLUS the issuers of
// the dirty assets (their creator-track-record depends on those assets' holder counts — the cascade edge).
async function dirtyAddrs(env: Env, lo: number, hi: number, assets: string[]): Promise<string[]> {
  const sql = `SELECT DISTINCT addr FROM (
      SELECT source addr FROM sends WHERE block_index BETWEEN ?1 AND ?2 AND source IS NOT NULL
      UNION SELECT destination FROM sends WHERE block_index BETWEEN ?1 AND ?2 AND destination IS NOT NULL
      UNION SELECT issuer FROM issuances WHERE block_index BETWEEN ?1 AND ?2 AND issuer IS NOT NULL
      UNION SELECT source FROM dispenses WHERE block_index BETWEEN ?1 AND ?2 AND source IS NOT NULL
      UNION SELECT destination FROM dispenses WHERE block_index BETWEEN ?1 AND ?2 AND destination IS NOT NULL
      UNION SELECT source FROM dispensers WHERE block_index BETWEEN ?1 AND ?2 AND source IS NOT NULL
      UNION SELECT source FROM transactions WHERE block_index BETWEEN ?1 AND ?2 AND source IS NOT NULL
      UNION SELECT tx0_address FROM order_matches WHERE block_index BETWEEN ?1 AND ?2 AND tx0_address IS NOT NULL
      UNION SELECT tx1_address FROM order_matches WHERE block_index BETWEEN ?1 AND ?2 AND tx1_address IS NOT NULL
      UNION SELECT source FROM dividends WHERE block_index BETWEEN ?1 AND ?2 AND source IS NOT NULL
      UNION SELECT source FROM broadcasts WHERE block_index BETWEEN ?1 AND ?2 AND source IS NOT NULL
      UNION SELECT holder FROM balances WHERE updated_block_index BETWEEN ?1 AND ?2 AND holder_type='address'
    )`;
  const r = await env.DB.prepare(sql).bind(lo, hi).all<{ addr: string }>();
  const set = new Set<string>(r.results.map((x) => x.addr).filter(Boolean));
  // cascade edge: issuers of dirty assets need addr_surv recomputed (their assets' holder counts moved).
  for (const part of chunk(assets, KEY_CHUNK)) {
    if (!part.length) continue;
    const ph = part.map(() => "?").join(",");
    const ir = await env.DB.prepare(`SELECT DISTINCT issuer FROM assets WHERE issuer IS NOT NULL AND asset IN (${ph})`).bind(...part).all<{ issuer: string }>();
    for (const x of ir.results) if (x.issuer) set.add(x.issuer);
  }
  return [...set];
}

/**
 * PER-BLOCK DIRTY CASCADE. Advances signals_cascade_block over [cursor+1 .. tip] (bounded), derives the
 * touched entities straight from the mirror tables, and recomputes ONLY those keys via each non-periodic
 * unit's `.scoped`. Periodic/global units (community avgs, low-quality propagation, recent-window, tip-ages,
 * infra flags, pagerank, anchors) are left to runSignalsStep on cron. Returns caught_up / needs_backfill.
 */
export async function runSignalsCascade(env: Env): Promise<any> {
  const cur = await getState(env, "signals_cascade_block");
  if (cur == null) return { needs_backfill: true, note: "run a full runSignalsStep cycle first (it sets the cascade cursor to tip)" };
  const cursor = parseInt(cur, 10);
  const tip = (await env.DB.prepare(`SELECT MAX(block_index) m FROM blocks`).first<{ m: number | null }>())?.m ?? 0;
  if (tip <= cursor) return { caught_up: true, at_block: cursor };
  const lo = cursor + 1, hi = Math.min(cursor + CASCADE_MAX_BLOCKS, tip);

  const assets = await dirtyAssets(env, lo, hi);
  const addrs = await dirtyAddrs(env, lo, hi, assets);
  const keysFor = (u: FeatureUnit) => (u.scope === "asset" ? assets : addrs);

  const ran: Record<string, number> = {};
  for (const u of UNITS) {
    if (u.periodic || !u.scoped || u.scope === "global") continue;
    const keys = keysFor(u);
    let wrote = 0;
    for (const part of chunk(keys, KEY_CHUNK)) {
      if (!part.length) continue;
      const ph = part.map(() => "?").join(",");
      const r: any = await env.DB.prepare(u.scoped(ph)).bind(...part).run();
      wrote += r?.meta?.rows_written ?? 0;
    }
    ran[u.name] = wrote;
  }
  await setState(env, "signals_cascade_block", String(hi));
  // `dirty` carries the exact touched sets so the tag rebuild (buildTagsScoped) reuses THIS derivation —
  // one block-cursor scan, tags + signals always rebuilt over the same entities.
  return { from_block: lo, to_block: hi, tip, dirty_assets: assets.length, dirty_addrs: addrs.length, caught_up: hi >= tip, ran, dirty: { assets, addrs } };
}

/**
 * VERIFIER (safety gate). Recompute one entity's feature row both ways — full-table `.full` vs dirty `.scoped`
 * — into a scratch and diff. Used by /admin/verify-signals to prove the cascade matches the canonical rebuild
 * before trusting it (the guardrail against a silent scoped-SQL bug). Returns per-column diffs, [] = identical.
 */
export async function verifySignals(env: Env, scope: "asset" | "address", id: string): Promise<any> {
  const table = scope === "asset" ? "asset_signals" : "address_signals";
  const key = scope === "asset" ? "asset" : "addr";
  const before = await env.DB.prepare(`SELECT * FROM ${table} WHERE ${key}=?`).bind(id).first<any>();
  for (const u of UNITS) {
    if (u.periodic || !u.scoped || u.scope !== scope) continue;
    await env.DB.prepare(u.scoped("?")).bind(id).run();
  }
  const after = await env.DB.prepare(`SELECT * FROM ${table} WHERE ${key}=?`).bind(id).first<any>();
  const diffs: any[] = [];
  if (before && after) for (const k of Object.keys(after)) if (String(before[k]) !== String(after[k])) diffs.push({ col: k, full: before[k], cascade: after[k] });
  return { scope, id, identical: diffs.length === 0, diffs, note: "non-periodic units only; periodic globals (community/recent/ages/propagation) are excluded by design" };
}
