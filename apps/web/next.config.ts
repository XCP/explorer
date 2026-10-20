import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  async headers() {
    return [
      { source: "/.well-known/:path*", headers: [{ key: "Access-Control-Allow-Origin", value: "*" }] },
      {
        source: "/.well-known/wallet-app.json",
        headers: [{ key: "Content-Type", value: "application/json; charset=utf-8" }],
      },
      { source: "/wallet-app/:path*", headers: [{ key: "Access-Control-Allow-Origin", value: "*" }] },
    ];
  },
  reactStrictMode: true,
  reactCompiler: true,
  typedRoutes: true,
  // @xcp/shared ships raw .ts (types + a couple of const arrays) — let Next compile it.
  transpilePackages: ["@xcp/shared"],
};
export default nextConfig;
// Cloudflare dev bindings during `next dev` (no-op until OpenNext is wired):
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
initOpenNextCloudflareForDev();
