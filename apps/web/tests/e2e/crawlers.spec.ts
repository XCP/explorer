import { test, expect } from "@playwright/test";

test("training crawls stop before page rendering and can read robots instructions", async ({ request }) => {
  for (const userAgent of ["GPTBot/1.4", "ClaudeBot/1.0"]) {
    for (const route of ["/asset/RAREPEPE", "/blocks", "/"]) {
      const response = await request.get(route, { headers: { "user-agent": userAgent } });
      expect(response.status()).toBe(403);
      expect(response.headers()["cache-control"]).toBe("no-store");
      expect(await response.text()).toBe("Forbidden");
    }
    const robots = await request.get("/robots.txt", { headers: { "user-agent": userAgent } });
    expect(robots.status()).toBe(200);
    expect(await robots.text()).toContain(`User-Agent: ${userAgent.split("/")[0]}`);
  }
});

test("AI search, user-requested visits, search engines and previews still get rendered pages", async ({ request }) => {
  for (const userAgent of [
    "OAI-SearchBot/1.4",
    "ChatGPT-User/1.0",
    "Claude-SearchBot/1.0",
    "Claude-User/1.0",
    "Googlebot/2.1",
    "bingbot/2.0",
    "facebookexternalhit/1.1",
    "Twitterbot/1.0",
  ]) {
    const response = await request.get("/asset/RAREPEPE", { headers: { "user-agent": userAgent } });
    expect(response.status(), userAgent).toBe(200);
    const body = await response.text();
    expect(body, userAgent).toContain("RAREPEPE");
    expect(body, userAgent).toContain("<main");
    expect(body, userAgent).not.toBe("Forbidden");
  }
});
