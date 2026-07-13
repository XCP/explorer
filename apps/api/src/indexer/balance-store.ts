import { normalize } from "#api/indexer/codec";
import { parseUtxoHolder } from "#api/indexer/compact-codec";
import { bi, type Ctx, type Stmt } from "#api/indexer/events/context";

const BATCH_SIZE = 90;

async function batch(db: D1Database, statements: Stmt[]): Promise<void> {
  for (let index = 0; index < statements.length; index += BATCH_SIZE) {
    await db.batch(statements.slice(index, index + BATCH_SIZE).map((statement) => statement(db)));
  }
}

/** Apply one replay chunk to the normalized polymorphic balance relation. Dictionaries must exist first. */
export async function applyCompactBalanceDeltas(
  db: D1Database,
  deltas: Ctx["balDelta"],
  snapshot: boolean,
): Promise<void> {
  if (deltas.size === 0) return;
  const keys = [...deltas.values()];
  const current = new Map<string, { quantity: bigint; eventIndex: number }>();

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
                assets.asset,b.quantity,b.updated_event_index
         FROM balances b
         JOIN asset_dictionary assets ON assets.asset_id=b.asset_id
         LEFT JOIN address_dictionary a ON a.address_id=b.address_id
         WHERE ${predicates.join(" OR ")}`,
      )
      .bind(...binds)
      .all<{ holder: string; asset: string; quantity: string; updated_event_index: number }>();
    for (const row of rows.results) {
      current.set(`${row.holder} ${row.asset}`, {
        quantity: bi(row.quantity),
        eventIndex: row.updated_event_index ?? 0,
      });
    }
  }

  const statements: Stmt[] = [];
  for (const key of keys) {
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
    const delta = changes.reduce((sum, change) => sum + change.delta, 0n);
    const quantity = ((existing?.quantity ?? 0n) + delta).toString();
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
      if (snapshot) {
        statements.push((target) =>
          target
            .prepare(
              `INSERT INTO balance_snapshots(address_id,asset_id,block_index,quantity,updated_event_index)
               SELECT a.address_id,s.asset_id,?,?,? FROM address_dictionary a,asset_dictionary s
               WHERE a.address=? AND s.asset=?
               ON CONFLICT DO UPDATE SET quantity=excluded.quantity,updated_event_index=excluded.updated_event_index`,
            )
            .bind(latest.block, quantity, latest.evIdx, key.holder, key.asset),
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
      if (snapshot) {
        statements.push((target) =>
          target
            .prepare(
              `INSERT INTO balance_snapshots(utxo_tx_hash,utxo_vout,asset_id,block_index,quantity,updated_event_index)
               SELECT ?,?,s.asset_id,?,?,? FROM asset_dictionary s WHERE s.asset=?
               ON CONFLICT DO UPDATE SET quantity=excluded.quantity,updated_event_index=excluded.updated_event_index`,
            )
            .bind(utxo.txHash, utxo.vout, latest.block, quantity, latest.evIdx, key.asset),
        );
      }
    }
  }
  await batch(db, statements);
}
