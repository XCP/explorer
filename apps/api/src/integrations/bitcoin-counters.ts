/**
 * Bitcoin Counters reference indexer (bitcoincounters.com) — the numbering authority for COUNT/ord
 * witness files owned through Counterparty assets. This integration only lists and validates the
 * provider's counter rows; deciding what to trust against our own mirror is indexer/counters.ts's job.
 */
const REQUEST_TIMEOUT_MS = 30_000;

export interface CounterListing {
  number: number;
  asset: string;
  txid: string;
  envelope: string;
  content_type: string;
}

export function parseCounterList(payload: unknown): CounterListing[] {
  const rows = (payload as { counters?: unknown })?.counters;
  if (!Array.isArray(rows)) throw new Error("counters response must carry a counters array");
  const out: CounterListing[] = [];
  for (const row of rows) {
    const r = row as Record<string, unknown>;
    if (typeof r.number !== "number" || typeof r.asset !== "string" || typeof r.txid !== "string") continue;
    if (!/^[0-9a-fA-F]{64}$/.test(r.txid)) continue;
    out.push({
      number: r.number,
      asset: r.asset,
      txid: r.txid,
      envelope: typeof r.envelope === "string" ? r.envelope : "unknown",
      content_type: typeof r.content_type === "string" ? r.content_type : "application/octet-stream",
    });
  }
  return out;
}

export async function fetchCounterList(): Promise<CounterListing[]> {
  const response = await fetch("https://www.bitcoincounters.com/counters?limit=1000", {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`counters request failed: ${response.status}`);
  return parseCounterList(await response.json());
}
