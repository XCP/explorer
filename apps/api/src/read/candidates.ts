/**
 * GET /v2/collections/candidates — the collection-candidate discovery board. Issuer clusters of uncollected
 * media assets held by real collectors: projects we haven't tagged yet. Thin route over queries/candidates.ts;
 * D1-cached (low-cardinality key, longer TTL — the underlying signals move slowly).
 */
import type { Envelope } from "@xcp/shared/envelope";
import type { CollectionCandidatesPayload } from "@xcp/shared/collections";
import { router, cached } from "./respond";
import { collectionCandidates } from "../queries/candidates";

export const candidates = router();

candidates.get("/v2/collections/candidates", (c) =>
  cached(c, "collection-candidates", { ttl: 1800, edge: 300 }, async (): Promise<Envelope<CollectionCandidatesPayload>> => {
    const rows = await collectionCandidates(c.env.DB).catch(() => []);
    return { result: { candidates: rows.map((r) => ({ ...r, samples: r.samples ? r.samples.split(",").slice(0, 6) : [] })) } };
  }));
