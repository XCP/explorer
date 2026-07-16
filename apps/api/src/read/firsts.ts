/**
 * /v2/firsts — Counterparty's origin story: the earliest record of each kind of on-chain moment, with date
 * and the entity (linkable). Includes our derived firsts (stamp/SRC-20/SRC-721/BTNS) from the tag +
 * classification layer. These facts do not change after chain finality: cache them for a year and bump the
 * versioned cache key whenever the catalog changes. SQL + catalog live in queries/firsts.ts.
 */
import type { FirstRow } from "@xcp/shared/stats";
import { router, cached } from "#api/read/respond";
import { FIRSTS_CATALOG, queryFirstRecords } from "#api/queries/firsts";

const pairAssets = (ref: string): string[] => ref.split(" / ").filter(Boolean);

/** Resolve every canonical asset subject through the same current asset dictionary. This keeps firsts
 * sourced from orders, sends, trades, pools, etc. from leaking numeric subasset identifiers while retaining
 * those canonical identifiers for icons and links. */
async function resolveAssetSubjects(db: D1Database, records: Awaited<ReturnType<typeof queryFirstRecords>>) {
  const canonical = new Set<string>();
  for (const record of records) {
    if (!record) continue;
    if (record.typ === "asset") canonical.add(record.icon_asset ?? record.ref);
    if (record.typ === "pair") pairAssets(record.ref).forEach((asset) => canonical.add(asset));
  }
  const assets = [...canonical];
  if (assets.length === 0) return new Map<string, string>();
  const placeholders = assets.map(() => "?").join(",");
  const result = await db
    .prepare(
      `SELECT dictionary.asset,COALESCE(state.asset_longname,dictionary.asset) display
       FROM asset_dictionary dictionary LEFT JOIN assets state ON state.asset_id=dictionary.asset_id
      WHERE dictionary.asset IN (${placeholders})`,
    )
    .bind(...assets)
    .all<{ asset: string; display: string }>();
  return new Map(result.results.map((asset) => [asset.asset, asset.display]));
}

export const firsts = router();

firsts.get("/v2/firsts", async (c) =>
  cached(c, "firsts:catalog:complete-media", { ttl: 31_536_000, edge: 86_400, swr: 31_536_000 }, async () => {
    const records = await queryFirstRecords(c.env.CORE_DB);
    const displayNames = await resolveAssetSubjects(c.env.CORE_DB, records);
    const rows = FIRSTS_CATALOG.map((f, index): FirstRow | null => {
      const r = records[index];
      if (!r || r.b == null) return null;
      const t = Number(r.t) || 0;
      const assetRefs = r.typ === "pair" ? pairAssets(r.ref) : undefined;
      const canonicalAsset = r.typ === "asset" ? (r.icon_asset ?? r.ref) : undefined;
      const displayRef = assetRefs
        ? assetRefs.map((asset) => displayNames.get(asset) ?? asset).join(" / ")
        : canonicalAsset
          ? (displayNames.get(canonicalAsset) ?? r.ref)
          : r.ref;
      return {
        key: f.key,
        label: f.label,
        block: r.b,
        date: new Date(t * 1000).toISOString().slice(0, 10),
        ref: displayRef,
        type: r.typ,
        tx: r.tx,
        ...(r.tx_url ? { tx_url: r.tx_url } : {}),
        ...(canonicalAsset && displayRef !== canonicalAsset ? { icon_asset: canonicalAsset } : {}),
        ...(assetRefs ? { asset_refs: assetRefs } : {}),
      };
    });
    return { result: rows.filter(Boolean).sort((a, b) => a!.block - b!.block) };
  }),
);
