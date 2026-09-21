/** Training crawls are separate from search indexing and user-requested AI visits. */
export const BLOCKED_CRAWLERS = ["AhrefsBot", "SemrushBot", "MJ12bot", "DotBot", "GPTBot", "ClaudeBot"];

const BLOCKED_CRAWLER = new RegExp(`(?:^|[\\s;(])(?:${BLOCKED_CRAWLERS.join("|")})(?:[/\\s;)]|$)`, "i");

export function isBlockedCrawler(userAgent: string): boolean {
  return BLOCKED_CRAWLER.test(userAgent);
}
