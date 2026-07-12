import "server-only";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { API_BASE } from "@/lib/api/url";

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
  try {
    const binding = getCloudflareContext().env.API_WORKER;
    if (binding) {
      const response = await binding.fetch(url, init);
      if (response.status < 500) return response;
    }
  } catch {
    // Outside the OpenNext runtime, or a local binding stub: use ordinary fetch below.
  }
  return fetch(url, init);
}

/** Server-side API read with route-selected freshness and canonical 404 translation. */
export async function getJson<T>(path: string, options: { revalidate?: number } = {}): Promise<T> {
  const response = await serverFetch(API_BASE + path, { next: { revalidate: options.revalidate ?? 30 } });
  if (response.status === 404) throw new NotFoundError(path);
  if (!response.ok) throw new Error(`API ${response.status} ${response.statusText}`);
  return response.json() as Promise<T>;
}

export type { Envelope } from "@xcp/shared/envelope";
