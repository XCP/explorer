/**
 * Emblem Vault insights. The crawler keeps emblem_vaults(token_id, contract, btc_address) fresh from
 * Ethereum (Alchemy); these read surfaces JOIN that against our OWN Counterparty ledger to answer:
 * which addresses are vaults, which are funded vs cracked, what's locked inside, and who wrapped/unwrapped.
 * We never trust Emblem for contents — every "what's inside" figure is derived from balances/sends.
 */
import { router, J, lim, off } from "./shared";

export const emblem = router();

// Segmentation summary: vault counts + the funded/cracked/deposit split + a "real user" count that
// strips out infrastructure (vaults, exchanges, burns, deposit plumbing).
emblem.get("/v2/emblem/stats", async (c) => {
  const s = await c.env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM emblem_vaults WHERE btc_address IS NOT NULL) vaults,
       (SELECT COUNT(DISTINCT e.btc_address) FROM emblem_vaults e JOIN balances b ON b.holder=e.btc_address AND CAST(b.quantity AS INTEGER)>0) funded,
       (SELECT COUNT(DISTINCT s.destination) FROM sends s JOIN emblem_vaults e ON e.btc_address=s.source
          WHERE s.destination IS NOT NULL AND NOT EXISTS (SELECT 1 FROM emblem_vaults v WHERE v.btc_address=s.destination)) cracked_to_user,
       (SELECT COUNT(DISTINCT s.destination) FROM sends s JOIN emblem_vaults e ON e.btc_address=s.source
          WHERE EXISTS (SELECT 1 FROM emblem_vaults v WHERE v.btc_address=s.destination)) revaulted,
       (SELECT COUNT(DISTINCT s.source) FROM sends s JOIN emblem_vaults e ON e.btc_address=s.destination) depositors,
       (SELECT COUNT(*) FROM address_signals WHERE assets_held>0) all_holders,
       (SELECT COUNT(*) FROM address_signals WHERE assets_held>0 AND is_emblem_vault=0 AND is_exchange=0 AND is_burn=0 AND is_deposit=0 AND likely_service=0) real_users`
  ).first<any>();
  return J(c, { result: { ...s, empty: (s?.vaults ?? 0) - (s?.funded ?? 0) } }, 600);
});

// Assets currently locked inside Emblem vaults (held by a vault Bitcoin address), by vault count.
emblem.get("/v2/emblem/assets", async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT b.asset, COUNT(*) vaults FROM balances b JOIN emblem_vaults e ON e.btc_address=b.holder
     WHERE CAST(b.quantity AS INTEGER)>0 GROUP BY b.asset ORDER BY vaults DESC LIMIT ? OFFSET ?`
  ).bind(lim(c), off(c)).all();
  return J(c, { result: rows.results, next_offset: off(c) + lim(c) }, 600);
});

// The vaults themselves: token id + contract + BTC address, and whether they currently hold CP value.
emblem.get("/v2/emblem/vaults", async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT e.token_id, e.contract, e.btc_address,
            (SELECT COUNT(*) FROM balances b WHERE b.holder=e.btc_address AND CAST(b.quantity AS INTEGER)>0) held_assets
     FROM emblem_vaults e WHERE e.btc_address IS NOT NULL ORDER BY e.first_seen DESC LIMIT ? OFFSET ?`
  ).bind(lim(c), off(c)).all();
  return J(c, { result: rows.results, next_offset: off(c) + lim(c) }, 120);
});
