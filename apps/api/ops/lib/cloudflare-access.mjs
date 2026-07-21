/** Optional Cloudflare Access service-token headers for canonical admin routes. */
export function cloudflareAccessHeaders(env = process.env) {
  const clientId = env.CF_ACCESS_CLIENT_ID;
  const clientSecret = env.CF_ACCESS_CLIENT_SECRET;
  if (!clientId && !clientSecret) return {};
  if (!clientId || !clientSecret)
    throw new Error("CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET must be set together");
  return { "CF-Access-Client-Id": clientId, "CF-Access-Client-Secret": clientSecret };
}
