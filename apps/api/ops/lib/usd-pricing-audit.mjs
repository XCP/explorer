export function assertUsdPricingAudit(identity, reconciliation) {
  if (
    Number(identity.source_matches) !== Number(identity.dex_trades) ||
    Number(identity.dex_trades) !== Number(identity.canonical_refs) ||
    Number(identity.alternate_refs) !== 0
  ) {
    throw new Error(`Canonical DEX identity invariant failed: ${JSON.stringify(identity)}`);
  }
  for (const field of [
    "calendar_available_unpriced",
    "priced_without_calendar",
    "divergent_trade_values",
    "usdc_mismatches",
    "expired_xcp_carries",
  ]) {
    if (Number(reconciliation[field]) !== 0)
      throw new Error(`USD pricing invariant ${field} failed: ${reconciliation[field]}`);
  }
}
