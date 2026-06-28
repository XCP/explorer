/**
 * /v2/vaults — Emblem Vault overview. A vault is a Bitcoin address wrapped as an Ethereum NFT (custody
 * bridge); emblem_vaults maps vault NFTs → their BTC address, and the assets they hold come from our own
 * Counterparty ledger. Surfaces what's vaulted, who funds/cracks vaults, and vaulting activity over time.
 */
import { router, J } from "./shared";

export const vaults = router();

vaults.get("/v2/vaults", async (c) => {
  const q = (sql: string) => c.env.DB.prepare(sql).all().then((r) => r.results).catch(() => []);
  const inVault = `emblem_vaults e JOIN balances b ON b.holder=e.btc_address AND b.holder_type='address' AND CAST(b.quantity AS INTEGER)>0`;
  const [summary, topAssets, topFunders, topCrackers, activity] = await Promise.all([
    c.env.DB.prepare(
      `SELECT (SELECT COUNT(*) FROM emblem_vaults) vault_records,
        (SELECT COUNT(DISTINCT b.holder) FROM ${inVault}) funded_vaults,
        (SELECT COUNT(DISTINCT b.asset) FROM ${inVault}) assets_vaulted,
        (SELECT COUNT(*) FROM tags WHERE tag='vault_funder') funders,
        (SELECT COUNT(*) FROM tags WHERE tag='vault_cracker') crackers`
    ).first<any>().catch(() => null),
    // most-vaulted assets: held in the most distinct vault boxes (the strongest "people lock this up" signal)
    q(`SELECT b.asset, a.asset_longname, COUNT(DISTINCT b.holder) vaults FROM ${inVault} LEFT JOIN assets a ON a.asset=b.asset GROUP BY b.asset ORDER BY vaults DESC LIMIT 15`),
    // power users: funders (sent assets INTO vaults) + crackers (pulled assets OUT), by distinct vaults touched
    q(`SELECT s.source addr, COUNT(DISTINCT s.destination) vaults FROM sends s JOIN emblem_vaults e ON e.btc_address=s.destination WHERE s.source IS NOT NULL GROUP BY s.source ORDER BY vaults DESC LIMIT 12`),
    q(`SELECT s.destination addr, COUNT(DISTINCT s.source) vaults FROM sends s JOIN emblem_vaults e ON e.btc_address=s.source WHERE s.destination IS NOT NULL GROUP BY s.destination ORDER BY vaults DESC LIMIT 12`),
    // vaulting activity: assets sent INTO vault boxes per day (last 90d)
    q(`SELECT s.block_time/86400 d, COUNT(*) v FROM sends s JOIN emblem_vaults e ON e.btc_address=s.destination WHERE s.block_time>0 GROUP BY d ORDER BY d DESC LIMIT 90`)
      .then((rows: any[]) => rows.map((r) => ({ t: r.d * 86400, v: Number(r.v) || 0 })).reverse()),
  ]);
  return J(c, { result: { summary, top_assets: topAssets, top_funders: topFunders, top_crackers: topCrackers, activity } }, 600);
});
