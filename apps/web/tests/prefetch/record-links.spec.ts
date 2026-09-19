import { test, expect, type Page } from "@playwright/test";
import type { SendRow } from "@xcp/shared/records";

const ADDRESS = "1K8pj6raDJ2GvUnXzE78HFVES31LMuxeTv";
const NEXT_ADDRESS = "171grbn6H9uZRc5LVkgtSR2aFosLh8iqEw";
const TX = "b5b0ee151fcf23d8612f816df969ae59bac7e789296ee51c11a34af3bee36705";

async function openTable(page: Page) {
  const prefetches: string[] = [];
  const apiReads: string[] = [];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (request.headers()["next-router-prefetch"] && /^\/(address|tx)\//.test(path)) prefetches.push(path);
  });
  await page.route("https://api.xcp.io/**", (route) => {
    const url = new URL(route.request().url());
    apiReads.push(url.pathname);
    if (url.pathname !== "/v2/sends") return route.fulfill({ status: 503, body: "unavailable" });
    const source = Number(url.searchParams.get("offset")) ? NEXT_ADDRESS : ADDRESS;
    const row: SendRow = {
      tx_hash: TX,
      block_index: 967626,
      block_time: null,
      source,
      destination: null,
      asset: null,
      quantity_normalized: "1",
      send_type: "enhanced_send",
      status: "valid",
      memo: null,
    };
    return route.fulfill({ json: { result: Array.from({ length: 30 }, () => row), next_offset: 50 } });
  });
  await page.route("https://cdn.usefathom.com/**", (route) => route.fulfill({ status: 204 }));
  await page.goto("/sends", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("table").getByRole("row")).toHaveCount(31);
  await page.getByRole("button", { name: "Next", exact: true }).scrollIntoViewIfNeeded();
  await page.waitForTimeout(1_000);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(1_000);
  // A bounded quiet window is necessary to detect unwanted background work.
  expect(prefetches).toEqual([]);
  return { prefetches, apiReads, errors };
}

for (const intent of ["hover", "keyboard", "touch"] as const) {
  test(`${intent} warms only the chosen record and navigation still works`, async ({ page }) => {
    if (intent === "touch") await page.setViewportSize({ width: 390, height: 844 });
    const { prefetches, apiReads, errors } = await openTable(page);
    const href = intent === "touch" ? `/tx/${TX}` : `/address/${ADDRESS}`;
    const link = page.locator(`main a[href="${href}"]`).first();
    if (intent === "hover") await link.hover();
    if (intent === "keyboard") await link.focus();
    if (intent === "touch") await link.dispatchEvent("touchstart");
    await expect.poll(() => prefetches.length).toBeGreaterThan(0);
    await page.waitForTimeout(1_000);
    expect([...new Set(prefetches)]).toEqual([href]);
    const warmed = prefetches.length;
    await link.dispatchEvent("mouseenter");
    await link.dispatchEvent("focus");
    await link.dispatchEvent("touchstart");
    await page.waitForTimeout(1_000);
    expect(prefetches).toHaveLength(warmed);

    if (intent === "keyboard") await page.keyboard.press("Enter");
    else if (intent === "touch") await link.tap();
    else await link.click();
    await expect(page).toHaveURL(new RegExp(`${href}$`));
    await expect(page.locator("main")).toBeVisible();
    if (intent !== "touch") {
      await expect(page.getByRole("heading", { name: ADDRESS, exact: true })).toBeVisible();
      await expect.poll(() => apiReads.includes(`/v2/addresses/${ADDRESS}/summary`)).toBe(true);
    }
    expect(errors).toEqual([]);
  });
}

test("pagination does not inherit prefetch intent from the previous address", async ({ page }) => {
  const { prefetches, errors } = await openTable(page);
  await page.locator(`main a[href="/address/${ADDRESS}"]`).first().hover();
  await expect.poll(() => prefetches.length).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Next", exact: true }).click();
  const link = page.locator(`main a[href="/address/${NEXT_ADDRESS}"]`).first();
  await expect(link).toHaveCount(1);
  await link.scrollIntoViewIfNeeded();
  await page.waitForTimeout(1_000);
  expect(prefetches).not.toContain(`/address/${NEXT_ADDRESS}`);
  await link.focus();
  await expect.poll(() => prefetches.includes(`/address/${NEXT_ADDRESS}`)).toBe(true);
  expect(errors).toEqual([]);
});
