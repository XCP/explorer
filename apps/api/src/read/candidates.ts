/**
 * GET /v2/collections/candidates — the collection-candidate discovery board. Untagged assets ranked
 * by collectors who CHOSE them (trade / dispense / non-distributor send) — the owner's curation feed.
 * Composed from two bounded query stages (see queries/candidates.ts) so no single D1 statement nears
 * the CPU limit; the whole computation runs at most once a day behind the D1 cache.
 */
import type { Envelope } from "@xcp/shared/envelope";
import type { CollectionCandidate, CollectionCandidatesPayload } from "@xcp/shared/collections";
import { router, cached } from "#api/read/respond";
import { collectorCandidateSeeds, chosenCollectorCounts } from "#api/queries/candidates";

export const candidates = router();

const SEED_LIMIT = 150;
const CHOSEN_BATCH = 30;
const BOARD_SIZE = 100;

candidates.get("/v2/collections/candidates", (c) =>
  cached(
    c,
    "collection-candidates:chosen:1",
    { ttl: 86400, edge: 300, swr: 86400 },
    async (): Promise<Envelope<CollectionCandidatesPayload>> => {
      const seeds = await collectorCandidateSeeds(c.env.CORE_DB, SEED_LIMIT);
      const chosen = new Map<number, number>();
      for (let index = 0; index < seeds.length; index += CHOSEN_BATCH) {
        const batch = seeds.slice(index, index + CHOSEN_BATCH).map((seed) => seed.asset_id);
        for (const row of await chosenCollectorCounts(c.env.CORE_DB, batch)) {
          chosen.set(row.asset_id, row.chosen_collectors);
        }
      }
      const board: CollectionCandidate[] = seeds
        .map((seed) => ({
          asset: seed.asset,
          asset_longname: seed.asset_longname,
          issuer: seed.issuer,
          chosen_collectors: chosen.get(seed.asset_id) ?? 0,
          collector_holders: seed.collector_holders,
          holders: seed.holders,
        }))
        .filter((row) => row.chosen_collectors > 0)
        .sort((a, b) => b.chosen_collectors - a.chosen_collectors)
        .slice(0, BOARD_SIZE);
      return { result: { candidates: board } };
    },
  ),
);
