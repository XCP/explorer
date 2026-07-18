import assert from "node:assert/strict";
import { test } from "node:test";
import { parseSpotUsdPrices } from "#api/integrations/coingecko";

test("CoinGecko spot parsing accepts only positive finite BTC and XCP prices", () => {
  assert.deepEqual(parseSpotUsdPrices({ bitcoin: { usd: 64_000 }, counterparty: { usd: 1.5 } }), {
    BTC: 64_000,
    XCP: 1.5,
  });
  assert.throws(() => parseSpotUsdPrices({ bitcoin: { usd: 64_000 }, counterparty: {} }), /XCP/);
  assert.throws(() => parseSpotUsdPrices({ bitcoin: { usd: -1 }, counterparty: { usd: 1.5 } }), /BTC/);
});
