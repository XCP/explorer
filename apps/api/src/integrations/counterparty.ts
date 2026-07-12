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

export interface CounterpartyRequestOptions {
  timeoutMs?: number;
  maxRetries?: number;
  malformedRetries?: number;
}

export async function counterpartyJson<T = unknown>(
  api: string,
  path: string,
  options: CounterpartyRequestOptions = {},
): Promise<T> {
  const { timeoutMs = 45_000, maxRetries = 4, malformedRetries = 2 } = options;
  // On rate-limit (429) or upstream 5xx, wait and retry instead of hammering Counterparty.
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(`${api}${path}`, { signal: AbortSignal.timeout(timeoutMs) });
    if (response.ok) {
      try {
        return parseCounterpartyResponse<T>(await response.text());
      } catch (error) {
        if (attempt < malformedRetries) {
          await backoff(attempt);
          continue;
        }
        throw error;
      }
    }
    if ((response.status === 429 || response.status >= 500) && attempt < maxRetries) {
      const retryAfter = Number.parseInt(response.headers.get("retry-after") || "", 10);
      await backoff(attempt, retryAfter);
      continue;
    }
    throw new Error(`Counterparty ${path} ${response.status}`);
  }
}
