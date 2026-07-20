import assert from "node:assert/strict";
import { test } from "node:test";
import { assertUsdPricingAudit } from "#ops/lib/usd-pricing-audit";

const identity = { source_matches: 2, dex_trades: 2, canonical_refs: 2, alternate_refs: 0 };
const reconciliation = {
  calendar_available_unpriced: 0,
  priced_without_calendar: 0,
  divergent_trade_values: 0,
  usdc_mismatches: 0,
  expired_xcp_carries: 0,
};

test("USD pricing audit accepts one canonical DEX row per source match", () => {
  assertUsdPricingAudit(identity, reconciliation);
});

test("USD pricing audit fails closed on identity drift and valuation divergence", () => {
  assert.throws(() => assertUsdPricingAudit({ ...identity, alternate_refs: 1 }, reconciliation), /identity invariant/);
  assert.throws(
    () => assertUsdPricingAudit(identity, { ...reconciliation, calendar_available_unpriced: 1 }),
    /calendar_available_unpriced/,
  );
  assert.throws(
    () => assertUsdPricingAudit(identity, { ...reconciliation, divergent_trade_values: 1 }),
    /divergent_trade_values/,
  );
});
