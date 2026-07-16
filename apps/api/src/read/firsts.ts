/**
 * /v2/firsts — Counterparty's origin story: the earliest record of each kind of on-chain moment, with date
 * and the entity (linkable). Includes our derived firsts (stamp/SRC-20/SRC-721/BTNS) from the tag +
 * classification layer. Pure read off the mirror; cached an hour (history doesn't change). SQL + catalog
 * live in queries/firsts.ts.
 */
import type { FirstRow } from "@xcp/shared/stats";
import { router, cached } from "#api/read/respond";
import { FIRSTS, firstRecord } from "#api/queries/firsts";

export const firsts = router();

firsts.get("/v2/firsts", async (c) =>
  cached(c, "firsts:catalog:valid", { ttl: 3600, edge: 600 }, async () => {
    const rows = await Promise.all(
      FIRSTS.map(async (f): Promise<FirstRow | null> => {
        const r = await firstRecord(c.env.CORE_DB, f.sql);
        if (!r || r.b == null) return null;
        const t = Number(r.t) || 0;
        return {
          key: f.key,
          label: f.label,
          block: r.b,
          date: new Date(t * 1000).toISOString().slice(0, 10),
          ref: r.ref,
          type: r.typ,
        };
      }),
    );
    return { result: rows.filter(Boolean).sort((a, b) => a!.block - b!.block) };
  }),
);
