import { test, expect } from "@playwright/test";
import type { TxView } from "@xcp/shared/chain";
import { amount, commas, fromSatsExact, DEFAULT_FIAT_CURRENCY } from "../../src/lib/format";

test("exact protocol quantities retain integer and fractional digits", () => {
  expect(amount("9007199254740993", false)).toBe("9,007,199,254,740,993");
  expect(amount("100000000.00000001", true)).toBe("100,000,000.00000001");
  expect(commas("100000000.00000001")).toBe("100,000,000.00000001");
  expect(amount(fromSatsExact("10000000000000001", true))).toBe("100,000,000.00000001");
  expect(fromSatsExact("100", false)).toBe("100");
  expect(fromSatsExact("1", true)).toBe("0.00000001");
});

test("exact displays reject precision loss and respect each asset scale", () => {
  expect(amount("1.5", false)).toBe("—");
  expect(amount("1.000000001", true)).toBe("—");
  expect(amount(1e-25, true)).toBe("—");
  expect(amount(1e-8, true)).toBe("0.00000001");
  expect(amount(9007199254740992, false)).toBe("—");
  expect(fromSatsExact(9007199254740992, true)).toBeNull();
  expect(fromSatsExact("1,000", true)).toBeNull();
  expect(fromSatsExact("1.5", false)).toBeNull();
  expect(amount("100.00000000", false)).toBe("100");
});

test("presentation locale does not affect canonical copy amounts or historical USD", () => {
  const canonical = fromSatsExact("10000000000000001", true);
  expect(amount(canonical, true, "de-DE")).toBe("100.000.000,00000001");
  expect(amount(canonical, true, "ja-JP")).toBe("100,000,000.00000001");
  expect(canonical).toBe("100000000.00000001");
  expect(DEFAULT_FIAT_CURRENCY).toBe("USD");
});

test("the shared decimal-string formatter remains exact in Chromium", async ({ page }) => {
  const formatted = await page.evaluate(() => {
    const format = new Intl.NumberFormat("en-US", { minimumFractionDigits: 8, maximumFractionDigits: 8 }).format;
    return (format as (value: string | number) => string)("100000000.00000001");
  });
  expect(formatted).toBe("100,000,000.00000001");
});

for (const divisible of [1, 0] as const) {
  test(`fairmint campaign displays its ${divisible ? "divisible" : "indivisible"} vend batch in its own units`, async ({
    page,
  }, testInfo) => {
    const hash = "08831b430e69f03c2bb3f5a41fc8e9d356a95d1399b1df8cdfd01c18a9c2b52a";
    const fixture: TxView = {
      tx_hash: hash,
      status: "confirmed",
      confirmations: 100,
      tip: 900100,
      pending: [],
      protocol: { valid: true, status: null },
      action: {
        kind: "fairminter",
        fairminter: {
          tx_hash: hash,
          block_index: 900000,
          block_time: null,
          source: "issuer",
          asset: "TOKEN",
          asset_longname: null,
          price: "1000000",
          quantity_by_price: "100000000000",
          hard_cap: "10000000000000000",
          soft_cap: "0",
          pool_quantity: "0",
          lp_asset: null,
          divisible,
          earned_quantity: "10000000000000001",
          paid_quantity: "0",
          status: "closed",
        },
      },
    };
    // Use the production transaction page and its real client revalidation boundary.
    // Only the read response is a fixture; no JSX is evaluated by Playwright's SSR transform.
    await page.route(`**/v2/transactions/${hash}`, (route) => route.fulfill({ json: { result: fixture } }));
    await page.goto(`/tx/${hash}`, { waitUntil: "domcontentloaded" });
    const campaign = page.locator(".tx-dead");
    await expect(campaign).toContainText(divisible ? "100,000,000.00000001" : "10,000,000,000,000,001");
    await expect(campaign).toContainText(divisible ? "0.01 XCP per 1,000" : "0.01 XCP per 100,000,000,000");
    if (divisible) {
      await page.screenshot({ path: testInfo.outputPath("quantity-desktop.png"), fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(campaign).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth),
      ).toBe(false);
      await page.screenshot({ path: testInfo.outputPath("quantity-mobile.png"), fullPage: true });
    }
  });
}
