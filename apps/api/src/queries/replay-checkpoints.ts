import { one } from "#api/db";

export interface ReplayIdentity {
  block_index: number;
  block_hash: string;
  ledger_hash: string | null;
  messages_hash: string | null;
}

export function storedReplayIdentity(db: D1Database, height: number): Promise<ReplayIdentity | null> {
  return one<ReplayIdentity>(
    db,
    `SELECT block_index,lower(hex(block_hash)) block_hash,
    nullif(lower(hex(ledger_hash)),'') ledger_hash,nullif(lower(hex(messages_hash)),'') messages_hash
    FROM blocks WHERE block_index=?`,
    height,
  );
}

export function lastParsedIdentity(db: D1Database, height: number): Promise<ReplayIdentity | null> {
  return one<ReplayIdentity>(
    db,
    `SELECT block_index,lower(hex(block_hash)) block_hash,
    lower(hex(ledger_hash)) ledger_hash,lower(hex(messages_hash)) messages_hash
    FROM blocks WHERE block_index<=? AND length(ledger_hash)=32 AND length(messages_hash)=32
    ORDER BY block_index DESC LIMIT 1`,
    height,
  );
}
