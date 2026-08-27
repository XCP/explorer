import { getCoreStateInt, setCoreState } from "#api/indexer/core-state";

const DIRTY_BATCH = 400;
const RECONCILE_BATCH = 1_000;
const RECONCILE_BLOCK_INTERVAL = 6;

export interface VaultContentRow {
  rowid: number;
  contract_id: number;
  token_id: string;
  btc_address_id: number;
  btc_address: string;
}

export interface VaultContentBatch {
  rows: VaultContentRow[];
  source: "dirty" | "reconcile";
  cursor: number;
  tip: number;
}

const checkedRowids = (rows: VaultContentRow[]): string =>
  rows
    .map(({ rowid }) => {
      if (!Number.isSafeInteger(rowid) || rowid <= 0) throw new Error("invalid Emblem vault rowid");
      return rowid;
    })
    .join(",");

const dirtyVaults = async (db: D1Database): Promise<VaultContentRow[]> =>
  (
    await db
      .prepare(
        // The dirty queue is usually empty. CROSS JOIN keeps it as the outer
        // loop instead of letting SQLite walk every vault on an idle tick.
        `SELECT vault.rowid,vault.contract_id,vault.token_id,vault.btc_address_id,address.address btc_address
         FROM emblem_vault_contents_dirty dirty
         CROSS JOIN emblem_vaults vault
           ON vault.contract_id=dirty.contract_id AND vault.token_id=dirty.token_id
         JOIN address_dictionary address ON address.address_id=vault.btc_address_id
         ORDER BY vault.rowid LIMIT ?`,
      )
      .bind(DIRTY_BATCH)
      .all<VaultContentRow>()
  ).results || [];

const claimDirtyVaults = async (db: D1Database, rows: VaultContentRow[]): Promise<void> => {
  const rowids = checkedRowids(rows);
  if (!rowids) throw new Error("cannot claim an empty Emblem vault batch");
  await db
    .prepare(
      `DELETE FROM emblem_vault_contents_dirty
       WHERE EXISTS (
         SELECT 1 FROM emblem_vaults vault
          WHERE vault.rowid IN (${rowids})
            AND vault.contract_id=emblem_vault_contents_dirty.contract_id
            AND vault.token_id=emblem_vault_contents_dirty.token_id
       )`,
    )
    .run();
};

export const restoreVaultContentBatch = async (db: D1Database, batch: VaultContentBatch): Promise<void> => {
  if (batch.source !== "dirty") return;
  const statements = batch.rows.map((row) =>
    db
      .prepare(
        `INSERT INTO emblem_vault_contents_dirty(contract_id,token_id)
         SELECT ?1,?2 WHERE NOT EXISTS (
           SELECT 1 FROM emblem_vault_contents_dirty WHERE contract_id=?1 AND token_id=?2
         )`,
      )
      .bind(row.contract_id, row.token_id),
  );
  for (let i = 0; i < statements.length; i += 50) await db.batch(statements.slice(i, i + 50));
};

export const completeVaultContentBatch = async (db: D1Database, batch: VaultContentBatch): Promise<void> => {
  if (batch.source !== "reconcile") return;
  const cursor = batch.rows.length ? batch.rows[batch.rows.length - 1].rowid : 0;
  await setCoreState(db, "vault_contents_cursor", cursor);
  await setCoreState(db, "vault_contents_reconcile_block", batch.tip);
};

export const selectVaultContentBatch = async (db: D1Database): Promise<VaultContentBatch | null> => {
  const dirty = await dirtyVaults(db);
  if (dirty.length) {
    await claimDirtyVaults(db, dirty);
    return { rows: dirty, source: "dirty", cursor: 0, tip: 0 };
  }

  const tip = (await db.prepare(`SELECT MAX(block_index) tip FROM blocks`).first<{ tip: number }>())?.tip ?? 0;
  const lastReconcileBlock = await getCoreStateInt(db, "vault_contents_reconcile_block");
  if (tip <= 0 || tip < lastReconcileBlock + RECONCILE_BLOCK_INTERVAL) return null;

  const cursor = await getCoreStateInt(db, "vault_contents_cursor");
  const rows =
    (
      await db
        .prepare(
          `SELECT vault.rowid,vault.contract_id,vault.token_id,vault.btc_address_id,address.address btc_address
           FROM emblem_vaults vault JOIN address_dictionary address ON address.address_id=vault.btc_address_id
           WHERE vault.rowid>? ORDER BY vault.rowid LIMIT ?`,
        )
        .bind(cursor, RECONCILE_BATCH)
        .all<VaultContentRow>()
    ).results || [];
  return { rows, source: "reconcile", cursor, tip };
};
