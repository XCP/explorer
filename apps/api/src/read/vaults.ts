/**
 * GET /v2/vaults — Emblem Vault overview. A vault is a Bitcoin address wrapped as an Ethereum NFT (custody
 * bridge); what's vaulted, who funds/cracks vaults, and vaulting activity over time all come from our OWN
 * Counterparty ledger. Thin route over queries/vaults.ts; D1-cached (low-cardinality key).
 */
import type { Envelope } from "@xcp/shared/envelope";
import type { VaultsPayload } from "@xcp/shared/emblem";
import { router, cached } from "#api/read/respond";
import {
  vaultSummary,
  vaultSalesByClass,
  vaultTopSoldAssets,
  vaultTopAssets,
  vaultTopFunders,
  vaultTopCrackers,
  vaultSalesActivity,
} from "#api/queries/vaults";

export const vaults = router();

vaults.get("/v2/vaults", (c) =>
  cached(c, "vaults", { ttl: 3600, edge: 120, swr: 86400 }, async (): Promise<Envelope<VaultsPayload>> => {
    const db = c.env.DB;
    const [summary, sales_by_class, top_sold_assets, top_assets, top_funders, top_crackers, sales_activity] =
      await Promise.all([
        vaultSummary(db).catch(() => null),
        vaultSalesByClass(db).catch(() => []),
        vaultTopSoldAssets(db).catch(() => []),
        vaultTopAssets(db).catch(() => []),
        vaultTopFunders(db).catch(() => []),
        vaultTopCrackers(db).catch(() => []),
        vaultSalesActivity(db).catch(() => []),
      ]);
    return {
      result: { summary, sales_by_class, top_sold_assets, top_assets, top_funders, top_crackers, sales_activity },
    };
  }),
);
