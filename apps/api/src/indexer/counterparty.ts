/** Counterparty HTTP client — fetch + decode (precision-safe) with good-citizen backoff. */
import { parseCounterpartyJson } from "#api/indexer/codec";

export async function counterpartyJson<T = unknown>(api: string, path: string): Promise<T> {
  // On rate-limit (429) or upstream 5xx, wait and retry instead of hammering Counterparty.
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(`${api}${path}`, { signal: AbortSignal.timeout(45000) });
    if (r.ok) return parseCounterpartyJson(await r.text()) as T;
    if ((r.status === 429 || r.status >= 500) && attempt < 4) {
      const ra = parseInt(r.headers.get("retry-after") || "", 10);
      await new Promise((res) => setTimeout(res, ra ? ra * 1000 : Math.min(8000, 500 * 2 ** attempt)));
      continue;
    }
    throw new Error(`Counterparty ${path} ${r.status}`);
  }
}
