import { createMiddleware } from "hono/factory";
import type { Env } from "#api/env";

type AdminRequest = {
  header(name: string): string | undefined;
};

/** Prefer credentials in a header so URLs, browser history, and access logs do not retain them. */
export function readAdminToken(req: AdminRequest): string | undefined {
  const authorization = req.header("Authorization");
  if (authorization?.startsWith("Bearer ")) return authorization.slice(7).trim();
  return undefined;
}

/** Hash both values to fixed-width bytes before comparison so length and mismatch position are not observable. */
export async function adminTokensEqual(candidate: string | undefined, expected: string): Promise<boolean> {
  if (candidate === undefined) return false;
  const encoder = new TextEncoder();
  const [candidateHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(candidate)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const left = new Uint8Array(candidateHash);
  const right = new Uint8Array(expectedHash);
  let difference = 0;
  for (let index = 0; index < left.length; index++) difference |= left[index]! ^ right[index]!;
  return difference === 0;
}

export const requireAdmin = createMiddleware<{ Bindings: Env }>(async (c, next) => {
  if (!(await adminTokensEqual(readAdminToken(c.req), c.env.ADMIN_TOKEN))) {
    c.header("WWW-Authenticate", 'Bearer realm="xcp-api-admin"');
    return c.json({ error: "unauthorized" }, 401);
  }
  await next();
});
