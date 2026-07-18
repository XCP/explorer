import assert from "node:assert/strict";
import { test } from "node:test";
import { parseEcbReferenceRates } from "#ops/lib/ecb-fx-data";

test("ECB reference-rate parsing retains only supported EUR crosses", () => {
  const csv = `KEY,CURRENCY,CURRENCY_DENOM,TIME_PERIOD,OBS_VALUE,TITLE
a,JPY,EUR,2026-01-02,184.50,"Japanese yen, reference"
b,USD,EUR,2026-01-02,1.1750,"US dollar, reference"
c,GBP,EUR,2026-01-02,0.87,"Pound, ignored"`;
  assert.deepEqual(parseEcbReferenceRates(csv), [
    { day: "2026-01-02", baseCurrency: "EUR", quoteCurrency: "JPY", price: 184.5 },
    { day: "2026-01-02", baseCurrency: "EUR", quoteCurrency: "USD", price: 1.175 },
  ]);
});

test("ECB reference-rate parsing fails closed on malformed consumed values", () => {
  assert.throws(
    () => parseEcbReferenceRates("CURRENCY,CURRENCY_DENOM,TIME_PERIOD,OBS_VALUE\nJPY,EUR,2026-01-02,0"),
    /Invalid ECB/,
  );
});
