/**
 * API client for the xcp.io explorer — talks to api.xcp.io (the D1 Counterparty mirror).
 * Envelope from the read API: { result, result_count?, next_offset? }.
 */
export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE || "https://xcp-api.me-bbe.workers.dev";

export function apiUrl(path: string, params?: Record<string, string | number | undefined>): string {
  const url = new URL(API_BASE + path);
  if (params) for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, String(v));
  return url.toString();
}

// The envelope is defined once, in the wire contract. (Type alias for existing importers; new code
// should import it from @xcp/shared/envelope directly.)
export type { Envelope } from "@xcp/shared/envelope";

export async function fetcher<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API ${res.status} ${res.statusText}`);
  return res.json();
}

/** Thrown by getJson on a 404 so server components can translate it into notFound(). */
export class NotFoundError extends Error {
  constructor(readonly path: string) {
    super(`Not found: ${path}`);
    this.name = "NotFoundError";
  }
}

/**
 * Server-side read of the API (React Server Components / route handlers). Plain fetch against the
 * same API_BASE, cached by Next's data cache (`next: { revalidate }`, seconds). Throws NotFoundError
 * on a 404 so pages can catch it and call notFound(); other non-2xx statuses throw a generic error.
 */
export async function getJson<T>(path: string, opts: { revalidate?: number } = {}): Promise<T> {
  const res = await fetch(API_BASE + path, { next: { revalidate: opts.revalidate ?? 30 } });
  if (res.status === 404) throw new NotFoundError(path);
  if (!res.ok) throw new Error(`API ${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}
