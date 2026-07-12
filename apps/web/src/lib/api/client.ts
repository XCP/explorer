import "client-only";
import { readJsonResponse } from "@/lib/api/response";

const REQUEST_TIMEOUT_MS = 15_000;

/** Default SWR fetcher for the public explorer API. */
export async function fetcher<T>(url: string): Promise<T> {
  const response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  return readJsonResponse<T>(response);
}
