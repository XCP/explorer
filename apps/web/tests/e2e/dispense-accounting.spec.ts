import { test, expect } from "@playwright/test";
import type { TxView } from "@xcp/shared/chain";
import { allocatedBtc } from "../../src/lib/dispenser-pricing";
import { fromSatsExact } from "../../src/lib/format";

test("allocated shares retain fractional satoshis without weakening chain precision", () => {
  expect(allocatedBtc(2000000 / 151)).toBe("0.000132450331");
  expect(allocatedBtc(2000000)).toBe("0.02");
  expect(allocatedBtc(null)).toBeNull();
  expect(allocatedBtc(NaN)).toBeNull();
  expect(fromSatsExact(2000000 / 151, true)).toBeNull();
});

test("bundle receipt shows every allocation and counts the payment once", async ({ page }) => {
  const hash = "70808e2a477cef90363e94263dba8f51cb6d6f3d70e51cb5a7acd8037e681132";
  const fixture: TxView = {
    tx_hash: hash,
    status: "confirmed",
    confirmations: 100,
    tip: 968000,
    pending: [],
    protocol: { valid: true, status: null },
    action: {
      kind: "dispense",
      dispenser: null,
      dispenses: Array.from({ length: 151 }, (_, index) => ({
        tx_hash: hash,
        block_index: 967326,
        block_time: 1789593673,
        source: "seller",
        destination: "buyer",
        asset: `ITEM${index}`,
        dispense_quantity_normalized: "1",
        btc_amount: "2000000",
        quote_sats: 2000000 / 151,
        payment_asset_count: 151,
        usd_value: 10,
      })),
    },
  };
  await page.route(`**/v2/transactions/${hash}`, (route) => route.fulfill({ json: { result: fixture } }));
  await page.goto(`/tx/${hash}`, { waitUntil: "domcontentloaded" });
  const receipt = page.locator(".txreceipt");
  await expect(receipt.locator("tbody tr")).toHaveCount(151);
  await expect(receipt.locator(".sale")).toContainText("allocated cost 0.02 BTC");
  await expect(receipt.locator("tbody tr").first()).toContainText("0.000132450331");
  await expect(receipt.locator("tfoot")).toContainText("0.02 BTC");
});
