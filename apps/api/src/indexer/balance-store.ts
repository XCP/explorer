import { balanceQuantity, normalize } from "#api/indexer/codec";
import { parseUtxoHolder } from "#api/indexer/identities";
import { type Ctx, type Stmt } from "#api/indexer/events/context";

const BATCH_SIZE = 90;

async function batch(db: D1Database, groups: Stmt[][]): Promise<void> {
  let pending: Stmt[] = [];
  for (const group of groups) {
    if (group.length > BATCH_SIZE) throw new Error("Balance checkpoint exceeds atomic batch bound");
    if (pending.length + group.length > BATCH_SIZE) {
      await db.batch(pending.map((statement) => statement(db)));
      pending = [];
    }
    pending.push(...group);
  }
  if (pending.length) await db.batch(pending.map((statement) => statement(db)));
}

/** Apply one replay chunk to the normalized polymorphic balance relation. Dictionaries must exist first. */
export async function applyCoreBalanceDeltas(
  db: D1Database,
  deltas: Ctx["balDelta"],
  snapshot: boolean,
): Promise<void> {
  if (deltas.size === 0) return;
  const keys = [...deltas.values()];
  const current = new Map<string, { quantity: bigint; eventIndex: number; block: number }>();

  for (let index = 0; index < keys.length; index += 40) {
    const slice = keys.slice(index, index + 40);
    const predicates: string[] = [];
    const binds: unknown[] = [];
    for (const key of slice) {
      if (key.htype === "address") {
        predicates.push(
          `(b.address_id=(SELECT address_id FROM address_dictionary WHERE address=?)
            AND b.asset_id=(SELECT asset_id FROM asset_dictionary WHERE asset=?))`,
        );
        binds.push(key.holder, key.asset);
      } else {
        const utxo = parseUtxoHolder(key.holder);
        predicates.push(
          `(b.utxo_tx_hash=? AND b.utxo_vout=?
            AND b.asset_id=(SELECT asset_id FROM asset_dictionary WHERE asset=?))`,
        );
        binds.push(utxo.txHash, utxo.vout, key.asset);
      }
    }
    const rows = await db
      .prepare(
        `SELECT CASE WHEN b.address_id IS NOT NULL THEN a.address
                     ELSE lower(hex(b.utxo_tx_hash))||':'||b.utxo_vout END holder,
                assets.asset,b.quantity,b.updated_event_index,b.updated_block_index
         FROM balances b
         JOIN asset_dictionary assets ON assets.asset_id=b.asset_id
         LEFT JOIN address_dictionary a ON a.address_id=b.address_id
         WHERE ${predicates.join(" OR ")}`,
      )
      .bind(...binds)
      .all<{
        holder: string;
        asset: string;
        quantity: string;
        updated_event_index: number;
        updated_block_index: number | null;
      }>();
    for (const row of rows.results) {
      current.set(`${row.holder} ${row.asset}`, {
        quantity: balanceQuantity(row.quantity),
        eventIndex: row.updated_event_index ?? 0,
        block: row.updated_block_index ?? 0,
      });
    }
  }

  const groups: Stmt[][] = [];
  for (const key of keys) {
    const statements: Stmt[] = [];
    const identity = `${key.holder} ${key.asset}`;
    const existing = current.get(identity);
    const eventHighWater = existing?.eventIndex ?? -1;
    const changes = key.changes.filter((change) => change.evIdx > eventHighWater);
    if (changes.length === 0) continue;
    const latest = changes.reduce((left, right) => (right.evIdx > left.evIdx ? right : left));
    const latestUtxoAddress = changes.reduce(
      (value, change) => (change.evIdx >= value.evIdx && change.utxoAddr ? change : value),
      { evIdx: -1, utxoAddr: null as string | null },
    ).utxoAddr;
    let running = existing?.quantity ?? 0n;
    const checkpoints = new Map<number, { quantity: string; eventIndex: number }>();
    if (snapshot && existing)
      checkpoints.set(existing.block, { quantity: running.toString(), eventIndex: existing.eventIndex });
    for (const change of [...changes].sort((a, b) => a.evIdx - b.evIdx)) {
      running += change.delta;
      if (running < 0n) throw new Error(`Balance underflow: ${key.asset} ${key.holder} at event ${change.evIdx}`);
      if (snapshot) checkpoints.set(change.block, { quantity: running.toString(), eventIndex: change.evIdx });
    }
    const quantity = running.toString();
    const normalized = normalize(quantity, key.divisible);
    if (key.htype === "address") {
      statements.push((target) =>
        target
          .prepare(
            `INSERT INTO balances(address_id,asset_id,quantity,quantity_normalized,updated_block_index,updated_event_index)
             SELECT a.address_id,s.asset_id,?,?,?,? FROM address_dictionary a,asset_dictionary s
             WHERE a.address=? AND s.asset=?
             ON CONFLICT DO UPDATE SET quantity=excluded.quantity,quantity_normalized=excluded.quantity_normalized,
               updated_block_index=excluded.updated_block_index,updated_event_index=excluded.updated_event_index`,
          )
          .bind(quantity, normalized, latest.block, latest.evIdx, key.holder, key.asset),
      );
      for (const [block, checkpoint] of checkpoints) {
        statements.push((target) =>
          target
            .prepare(
              `INSERT INTO balance_snapshots(address_id,asset_id,block_index,quantity,updated_event_index)
               SELECT a.address_id,s.asset_id,?,?,? FROM address_dictionary a,asset_dictionary s
               WHERE a.address=? AND s.asset=?
               ON CONFLICT DO UPDATE SET quantity=excluded.quantity,updated_event_index=excluded.updated_event_index
                 WHERE balance_snapshots.updated_event_index<excluded.updated_event_index`,
            )
            .bind(block, checkpoint.quantity, checkpoint.eventIndex, key.holder, key.asset),
        );
      }
    } else {
      const utxo = parseUtxoHolder(key.holder);
      statements.push((target) =>
        target
          .prepare(
            `INSERT INTO balances(utxo_tx_hash,utxo_vout,asset_id,quantity,quantity_normalized,
                                  updated_block_index,updated_event_index,utxo_address_id)
             SELECT ?,?,s.asset_id,?,?,?,?,a.address_id FROM asset_dictionary s
             LEFT JOIN address_dictionary a ON a.address=? WHERE s.asset=?
             ON CONFLICT DO UPDATE SET quantity=excluded.quantity,quantity_normalized=excluded.quantity_normalized,
               updated_block_index=excluded.updated_block_index,updated_event_index=excluded.updated_event_index,
               utxo_address_id=coalesce(excluded.utxo_address_id,balances.utxo_address_id)`,
          )
          .bind(utxo.txHash, utxo.vout, quantity, normalized, latest.block, latest.evIdx, latestUtxoAddress, key.asset),
      );
      for (const [block, checkpoint] of checkpoints) {
        statements.push((target) =>
          target
            .prepare(
              `INSERT INTO balance_snapshots(utxo_tx_hash,utxo_vout,asset_id,block_index,quantity,updated_event_index)
               SELECT ?,?,s.asset_id,?,?,? FROM asset_dictionary s WHERE s.asset=?
               ON CONFLICT DO UPDATE SET quantity=excluded.quantity,updated_event_index=excluded.updated_event_index
                 WHERE balance_snapshots.updated_event_index<excluded.updated_event_index`,
            )
            .bind(utxo.txHash, utxo.vout, block, checkpoint.quantity, checkpoint.eventIndex, key.asset),
        );
      }
    }
    groups.push(statements);
  }
  // A balance and ALL its block checkpoints commit together. A crash cannot
  // advance its high-water while losing the snapshots that retries would skip.
  await batch(db, groups);
}
