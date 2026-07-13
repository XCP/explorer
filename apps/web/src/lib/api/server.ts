import "server-only";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { API_BASE } from "@/lib/api/url";
import { readJsonResponse } from "@/lib/api/response";

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
      }
    } catch {
      // Outside the OpenNext runtime, or a failed binding: use ordinary fetch below.
    }
  }
  return fetch(url, { ...init, signal: AbortSignal.timeout(ORIGIN_TIMEOUT_MS) });
}

/** Server-side API read with route-selected freshness and canonical 404 translation. */
export async function getJson<T>(path: string, options: { revalidate?: number } = {}): Promise<T> {
  const response = await serverFetch(API_BASE + path, { next: { revalidate: options.revalidate ?? 30 } });
  if (response.status === 404) throw new NotFoundError(path);
  return readJsonResponse<T>(response);
}

export type { Envelope } from "@xcp/shared/envelope";
