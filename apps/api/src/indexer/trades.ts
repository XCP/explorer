/**
 * `trades` — the polymorphic sales ledger. One row per trade across every venue (DEX order-matches, dispenses,
 * Emblem-vault NFT sales), normalized to a common shape so the unified feed is a flat read, not a runtime union:
 *
 *   venue · asset (the CP card) · block_time · quantity · currency · total · price(gen) · usd_value · buyer · seller · tx
 *
 * Materialized incrementally from the source tables (on-chain venues by CP block cursor; Emblem re-folded from
 * the emblem_sales staging table each pass — idempotent via INSERT OR IGNORE on the (venue,ref) key). `usd_value`
 * is filled here only where it's free (USDC sales); XCP/BTC/ETH→USD backfill is a later pass over a price feed.
 */
import type { Env } from "../index";

export const TRADES_DDL = `CREATE TABLE IF NOT EXISTS trades (
  venue       TEXT NOT NULL,               -- 'dex' | 'dispense' | 'emblem'
  ref         TEXT NOT NULL,               -- dedupe key within venue (source row id / tx_log)
  asset       TEXT,                        -- the CP card (NULL if unattributable)
  block_time  INTEGER,                     -- unix seconds (Emblem: approximated from ETH block)
  block_index INTEGER,                     -- CP block, or ETH block_number for Emblem
  quantity    REAL,                        -- units of asset
  currency    TEXT,                        -- 'XCP' | 'BTC' | 'ETH' | 'USDC'
  total       REAL,                        -- price paid, in currency
  price       REAL GENERATED ALWAYS AS (CASE WHEN quantity > 0 THEN total / quantity END) VIRTUAL,
  usd_value   REAL,                        -- total in USD (nullable; filled later)
  buyer TEXT, seller TEXT, tx_hash TEXT,
  PRIMARY KEY (venue, ref)
)`;
const TRADES_IDX = [
  `CREATE INDEX IF NOT EXISTS idx_trades_time ON trades(block_time DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_trades_asset ON trades(asset, block_time DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_trades_venue ON trades(venue, block_time DESC)`,
];

// Payment-token map (ETH-family all 18-dec and value-equivalent; USDC is 6-dec and ≈USD). Derived from the
// observed getNFTSales token distribution: native-ETH, WETH, the Blur ETH-pool, a Blur router, and USDC.
const ETH_TOKENS = [
  "0x0000000000000000000000000000000000000000", // native ETH
  "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2", // WETH
  "0x0000000000a39bb272e79075ade125fd351887ac", // Blur ETH pool
  "0x223e16c52436cab2ca9fe37087c79986a288fffa", // Blur
];
const USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";

const WINDOW = 250_000; // CP blocks materialized per on-chain venue per call

async function getState(env: Env, k: string): Promise<number> {
  return parseInt(((await env.DB.prepare(`SELECT value FROM indexer_state WHERE key=?`).bind(k).first<{ value: string }>())?.value) || "0", 10);
}
async function setState(env: Env, k: string, v: number): Promise<void> {
  await env.DB.prepare(`INSERT INTO indexer_state (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).bind(k, String(v)).run();
}

/** DEX: an order_match where one side is XCP/BTC is a priced sale — that side is the money, the other the asset. */
function dexSql(lo: number, hi: number) {
  const money = `om.forward_asset IN ('XCP','BTC')`;
  return `INSERT OR IGNORE INTO trades (venue,ref,asset,block_time,block_index,quantity,currency,total,buyer,seller,tx_hash)
    SELECT 'dex', CAST(om.id AS TEXT),
      CASE WHEN ${money} THEN om.backward_asset ELSE om.forward_asset END,
      om.block_time, om.block_index,
      (CASE WHEN ${money} THEN om.backward_quantity ELSE om.forward_quantity END) * 1.0
        / (CASE WHEN a.divisible = 1 THEN 1e8 ELSE 1 END),
      CASE WHEN ${money} THEN om.forward_asset ELSE om.backward_asset END,
      (CASE WHEN ${money} THEN om.forward_quantity ELSE om.backward_quantity END) * 1.0 / 1e8,
      CASE WHEN ${money} THEN om.tx0_address ELSE om.tx1_address END,   -- buyer = money-giver
      CASE WHEN ${money} THEN om.tx1_address ELSE om.tx0_address END,   -- seller = asset-giver
      om.tx1_hash
    FROM order_matches om
    LEFT JOIN assets a ON a.asset = (CASE WHEN ${money} THEN om.backward_asset ELSE om.forward_asset END)
    WHERE om.status='completed' AND (om.forward_asset IN ('XCP','BTC') OR om.backward_asset IN ('XCP','BTC'))
      AND om.block_index > ${lo} AND om.block_index <= ${hi}`;
}

/** Dispense: asset dispensed for BTC. btc_amount is raw sats (no normalized column); destination bought, source sold. */
function dispenseSql(lo: number, hi: number) {
  return `INSERT OR IGNORE INTO trades (venue,ref,asset,block_time,block_index,quantity,currency,total,buyer,seller,tx_hash)
    SELECT 'dispense', CAST(d.id AS TEXT), d.asset, d.block_time, d.block_index,
      CAST(d.dispense_quantity_normalized AS REAL), 'BTC', d.btc_amount * 1.0 / 1e8,
      d.destination, d.source, d.tx_hash
    FROM dispenses d
    WHERE d.btc_amount > 0 AND d.block_index > ${lo} AND d.block_index <= ${hi}`;
}

/** Emblem: NFT sale (qty 1 vault) → the wrapped CP card via emblem_vaults.btc_address → its primary balance.
 *  ETH block→time is approximated (piecewise around the merge); price/currency from the token map. */
function emblemSql() {
  const eth = ETH_TOKENS.map((t) => `'${t}'`).join(",");
  const isUsdc = `es.token_addr = '${USDC}'`;
  return `INSERT OR IGNORE INTO trades (venue,ref,asset,block_time,block_index,quantity,currency,total,usd_value,buyer,seller,tx_hash)
    SELECT 'emblem', es.tx_hash || '_' || es.log_index,
      (SELECT b.asset FROM balances b WHERE b.holder = ev.btc_address AND b.asset <> 'XCP'
         ORDER BY CAST(b.quantity AS REAL) DESC LIMIT 1),
      CASE WHEN es.block_number >= 15537394 THEN 1663224162 + (es.block_number - 15537394) * 12
           ELSE CAST(1438269973 + es.block_number * 13.15 AS INTEGER) END,
      es.block_number, 1.0,
      CASE WHEN ${isUsdc} THEN 'USDC' ELSE 'ETH' END,
      CAST(es.price_raw AS REAL) / (CASE WHEN ${isUsdc} THEN 1e6 ELSE 1e18 END),
      CASE WHEN ${isUsdc} THEN CAST(es.price_raw AS REAL) / 1e6 ELSE NULL END,
      es.buyer, es.seller, es.tx_hash
    FROM emblem_sales es
    JOIN emblem_vaults ev ON ev.token_id = es.token_id AND ev.contract = es.contract
    WHERE ev.btc_address IS NOT NULL AND CAST(es.price_raw AS REAL) > 0
      AND es.token_addr IN (${eth}, '${USDC}')`;
}

/** Advance the trades materialization one bounded step. On-chain venues walk a CP-block window per call;
 *  Emblem is re-folded whole (small, idempotent). Loop until dex_done && dispense_done. */
export async function buildTrades(env: Env): Promise<any> {
  await env.DB.prepare(TRADES_DDL).run();
  for (const s of TRADES_IDX) await env.DB.prepare(s).run();
  const tip = Number((await env.DB.prepare(`SELECT MAX(block_index) m FROM blocks`).first<{ m: number }>())?.m) || 0;
  const out: any = { tip };

  const dcur = await getState(env, "trades_cur_dex");
  if (dcur < tip) {
    const hi = Math.min(dcur + WINDOW, tip);
    await env.DB.prepare(dexSql(dcur, hi)).run();
    await setState(env, "trades_cur_dex", hi);
    out.dex = { from: dcur, to: hi };
  }
  out.dex_done = (await getState(env, "trades_cur_dex")) >= tip;

  const pcur = await getState(env, "trades_cur_dispense");
  if (pcur < tip) {
    const hi = Math.min(pcur + WINDOW, tip);
    await env.DB.prepare(dispenseSql(pcur, hi)).run();
    await setState(env, "trades_cur_dispense", hi);
    out.dispense = { from: pcur, to: hi };
  }
  out.dispense_done = (await getState(env, "trades_cur_dispense")) >= tip;

  // Emblem: re-fold the staging table every pass (idempotent; grows as the sales backfill continues).
  await env.DB.prepare(emblemSql()).run();

  const counts = await env.DB.prepare(`SELECT venue, COUNT(*) n FROM trades GROUP BY venue`).all<{ venue: string; n: number }>();
  out.counts = Object.fromEntries((counts.results || []).map((r) => [r.venue, r.n]));
  out.done = out.dex_done && out.dispense_done;
  return out;
}
