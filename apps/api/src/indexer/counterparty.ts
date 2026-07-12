/** Counterparty HTTP client — fetch + decode (precision-safe) with good-citizen backoff. */
import { parseCounterpartyJson } from "#api/indexer/codec";

export function parseCounterpartyResponse<T = unknown>(text: string): T {
  const value: unknown = parseCounterpartyJson(text);
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Counterparty response must be an object");
  }
  const envelope = value as Record<string, unknown>;
  if (envelope.error !== undefined && envelope.error !== null) {
    const detail = typeof envelope.error === "string" ? envelope.error.slice(0, 120) : "provider error";
    throw new Error(`Counterparty response error: ${detail}`);
  }
  return value as T;
}

const backoff = (attempt: number, retryAfter = 0) =>
  new Promise((resolve) => setTimeout(resolve, retryAfter ? retryAfter * 1000 : Math.min(8000, 500 * 2 ** attempt)));

export async function counterpartyJson<T = unknown>(api: string, path: string): Promise<T> {
  // On rate-limit (429) or upstream 5xx, wait and retry instead of hammering Counterparty.
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(`${api}${path}`, { signal: AbortSignal.timeout(45000) });
    if (r.ok) {
      try {
        return parseCounterpartyResponse<T>(await r.text());
      } catch (error) {
        if (attempt < 2) {
          await backoff(attempt);
          continue;
        }
        throw error;
      }
    }
    if ((r.status === 429 || r.status >= 500) && attempt < 4) {
      const ra = parseInt(r.headers.get("retry-after") || "", 10);
      await backoff(attempt, ra);
      continue;
    }
    throw new Error(`Counterparty ${path} ${r.status}`);
  }
}
