import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  reactStrictMode: true,
  // @xcp/shared ships raw .ts (types + a couple of const arrays) — let Next compile it.
  transpilePackages: ["@xcp/shared"],
};
export default nextConfig;
// Cloudflare dev bindings during `next dev` (no-op until OpenNext is wired):
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
initOpenNextCloudflareForDev();
