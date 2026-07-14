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
    const db = c.env.CORE_DB;
    // These are aggregate scans over one SQLite database. Running them concurrently multiplies D1
    // contention and is substantially slower than letting indexed statements complete in sequence.
    const summary = await vaultSummary(db).catch(() => null);
    const sales_by_class = await vaultSalesByClass(db).catch(() => []);
    const top_sold_assets = await vaultTopSoldAssets(db).catch(() => []);
    const top_assets = await vaultTopAssets(db).catch(() => []);
    const top_funders = await vaultTopFunders(db).catch(() => []);
    const top_crackers = await vaultTopCrackers(db).catch(() => []);
    const sales_activity = await vaultSalesActivity(db).catch(() => []);
    return {
      result: { summary, sales_by_class, top_sold_assets, top_assets, top_funders, top_crackers, sales_activity },
    };
  }),
);
