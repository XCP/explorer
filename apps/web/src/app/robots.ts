import type { MetadataRoute } from "next";

const BLOCKED_CRAWLERS = ["AhrefsBot", "SemrushBot", "MJ12bot", "DotBot"];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: BLOCKED_CRAWLERS, disallow: "/" },
      { userAgent: "*", allow: "/" },
    ],
  };
}
