/** Environment-neutral explorer API URL construction. Safe in Server and Client Components. */
export const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "https://xcp-api.me-bbe.workers.dev";

export function apiUrl(path: string, params?: Record<string, string | number | undefined>): string {
  const url = new URL(API_BASE + path);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value != null) url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

export type { Envelope } from "@xcp/shared/envelope";
