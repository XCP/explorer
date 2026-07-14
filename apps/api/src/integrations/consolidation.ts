const REQUEST_TIMEOUT_MS = 45_000;

/** Forward one extension recovery request to the consolidation service. */
export async function requestConsolidation(baseUrl: string, request: Request): Promise<Response> {
  const incoming = new URL(request.url);
  const target = new URL(incoming.pathname + incoming.search, `${baseUrl.replace(/\/$/, "")}/`);
  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  return fetch(target, {
    method: request.method,
    headers: { accept: "application/json" },
    body: hasBody ? await request.clone().arrayBuffer() : undefined,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}
