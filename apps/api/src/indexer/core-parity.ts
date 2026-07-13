import type { Env } from "#api/env";
import { CORE_TABLE_MANIFEST } from "#api/indexer/core-manifest";

interface CountRow {
  count: number | string;
}

export interface CoreParityRelation {
  target: string;
  sources: readonly string[];
  sourceSql: string;
  targetSql: string;
}

const quote = (identifier: string) => `"${identifier.replaceAll('"', '""')}"`;

const copied = CORE_TABLE_MANIFEST.filter(
  (entry) => entry.target != null && entry.disposition !== "seed" && entry.disposition !== "merge",
);

export const CORE_PARITY_RELATIONS: readonly CoreParityRelation[] = [
  ...copied.map((entry) => ({
    target: entry.target,
    sources: [entry.source],
    sourceSql: `SELECT count(*) count FROM ${quote(entry.source)}`,
    targetSql:
      entry.source === "pr_edges"
        ? `SELECT coalesce(sum(multiplicity),0) count FROM pr_edges`
        : `SELECT count(*) count FROM ${quote(entry.target)}`,
  })),
  {
    target: "ledger_events",
    sources: ["credits", "debits"],
    sourceSql: `SELECT (SELECT count(*) FROM credits)+(SELECT count(*) FROM debits) count`,
    targetSql: `SELECT count(*) count FROM ledger_events`,
  },
].sort((left, right) => left.target.localeCompare(right.target));

async function counts(db: D1Database, sql: readonly string[]): Promise<number[]> {
  const output: number[] = [];
  for (let index = 0; index < sql.length; index += 80) {
    const results = await db.batch(sql.slice(index, index + 80).map((query) => db.prepare(query)));
    for (const result of results) {
      const row = result.results?.[0] as CountRow | undefined;
      output.push(Number(row?.count ?? -1));
    }
  }
  return output;
}

async function state(db: D1Database, table: "indexer_state" | "core_state", key: string): Promise<string | null> {
  return (
    (await db.prepare(`SELECT value FROM ${table} WHERE key=?`).bind(key).first<{ value: string }>())?.value ?? null
  );
}

/** Exact relation-count audit at one event frontier. Setting accept records evidence only when every relation and
 * cursor agrees; a failed audit always closes the parity gate. */
export async function auditCoreDataParity(
  env: Pick<Env, "DB" | "CORE_DB">,
  options: { accept?: boolean; now?: number } = {},
) {
  const [sourceCounts, targetCounts, sourceEventIndex, compactEventIndex, buildComplete, importComplete, reconciled] =
    await Promise.all([
      counts(
        env.DB,
        CORE_PARITY_RELATIONS.map((relation) => relation.sourceSql),
      ),
      counts(
        env.CORE_DB,
        CORE_PARITY_RELATIONS.map((relation) => relation.targetSql),
      ),
      state(env.DB, "indexer_state", "last_event_index"),
      state(env.CORE_DB, "core_state", "last_event_index"),
      state(env.CORE_DB, "core_state", "build_complete"),
      state(env.CORE_DB, "core_state", "import_complete"),
      state(env.CORE_DB, "core_state", "seed_reconciled"),
    ]);
  const relations = CORE_PARITY_RELATIONS.map((relation, index) => ({
    target: relation.target,
    sources: relation.sources,
    source: sourceCounts[index],
    compact: targetCounts[index],
    matches: sourceCounts[index] >= 0 && sourceCounts[index] === targetCounts[index],
  }));
  const cursorMatches = sourceEventIndex != null && sourceEventIndex === compactEventIndex;
  const prerequisites = buildComplete === "1" && importComplete === "1" && reconciled === "1";
  const ok = prerequisites && cursorMatches && relations.every((relation) => relation.matches);

  if (options.accept) {
    const now = options.now ?? Math.floor(Date.now() / 1000);
    await env.CORE_DB.batch([
      env.CORE_DB.prepare(
        `INSERT INTO core_state(key,value) VALUES('parity_verified',?)
         ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
      ).bind(ok ? "1" : "0"),
      env.CORE_DB.prepare(
        `INSERT INTO core_state(key,value) VALUES('parity_checked_at',?)
         ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
      ).bind(String(now)),
      env.CORE_DB.prepare(
        `INSERT INTO core_state(key,value) VALUES('parity_event_index',?)
         ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
      ).bind(ok ? String(compactEventIndex) : ""),
    ]);
  }

  return {
    ok,
    prerequisites,
    source_event_index: sourceEventIndex == null ? null : Number(sourceEventIndex),
    compact_event_index: compactEventIndex == null ? null : Number(compactEventIndex),
    cursor_matches: cursorMatches,
    checked_relations: relations.length,
    mismatches: relations.filter((relation) => !relation.matches),
  };
}
