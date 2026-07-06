/**
 * Tag builder — materializes the polymorphic `tags` table (the categorical layer) from the numeric signal
 * tables + curated lists. Rules are DATA (edit here, like the scoring config). Numeric detail stays in signal
 * tables; tags are the categorical facts used for gating, archetypes/badges, segmentation, the signal-test
 * harness targets, and the curated validation set.
 *
 * TWO builders over the SAME rules (mirrors signals.ts' full/scoped pair):
 *   - buildTags(env)                     — FULL self-healing rebuild: DELETE all source='computed' rows, re-run
 *                                          every rule. Ground truth; run on a daily block-delta gate + on demand.
 *   - buildTagsScoped(env, {assets,addrs}) — PER-BLOCK dirty rebuild: DELETE + re-run the behavioral rules only
 *                                          for the entities the cascade touched this tick. Bounded by what
 *                                          changed, not table size. Intrinsic asset-type tags are append-only
 *                                          (INSERT OR IGNORE, never deleted — an asset's type never changes).
 *
 * Each rule carries `key` = the SELECT column that equals entity_id, so the scoped variant is just the full
 * SQL with ` AND <key> IN (?,?,…)` appended (every rule ends on a WHERE-condition, so the append is safe).
 */
import type { Env } from "../index";

interface Rule { tag: string; key: string; sql: string }

// ---- ADDRESS rules (source='computed'). {TIP} is substituted with the chain tip so age-based tags don't
// need a correlated subquery. `key` is the column that carries the tagged address. ----
const ADDR_RULES: Rule[] = [
  // ---- address classification (infra) ----
  { tag: "exchange",        key: "addr",          sql: `SELECT 'address',addr,'exchange','computed' FROM address_signals WHERE is_exchange=1` },
  { tag: "deposit",         key: "addr",          sql: `SELECT 'address',addr,'deposit','computed' FROM address_signals WHERE is_deposit=1` },
  { tag: "burn",            key: "addr",          sql: `SELECT 'address',addr,'burn','computed' FROM address_signals WHERE is_burn=1` },
  { tag: "vault",           key: "addr",          sql: `SELECT 'address',addr,'vault','computed' FROM address_signals WHERE is_emblem_vault=1` },
  // vault FUNDERS (sent assets into a vault) + CRACKERS (received assets out of a vault) — both are power-user
  // cohorts (lab 06-27: ~100x / ~65x baseline survived_assets). Tags for segmentation, not score weights
  // (the underlying quality is already captured by survived_assets/btc_fees/assets_held).
  { tag: "vault_funder",    key: "s.source",      sql: `SELECT DISTINCT 'address',s.source,'vault_funder','computed' FROM sends s JOIN emblem_vaults e ON e.btc_address=s.destination WHERE s.source IS NOT NULL` },
  { tag: "vault_cracker",   key: "s.destination", sql: `SELECT DISTINCT 'address',s.destination,'vault_cracker','computed' FROM sends s JOIN emblem_vaults e ON e.btc_address=s.source WHERE s.destination IS NOT NULL` },
  { tag: "service",         key: "addr",          sql: `SELECT 'address',addr,'service','computed' FROM address_signals WHERE likely_service=1` },
  // ---- address behavior / archetypes ----
  { tag: "trader",          key: "addr",          sql: `SELECT 'address',addr,'trader','computed' FROM address_signals WHERE dex_trades>=10` },
  { tag: "active_trader",   key: "addr",          sql: `SELECT 'address',addr,'active_trader','computed' FROM address_signals WHERE dex_trades>=100` },
  { tag: "collector",       key: "addr",          sql: `SELECT 'address',addr,'collector','computed' FROM address_signals WHERE assets_held>=100` },
  { tag: "whale",           key: "addr",          sql: `SELECT 'address',addr,'whale','computed' FROM address_signals WHERE assets_held>=500` },
  { tag: "merchant",        key: "addr",          sql: `SELECT 'address',addr,'merchant','computed' FROM address_signals WHERE dispenses>=5` },
  { tag: "creator",         key: "addr",          sql: `SELECT 'address',addr,'creator','computed' FROM address_signals WHERE survived_assets>=1` },
  { tag: "prolific_creator",key: "addr",          sql: `SELECT 'address',addr,'prolific_creator','computed' FROM address_signals WHERE survived_assets>=20` },
  { tag: "burner",          key: "addr",          sql: `SELECT 'address',addr,'burner','computed' FROM address_signals WHERE assets_burned>=3` },
  { tag: "dividend_payer",  key: "addr",          sql: `SELECT 'address',addr,'dividend_payer','computed' FROM address_signals WHERE dividends>=1` },
  { tag: "stamp_creator",   key: "addr",          sql: `SELECT 'address',addr,'stamp_creator','computed' FROM address_signals WHERE stamps_created>=5` },
  { tag: "stamp_collector", key: "addr",          sql: `SELECT 'address',addr,'stamp_collector','computed' FROM address_signals WHERE stamps_collected>=20` },
  { tag: "src20_deployer",  key: "addr",          sql: `SELECT 'address',addr,'src20_deployer','computed' FROM address_signals WHERE src20_deploys>=1` },
  { tag: "btns_user",       key: "addr",          sql: `SELECT 'address',addr,'btns_user','computed' FROM address_signals WHERE is_btns_user=1` },
  { tag: "og",              key: "addr",          sql: `SELECT 'address',addr,'og','computed' FROM address_signals WHERE first_blk<={TIP}-43800 AND last_blk>=850000` },
];
// NOTE: stamp classification tags (stamp/src20/src721/src101/src20_deploy) are NOT here — they are written
// at ingest by the issuance handler with source='protocol' (the classifier base64-decodes the description,
// which can't be expressed in SQL). The DELETE-and-rebuild below only touches source='computed', so those
// ingest-written tags survive. See src/indexer/events/issuance.ts.

// ---- ASSET behavioral rules (aggregated features; can gain/lose the tag as features move) ----
const ASSET_RULES: Rule[] = [
  { tag: "wash",     key: "asset", sql: `SELECT 'asset',asset,'wash','computed' FROM asset_signals WHERE low_quality=1` },
  { tag: "liquid",   key: "asset", sql: `SELECT 'asset',asset,'liquid','computed' FROM asset_signals WHERE trades>=10` },
  { tag: "durable",  key: "asset", sql: `SELECT 'asset',asset,'durable','computed' FROM asset_signals WHERE (last_trade_blk-first_trade_blk)>=43800` },
  { tag: "broad",    key: "asset", sql: `SELECT 'asset',asset,'broad','computed' FROM asset_signals WHERE holders>=50` },
  { tag: "vaulted",  key: "asset", sql: `SELECT 'asset',asset,'vaulted','computed' FROM asset_signals WHERE asset IN (SELECT b.asset FROM emblem_vaults e JOIN balances b ON b.holder=e.btc_address AND CAST(b.quantity AS INTEGER)>0)` },
];
// NOTE: `has_media` (asset has real art in the CDN) is NOT computed here — it's a persistent tag with
// source='media', written directly by the xcp-cdn ingest when it stores art (and backfilled once from the
// R2 bucket). The DELETE-and-rebuild below only touches source='computed', so those survive. ~91k assets.

// ---- ASSET-TYPE rules (from the assets table). INTRINSIC + append-only: an asset's type never changes once
// issued, so these are never DELETEd in the scoped path — just INSERT OR IGNORE'd for newly-seen assets. ----
const ASSET_TYPE_RULES: Rule[] = [
  { tag: "named",    key: "asset", sql: `SELECT 'asset',asset,'named','computed' FROM assets WHERE type='asset'` },
  { tag: "subasset", key: "asset", sql: `SELECT 'asset',asset,'subasset','computed' FROM assets WHERE type='subasset'` },
  { tag: "numeric",  key: "asset", sql: `SELECT 'asset',asset,'numeric','computed' FROM assets WHERE type='numeric'` },
];

// Every computed rule, in the original (address → asset-behavior → asset-type) order — used by the FULL rebuild.
const COMPUTED_RULES: Rule[] = [...ADDR_RULES, ...ASSET_RULES, ...ASSET_TYPE_RULES];

// Behavioral tag names by scope — the scoped rebuild DELETEs exactly these for dirty entities (leaving
// intrinsic asset-type tags + protocol/curated/manual/collection/media tags untouched).
const ADDR_BEHAVIORAL_TAGS = ADDR_RULES.map((r) => `'${r.tag}'`).join(",");
const ASSET_BEHAVIORAL_TAGS = ASSET_RULES.map((r) => `'${r.tag}'`).join(",");

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

const KEY_CHUNK = 800; // dirty keys per statement (SQLite var limit is 999)
const chunk = <T>(a: T[], n: number): T[][] => { const o: T[][] = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };

async function tipBlock(env: Env): Promise<number> {
  return Number((await env.DB.prepare(`SELECT MAX(block_index) m FROM blocks`).first<{ m: number }>())?.m) || 0;
}

/**
 * FULL self-healing rebuild (canonical): drop every computed tag and re-derive from the rules. Curated /
 * protocol / manual / collection / media tags (other `source` values) are left untouched. Idempotent.
 */
export async function buildTags(env: Env): Promise<any> {
  const tip = await tipBlock(env);
  // refresh computed tags only (leave curated/manual/protocol/collection/media intact)
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

/**
 * PER-BLOCK DIRTY rebuild (Layer B) — the same rules, scoped to the entities the cascade touched this tick.
 * For each dirty chunk: DELETE its behavioral computed tags, then re-run every behavioral rule filtered to
 * that chunk (an entity that stopped matching a rule loses the tag — same guarantee as the full rebuild, but
 * only for dirty entities; the daily full rebuild self-heals anything the dirty set missed). Intrinsic
 * asset-type tags are append-only, so they are INSERT OR IGNORE'd (never DELETEd) for the dirty assets —
 * this is also how a freshly-issued asset (dirtied by its issuance) gets its named/subasset/numeric tag.
 *
 * Takes the dirty sets straight from runSignalsCascade's return (one derivation, shared with the signals
 * cascade) so tags and signals are always rebuilt over the exact same entities.
 */
export async function buildTagsScoped(env: Env, dirty: { assets: string[]; addrs: string[] }): Promise<any> {
  const tip = await tipBlock(env);
  const sub = (sql: string) => sql.replace(/\{TIP\}/g, String(tip));
  let addrWrote = 0, assetWrote = 0, typeWrote = 0;

  // --- dirty ADDRESSES: replace their behavioral tags ---
  for (const part of chunk(dirty.addrs, KEY_CHUNK)) {
    if (!part.length) continue;
    const ph = part.map(() => "?").join(",");
    await env.DB.prepare(`DELETE FROM tags WHERE source='computed' AND entity_type='address' AND tag IN (${ADDR_BEHAVIORAL_TAGS}) AND entity_id IN (${ph})`).bind(...part).run();
    for (const r of ADDR_RULES) {
      const res: any = await env.DB.prepare(`INSERT OR IGNORE INTO tags (entity_type,entity_id,tag,source) ${sub(r.sql)} AND ${r.key} IN (${ph})`).bind(...part).run();
      addrWrote += res?.meta?.rows_written ?? 0;
    }
  }

  // --- dirty ASSETS: replace their behavioral tags, then ensure their intrinsic type tag ---
  for (const part of chunk(dirty.assets, KEY_CHUNK)) {
    if (!part.length) continue;
    const ph = part.map(() => "?").join(",");
    await env.DB.prepare(`DELETE FROM tags WHERE source='computed' AND entity_type='asset' AND tag IN (${ASSET_BEHAVIORAL_TAGS}) AND entity_id IN (${ph})`).bind(...part).run();
    for (const r of ASSET_RULES) {
      const res: any = await env.DB.prepare(`INSERT OR IGNORE INTO tags (entity_type,entity_id,tag,source) ${sub(r.sql)} AND ${r.key} IN (${ph})`).bind(...part).run();
      assetWrote += res?.meta?.rows_written ?? 0;
    }
    for (const r of ASSET_TYPE_RULES) {
      const res: any = await env.DB.prepare(`INSERT OR IGNORE INTO tags (entity_type,entity_id,tag,source) ${r.sql} AND ${r.key} IN (${ph})`).bind(...part).run();
      typeWrote += res?.meta?.rows_written ?? 0;
    }
  }

  return { dirty_addrs: dirty.addrs.length, dirty_assets: dirty.assets.length, addr_tags: addrWrote, asset_tags: assetWrote, type_tags: typeWrote };
}
