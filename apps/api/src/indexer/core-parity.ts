import type { Env } from "#api/env";
import { CORE_TABLE_MANIFEST } from "#api/indexer/core-manifest";

interface CountRow {
  count: number | string;
}

interface FingerprintRow {
  fingerprint: string;
}

export interface CoreParityRelation {
  target: string;
  sources: readonly string[];
  sourceSql: string;
  targetSql: string;
}

export interface CoreParityFrontier {
  target: string;
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
        : entry.source === "emblem_listings"
          ? `SELECT count(*) count FROM emblem_listings WHERE generation=coalesce((SELECT CAST(value AS INTEGER) FROM core_state WHERE key='emblem_listings_generation'),0)`
          : `SELECT count(*) count FROM ${quote(entry.target)}`,
  })),
  {
    target: "ledger_events",
    sources: ["credits", "debits"],
    sourceSql: `SELECT (SELECT count(*) FROM credits)+(SELECT count(*) FROM debits) count`,
    targetSql: `SELECT count(*) count FROM ledger_events`,
  },
].sort((left, right) => left.target.localeCompare(right.target));

function frontierSql(table: string, identity: string): string {
  return `SELECT coalesce(CAST(min(${identity}) AS TEXT),'')||':'||coalesce(CAST(max(${identity}) AS TEXT),'')||':'||coalesce(CAST(min(block_index) AS TEXT),'')||':'||coalesce(CAST(max(block_index) AS TEXT),'') fingerprint FROM ${quote(table)}`;
}

/** Bounded identity checks for the canonical streams that drive replay. Counts alone cannot reveal an equal-sized
 * hole or shifted range; these checks verify both ends of each identity and block frontier without hashing rows
 * whose compact physical representation intentionally differs from the source. */
export const CORE_PARITY_FRONTIERS: readonly CoreParityFrontier[] = [
  {
    target: "blocks",
    sourceSql: frontierSql("blocks", "block_index"),
    targetSql: frontierSql("blocks", "block_index"),
  },
  {
    target: "transactions",
    sourceSql: frontierSql("transactions", "tx_index"),
    targetSql: frontierSql("transactions", "tx_index"),
  },
  ...["dispenses", "fairmints", "issuances", "sends"].map((target) => ({
    target,
    sourceSql: frontierSql(target, "event_index"),
    targetSql: frontierSql(target, "event_index"),
  })),
  {
    target: "ledger_events",
    sourceSql: `SELECT coalesce(CAST(min(event_index) AS TEXT),'')||':'||coalesce(CAST(max(event_index) AS TEXT),'')||':'||coalesce(CAST(min(block_index) AS TEXT),'')||':'||coalesce(CAST(max(block_index) AS TEXT),'') fingerprint FROM (SELECT event_index,block_index FROM credits UNION ALL SELECT event_index,block_index FROM debits)`,
    targetSql: frontierSql("ledger_events", "event_index"),
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

async function fingerprints(db: D1Database, sql: readonly string[]): Promise<string[]> {
  const output: string[] = [];
  for (let index = 0; index < sql.length; index += 80) {
    const results = await db.batch(sql.slice(index, index + 80).map((query) => db.prepare(query)));
    for (const result of results) {
      const row = result.results?.[0] as FingerprintRow | undefined;
      output.push(row?.fingerprint ?? "<missing>");
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
  const [
    sourceCounts,
    targetCounts,
    sourceFrontiers,
    targetFrontiers,
    sourceEventIndex,
    compactEventIndex,
    buildComplete,
    importComplete,
    reconciled,
  ] = await Promise.all([
    counts(
      env.DB,
      CORE_PARITY_RELATIONS.map((relation) => relation.sourceSql),
    ),
    counts(
      env.CORE_DB,
      CORE_PARITY_RELATIONS.map((relation) => relation.targetSql),
    ),
    fingerprints(
      env.DB,
      CORE_PARITY_FRONTIERS.map((frontier) => frontier.sourceSql),
    ),
    fingerprints(
      env.CORE_DB,
      CORE_PARITY_FRONTIERS.map((frontier) => frontier.targetSql),
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
  const frontiers = CORE_PARITY_FRONTIERS.map((frontier, index) => ({
    target: frontier.target,
    source: sourceFrontiers[index],
    compact: targetFrontiers[index],
    matches: sourceFrontiers[index] !== "<missing>" && sourceFrontiers[index] === targetFrontiers[index],
  }));
  const cursorMatches = sourceEventIndex != null && sourceEventIndex === compactEventIndex;
  const prerequisites = buildComplete === "1" && importComplete === "1" && reconciled === "1";
  const ok =
    prerequisites &&
    cursorMatches &&
    relations.every((relation) => relation.matches) &&
    frontiers.every((frontier) => frontier.matches);

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
    checked_frontiers: frontiers.length,
    frontier_mismatches: frontiers.filter((frontier) => !frontier.matches),
  };
}

/** Open forward dual-writes only from a freshly successful parity audit. */
export async function activateCoreForwardWrites(env: Pick<Env, "DB" | "CORE_DB">) {
  const parity = await auditCoreDataParity(env, { accept: true });
  if (!parity.ok) return { ok: false, forward_write_ready: false, parity };
  await env.CORE_DB.prepare(
    `INSERT INTO core_state(key,value) VALUES('forward_write_ready','1')
     ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
  ).run();
  return { ok: true, forward_write_ready: true, parity };
}

/** Close forward dual-writes without changing imported data or verification evidence. */
export async function rollbackCoreForwardWrites(db: D1Database) {
  await db
    .prepare(
      `INSERT INTO core_state(key,value) VALUES('forward_write_ready','0')
       ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
    )
    .run();
  return { ok: true, forward_write_ready: false };
}
