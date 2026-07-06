/** Address surfaces: holdings + record tabs, the composed reputation score, account summary, issued
 *  assets, and the relationship reads (connections graph, sweep-based identity lineage). SQL lives in
 *  queries/addresses.ts; the reputation composition (scoring + archetype tags) stays here — it's
 *  reputation logic, not SQL. */
import { router, J, lim, off, round } from "./respond";
import { scoreAddress, addressScore, addressTier, type AddrState, rawSqlExpr, ADDRESS_FACTORS } from "../reputation/score";
import { ADDRESS_TIERS, ADDRESS_TIER_MEANING, OG, TAG } from "../reputation/config";
import {
  listBalances, listSends, listIssuances, listDispensers, listDispenses, listIssued,
  addressSummary, addressReputationRow, addressConnections, addressLineage,
  maxBlockIndex, reputationDistribution, reputationTop,
} from "../queries/addresses";

export const addresses = router();

addresses.get("/v2/addresses/:addr/balances", async (c) => {
  const result = await listBalances(c.env.DB, c.req.param("addr"), { limit: lim(c), offset: off(c) });
  return J(c, { result, next_offset: off(c) + lim(c) });
});

addresses.get("/v2/addresses/:addr/sends", async (c) => {
  const result = await listSends(c.env.DB, c.req.param("addr"), { limit: lim(c), offset: off(c) });
  return J(c, { result, next_offset: off(c) + lim(c) });
});

addresses.get("/v2/addresses/:addr/issuances", async (c) => {
  const result = await listIssuances(c.env.DB, c.req.param("addr"), { limit: lim(c), offset: off(c) });
  return J(c, { result, next_offset: off(c) + lim(c) });
});

addresses.get("/v2/addresses/:addr/dispensers", async (c) => {
  const result = await listDispensers(c.env.DB, c.req.param("addr"), { limit: lim(c), offset: off(c) });
  return J(c, { result, next_offset: off(c) + lim(c) });
});

addresses.get("/v2/addresses/:addr/dispenses", async (c) => {
  const result = await listDispenses(c.env.DB, c.req.param("addr"), { limit: lim(c), offset: off(c) });
  return J(c, { result, next_offset: off(c) + lim(c) });
});

// Address reputation — composed, intrinsic, earned-only score from precomputed address_signals.
// Returns a 0-100 score (percentile-mapped from the skewed raw distribution), a band, archetype tags,
// and the EVIDENCE behind it (so it's explainable, not a black box). New/quiet addresses read neutral.
addresses.get("/v2/addresses/:addr/reputation", async (c) => {
  const h = c.req.param("addr");
  const r = await addressReputationRow(c.env.DB, h);
  if (!r || !r.first_blk) return J(c, { result: { score: null, tier: "No history", band: "No history", tier_meaning: ADDRESS_TIER_MEANING["No history"], tags: [], evidence: null } }, 300);
  const n = (v: unknown) => Number(v) || 0;
  const T = TAG;
  const xcp = n(r.xcp), first = n(r.first_blk), last = n(r.last_blk), tip = n(r.tip);
  // all scoring math lives in src/reputation/* (config + generic engine) — tune weights there.
  const { raw, breakdown } = scoreAddress(r, tip);
  // Infrastructure + throwaway addresses are NON-RANKED (their own honest state); real users get a tier.
  const isExch = n(r.is_exchange) === 1, isDep = n(r.is_deposit) === 1;
  const og = (tip - first) > OG.minAgeBlocks && last >= OG.modernBlock; // OG = old AND active into the modern chain
  // "active" = any reputation-bearing footprint; a passive one-shot recipient is Dormant, not ranked.
  const activeUser = n(r.assets_held) > 0 || n(r.survived_assets) > 0 || n(r.dex_trades) > 0 || n(r.dispenses) > 0
    || n(r.btc_fees) > 0 || n(r.assets_issued) > 0 || n(r.dividends) > 0;
  const state: AddrState = isExch ? "exchange" : isDep ? "deposit" : n(r.is_emblem_vault) === 1 ? "vault"
    : n(r.is_burn) === 1 ? "burn" : n(r.likely_service) === 1 ? "service" : !activeUser ? "dormant" : "ranked";
  const tier = addressTier(raw, state);
  const score = state === "ranked" ? addressScore(raw) : null; // only real users get a 0-100 percentile
  const tags: string[] = [];
  if (state !== "ranked") tags.push(tier); // infra/dormant get their state as the tag
  if (state === "ranked") {
    if (og) tags.push("Early Adopter"); // age signal (arrived early + still active); distinct from the OG tier
    if (n(r.survived_assets) >= T.creatorSurvived) tags.push("Creator");
    if (n(r.assets_held) >= T.collectorHeld) tags.push("Collector");
    if (n(r.dispenses) >= T.merchantDispenses) tags.push("Merchant");
    if (xcp >= T.whaleXcp || n(r.assets_held) >= T.whaleHeld) tags.push("Whale");
    if (n(r.assets_burned) >= T.burnerAssets) tags.push("Burner");
    // Bitcoin Stamps / BTNS archetypes (descriptive segmentation tags, not score weights)
    if (n(r.stamps_created) >= T.stampCreator) tags.push("Stamp Creator");
    if (n(r.src20_deploys) >= 1) tags.push("SRC-20 Deployer");
    if (n(r.stamps_collected) >= T.stampCollector) tags.push("Stamp Collector");
    if (n(r.is_btns_user) === 1) tags.push("BTNS User");
  }
  return J(c, { result: {
    score, tier, band: tier, tier_meaning: ADDRESS_TIER_MEANING[tier] ?? null, tags,
    evidence: {
      first_block: first, last_block: last, span_years: round((last - first) / 52560, 1),
      survived_assets: n(r.survived_assets), assets_distributed: n(r.assets_distributed), assets_hits: n(r.assets_hits), dividends: n(r.dividends),
      dispense_btc: round(n(r.dispense_btc), 2), btc_fees: round(n(r.btc_fees), 3),
      btc_spent: round(n(r.btc_spent), 2), inbound_peers: n(r.in_peers),
      assets_held: n(r.assets_held), xcp: Math.round(xcp),
      assets_burned: n(r.assets_burned),
      stamps_created: n(r.stamps_created), stamps_collected: n(r.stamps_collected),
      src20_deploys: n(r.src20_deploys), btns_user: n(r.is_btns_user) === 1,
    },
    raw: round(raw, 2), breakdown, // per-factor contribution — explains the score, powers weight tuning
  } }, 300);
});

// Reputation tuning/calibration view: the population raw-score distribution across the band boundaries +
// band counts + the top of the table (to spot-check). Run after a weight change in reputation/config.ts to
// recalibrate the percentile anchors (set pct.p50/p90/p99 to where the population actually lands). Cheap:
// one GROUP BY (no window sort). Excludes infra (exchange/deposit/burn/vault) — they aren't user scores.
addresses.get("/v2/reputation/review", async (c) => {
  const tip = Number((await maxBlockIndex(c.env.DB))?.m) || 0;
  const expr = rawSqlExpr(ADDRESS_FACTORS, tip); // built from the SAME factor config as the read scorer
  // same population the read endpoint ranks: real users only (infra + passive throwaways excluded)
  const notInfra = `is_exchange=0 AND is_deposit=0 AND is_burn=0 AND COALESCE(is_emblem_vault,0)=0 AND COALESCE(likely_service,0)=0 AND first_blk IS NOT NULL AND (assets_held>0 OR survived_assets>0 OR dex_trades>0 OR dispenses>0 OR btc_fees>0 OR assets_issued>0 OR dividends>0)`;
  const [vetCut, estCut, actCut] = [ADDRESS_TIERS[0].minRaw, ADDRESS_TIERS[1].minRaw, ADDRESS_TIERS[2].minRaw];
  const distribution = await reputationDistribution(c.env.DB, expr, notInfra, vetCut, estCut, actCut).catch(() => null);
  const top = await reputationTop(c.env.DB, expr, notInfra).catch(() => []);
  return J(c, {
    result: {
      factors: ADDRESS_FACTORS.filter((f) => f.weight).map((f) => ({ key: f.key, weight: f.weight, transform: f.transform })),
      anchors_in_use: { note: "set pct anchors in reputation/config.ts to match 'distribution' below" },
      distribution, top,
    },
  }, 60);
});

addresses.get("/v2/addresses/:addr/summary", async (c) => {
  const result = await addressSummary(c.env.DB, c.req.param("addr"));
  return J(c, { result }, 30);
});

addresses.get("/v2/addresses/:addr/issued", async (c) => {
  const result = await listIssued(c.env.DB, c.req.param("addr"), { limit: lim(c), offset: off(c) });
  return J(c, { result, next_offset: off(c) + lim(c) });
});

// Address connections: top counterparties merged across sends + dispenses + DEX order matches.
// The on-chain social/money graph for an address. Excludes self.
// Two directions per relationship folded into one CASE term each (D1 caps UNION-ALL terms low).
// Exchange-DEPOSIT counterparties are filtered out: they're 1:1 plumbing (validated — they're 60% of an
// exchange's "connections" but ~0% of a real user's), so they bury genuine relationships. is_exchange
// counterparties are KEPT (a real "uses this exchange" signal) and flagged so the UI can badge them.
addresses.get("/v2/addresses/:addr/connections", async (c) => {
  const result = await addressConnections(c.env.DB, c.req.param("addr"), lim(c, 12, 24));
  return J(c, { result }, 120);
});

// Identity lineage via sweeps — a SWEEP moves all assets+ownership to another address (strongest
// "same person" signal on chain). Returns swept-to / swept-from links to chain identity clusters.
addresses.get("/v2/addresses/:addr/lineage", async (c) => {
  const result = await addressLineage(c.env.DB, c.req.param("addr"));
  return J(c, { result }, 300);
});
