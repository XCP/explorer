/**
 * Emblem Vault insights (GET /v2/emblem/*). Thin routes over queries/emblem.ts: which assets are locked in
 * vaults, the vault records themselves, and the funded/cracked/deposit segmentation. Contents are always
 * derived from our OWN Counterparty ledger — Emblem is never trusted for what's inside.
 */
import { router, J, lim, off } from "./respond";
import { emblemStats, emblemAssets, emblemVaults } from "../queries/emblem";

export const emblem = router();

// Segmentation summary: vault counts + the funded/cracked/deposit split + a "real user" count that strips
// out infrastructure (vaults, exchanges, burns, deposit plumbing). empty = vaults − funded.
emblem.get("/v2/emblem/stats", async (c) => {
  const s = await emblemStats(c.env.DB);
  return J(c, { result: { ...s, empty: (s?.vaults ?? 0) - (s?.funded ?? 0) } }, 600);
});

// Assets currently locked inside Emblem vaults (held by a vault Bitcoin address), by vault count.
emblem.get("/v2/emblem/assets", async (c) => {
  const result = await emblemAssets(c.env.DB, { limit: lim(c), offset: off(c) });
  return J(c, { result, next_offset: result.length === lim(c) ? off(c) + lim(c) : null }, 600);
});

// The vaults themselves: token id + contract + BTC address, and whether they currently hold CP value.
emblem.get("/v2/emblem/vaults", async (c) => {
  const result = await emblemVaults(c.env.DB, { limit: lim(c), offset: off(c) });
  return J(c, { result, next_offset: result.length === lim(c) ? off(c) + lim(c) : null }, 120);
});
