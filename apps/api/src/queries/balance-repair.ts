import { balanceQuantity, normalize } from "#api/indexer/codec";

export interface BalanceRepair {
  balanceId: number;
  address: string;
  asset: string;
  previous: string;
  expected: string;
  eventIndex: number;
  divisible: boolean;
}
export interface SnapshotRepair {
  snapshotId: number;
  address: string;
  asset: string;
  previous: string;
  expected: string;
  eventIndex: number;
}

/** Operator only. Every precondition and both tables commit in one D1 batch.
 * No cursor, high-water, or ledger edits. Failed guards roll back the batch. */
export function balanceRepairStatements(
  db: D1Database,
  lock: string,
  cursor: string,
  balances: BalanceRepair[],
  snapshots: SnapshotRepair[],
): D1PreparedStatement[] {
  if (!balances.length || 1 + 2 * (balances.length + snapshots.length) > 90) throw new Error("Repair batch bound");
  const guard = (predicate: string, binds: unknown[]) =>
    db
      .prepare(`SELECT CASE WHEN ${predicate} THEN 1 ELSE json('balance repair precondition failed') END verified`)
      .bind(...binds);
  const statements = [
    guard(
      `(SELECT value FROM core_state WHERE key='replay_lock')=?
    AND (SELECT value FROM core_state WHERE key='last_event_index')=?
    AND NOT EXISTS(SELECT 1 FROM core_state WHERE key='rollback_to')`,
      [lock, cursor],
    ),
  ];
  for (const row of balances) {
    const expected = balanceQuantity(row.expected).toString();
    if (expected === row.previous) throw new Error("Unchanged balance in repair plan");
    statements.push(
      guard(
        `EXISTS(SELECT 1 FROM balances b
      WHERE b.balance_id=? AND b.quantity=? AND b.updated_event_index=?
        AND b.address_id=(SELECT address_id FROM address_dictionary WHERE address=?)
        AND b.asset_id=(SELECT asset_id FROM asset_dictionary WHERE asset=?))
      AND NOT EXISTS(SELECT 1 FROM ledger_events e
        WHERE e.address_id=(SELECT address_id FROM address_dictionary WHERE address=?)
          AND e.asset_id=(SELECT asset_id FROM asset_dictionary WHERE asset=?) AND e.event_index>?)`,
        [row.balanceId, row.previous, row.eventIndex, row.address, row.asset, row.address, row.asset, row.eventIndex],
      ),
    );
    statements.push(
      db
        .prepare("UPDATE balances SET quantity=?,quantity_normalized=? WHERE balance_id=?")
        .bind(expected, normalize(expected, row.divisible), row.balanceId),
    );
  }
  for (const row of snapshots) {
    const expected = balanceQuantity(row.expected).toString();
    if (expected === row.previous) throw new Error("Unchanged snapshot in repair plan");
    statements.push(
      guard(
        `EXISTS(SELECT 1 FROM balance_snapshots s
      WHERE s.snapshot_id=? AND s.quantity=? AND s.updated_event_index=?
        AND s.address_id=(SELECT address_id FROM address_dictionary WHERE address=?)
        AND s.asset_id=(SELECT asset_id FROM asset_dictionary WHERE asset=?))`,
        [row.snapshotId, row.previous, row.eventIndex, row.address, row.asset],
      ),
    );
    statements.push(
      db.prepare("UPDATE balance_snapshots SET quantity=? WHERE snapshot_id=?").bind(expected, row.snapshotId),
    );
  }
  return statements;
}
