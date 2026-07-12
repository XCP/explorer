import "client-only";

const REQUEST_TIMEOUT_MS = 15_000;

/** Default SWR fetcher for the public explorer API. */
export async function fetcher<T>(url: string): Promise<T> {
  const response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`API ${response.status} ${response.statusText}`);
  return response.json();
}
