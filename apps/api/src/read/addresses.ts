/** Address surfaces: holdings + record tabs, the composed reputation score, account summary, issued
 *  assets, and the relationship reads (connections graph, sweep-based identity lineage). SQL lives in
 *  queries/addresses.ts; the reputation composition (scoring + archetype tags) stays here — it's
 *  reputation logic, not SQL. */
import { router, J, lim, off, round, cached } from "./respond";
import { scoreAddress, addressScore, addressTier, type AddrState, rawSqlExpr, ADDRESS_FACTORS } from "../reputation/score";
import { classifyPersona } from "../reputation/persona";
import { ADDRESS_TIERS, ADDRESS_TIER_MEANING, OG, TAG } from "../reputation/config";
import {
  listBalances, listSends, listIssuances, listDispensers, listDispenses, listIssued, listAddressLedger, listAddressLedgerLegacy,
  addressSummary, addressReputationRow, addressConnections, addressLineage,
  maxBlockIndex, reputationDistribution, reputationTop, reputationTierMembers, reputationFunnel, reputationHistogram,
} from "../queries/addresses";

export const addresses = router();

// Real-user population filter shared by every reputation-tier read. The ONLY thing that isn't a real
// user is infrastructure (exchange / deposit / burn / vault / service). EVERYTHING ELSE that we know
// about appeared on-chain doing SOMETHING — received or sent an asset, bought from a dispenser, created
// one, issued, traded — and therefore has history. "No history" is a contradiction: if it were truly
// historyless we wouldn't have a row for it. So the gate is "not infrastructure AND has any on-chain
// footprint": a comprehensive first_block (any appearance — see signals.ts addr_*_seen builders), send
// peers, BTC spent, a holding, or any earned signal. This collapses the old "no history" bucket to ~0.
const NOT_INFRA = `is_exchange=0 AND is_deposit=0 AND is_burn=0 AND COALESCE(is_emblem_vault,0)=0 AND COALESCE(likely_service,0)=0 AND (first_block IS NOT NULL OR in_peers>0 OR out_peers>0 OR COALESCE(btc_spent,0)>0 OR assets_held>0 OR survived_assets>0 OR dex_trades>0 OR dispenses>0 OR btc_fees>0 OR assets_issued>0 OR dividends>0)`;

addresses.get("/v2/addresses/:address/balances", async (c) => {
  const result = await listBalances(c.env.DB, c.req.param("address"), { limit: lim(c), offset: off(c) });
  return J(c, { result, next_offset: result.length === lim(c) ? off(c) + lim(c) : null });
});

addresses.get("/v2/addresses/:address/sends", async (c) => {
  const result = await listSends(c.env.DB, c.req.param("address"), { limit: lim(c), offset: off(c) });
  return J(c, { result, next_offset: result.length === lim(c) ? off(c) + lim(c) : null });
});

// Provenance ledger — every raw credit/debit for the address (credits/debits, migration 0038): the full
// money-in/out history with each event's Counterparty reason. Empty until the ledger is backfilled by a reindex.
addresses.get("/v2/addresses/:address/ledger", async (c) => {
  const page = { limit: lim(c), offset: off(c) };
  const cutover = await c.env.LEDGER_DB.prepare("SELECT value FROM ledger_state WHERE key='read_cutover'").first<{ value: string }>();
  const result = cutover?.value === "1"
    ? await listAddressLedger(c.env.LEDGER_DB, c.req.param("address"), page)
    : await listAddressLedgerLegacy(c.env.DB, c.req.param("address"), page);
  return J(c, { result, next_offset: result.length === lim(c) ? off(c) + lim(c) : null });
});

addresses.get("/v2/addresses/:address/issuances", async (c) => {
  const result = await listIssuances(c.env.DB, c.req.param("address"), { limit: lim(c), offset: off(c) });
  return J(c, { result, next_offset: result.length === lim(c) ? off(c) + lim(c) : null });
});

addresses.get("/v2/addresses/:address/dispensers", async (c) => {
  const result = await listDispensers(c.env.DB, c.req.param("address"), { limit: lim(c), offset: off(c) });
  return J(c, { result, next_offset: result.length === lim(c) ? off(c) + lim(c) : null });
});

addresses.get("/v2/addresses/:address/dispenses", async (c) => {
  const result = await listDispenses(c.env.DB, c.req.param("address"), { limit: lim(c), offset: off(c) });
  return J(c, { result, next_offset: result.length === lim(c) ? off(c) + lim(c) : null });
});

// Address reputation — composed, intrinsic, earned-only score from precomputed address_signals.
// Returns a 0-100 score (percentile-mapped from the skewed raw distribution), a band, archetype tags,
// and the EVIDENCE behind it (so it's explainable, not a black box). New/quiet addresses read neutral.
addresses.get("/v2/addresses/:address/reputation", async (c) => {
  const h = c.req.param("address");
  const r = await addressReputationRow(c.env.DB, h);
  if (!r || !r.first_block) return J(c, { result: { score: null, tier: "No history", band: "No history", tier_meaning: ADDRESS_TIER_MEANING["No history"], tags: [], evidence: null, persona: null } }, 300);
  const n = (v: unknown) => Number(v) || 0;
  const T = TAG;
  const xcp = n(r.xcp), first = n(r.first_block), last = n(r.last_block), tip = n(r.tip);
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
  // PERSONA — the dominant ROLE (what it does), orthogonal to the reputation score (whether to trust it).
  // Composed from the same signals as the archetype tags below, so the headline and the chips agree.
  const persona = classifyPersona(r, state);
  const tags: string[] = [];
  if (state !== "ranked") tags.push(tier); // infra/dormant get their state as the tag
  if (state === "ranked") {
    if (og) tags.push("Early Adopter"); // age signal (arrived early + still active); distinct from the OG tier
    if (n(r.survived_assets) >= 20) tags.push("Prolific Creator"); // matches tags.ts prolific_creator
    else if (n(r.survived_assets) >= T.creatorSurvived) tags.push("Creator");
    if (n(r.assets_held) >= T.collectorHeld) tags.push("Collector");
    if (n(r.dispenses) >= T.merchantDispenses) tags.push("Merchant");
    if (n(r.dex_trades) >= 100) tags.push("Active Trader"); // matches tags.ts trader/active_trader
    else if (n(r.dex_trades) >= 10) tags.push("Trader");
    if (n(r.dividends) >= 1) tags.push("Dividend Payer");
    if (xcp >= T.whaleXcp || n(r.assets_held) >= T.whaleHeld) tags.push("Whale");
    if (n(r.assets_burned) >= T.burnerAssets) tags.push("Burner");
    // Bitcoin Stamps / BTNS archetypes (descriptive segmentation tags, not score weights)
    if (n(r.stamps_created) >= T.stampCreator) tags.push("Stamp Creator");
    if (n(r.src20_deploys) >= 1) tags.push("SRC-20 Deployer");
    if (n(r.stamps_collected) >= T.stampCollector) tags.push("Stamp Collector");
    if (n(r.is_btns_user) === 1) tags.push("BTNS User");
  }
  return J(c, { result: {
    score, tier, band: tier, tier_meaning: ADDRESS_TIER_MEANING[tier] ?? null, tags, persona,
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
  const [vetCut, estCut, actCut] = [ADDRESS_TIERS[0].minRaw, ADDRESS_TIERS[1].minRaw, ADDRESS_TIERS[2].minRaw];
  const distribution = await reputationDistribution(c.env.DB, expr, NOT_INFRA, vetCut, estCut, actCut).catch(() => null);
  const top = await reputationTop(c.env.DB, expr, NOT_INFRA).catch(() => []);
  return J(c, {
    result: {
      factors: ADDRESS_FACTORS.filter((f) => f.weight).map((f) => ({ key: f.key, weight: f.weight, transform: f.transform })),
      anchors_in_use: { note: "set pct anchors in reputation/config.ts to match 'distribution' below" },
      distribution, top,
    },
  }, 60);
});

// Public reputation-tiers overview — the real-user population split across OG/Established/Active/Casual,
// each with its raw-score cutoff, plain-language meaning, and current head count. Backs the /reputation
// page; each tier deep-links to its membership below.
addresses.get("/v2/reputation/tiers", (c) =>
  cached(c, "reputation:tiers", { ttl: 3600, edge: 300, swr: 86400 }, async () => {
  const tip = Number((await maxBlockIndex(c.env.DB))?.m) || 0;
  const expr = rawSqlExpr(ADDRESS_FACTORS, tip);
  const [vetCut, estCut, actCut] = [ADDRESS_TIERS[0].minRaw, ADDRESS_TIERS[1].minRaw, ADDRESS_TIERS[2].minRaw];
  const [d, f, histogram] = await Promise.all([
    reputationDistribution(c.env.DB, expr, NOT_INFRA, vetCut, estCut, actCut).catch(() => null),
    reputationFunnel(c.env.DB).catch(() => null),
    reputationHistogram(c.env.DB, expr, NOT_INFRA, 40).catch(() => []),
  ]);
  const counts: Record<string, number> = { OG: d?.og ?? 0, Established: d?.established ?? 0, Active: d?.active ?? 0, Casual: d?.casual ?? 0 };
  const tiers = ADDRESS_TIERS.map((t) => ({ tier: t.tier, slug: t.tier.toLowerCase(), min_raw: t.minRaw, meaning: t.meaning, count: counts[t.tier] ?? 0 }));
  const scored = d?.n ?? 0;
  const infrastructure = f?.infra ?? 0;
  // The census is every REAL address: infrastructure + scored users. "No history" is definitionally 0 —
  // a historyless row is a contradiction (see NOT_INFRA). The mirror still carries a handful of
  // footprint-less rows left by a since-removed graph experiment (a stale rep_score, zero on-chain
  // history); they are not real addresses, so they're excluded from the total rather than shown as an
  // orphan "no history" bucket.
  const total_addresses = infrastructure + scored;
  const funnel = {
    total_addresses, infrastructure, scored, no_history: 0,
    by_kind: { exchanges: f?.exchanges ?? 0, deposits: f?.deposits ?? 0, vaults: f?.vaults ?? 0, burns: f?.burns ?? 0, services: f?.services ?? 0 },
  };
  return { result: { total: scored, mean: d?.mean ?? 0, max: d?.max ?? 0, funnel, histogram, tiers } };
  })
);

// One reputation tier's definition + its ranked membership (paginated) — the deep-link target for the
// tier labels in the Holder view and holders-table badges.
addresses.get("/v2/reputation/tiers/:tier", async (c) => {
  const slug = c.req.param("tier").toLowerCase();
  const idx = ADDRESS_TIERS.findIndex((t) => t.tier.toLowerCase() === slug);
  if (idx < 0) return c.json({ error: "Unknown reputation tier" }, 404);
  const t = ADDRESS_TIERS[idx];
  const maxRaw = idx === 0 ? 1e9 : ADDRESS_TIERS[idx - 1].minRaw; // upper bound = the next-higher tier's cutoff
  const tip = Number((await maxBlockIndex(c.env.DB))?.m) || 0;
  const expr = rawSqlExpr(ADDRESS_FACTORS, tip);
  const members = await reputationTierMembers(c.env.DB, expr, NOT_INFRA, t.minRaw, maxRaw, lim(c), off(c)).catch(() => []);
  const summary = { tier: t.tier, slug, min_raw: t.minRaw, meaning: t.meaning, count: 0 };
  return J(c, { result: { tier: summary, members }, next_offset: members.length === lim(c) ? off(c) + lim(c) : null }, 120);
});

addresses.get("/v2/addresses/:address/summary", async (c) => {
  const result = await addressSummary(c.env.DB, c.req.param("address"));
  return J(c, { result }, 30);
});

addresses.get("/v2/addresses/:address/issued", async (c) => {
  const result = await listIssued(c.env.DB, c.req.param("address"), { limit: lim(c), offset: off(c) });
  return J(c, { result, next_offset: result.length === lim(c) ? off(c) + lim(c) : null });
});

// Address connections: top counterparties merged across sends + dispenses + DEX order matches.
// The on-chain social/money graph for an address. Excludes self.
// Two directions per relationship folded into one CASE term each (D1 caps UNION-ALL terms low).
// Exchange-DEPOSIT counterparties are filtered out: they're 1:1 plumbing (validated — they're 60% of an
// exchange's "connections" but ~0% of a real user's), so they bury genuine relationships. is_exchange
// counterparties are KEPT (a real "uses this exchange" signal) and flagged so the UI can badge them.
addresses.get("/v2/addresses/:address/connections", async (c) => {
  const result = await addressConnections(c.env.DB, c.req.param("address"), lim(c, 12, 24));
  return J(c, { result }, 120);
});

// Identity lineage via sweeps — a SWEEP moves all assets+ownership to another address (strongest
// "same person" signal on chain). Returns swept-to / swept-from links to chain identity clusters.
addresses.get("/v2/addresses/:address/lineage", async (c) => {
  const result = await addressLineage(c.env.DB, c.req.param("address"));
  return J(c, { result }, 300);
});
