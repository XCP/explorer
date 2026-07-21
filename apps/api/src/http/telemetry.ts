import type { Context, Next } from "hono";

/** Bounded route labels keep entity identifiers and attacker-controlled paths out of telemetry. */
export function routeFamily(path: string): string {
  if (path === "/") return "/";
  if (path === "/health") return "/health";
  if (path === "/v2" || path.startsWith("/v2/")) {
    const parts = path.split("/").filter(Boolean);
    if (parts.length <= 2) return `/${parts.join("/")}`;
    return `/${parts.slice(0, 2).join("/")}/:detail`;
  }
  if (path === "/admin" || path.startsWith("/admin/")) {
    const operation = path.split("/").filter(Boolean)[1];
    return operation ? `/admin/${operation}` : "/admin";
  }
  if (path.startsWith("/api/v1/")) return "/api/v1/:legacy";
  return "/:unmatched";
}

export async function requestTelemetry(c: Context, next: Next): Promise<void> {
  const started = Date.now();
  await next();
  console.info({
    event: "request_complete",
    method: c.req.method,
    route_family: routeFamily(c.req.path),
    status: c.res.status,
    duration_ms: Date.now() - started,
    edge_cache: c.res.headers.get("x-cache") ?? "NONE",
    data_cache: c.res.headers.get("x-d1-cache") ?? "NONE",
  });
}
