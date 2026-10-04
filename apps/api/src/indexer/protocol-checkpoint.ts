import { counterpartyJson } from "#api/integrations/counterparty";
import type { ReplayIdentity } from "#api/queries/replay-checkpoints";

export const PENDING_PROTOCOL_KEY = "replay_protocol_identities";

export async function fetchReplayIdentity(api: string, height: number, parsed = false): Promise<ReplayIdentity> {
  const { result } = await counterpartyJson<{ result?: Partial<ReplayIdentity> }>(api, `/blocks/${height}`);
  if (!result?.block_hash || (result.block_index !== undefined && result.block_index !== height))
    throw new Error("Cannot verify applied block hash");
  const identity = {
    block_index: height,
    block_hash: result.block_hash,
    ledger_hash: result.ledger_hash ?? null,
    messages_hash: result.messages_hash ?? null,
  };
  if (parsed) requireParsedIdentity(identity);
  return identity;
}

export function requireParsedIdentity(identity: ReplayIdentity): void {
  if (
    ![identity.block_hash, identity.ledger_hash, identity.messages_hash].every(
      (hash) => typeof hash === "string" && /^[a-f0-9]{64}$/i.test(hash),
    )
  )
    throw new Error("Parsed block protocol hashes unavailable");
}

export function sameReplayIdentity(stored: ReplayIdentity, fresh: ReplayIdentity): boolean {
  if ((stored.ledger_hash && !fresh.ledger_hash) || (stored.messages_hash && !fresh.messages_hash))
    throw new Error("Parsed block protocol hashes unavailable");
  return (
    stored.block_hash === fresh.block_hash &&
    (!stored.ledger_hash || stored.ledger_hash === fresh.ledger_hash) &&
    (!stored.messages_hash || stored.messages_hash === fresh.messages_hash)
  );
}

export function pendingReplayIdentities(raw: string | null): ReplayIdentity[] {
  if (raw === null) return [];
  const rows: ReplayIdentity[] = JSON.parse(raw);
  if (!Array.isArray(rows) || rows.length > 50) throw new Error("Invalid pending protocol identities");
  for (const row of rows) {
    if (!Number.isSafeInteger(row.block_index) || row.block_index < 0)
      throw new Error("Invalid pending protocol height");
    requireParsedIdentity(row);
  }
  return rows;
}
