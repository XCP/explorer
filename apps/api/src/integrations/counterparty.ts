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

const MAX_BACKOFF_MS = 8_000;

const backoffMs = (attempt: number, retryAfter = 0) => {
  const requested = retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** attempt;
  const bounded = Math.min(MAX_BACKOFF_MS, requested);
  // Jitter prevents every scheduled Worker invocation from retrying a recovering provider together.
  return Math.round(bounded * (0.75 + Math.random() * 0.5));
};

export interface CounterpartyRequestOptions {
  timeoutMs?: number;
  totalTimeoutMs?: number;
  maxRetries?: number;
  malformedRetries?: number;
}

export async function counterpartyJson<T = unknown>(
  api: string,
  path: string,
  options: CounterpartyRequestOptions = {},
): Promise<T> {
  const { timeoutMs = 45_000, totalTimeoutMs = 120_000, maxRetries = 4, malformedRetries = 2 } = options;
  const deadline = Date.now() + totalTimeoutMs;
  // On rate-limit (429) or upstream 5xx, wait and retry instead of hammering Counterparty.
  for (let attempt = 0; ; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error(`Counterparty ${path} request deadline exceeded`);
    const response = await fetch(`${api}${path}`, { signal: AbortSignal.timeout(Math.min(timeoutMs, remaining)) });
    if (response.ok) {
      try {
        return parseCounterpartyResponse<T>(await response.text());
      } catch (error) {
        if (attempt < malformedRetries) {
          const delay = Math.min(backoffMs(attempt), deadline - Date.now());
          if (delay <= 0) throw new Error(`Counterparty ${path} request deadline exceeded`);
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
        throw error;
      }
    }
    if ((response.status === 429 || response.status >= 500) && attempt < maxRetries) {
      const retryAfter = Number.parseInt(response.headers.get("retry-after") || "", 10);
      const delay = Math.min(backoffMs(attempt, retryAfter), deadline - Date.now());
      if (delay <= 0) throw new Error(`Counterparty ${path} request deadline exceeded`);
      await new Promise((resolve) => setTimeout(resolve, delay));
      continue;
    }
    throw new Error(`Counterparty ${path} ${response.status}`);
  }
}
