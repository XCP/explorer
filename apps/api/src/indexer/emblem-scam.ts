/** Emblem empty-shell and high-supply dump attribution, derived entirely from compact relations. */
import type { Env } from "#api/env";
import { getCoreStateInt, setCoreState } from "#api/indexer/core-state";

const HEAVY_DAILY = 144;
const HIGH_SUPPLY_DUMP = 1_000_000;

export const CLASSIFY_SCAM_SHELLS_SQL = `UPDATE emblem_vaults AS vault SET is_scam_shell=CASE WHEN
  vault.vault_kind='foreign' AND vault.claimed_asset_id IS NOT NULL AND COALESCE(vault.has_contents,0)=0
  AND EXISTS(SELECT 1 FROM emblem_vaults real
    WHERE real.vault_kind='single' AND real.contents_asset_id=vault.claimed_asset_id)
  THEN 1 ELSE 0 END
WHERE vault.is_scam_shell IS NOT CASE WHEN
  vault.vault_kind='foreign' AND vault.claimed_asset_id IS NOT NULL AND COALESCE(vault.has_contents,0)=0
  AND EXISTS(SELECT 1 FROM emblem_vaults real
    WHERE real.vault_kind='single' AND real.contents_asset_id=vault.claimed_asset_id)
  THEN 1 ELSE 0 END`;

export const REFRESH_SCAM_SELLERS_SQL = `INSERT INTO emblem_scam_sellers(seller_id,scams)
  SELECT sale.seller_id,COUNT(DISTINCT vault.token_id)
  FROM emblem_sales sale JOIN emblem_vaults vault
    ON vault.token_id=sale.token_id AND vault.contract_id=sale.contract_id
  WHERE vault.is_scam_shell=1 AND sale.seller_id IS NOT NULL GROUP BY sale.seller_id
  ON CONFLICT(seller_id) DO UPDATE SET scams=excluded.scams`;

export const CLEAR_STALE_SCAM_SELLERS_SQL = `UPDATE emblem_scam_sellers AS seller SET scams=0
  WHERE scams<>0 AND NOT EXISTS(
    SELECT 1 FROM emblem_sales sale JOIN emblem_vaults vault
      ON vault.token_id=sale.token_id AND vault.contract_id=sale.contract_id
    WHERE vault.is_scam_shell=1 AND sale.seller_id=seller.seller_id)`;

const ATTRIBUTION_CTE = `WITH edges AS (
    SELECT seller.seller_id,seller.scams,send.source_address_id funder_id,
      COUNT(DISTINCT vault.btc_address_id) funded_vaults
    FROM emblem_scam_sellers seller
    JOIN emblem_sales sale ON sale.seller_id=seller.seller_id
    JOIN emblem_vaults vault ON vault.token_id=sale.token_id AND vault.contract_id=sale.contract_id
      AND vault.vault_kind='single' AND vault.btc_address_id IS NOT NULL
    JOIN sends send ON send.destination_address_id=vault.btc_address_id
    JOIN asset_dictionary asset ON asset.asset_id=send.asset_id AND asset.asset<>'XCP'
    WHERE seller.scams>0 AND send.source_address_id IS NOT NULL
    GROUP BY seller.seller_id,send.source_address_id
  ), ranked AS (
    SELECT *,ROW_NUMBER() OVER(PARTITION BY seller_id ORDER BY funded_vaults DESC,funder_id) position
    FROM edges
  ), attribution AS (
    SELECT funder_id,SUM(scams) scams FROM ranked WHERE position=1 AND funded_vaults>=2 GROUP BY funder_id
  )`;

export const ENSURE_SHELL_SIGNAL_ROWS_SQL = `${ATTRIBUTION_CTE}
  INSERT OR IGNORE INTO address_signals(address_id) SELECT funder_id FROM attribution`;

export const REFRESH_SHELL_SIGNALS_SQL = `${ATTRIBUTION_CTE}
  UPDATE address_signals AS signal SET shell_scams=COALESCE(
    (SELECT attribution.scams FROM attribution WHERE attribution.funder_id=signal.address_id),0)
  WHERE signal.shell_scams IS NOT COALESCE(
    (SELECT attribution.scams FROM attribution WHERE attribution.funder_id=signal.address_id),0)`;

export const CLASSIFY_DUMP_VAULTS_SQL = `UPDATE emblem_vaults AS vault SET is_dump=CASE WHEN
  vault.vault_kind='single' AND COALESCE(vault.contents_qty,1)<=1
  AND EXISTS(SELECT 1 FROM asset_signals signal
    WHERE signal.asset_id=vault.contents_asset_id AND signal.supply>=${HIGH_SUPPLY_DUMP})
  AND EXISTS(SELECT 1 FROM emblem_sales sale
    WHERE sale.token_id=vault.token_id AND sale.contract_id=vault.contract_id)
  THEN 1 ELSE 0 END
WHERE vault.is_dump IS NOT CASE WHEN
  vault.vault_kind='single' AND COALESCE(vault.contents_qty,1)<=1
  AND EXISTS(SELECT 1 FROM asset_signals signal
    WHERE signal.asset_id=vault.contents_asset_id AND signal.supply>=${HIGH_SUPPLY_DUMP})
  AND EXISTS(SELECT 1 FROM emblem_sales sale
    WHERE sale.token_id=vault.token_id AND sale.contract_id=vault.contract_id)
  THEN 1 ELSE 0 END`;

const DUMP_CTE = `WITH attribution AS (
    SELECT send.source_address_id address_id,COUNT(DISTINCT vault.token_id) scams
    FROM emblem_vaults vault JOIN sends send
      ON send.destination_address_id=vault.btc_address_id AND send.asset_id=vault.contents_asset_id
    JOIN asset_dictionary asset ON asset.asset_id=send.asset_id AND asset.asset<>'XCP'
    WHERE vault.is_dump=1 AND send.source_address_id IS NOT NULL GROUP BY send.source_address_id
  )`;

export const ENSURE_DUMP_SIGNAL_ROWS_SQL = `${DUMP_CTE}
  INSERT OR IGNORE INTO address_signals(address_id) SELECT address_id FROM attribution`;

export const REFRESH_DUMP_SIGNALS_SQL = `${DUMP_CTE}
  UPDATE address_signals AS signal SET dump_scams=COALESCE(
    (SELECT attribution.scams FROM attribution WHERE attribution.address_id=signal.address_id),0)
  WHERE signal.dump_scams IS NOT COALESCE(
    (SELECT attribution.scams FROM attribution WHERE attribution.address_id=signal.address_id),0)`;

export async function buildScamAttribution(env: Env, force = false): Promise<Record<string, unknown>> {
  const tip = Number(
    (await env.CORE_DB.prepare(`SELECT MAX(block_index) block FROM blocks`).first<{ block: number }>())?.block ?? 0,
  );
  const last = await getCoreStateInt(env.CORE_DB, "scam_attrib_block");
  if (!force && tip - last < HEAVY_DAILY) return { skipped: "not due", tip, last };

  await env.CORE_DB.batch([
    env.CORE_DB.prepare(CLASSIFY_SCAM_SHELLS_SQL),
    env.CORE_DB.prepare(REFRESH_SCAM_SELLERS_SQL),
    env.CORE_DB.prepare(CLEAR_STALE_SCAM_SELLERS_SQL),
  ]);
  await env.CORE_DB.prepare(ENSURE_SHELL_SIGNAL_ROWS_SQL).run();
  await env.CORE_DB.prepare(REFRESH_SHELL_SIGNALS_SQL).run();
  await env.CORE_DB.prepare(CLASSIFY_DUMP_VAULTS_SQL).run();
  await env.CORE_DB.prepare(ENSURE_DUMP_SIGNAL_ROWS_SQL).run();
  await env.CORE_DB.prepare(REFRESH_DUMP_SIGNALS_SQL).run();
  await setCoreState(env.CORE_DB, "scam_attrib_block", tip);

  const summary = await env.CORE_DB.prepare(
    `SELECT
      (SELECT COUNT(*) FROM emblem_vaults WHERE is_scam_shell=1) genuine_shells,
      (SELECT COUNT(*) FROM emblem_scam_sellers WHERE scams>0) scam_sellers,
      (SELECT COUNT(*) FROM address_signals WHERE shell_scams>0) btc_identities,
      (SELECT COALESCE(SUM(shell_scams),0) FROM address_signals) attributed_shells,
      (SELECT COUNT(*) FROM emblem_vaults WHERE is_dump=1) dump_vaults,
      (SELECT COUNT(*) FROM address_signals WHERE dump_scams>0) dump_actors,
      (SELECT COALESCE(SUM(dump_scams),0) FROM address_signals) attributed_dumps`,
  ).first<Record<string, number>>();
  return { tip, ...(summary ?? {}) };
}
