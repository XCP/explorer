/** Address surfaces: holdings + record tabs, the composed reputation score, account summary, issued
 *  assets, and the relationship reads (connections graph, sweep-based identity lineage). SQL lives in
 *  queries/addresses.ts; the reputation composition (scoring + archetype tags) stays here — it's
 *  reputation logic, not SQL. */
import { router, J, lim, off, round, cached } from "#api/read/respond";
import { listAddressBalances, listAddressSends, listAddressUtxoBalances } from "#api/queries/core";
import { classifyPersona } from "#api/reputation/persona";
import { addressCurrentActivity } from "#api/reputation/activity";
import { TAG } from "#api/reputation/config";
import {
  ADDRESS_REPUTATION_BANDS,
  ADDRESS_REPUTATION_MODEL_VERSION,
  ADDRESS_REPUTATION_STATE_LABELS,
  addressReputationState,
  addressReputationTier,
} from "#api/indexer/address-reputation";
import {
  listIssuances,
  listDispensers,
  listDispenses,
  listIssued,
  listAddressLedger,
  addressSummary,
  addressReputationRow,
  addressConnections,
  addressLineage,
  reputationDistribution,
  reputationTop,
  reputationMetadata,
  reputationTierMembers,
  reputationFunnel,
  reputationHistogram,
  addressCensus,
} from "#api/queries/addresses";
import { listAddressCollectionCreators } from "#api/queries/collections";

export const addresses = router();

// Real-user population filter shared by every reputation-tier read. The ONLY thing that isn't a real
// user is explicitly identified infrastructure (exchange / deposit / burn / vault). EVERYTHING ELSE that we know
// about appeared on-chain doing SOMETHING — received or sent an asset, bought from a dispenser, created
// one, issued, traded — and therefore has history. "No history" is a contradiction: if it were truly
// historyless we wouldn't have a row for it. So the gate is "not infrastructure AND has any on-chain
// footprint": a comprehensive first_block (any appearance — see signals.ts addr_*_seen builders), send
// peers, BTC spent, a holding, or any earned signal. This collapses the old "no history" bucket to ~0.

// Population census — the /addresses knowledge page. Registered before the :address routes so the
// literal segment cannot be captured as an address. One D1-cached payload, refreshed daily.
addresses.get("/v2/addresses/census", (c) =>
  cached(c, "addresses:census:1", { ttl: 86400, edge: 600, swr: 86400 }, async () => ({
    result: await addressCensus(c.env.CORE_DB),
  })),
);

// Batch creator lookup — badges for a page of addresses in one call. Literal segment, so it sits with
// census ahead of the :address routes. Keyed by the address list, so the edge cache serves repeat pages.
addresses.get("/v2/addresses/collections", async (c) => {
  const requested = (c.req.query("addresses") ?? "")
    .split(",")
    .map((address) => address.trim())
    .filter(Boolean);
  const unique = [...new Set(requested)];
  if (unique.length === 0 || unique.length > 50)
    return c.json({ error: "addresses: 1 to 50 comma-separated addresses" }, 400);
  return J(c, { result: await listAddressCollectionCreators(c.env.CORE_DB, unique) }, 600);
});

addresses.get("/v2/addresses/:address/balances", async (c) => {
  const type = c.req.query("type") ?? "address";
  if (type !== "address" && type !== "utxo") {
    return c.json({ error: "type must be address or utxo" }, 400);
  }
  const page = { limit: lim(c), offset: off(c) };
  const result =
    type === "address"
      ? await listAddressBalances(c.env.CORE_DB, c.req.param("address"), page.limit, page.offset)
      : await listAddressUtxoBalances(c.env.CORE_DB, c.req.param("address"), page.limit, page.offset);
  return J(c, {
    result,
    result_count: result.length,
    next_offset: result.length === page.limit ? page.offset + page.limit : null,
  });
});

addresses.get("/v2/addresses/:address/sends", async (c) => {
  const page = { limit: lim(c), offset: off(c) };
  const result = await listAddressSends(c.env.CORE_DB, c.req.param("address"), page.limit, page.offset);
  return J(c, { result, next_offset: result.length === lim(c) ? off(c) + lim(c) : null });
});

addresses.get("/v2/addresses/:address/ledger", async (c) => {
  const page = { limit: lim(c), offset: off(c) };
  const result = await listAddressLedger(c.env.CORE_DB, c.req.param("address"), page);
  return J(c, { result, next_offset: result.length === lim(c) ? off(c) + lim(c) : null });
});

addresses.get("/v2/addresses/:address/issuances", async (c) => {
  const result = await listIssuances(c.env.CORE_DB, c.req.param("address"), { limit: lim(c), offset: off(c) });
  return J(c, { result, next_offset: result.length === lim(c) ? off(c) + lim(c) : null });
});

addresses.get("/v2/addresses/:address/dispensers", async (c) => {
  const result = await listDispensers(c.env.CORE_DB, c.req.param("address"), { limit: lim(c), offset: off(c) });
  return J(c, { result, next_offset: result.length === lim(c) ? off(c) + lim(c) : null });
});

addresses.get("/v2/addresses/:address/dispenses", async (c) => {
  const result = await listDispenses(c.env.CORE_DB, c.req.param("address"), { limit: lim(c), offset: off(c) });
  return J(c, { result, next_offset: result.length === lim(c) ? off(c) + lim(c) : null });
});

// Address reputation — composed, intrinsic, earned-only score from precomputed address_signals.
// Returns a 0-100 score (percentile-mapped from the skewed raw distribution), a band, archetype tags,
// and the EVIDENCE behind it (so it's explainable, not a black box). New/quiet addresses read neutral.
addresses.get("/v2/addresses/:address/reputation", async (c) => {
  const h = c.req.param("address");
  const r = await addressReputationRow(c.env.CORE_DB, h);
  if (!r || !r.first_block)
    return J(
      c,
      {
        result: {
          track_record: {
            score: null,
            tier: "No history",
            meaning: ADDRESS_REPUTATION_STATE_LABELS.unrated,
          },
          activity: null,
          tags: [],
          evidence: null,
          persona: null,
          components: null,
          rank_position: null,
          population: null,
          calculated_at: null,
          model_version: null,
        },
      },
      300,
    );
  const n = (v: unknown) => Number(v) || 0;
  const T = TAG;
  const xcp = n(r.xcp),
    first = n(r.first_block),
    last = n(r.last_block);
  // all scoring math lives in src/reputation/* (config + generic engine) — tune weights there.
  const state = addressReputationState(r as unknown as Record<string, unknown>);
  const score = state === "ranked" ? round(n(r.reputation), 1) : null;
  const tier = state === "ranked" ? addressReputationTier(n(r.reputation)) : ADDRESS_REPUTATION_STATE_LABELS[state];
  // Infrastructure + throwaway addresses are NON-RANKED (their own honest state); real users get a tier.
  const activity = addressCurrentActivity(r.last_active_at, r.observed_at);
  // PERSONA — the dominant ROLE (what it does), orthogonal to the reputation score (whether to trust it).
  // Composed from the same signals as the archetype tags below, so the headline and the chips agree.
  const persona = state === "integrity" || state === "unrated" ? null : classifyPersona(r, state);
  const tags: string[] = [];
  if (state !== "ranked") tags.push(tier); // infra/dormant get their state as the tag
  if (state === "ranked") {
    if (n(r.survived_assets) >= 20)
      tags.push("Prolific Creator"); // matches tags.ts prolific_creator
    else if (n(r.survived_assets) >= T.creatorSurvived) tags.push("Creator");
    if (n(r.assets_held) >= T.collectorHeld) tags.push("Collector");
    if (n(r.dispenses) >= T.merchantDispenses) tags.push("Merchant");
    if (n(r.dex_trades) >= 100)
      tags.push("Active Trader"); // matches tags.ts trader/active_trader
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
  return J(
    c,
    {
      result: {
        track_record: {
          score,
          tier,
          meaning:
            state === "ranked"
              ? (ADDRESS_REPUTATION_BANDS.find((band) => band.tier === tier)?.meaning ?? null)
              : ADDRESS_REPUTATION_STATE_LABELS[state],
        },
        activity,
        tags,
        persona,
        evidence: {
          first_block: first,
          last_block: last,
          span_years: round((last - first) / 52560, 1),
          survived_assets: n(r.survived_assets),
          assets_distributed: n(r.assets_distributed),
          assets_hits: n(r.assets_hits),
          dividends: n(r.dividends),
          dispense_btc: round(n(r.dispense_btc), 2),
          btc_fees: round(n(r.btc_fees), 3),
          btc_spent: round(n(r.btc_spent), 2),
          inbound_peers: n(r.in_peers),
          assets_held: n(r.assets_held),
          xcp: Math.round(xcp),
          assets_burned: n(r.assets_burned),
          stamps_created: n(r.stamps_created),
          stamps_collected: n(r.stamps_collected),
          src20_deploys: n(r.src20_deploys),
          btns_user: n(r.is_btns_user) === 1,
        },
        components:
          state === "ranked"
            ? {
                duration: round(n(r.duration_score), 1),
                creation: round(n(r.creation_score), 1),
                economic: round(n(r.economic_score), 1),
                participation: round(n(r.participation_score), 1),
              }
            : null,
        rank_position: state === "ranked" ? n(r.rank_position) : null,
        population: state === "ranked" ? n(r.population) : null,
        calculated_at: state === "ranked" ? n(r.calculated_at) : null,
        model_version: state === "ranked" ? n(r.model_version) : null,
      },
    },
    300,
  );
});

// Methodology review: model identity, family weights, band distribution, and top-ranked addresses.
addresses.get("/v2/reputation/review", async (c) => {
  const [distribution, top, metadata] = await Promise.all([
    reputationDistribution(c.env.CORE_DB).catch(() => null),
    reputationTop(c.env.CORE_DB).catch(() => []),
    reputationMetadata(c.env.CORE_DB).catch(() => null),
  ]);
  return J(
    c,
    {
      result: {
        model_version: ADDRESS_REPUTATION_MODEL_VERSION,
        calculated_at: metadata?.calculated_at ?? null,
        families: ["duration", "creation", "economic", "participation"],
        family_weight: 0.25,
        distribution,
        top,
      },
    },
    60,
  );
});

// Public Reputation overview: fixed bands, methodology metadata, classification census, and histogram.
addresses.get("/v2/reputation/tiers", (c) =>
  // ttl matches the data, which refreshes weekly (ADDRESS_REPUTATION_REFRESH_SECONDS).
  // At ttl 3600 the four reads behind this ran 64 times in 13h and scanned the two
  // largest tables whole each time -- the histogram alone is a GROUP BY over all
  // ~677,000 scored rows, and the funnel a full SUM(CASE) over address_signals,
  // together ~$3.90/mo to recompute a page that could not have changed.
  cached(c, "reputation:tiers:v2", { ttl: 86_400, edge: 300, swr: 604_800 }, async () => {
    const [d, f, histogram, metadata] = await Promise.all([
      reputationDistribution(c.env.CORE_DB).catch(() => null),
      reputationFunnel(c.env.CORE_DB).catch(() => null),
      reputationHistogram(c.env.CORE_DB).catch(() => []),
      reputationMetadata(c.env.CORE_DB).catch(() => null),
    ]);
    const counts: Record<string, number> = {
      Exceptional: d?.exceptional ?? 0,
      Strong: d?.strong ?? 0,
      Established: d?.established ?? 0,
      Limited: d?.limited ?? 0,
    };
    const tiers = ADDRESS_REPUTATION_BANDS.map((band) => ({
      tier: band.tier,
      slug: band.slug,
      minimum: band.minimum,
      meaning: band.meaning,
      count: counts[band.tier] ?? 0,
    }));
    const scored = d?.n ?? 0;
    const infrastructure = f?.infra ?? 0;
    // The census is infrastructure plus identities with measurable scoring history. Dictionary-only
    // identities with no on-chain footprint are excluded rather than presented as a "no history" cohort.
    const total_addresses = infrastructure + scored;
    const funnel = {
      total_addresses,
      infrastructure,
      scored,
      no_history: 0,
      by_kind: {
        exchanges: f?.exchanges ?? 0,
        deposits: f?.deposits ?? 0,
        vaults: f?.vaults ?? 0,
        burns: f?.burns ?? 0,
      },
    };
    return {
      result: {
        total: scored,
        mean: d?.mean ?? 0,
        max: d?.max ?? 0,
        funnel,
        histogram,
        tiers,
        model_version: ADDRESS_REPUTATION_MODEL_VERSION,
        calculated_at: metadata?.calculated_at ?? null,
      },
    };
  }),
);

// One reputation tier's definition + its ranked membership (paginated) — the deep-link target for the
// tier labels in the Holder view and holders-table badges.
addresses.get("/v2/reputation/tiers/:tier", async (c) => {
  const slug = c.req.param("tier").toLowerCase();
  const idx = ADDRESS_REPUTATION_BANDS.findIndex((band) => band.slug === slug);
  if (idx < 0) return c.json({ error: "Unknown reputation tier" }, 404);
  const tier = ADDRESS_REPUTATION_BANDS[idx];
  const maximum = idx === 0 ? 101 : ADDRESS_REPUTATION_BANDS[idx - 1].minimum;
  const members = await reputationTierMembers(c.env.CORE_DB, tier.minimum, maximum, lim(c), off(c)).catch(() => []);
  const summary = { tier: tier.tier, slug, minimum: tier.minimum, meaning: tier.meaning, count: 0 };
  return J(
    c,
    { result: { tier: summary, members }, next_offset: members.length === lim(c) ? off(c) + lim(c) : null },
    120,
  );
});

addresses.get("/v2/addresses/:address/summary", async (c) => {
  const result = await addressSummary(c.env.CORE_DB, c.req.param("address"));
  return J(c, { result }, 30);
});

addresses.get("/v2/addresses/:address/issued", async (c) => {
  const result = await listIssued(c.env.CORE_DB, c.req.param("address"), { limit: lim(c), offset: off(c) });
  return J(c, { result, next_offset: result.length === lim(c) ? off(c) + lim(c) : null });
});

// Address connections: top counterparties merged across sends + dispenses + DEX order matches.
// The on-chain social/money graph for an address. Excludes self.
// Two directions per relationship folded into one CASE term each (D1 caps UNION-ALL terms low).
// Exchange-DEPOSIT counterparties are filtered out: they're 1:1 plumbing (validated — they're 60% of an
// exchange's "connections" but ~0% of a real user's), so they bury genuine relationships. is_exchange
// counterparties are KEPT (a real "uses this exchange" signal) and flagged so the UI can badge them.
addresses.get("/v2/addresses/:address/connections", async (c) => {
  const result = await addressConnections(c.env.CORE_DB, c.req.param("address"), lim(c, 12, 24));
  // This is a lifetime interaction aggregate. A one-hour edge lifetime keeps active addresses timely
  // while preventing repeated page and SSR reads from rescanning a large address history every two minutes.
  return J(c, { result }, 3_600);
});

// Identity lineage via sweeps — a SWEEP moves all assets+ownership to another address (strongest
// "same person" signal on chain). Returns swept-to / swept-from links to chain identity clusters.
addresses.get("/v2/addresses/:address/lineage", async (c) => {
  const result = await addressLineage(c.env.CORE_DB, c.req.param("address"));
  return J(c, { result }, 300);
});
