import "server-only";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { API_BASE } from "@/lib/api/url";
import { ApiResponseError, readJsonResponse } from "@/lib/api/response";

const BINDING_TIMEOUT_MS = 5_000;
const ORIGIN_TIMEOUT_MS = 15_000;

/** Thrown on a canonical 404 so route pages can translate it to Next's notFound(). */
export class NotFoundError extends Error {
  constructor(readonly path: string) {
    super(`Not found: ${path}`);
    this.name = "NotFoundError";
  }
}

type NextFetchInit = RequestInit & { next?: { revalidate?: number } };

// Production Server Components use the sibling Worker binding. Next dev/build falls back to the public
// origin when the binding is absent or its local stub has nothing behind it.
async function serverFetch(url: string, init: NextFetchInit): Promise<Response> {
  // `next dev` exposes a placeholder service binding with nothing behind it.
  // Calling it burns the full timeout (twice for metadata + page) and can turn
  // an ordinary 404 into the error boundary. The real binding exists only in
  // the deployed production Worker; development uses the public origin.
  if (process.env.NODE_ENV === "production") {
    try {
      const binding = getCloudflareContext().env.API_WORKER;
      if (binding) {
        const response = await binding.fetch(url, { ...init, signal: AbortSignal.timeout(BINDING_TIMEOUT_MS) });
        if (response.status < 500) return response;
        console.error(`serverFetch binding ${url} -> ${response.status}`);
      } else {
        console.error(`serverFetch: API_WORKER binding missing for ${url}`);
      }
    } catch (error) {
      console.error(
        `serverFetch binding threw for ${url}:`,
        error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      );
    }
  }
  const fallback = await fetch(url, { ...init, signal: AbortSignal.timeout(ORIGIN_TIMEOUT_MS) });
  console.error(`serverFetch fallback ${url} -> ${fallback.status}`);
  return fallback;
}

/** Server-side API read with route-selected freshness and canonical 404 translation. */
export async function getJson<T>(path: string, options: { revalidate?: number } = {}): Promise<T> {
  try {
    const response = await serverFetch(API_BASE + path, { next: { revalidate: options.revalidate ?? 30 } });
    if (response.status === 404) {
      // Only the API's own JSON 404 means "this resource does not exist". A 404 from the transport
      // (e.g. Cloudflare's block on sibling workers.dev fetches after a binding timeout) is an
      // infrastructure failure — treating it as NotFound turns transient outages into rendered,
      // ISR-cached not-found pages (the /year launch failure mode).
      if (response.headers.get("content-type")?.includes("json")) throw new NotFoundError(path);
      throw new ApiResponseError(response.status, `non-API 404 for ${path}`);
    }
    return await readJsonResponse<T>(response);
  } catch (error) {
    // Surfaced in `wrangler tail` — server-side read failures are otherwise invisible in prod.
    console.error(
      `getJson ${path} failed:`,
      error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    );
    throw error;
  }
}

export type { Envelope } from "@xcp/shared/envelope";
