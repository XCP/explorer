import type { MetadataRoute } from "next";
import { BLOCKED_CRAWLERS } from "@/lib/crawlers";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: BLOCKED_CRAWLERS, disallow: "/" },
      { userAgent: "*", allow: "/" },
    ],
  };
}
