/**
 * Graph-reputation SCORECARD — the objective success criteria for any graph variant (flat / temporal /
 * value-weighted / threshold / harvested seeds), computed on whatever is currently in the signal tables.
 * Pairs with the sybil/aged-address cases in tests/graph.test.ts (the cheap harness screen). Run this after
 * each prod rebuild; compare rows across variants to pick a winner instead of eyeballing. See
 * docs/graph-reputation.md (Phase C/D). The graph trait is a DISPLAYED tier + curation queue, so "success" =
 * precise tiers, gaming resistance, and good curation candidates — decomposed into the criteria below.
 */
import type { Env } from "../index";

// Known-legit assets that must NOT read distrusted (coverage watchlist — the BITCRYSTALS class + anchors).
const LEGIT_WATCHLIST = ["BITCRYSTALS", "SJCX", "FLDC", "GEMZ", "SCOTCOIN", "TRIGGERS", "MAFIACASH", "RUSTBITS", "XCP", "PEPECASH", "BITCORN", "FLDC"];

async function cut(env: Env, key: string): Promise<number> {
  const v = (await env.DB.prepare(`SELECT value FROM indexer_state WHERE key=?`).bind(key).first<{ value: string }>())?.value;
  return Number(v) || 0;
}
async function one(env: Env, sql: string): Promise<Record<string, number>> {
  return (await env.DB.prepare(sql).first<Record<string, number>>()) ?? {};
}

/** Compute the full scorecard for the graph currently written to asset_signals / address_signals. */
export async function graphEval(env: Env): Promise<Record<string, unknown>> {
  const [aT, aD, rT, rD] = [await cut(env, "graph_cut_asset_trust"), await cut(env, "graph_cut_asset_distrust"), await cut(env, "graph_cut_addr_trust"), await cut(env, "graph_cut_addr_distrust")];
  // tier predicates (mirror graphTier): distrusted = d>t & d>cutD ; trusted = t>0 & t>=d & t>=cutT
  const aDist = `graph_distrust>graph_trust AND graph_distrust>${aD}`;
  const aTrust = `graph_trust>0 AND graph_trust>=graph_distrust AND graph_trust>=${aT}`;
  const rDist = `graph_distrust>graph_trust AND graph_distrust>${rD}`;
  const rTrust = `graph_trust>0 AND graph_trust>=graph_distrust AND graph_trust>=${rT}`;

  const aTiers = await one(env, `SELECT SUM(CASE WHEN ${aTrust} THEN 1 ELSE 0 END) trusted, SUM(CASE WHEN ${aDist} THEN 1 ELSE 0 END) distrusted, COUNT(*) total FROM asset_signals`);
  const rTiers = await one(env, `SELECT SUM(CASE WHEN ${rTrust} THEN 1 ELSE 0 END) trusted, SUM(CASE WHEN ${rDist} THEN 1 ELSE 0 END) distrusted, COUNT(*) total FROM address_signals`);

  // C1 — catches known-bad: recall of curated lowq assets, and of derived scam-actor addresses, in distrust.
  const recallLowq = await one(env, `SELECT SUM(CASE WHEN ${aDist} THEN 1 ELSE 0 END) hit, COUNT(*) total FROM asset_signals WHERE asset IN (SELECT key FROM curated WHERE kind='lowq')`);
  const recallScam = await one(env, `SELECT SUM(CASE WHEN ${rDist} THEN 1 ELSE 0 END) hit, COUNT(*) total FROM address_signals WHERE COALESCE(shell_scams,0)>0 OR COALESCE(vault_scams,0)>0`);

  // C2 — no false-flags: established-CLEAN assets (real market, not lowq) that read distrusted. Target ≤2.
  const falseFlag = await one(env, `SELECT COUNT(*) n FROM asset_signals WHERE ${aDist} AND low_quality=0 AND holders>500 AND trades>500`);

  // C3 — distrust is MEANINGFUL: contamination = share of the distrusted tier that actually has a clean market
  // (holders>100 & trades>10 & lowq=0). Lower = the tier is confidently bad, not smearing legit assets.
  const contam = await one(env, `SELECT SUM(CASE WHEN low_quality=0 AND holders>100 AND trades>10 THEN 1 ELSE 0 END) clean, COUNT(*) distrusted FROM asset_signals WHERE ${aDist}`);

  // C5 — aged-address resistance: what fraction of the TRUSTED address cohort is dormant (>1yr since last
  // activity). A flat PPR rewards stale position; temporal decay should shrink this (trust flows old→new).
  const tip = (await one(env, `SELECT MAX(block_index) m FROM blocks`)).m ?? 0;
  const dormant = await one(env, `SELECT SUM(CASE WHEN ${rTrust} THEN 1 ELSE 0 END) trusted, SUM(CASE WHEN ${rTrust} AND ${tip}-last_block>52560 THEN 1 ELSE 0 END) dormant FROM address_signals`);

  // C6 — legit coverage: of the watchlist, how many read trusted (good) vs distrusted (bad).
  const wl = LEGIT_WATCHLIST.map((a) => `'${a}'`).join(",");
  const coverage = await one(env, `SELECT SUM(CASE WHEN ${aTrust} THEN 1 ELSE 0 END) trusted, SUM(CASE WHEN ${aDist} THEN 1 ELSE 0 END) distrusted, COUNT(*) present FROM asset_signals WHERE asset IN (${wl})`);

  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : 0);
  return {
    cuts: { asset_trust: aT, asset_distrust: aD, addr_trust: rT, addr_distrust: rD },
    tiers: {
      assets: { trusted: aTiers.trusted, distrusted: aTiers.distrusted, unscored_pct: pct((aTiers.total ?? 0) - (aTiers.trusted ?? 0) - (aTiers.distrusted ?? 0), aTiers.total ?? 0) },
      addresses: { trusted: rTiers.trusted, distrusted: rTiers.distrusted, unscored_pct: pct((rTiers.total ?? 0) - (rTiers.trusted ?? 0) - (rTiers.distrusted ?? 0), rTiers.total ?? 0) },
    },
    c1_known_bad_recall: { lowq_assets_pct: pct(recallLowq.hit ?? 0, recallLowq.total ?? 0), scam_addrs_pct: pct(recallScam.hit ?? 0, recallScam.total ?? 0), lowq: recallLowq, scam: recallScam },
    c2_false_flag_established: falseFlag.n,
    c3_distrust_contamination_pct: pct(contam.clean ?? 0, contam.distrusted ?? 0),
    c5_trusted_dormant_pct: pct(dormant.dormant ?? 0, dormant.trusted ?? 0),
    c6_watchlist_coverage: { trusted: coverage.trusted, distrusted: coverage.distrusted, present: coverage.present, of: LEGIT_WATCHLIST.length },
  };
}
