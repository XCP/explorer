import { readFileSync } from "node:fs";

function localCredentials() {
  try {
    return Object.fromEntries(
      readFileSync(new URL("../../.dev.vars", import.meta.url), "utf8")
        .split(/\r?\n/)
        .filter((line) => line && !line.startsWith("#") && line.includes("="))
        .map((line) => {
          const separator = line.indexOf("=");
          return [
            line.slice(0, separator).trim(),
            line
              .slice(separator + 1)
              .trim()
              .replace(/^"|"$/g, ""),
          ];
        }),
    );
  } catch {
    return {};
  }
}

/** Optional Cloudflare Access service-token headers for canonical admin routes. */
export function cloudflareAccessHeaders(env = process.env) {
  const local = localCredentials();
  const clientId = env.CF_ACCESS_CLIENT_ID ?? local.CF_ACCESS_CLIENT_ID;
  const clientSecret = env.CF_ACCESS_CLIENT_SECRET ?? local.CF_ACCESS_CLIENT_SECRET;
  if (!clientId && !clientSecret) return {};
  if (!clientId || !clientSecret)
    throw new Error("CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET must be set together");
  return { "CF-Access-Client-Id": clientId, "CF-Access-Client-Secret": clientSecret };
}
