/**
 * Precomputed reputation signal tables — address_signals + asset_signals.
 *
 * Heavy full-table aggregations over the mirror, so NOT computed per-request. Read endpoints (address/
 * asset reputation, leaderboards) just look these up = fast.
 *
 * IMPORTANT: a full rebuild is ~16 heavy aggregations — too long for ONE Worker request (times out).
 * So it runs STEPPED: runSignalsStep() executes the next few passes from a cursor in indexer_state and
 * wraps around. The cron calls it a couple steps per caught-up tick, continuously cycling = always fresh.
 * Each pass is idempotent (INSERT...SELECT ON CONFLICT / UPDATE), refresh-in-place.
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

// Ordered passes. DDL passes are cheap; the rest are one heavy aggregation each.
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

const PASSES: { name: string; sql: string }[] = [
  { name: "ddl_addr", sql: ADDR_DDL },
  { name: "addr_send_out", sql: `INSERT INTO address_signals (addr,first_blk,out_peers) SELECT source,MIN(block_index),COUNT(DISTINCT destination) FROM sends WHERE source IS NOT NULL GROUP BY source ON CONFLICT(addr) DO UPDATE SET first_blk=MIN(address_signals.first_blk,excluded.first_blk),out_peers=excluded.out_peers` },
  { name: "addr_send_in", sql: `INSERT INTO address_signals (addr,in_peers,first_blk,last_blk) SELECT destination,COUNT(DISTINCT source),MIN(block_index),MAX(block_index) FROM sends WHERE destination IS NOT NULL GROUP BY destination ON CONFLICT(addr) DO UPDATE SET in_peers=excluded.in_peers,first_blk=MIN(address_signals.first_blk,excluded.first_blk),last_blk=MAX(address_signals.last_blk,excluded.last_blk)` },
  { name: "addr_last", sql: `INSERT INTO address_signals (addr,last_blk) SELECT source,MAX(block_index) FROM sends WHERE source IS NOT NULL GROUP BY source ON CONFLICT(addr) DO UPDATE SET last_blk=MAX(address_signals.last_blk,excluded.last_blk)` },
  { name: "addr_disp_earn", sql: `INSERT INTO address_signals (addr,dispense_btc,dispenses) SELECT source,COALESCE(SUM(btc_amount),0)/1e8,COUNT(*) FROM dispenses WHERE source IS NOT NULL GROUP BY source ON CONFLICT(addr) DO UPDATE SET dispense_btc=excluded.dispense_btc,dispenses=excluded.dispenses` },
  { name: "addr_disp_spend", sql: `INSERT INTO address_signals (addr,btc_spent) SELECT destination,COALESCE(SUM(btc_amount),0)/1e8 FROM dispenses WHERE destination IS NOT NULL GROUP BY destination ON CONFLICT(addr) DO UPDATE SET btc_spent=excluded.btc_spent` },
  { name: "addr_div", sql: `INSERT INTO address_signals (addr,dividends) SELECT source,COUNT(*) FROM dividends WHERE source IS NOT NULL GROUP BY source ON CONFLICT(addr) DO UPDATE SET dividends=excluded.dividends` },
  { name: "addr_iss", sql: `INSERT INTO address_signals (addr,assets_issued,locked_assets) SELECT issuer,COUNT(*),COALESCE(SUM(locked),0) FROM issuances WHERE issuer IS NOT NULL GROUP BY issuer ON CONFLICT(addr) DO UPDATE SET assets_issued=excluded.assets_issued,locked_assets=excluded.locked_assets` },
  { name: "addr_fees", sql: `INSERT INTO address_signals (addr,btc_fees) SELECT source,SUM(CAST(fee AS REAL))/1e8 FROM transactions WHERE source IS NOT NULL AND fee IS NOT NULL GROUP BY source ON CONFLICT(addr) DO UPDATE SET btc_fees=excluded.btc_fees` },
  { name: "addr_held", sql: `INSERT INTO address_signals (addr,assets_held) SELECT holder,COUNT(DISTINCT asset) FROM balances WHERE holder_type='address' AND CAST(quantity AS INTEGER)>0 GROUP BY holder ON CONFLICT(addr) DO UPDATE SET assets_held=excluded.assets_held` },
  { name: "addr_recv", sql: `INSERT INTO address_signals (addr,assets_received) SELECT destination,COUNT(DISTINCT asset) FROM sends WHERE destination IS NOT NULL GROUP BY destination ON CONFLICT(addr) DO UPDATE SET assets_received=excluded.assets_received` },
  // Creator track record in tiers by an asset's holder count (validated: cold-start assets survive ~1%,
  // a creator with prior 'landed' assets 18-28% — a ~30-40x predictive lift). survived_assets is the
  // 'landed' tier (>=10 holders) — the predictive sweet spot; >=2 'distributed' (left the wallet) is the
  // weak floor; >=50 'hits' is the elite cut. ln() scaling in the score handles the volume-dilution past ~20.
  { name: "addr_surv", sql: `WITH hc AS (SELECT asset, COUNT(*) h FROM balances WHERE holder_type='address' AND CAST(quantity AS INTEGER)>0 GROUP BY asset) INSERT INTO address_signals (addr,assets_distributed,survived_assets,assets_hits) SELECT a.issuer, SUM(CASE WHEN hc.h>=2 THEN 1 ELSE 0 END), SUM(CASE WHEN hc.h>=10 THEN 1 ELSE 0 END), SUM(CASE WHEN hc.h>=50 THEN 1 ELSE 0 END) FROM assets a JOIN hc ON hc.asset=a.asset WHERE a.issuer IS NOT NULL GROUP BY a.issuer ON CONFLICT(addr) DO UPDATE SET assets_distributed=excluded.assets_distributed, survived_assets=excluded.survived_assets, assets_hits=excluded.assets_hits` },
  // archetype: exchange/hub (no creation/commerce + high inbound) then deposit/forwarding addresses
  // (out_peers=1, holds nothing, sole destination is an exchange — exchange plumbing, not real users).
  // Exchange/hub: CURATED hard-coded list (heuristics false-positived whales + token treasuries).
  { name: "addr_is_exchange", sql: `UPDATE address_signals SET is_exchange = CASE WHEN addr IN (${EXCHANGES_SQL}) THEN 1 ELSE 0 END` },
  // Burn addresses: vanity x/X-run pattern OR curated non-pattern burns (from community list).
  // Burn = exactly the hard-coded curated list (no pattern/heuristic).
  { name: "addr_is_burn", sql: `UPDATE address_signals SET is_burn = CASE WHEN addr IN (${CURATED_BURNS_SQL}) THEN 1 ELSE 0 END` },
  { name: "addr_is_deposit", sql: `UPDATE address_signals SET is_deposit = CASE WHEN out_peers=1 AND assets_held=0 AND addr IN (SELECT s.source FROM sends s JOIN address_signals e ON e.addr=s.destination WHERE e.is_exchange=1) THEN 1 ELSE 0 END` },
  { name: "ddl_asset", sql: ASSET_DDL },
  // Resets burned_pct=0 for every asset (cleared here, then re-set by asset_burn_adjust for assets that
  // still have burns) so assets that lost their burn holders don't keep a stale burned_pct.
  { name: "asset_holders", sql: `INSERT INTO asset_signals (asset,holders,top1_pct) SELECT asset,COUNT(*),MAX(CAST(quantity AS REAL))*100.0/NULLIF(SUM(CAST(quantity AS REAL)),0) FROM balances WHERE holder_type='address' AND CAST(quantity AS INTEGER)>0 GROUP BY asset ON CONFLICT(asset) DO UPDATE SET holders=excluded.holders,top1_pct=excluded.top1_pct,burned_pct=0` },
  // burn adjustment: for assets with burns, re-state holders & top1 as CIRCULATING (exclude burn addrs)
  // and record burned_pct (= supply − circulating). So "top holder owns X%" reflects real holders, not the burn.
  { name: "asset_burn_adjust", sql: `WITH adj AS (SELECT b.asset, COUNT(CASE WHEN COALESCE(sg.is_burn,0)=0 THEN 1 END) ch, MAX(CASE WHEN COALESCE(sg.is_burn,0)=0 THEN CAST(b.quantity AS REAL) END)*100.0/NULLIF(SUM(CASE WHEN COALESCE(sg.is_burn,0)=0 THEN CAST(b.quantity AS REAL) END),0) ct, SUM(CASE WHEN sg.is_burn=1 THEN CAST(b.quantity AS REAL) ELSE 0 END)*100.0/NULLIF(SUM(CAST(b.quantity AS REAL)),0) bp FROM balances b JOIN address_signals sg ON sg.addr=b.holder WHERE b.holder_type='address' AND CAST(b.quantity AS INTEGER)>0 GROUP BY b.asset HAVING SUM(CASE WHEN sg.is_burn=1 THEN 1 ELSE 0 END)>0) UPDATE asset_signals SET holders=adj.ch, top1_pct=COALESCE(adj.ct,0), burned_pct=adj.bp FROM adj WHERE adj.asset=asset_signals.asset` },
  { name: "asset_trades", sql: `WITH m AS (SELECT forward_asset asset,tx0_address a0,tx1_address a1,block_index b FROM order_matches UNION ALL SELECT backward_asset,tx0_address,tx1_address,block_index FROM order_matches) INSERT INTO asset_signals (asset,trades,self_trade_pct,first_trade_blk,last_trade_blk) SELECT asset,COUNT(*),SUM(CASE WHEN a0=a1 THEN 1.0 ELSE 0 END)*100.0/NULLIF(COUNT(*),0),MIN(b),MAX(b) FROM m WHERE asset IS NOT NULL GROUP BY asset ON CONFLICT(asset) DO UPDATE SET trades=excluded.trades,self_trade_pct=excluded.self_trade_pct,first_trade_blk=excluded.first_trade_blk,last_trade_blk=excluded.last_trade_blk` },
  { name: "asset_disp", sql: `INSERT INTO asset_signals (asset,dispenses,dispense_btc) SELECT asset,COUNT(*),COALESCE(SUM(btc_amount),0)/1e8 FROM dispenses WHERE asset IS NOT NULL GROUP BY asset ON CONFLICT(asset) DO UPDATE SET dispenses=excluded.dispenses,dispense_btc=excluded.dispense_btc` },
  // low-quality flag (full recompute, deterministic): intrinsic wash (>=50% self-trade among >=30 trades
  // — the trade floor avoids flagging legit assets with 1-2 coincidental self-trades) OR the curated list.
  { name: "asset_lowq", sql: `UPDATE asset_signals SET low_quality = CASE WHEN (self_trade_pct>=50 AND trades>=30) OR asset IN (${CURATED_LOWQ_SQL}) THEN 1 ELSE 0 END` },
  // propagate to siblings of BAD OPERATORS (issuers whose portfolio is >=50% flagged with >=4 flagged) —
  // guilt-by-association, but only for predominantly-bad operators (legit platforms like Assetic stay clean).
  { name: "asset_lowq_propagate", sql: `UPDATE asset_signals SET low_quality=1 WHERE low_quality=0 AND issuer IN (SELECT issuer FROM asset_signals WHERE issuer IS NOT NULL GROUP BY issuer HAVING SUM(low_quality)>=4 AND SUM(low_quality)*1.0/COUNT(*)>=0.5)` },
  // community quality (un-confounded, fairmint-safe): avg holder breadth + % of holders that are creators.
  // Scoped to >=3 holders (single-holder assets need no community signal; also keeps the write under D1's cap).
  { name: "asset_community", sql: `INSERT INTO asset_signals (asset, holder_breadth, pct_creator_holders) SELECT b.asset, AVG(COALESCE(sg.assets_held,0)), AVG(CASE WHEN sg.survived_assets>0 THEN 1.0 ELSE 0 END)*100 FROM balances b LEFT JOIN address_signals sg ON sg.addr=b.holder WHERE b.holder_type='address' AND CAST(b.quantity AS INTEGER)>0 GROUP BY b.asset HAVING COUNT(*)>=3 ON CONFLICT(asset) DO UPDATE SET holder_breadth=excluded.holder_breadth, pct_creator_holders=excluded.pct_creator_holders` },
  // clean (low-quality-excluded) per-address dispense/spend so merchant & spender boards aren't inflated by bridge flow
  { name: "addr_clean_disp", sql: `INSERT INTO address_signals (addr,clean_dispense_btc) SELECT d.source,SUM(d.btc_amount)/1e8 FROM dispenses d JOIN asset_signals a ON a.asset=d.asset WHERE a.low_quality=0 AND d.source IS NOT NULL GROUP BY d.source ON CONFLICT(addr) DO UPDATE SET clean_dispense_btc=excluded.clean_dispense_btc` },
  { name: "addr_clean_spent", sql: `INSERT INTO address_signals (addr,clean_btc_spent) SELECT d.destination,SUM(d.btc_amount)/1e8 FROM dispenses d JOIN asset_signals a ON a.asset=d.asset WHERE a.low_quality=0 AND d.destination IS NOT NULL GROUP BY d.destination ON CONFLICT(addr) DO UPDATE SET clean_btc_spent=excluded.clean_btc_spent` },
  // Burner signal: distinct CLEAN assets an address has sent to a known burn address (creators burning
  // their own supply — PEPECASH, Bitcorn — is a credible pro-holder/deflation act). Low-quality assets are
  // excluded so dusting spam into a burn can't farm the trait. Depends on is_burn + asset low_quality.
  { name: "addr_burned_out", sql: `INSERT INTO address_signals (addr,assets_burned) SELECT s.source,COUNT(DISTINCT s.asset) FROM sends s JOIN address_signals b ON b.addr=s.destination AND b.is_burn=1 LEFT JOIN asset_signals a ON a.asset=s.asset WHERE s.source IS NOT NULL AND COALESCE(a.low_quality,0)=0 GROUP BY s.source ON CONFLICT(addr) DO UPDATE SET assets_burned=excluded.assets_burned` },
  // Dispenser-operator trust = longevity-weighted track record (validated: at the top it's 100% legit
  // operators, 0 wash). span(months)*2 + repeat-operation(distinct dispensers)*1.5 + distinct buyers + a
  // small volume term. Longevity-weighted so a short-burst pump can't outrank a proven OG operator.
  { name: "addr_disp_trust", sql: `INSERT INTO address_signals (addr,disp_trust) SELECT o.source, 2*LN(1+(MAX(o.block_index)-MIN(o.block_index))/4320.0)+1.5*LN(1+COUNT(DISTINCT o.tx_hash))+LN(1+COALESCE(MAX(b.buyers),0))+0.5*LN(1+COALESCE(MAX(b.dx),0)) FROM dispensers o LEFT JOIN (SELECT source,COUNT(*) dx,COUNT(DISTINCT destination) buyers FROM dispenses WHERE source IS NOT NULL GROUP BY source) b ON b.source=o.source WHERE o.source IS NOT NULL GROUP BY o.source ON CONFLICT(addr) DO UPDATE SET disp_trust=excluded.disp_trust` },
  // Emblem Vault custody addresses: a Bitcoin address that backs an Emblem Vault NFT (the crawler fills
  // emblem_vaults). Flag them so they can be segmented out of "real holders" like exchanges/burns.
  { name: "ddl_emblem", sql: EMBLEM_DDL },
  { name: "addr_is_emblem", sql: `UPDATE address_signals SET is_emblem_vault = CASE WHEN addr IN (SELECT btc_address FROM emblem_vaults) THEN 1 ELSE 0 END` },
  // likely_service: a HEURISTIC (not curated) flag for service-like addresses — huge inbound degree, no
  // asset creation, not already-classified infra. Catches the unidentified-exchange/consolidation types
  // that would otherwise leak into "real user" views; it's "likely", not a confirmed exchange.
  { name: "addr_likely_service", sql: `UPDATE address_signals SET likely_service = CASE WHEN is_exchange=0 AND is_burn=0 AND is_emblem_vault=0 AND assets_issued=0 AND in_peers>=500 THEN 1 ELSE 0 END` },
  // Bitcoin Stamps / SRC-20 segmentation — stamp CREATORS (issued any stamp asset) + SRC-20 token deployers,
  // so "who makes stamps" is distinct from Rare Pepe issuers. Reads the ingest-written stamp/src20_deploy tags.
  { name: "addr_stamps_created", sql: `INSERT INTO address_signals (addr,stamps_created,src20_deploys) SELECT a.issuer, COUNT(DISTINCT CASE WHEN t.tag='stamp' THEN a.asset END), COUNT(DISTINCT CASE WHEN t.tag='src20_deploy' THEN a.asset END) FROM assets a JOIN tags t ON t.entity_type='asset' AND t.entity_id=a.asset AND t.tag IN ('stamp','src20_deploy') WHERE a.issuer IS NOT NULL GROUP BY a.issuer ON CONFLICT(addr) DO UPDATE SET stamps_created=excluded.stamps_created, src20_deploys=excluded.src20_deploys` },
  // Stamp COLLECTORS — distinct stamp assets held (segments stamp collectors from pepe/art collectors).
  { name: "addr_stamps_collected", sql: `INSERT INTO address_signals (addr,stamps_collected) SELECT b.holder, COUNT(DISTINCT b.asset) FROM balances b JOIN tags t ON t.entity_type='asset' AND t.entity_id=b.asset AND t.tag='stamp' WHERE b.holder_type='address' AND CAST(b.quantity AS INTEGER)>0 GROUP BY b.holder ON CONFLICT(addr) DO UPDATE SET stamps_collected=excluded.stamps_collected` },
  // BTNS protocol users — anyone who broadcast a BTNS command (tag only; we don't implement BTNS).
  { name: "addr_is_btns", sql: `UPDATE address_signals SET is_btns_user = CASE WHEN addr IN (SELECT DISTINCT source FROM broadcasts WHERE btns=1 AND source IS NOT NULL) THEN 1 ELSE 0 END` },
  // DEX trading activity — order-match participation per address (was an unrewarded reputation input).
  { name: "addr_dex_trades", sql: `INSERT INTO address_signals (addr,dex_trades) SELECT addr, COUNT(*) FROM (SELECT tx0_address addr FROM order_matches WHERE tx0_address IS NOT NULL UNION ALL SELECT tx1_address FROM order_matches WHERE tx1_address IS NOT NULL) GROUP BY addr ON CONFLICT(addr) DO UPDATE SET dex_trades=excluded.dex_trades` },
  // distinct market participants per asset — WASH-RESISTANT breadth (self-trading inflates `trades` but
  // can't fake distinct addresses). Strongest additive asset signal found (lift 10.3x vs vaulted).
  { name: "asset_distinct_traders", sql: `WITH m AS (SELECT forward_asset asset,tx0_address a FROM order_matches UNION ALL SELECT forward_asset,tx1_address FROM order_matches UNION ALL SELECT backward_asset,tx0_address FROM order_matches UNION ALL SELECT backward_asset,tx1_address FROM order_matches) INSERT INTO asset_signals (asset,distinct_traders) SELECT asset,COUNT(DISTINCT a) FROM m WHERE asset IS NOT NULL GROUP BY asset ON CONFLICT(asset) DO UPDATE SET distinct_traders=excluded.distinct_traders` },
  // distinct dispenser operators per asset (lift 3.98x — same "distinct participants" family).
  { name: "asset_distinct_dispensers", sql: `INSERT INTO asset_signals (asset,distinct_dispensers) SELECT asset,COUNT(DISTINCT source) FROM dispensers WHERE asset IS NOT NULL GROUP BY asset ON CONFLICT(asset) DO UPDATE SET distinct_dispensers=excluded.distinct_dispensers` },
  // holder sophistication: avg DEX activity of the asset's holders (lift 2.23x). Scoped >=3 holders (write cap).
  { name: "asset_holder_dex", sql: `INSERT INTO asset_signals (asset,avg_holder_dex) SELECT b.asset, AVG(COALESCE(sg.dex_trades,0)) FROM balances b LEFT JOIN address_signals sg ON sg.addr=b.holder WHERE b.holder_type='address' AND CAST(b.quantity AS INTEGER)>0 GROUP BY b.asset HAVING COUNT(*)>=3 ON CONFLICT(asset) DO UPDATE SET avg_holder_dex=excluded.avg_holder_dex` },
  // CURRENT ACTIVITY: trailing-~12mo trades+dispenses (the recency signal). Reset first so assets that fell out
  // of the window go to 0, then recount within the window.
  { name: "asset_recent_reset", sql: `UPDATE asset_signals SET recent_events=0` },
  { name: "asset_recent", sql: `INSERT INTO asset_signals (asset,recent_events) SELECT asset,COUNT(*) FROM (SELECT forward_asset asset FROM order_matches WHERE block_index>=(SELECT MAX(block_index)-52560 FROM blocks) UNION ALL SELECT backward_asset FROM order_matches WHERE block_index>=(SELECT MAX(block_index)-52560 FROM blocks) UNION ALL SELECT asset FROM dispenses WHERE block_index>=(SELECT MAX(block_index)-52560 FROM blocks)) WHERE asset IS NOT NULL GROUP BY asset ON CONFLICT(asset) DO UPDATE SET recent_events=excluded.recent_events` },
  // REALIZED VALUE: biggest BTC actually paid in a dispense, and biggest XCP that changed hands in a DEX match
  // (the XCP side of an asset/XCP order match). Captures worth, not volume — surfaces scarce-but-valuable grails.
  { name: "asset_max_disp_btc", sql: `INSERT INTO asset_signals (asset,max_dispense_btc) SELECT asset, MAX(btc_amount)/1e8 FROM dispenses WHERE btc_amount>0 AND asset IS NOT NULL GROUP BY asset ON CONFLICT(asset) DO UPDATE SET max_dispense_btc=excluded.max_dispense_btc` },
  { name: "asset_max_trade_xcp", sql: `INSERT INTO asset_signals (asset,max_trade_xcp) SELECT asset, MAX(x)/1e8 FROM (SELECT forward_asset asset, CAST(backward_quantity AS REAL) x FROM order_matches WHERE backward_asset='XCP' UNION ALL SELECT backward_asset, CAST(forward_quantity AS REAL) FROM order_matches WHERE forward_asset='XCP') WHERE asset IS NOT NULL GROUP BY asset ON CONFLICT(asset) DO UPDATE SET max_trade_xcp=excluded.max_trade_xcp` },
  // seed asset metadata + precomputed age (tip − first issuance) via UPDATE existing rows (a full INSERT...SELECT of all assets exceeds D1's per-statement write cap)
  { name: "asset_seed", sql: `UPDATE asset_signals SET asset_longname=(SELECT asset_longname FROM assets a WHERE a.asset=asset_signals.asset), issuer=(SELECT issuer FROM assets a WHERE a.asset=asset_signals.asset), divisible=(SELECT divisible FROM assets a WHERE a.asset=asset_signals.asset), locked=(SELECT locked FROM assets a WHERE a.asset=asset_signals.asset), age_blocks=((SELECT MAX(block_index) FROM blocks)-(SELECT first_issuance_block_index FROM assets a WHERE a.asset=asset_signals.asset)), recency_blocks=((SELECT MAX(block_index) FROM blocks)-last_trade_blk) WHERE EXISTS (SELECT 1 FROM assets a WHERE a.asset=asset_signals.asset)` },
  ...INDEX_DDL.map((sql, i) => ({ name: `idx_${i}`, sql })),
];

async function getState(env: Env, k: string): Promise<string | null> {
  return ((await env.DB.prepare(`SELECT value FROM indexer_state WHERE key=?`).bind(k).first<{ value: string }>())?.value) ?? null;
}
async function setState(env: Env, k: string, v: string): Promise<void> {
  await env.DB.prepare(`INSERT INTO indexer_state (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).bind(k, v).run();
}

/** Run the next `max` passes from the cursor; wraps to 0 when a full cycle completes. Bounded per call. */
export async function runSignalsStep(env: Env, max = 3): Promise<any> {
  let i = parseInt((await getState(env, "signals_step")) || "0", 10);
  if (i >= PASSES.length || i < 0) i = 0;
  const ran: Record<string, number> = {};
  const start = i;
  for (let k = 0; k < max && i < PASSES.length; k++, i++) {
    const r: any = await env.DB.prepare(PASSES[i].sql).run();
    ran[PASSES[i].name] = r?.meta?.rows_written ?? 0;
  }
  const done = i >= PASSES.length;
  await setState(env, "signals_step", done ? "0" : String(i));
  return { ran_passes: `${start}..${i - 1}`, of: PASSES.length, cycle_done: done, ran };
}
