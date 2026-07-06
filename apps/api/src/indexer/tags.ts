/**
 * Tag builder — materializes the polymorphic `tags` table (the categorical layer) from the numeric signal
 * tables + curated lists. Rebuilt after each signals refresh. Rules are DATA (edit here, like the scoring
 * config). Numeric detail stays in signal tables; tags are the categorical facts used for gating,
 * archetypes/badges, segmentation, the signal-test harness targets, and the curated validation set.
 */
import type { Env } from "../index";

// Each rule INSERTs matching entities under one tag (source='computed'). {TIP} is substituted with the
// chain tip so age-based tags don't need a correlated subquery.
const COMPUTED_RULES: { tag: string; sql: string }[] = [
  // ---- address classification (infra) ----
  { tag: "exchange",        sql: `SELECT 'address',addr,'exchange','computed' FROM address_signals WHERE is_exchange=1` },
  { tag: "deposit",         sql: `SELECT 'address',addr,'deposit','computed' FROM address_signals WHERE is_deposit=1` },
  { tag: "burn",            sql: `SELECT 'address',addr,'burn','computed' FROM address_signals WHERE is_burn=1` },
  { tag: "vault",           sql: `SELECT 'address',addr,'vault','computed' FROM address_signals WHERE is_emblem_vault=1` },
  // vault FUNDERS (sent assets into a vault) + CRACKERS (received assets out of a vault) — both are power-user
  // cohorts (lab 06-27: ~100x / ~65x baseline survived_assets). Tags for segmentation, not score weights
  // (the underlying quality is already captured by survived_assets/btc_fees/assets_held).
  { tag: "vault_funder",    sql: `SELECT DISTINCT 'address',s.source,'vault_funder','computed' FROM sends s JOIN emblem_vaults e ON e.btc_address=s.destination WHERE s.source IS NOT NULL` },
  { tag: "vault_cracker",   sql: `SELECT DISTINCT 'address',s.destination,'vault_cracker','computed' FROM sends s JOIN emblem_vaults e ON e.btc_address=s.source WHERE s.destination IS NOT NULL` },
  { tag: "service",         sql: `SELECT 'address',addr,'service','computed' FROM address_signals WHERE likely_service=1` },
  // ---- address behavior / archetypes ----
  { tag: "trader",          sql: `SELECT 'address',addr,'trader','computed' FROM address_signals WHERE dex_trades>=10` },
  { tag: "active_trader",   sql: `SELECT 'address',addr,'active_trader','computed' FROM address_signals WHERE dex_trades>=100` },
  { tag: "collector",       sql: `SELECT 'address',addr,'collector','computed' FROM address_signals WHERE assets_held>=100` },
  { tag: "whale",           sql: `SELECT 'address',addr,'whale','computed' FROM address_signals WHERE assets_held>=500` },
  { tag: "merchant",        sql: `SELECT 'address',addr,'merchant','computed' FROM address_signals WHERE dispenses>=5` },
  { tag: "creator",         sql: `SELECT 'address',addr,'creator','computed' FROM address_signals WHERE survived_assets>=1` },
  { tag: "prolific_creator",sql: `SELECT 'address',addr,'prolific_creator','computed' FROM address_signals WHERE survived_assets>=20` },
  { tag: "burner",          sql: `SELECT 'address',addr,'burner','computed' FROM address_signals WHERE assets_burned>=3` },
  { tag: "dividend_payer",  sql: `SELECT 'address',addr,'dividend_payer','computed' FROM address_signals WHERE dividends>=1` },
  { tag: "stamp_creator",   sql: `SELECT 'address',addr,'stamp_creator','computed' FROM address_signals WHERE stamps_created>=5` },
  { tag: "stamp_collector", sql: `SELECT 'address',addr,'stamp_collector','computed' FROM address_signals WHERE stamps_collected>=20` },
  { tag: "src20_deployer",  sql: `SELECT 'address',addr,'src20_deployer','computed' FROM address_signals WHERE src20_deploys>=1` },
  { tag: "btns_user",       sql: `SELECT 'address',addr,'btns_user','computed' FROM address_signals WHERE is_btns_user=1` },
  { tag: "og",              sql: `SELECT 'address',addr,'og','computed' FROM address_signals WHERE first_blk<={TIP}-43800 AND last_blk>=850000` },
  // NOTE: stamp classification tags (stamp/src20/src721/src101/src20_deploy) are NOT here — they are written
  // at ingest by the issuance handler with source='protocol' (the classifier base64-decodes the description,
  // which can't be expressed in SQL). The DELETE-and-rebuild below only touches source='computed', so those
  // ingest-written tags survive. See src/indexer/events/issuance.ts.
  // ---- asset behavior (aggregated features) ----
  { tag: "wash",            sql: `SELECT 'asset',asset,'wash','computed' FROM asset_signals WHERE low_quality=1` },
  { tag: "liquid",          sql: `SELECT 'asset',asset,'liquid','computed' FROM asset_signals WHERE trades>=10` },
  { tag: "durable",         sql: `SELECT 'asset',asset,'durable','computed' FROM asset_signals WHERE (last_trade_blk-first_trade_blk)>=43800` },
  { tag: "broad",           sql: `SELECT 'asset',asset,'broad','computed' FROM asset_signals WHERE holders>=50` },
  { tag: "vaulted",         sql: `SELECT 'asset',asset,'vaulted','computed' FROM asset_signals WHERE asset IN (SELECT b.asset FROM emblem_vaults e JOIN balances b ON b.holder=e.btc_address AND CAST(b.quantity AS INTEGER)>0)` },
  // NOTE: `has_media` (asset has real art in the CDN) is NOT computed here — it's a persistent tag with
  // source='media', written directly by the xcp-cdn ingest when it stores art (and backfilled once from the
  // R2 bucket). The DELETE-and-rebuild below only touches source='computed', so those survive. ~91k assets.
  // ---- asset type (from the assets table) ----
  { tag: "named",           sql: `SELECT 'asset',asset,'named','computed' FROM assets WHERE type='asset'` },
  { tag: "subasset",        sql: `SELECT 'asset',asset,'subasset','computed' FROM assets WHERE type='subasset'` },
  { tag: "numeric",         sql: `SELECT 'asset',asset,'numeric','computed' FROM assets WHERE type='numeric'` },
];

// Curated/labeled set — the validation anchors (source='curated'). Seed; expand by hand. These are the
// "known good/known bad" the harness/face-validity checks measure against. Keep high-confidence only.
// Grail validation set — known-iconic assets, the ground truth we test the objective score against (NOT a
// score override; the score stays objective). LESSON (2026-06-28): liquid grails (FDCARD/SATOSHICARD ~p98)
// the model ranks well, but ultra-rare 1/1 grails (WINKELPEPE 3 holders/3 trades, p62) are objectively
// indistinguishable from dead assets in CP data — grail-ness there = series membership, which must come from
// the canonical Rare Pepe / Fake Rare directories (off-chain but authoritative), imported as tags later.
const CURATED_TAGS: { type: string; id: string; tag: string }[] = [
  { type: "asset", id: "FDCARD", tag: "grail" }, { type: "asset", id: "SATOSHICARD", tag: "grail" },
  { type: "asset", id: "RAREPEPE", tag: "grail" }, { type: "asset", id: "DARKPILLPEPE", tag: "grail" },
  { type: "asset", id: "WINKELPEPE", tag: "grail" }, { type: "asset", id: "PEPEALASSAD", tag: "grail" },
  { type: "asset", id: "TEST", tag: "grail" }, { type: "asset", id: "NINJASUIT", tag: "grail" },
  { type: "asset", id: "PEPECASH", tag: "grail" }, { type: "asset", id: "FAKERARE", tag: "grail" },
];

export async function buildTags(env: Env): Promise<any> {
  const tip = Number((await env.DB.prepare(`SELECT MAX(block_index) m FROM blocks`).first<{ m: number }>())?.m) || 0;
  // refresh computed tags only (leave curated/manual intact)
  await env.DB.prepare(`DELETE FROM tags WHERE source='computed'`).run();
  let rules = 0;
  for (const r of COMPUTED_RULES) {
    await env.DB.prepare(`INSERT OR IGNORE INTO tags (entity_type,entity_id,tag,source) ${r.sql.replace(/\{TIP\}/g, String(tip))}`).run();
    rules++;
  }
  // upsert curated labels (idempotent)
  for (const t of CURATED_TAGS) {
    await env.DB.prepare(`INSERT OR IGNORE INTO tags (entity_type,entity_id,tag,source) VALUES (?,?,?,'curated')`).bind(t.type, t.id, t.tag).run();
  }
  const n = await env.DB.prepare(`SELECT COUNT(*) c FROM tags`).first<{ c: number }>();
  return { rules, curated: CURATED_TAGS.length, total_tags: n?.c ?? 0 };
}
