/**
 * GET /v2/vaults — Emblem Vault overview. A vault is a Bitcoin address wrapped as an Ethereum NFT (custody
 * bridge); what's vaulted, who funds/cracks vaults, and vaulting activity over time all come from our OWN
 * Counterparty ledger. Thin route over queries/vaults.ts; D1-cached (low-cardinality key).
 */
import type { Envelope } from "@xcp/shared/envelope";
import type { VaultsPayload } from "@xcp/shared/emblem";
import { router, cached } from "./respond";
import { vaultSummary, vaultTopAssets, vaultTopFunders, vaultTopCrackers, vaultingActivity } from "../queries/vaults";

export const vaults = router();

vaults.get("/v2/vaults", (c) =>
  cached(c, "vaults", { ttl: 600, edge: 120 }, async (): Promise<Envelope<VaultsPayload>> => {
    const db = c.env.DB;
    const [summary, top_assets, top_funders, top_crackers, activity] = await Promise.all([
      vaultSummary(db).catch(() => null),
      vaultTopAssets(db).catch(() => []),
      vaultTopFunders(db).catch(() => []),
      vaultTopCrackers(db).catch(() => []),
      vaultingActivity(db).catch(() => []),
    ]);
    return { result: { summary, top_assets, top_funders, top_crackers, activity } };
  }));
