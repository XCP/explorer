import type { Env } from "#api/env";

const DEFAULT_SAMPLE_RADIUS = 2_000;
const MAX_SAMPLE_RADIUS = 10_000;

type Aggregate = {
  rows: number;
  event_sum: number;
  block_sum: number;
  direction_sum: number;
};

type StateRow = { key: string; value: string };

export type LedgerReadinessReport = {
  ready: boolean;
  read_only: true;
  state: Record<string, string | null>;
  totals: {
    source: number;
    compact: number;
    match: boolean;
    first_event: { source: number | null; compact: number | null; match: boolean };
    last_event: { source: number | null; compact: number | null; match: boolean };
  };
  samples: Array<{
    from: number;
    to: number;
    source: Aggregate;
    compact: Aggregate;
    match: boolean;
  }>;
  failures: string[];
};

function numberOrNull(value: unknown): number | null {
  return value == null ? null : Number(value);
}

function aggregate(row: Partial<Aggregate> | null): Aggregate {
  return {
    rows: Number(row?.rows ?? 0),
    event_sum: Number(row?.event_sum ?? 0),
    block_sum: Number(row?.block_sum ?? 0),
    direction_sum: Number(row?.direction_sum ?? 0),
  };
}

export function ledgerReadinessFailures(input: {
  state: Record<string, string | null>;
  sourceRows: number;
  compactRows: number;
  sourceFirst: number | null;
  compactFirst: number | null;
  sourceLast: number | null;
  compactLast: number | null;
  sampleMatches: boolean[];
}): string[] {
  const failures: string[] = [];
  if (input.state.backfill_active !== "0") failures.push("backfill is still active");
  if (input.state.ledger_credit_done !== "1") failures.push("credit backfill is incomplete");
  if (input.state.ledger_debit_done !== "1") failures.push("debit backfill is incomplete");
  if (input.sourceRows <= 0) failures.push("source ledger is empty or unreadable");
  if (input.compactRows <= 0) failures.push("compact ledger is empty or unreadable");
  if (input.sourceRows !== input.compactRows) failures.push("source and compact row counts differ");
  if (input.sourceFirst !== input.compactFirst) failures.push("first event indexes differ");
  if (input.sourceLast !== input.compactLast) failures.push("last event indexes differ");
  if (input.sampleMatches.some((match) => !match)) failures.push("one or more bounded range samples differ");
  return failures;
}

/**
 * Read-only compact-ledger cutover audit. Exact counts and PK extrema are paired with three bounded
 * range aggregates; this catches missing/misdirected rows without repeatedly scanning both full ledgers.
 * The function intentionally cannot update `read_cutover`.
 */
export async function auditLedgerReadiness(
  env: Pick<Env, "DB" | "LEDGER_DB">,
  sampleRadius = DEFAULT_SAMPLE_RADIUS,
): Promise<LedgerReadinessReport> {
  const radius = Math.max(1, Math.min(Math.trunc(sampleRadius), MAX_SAMPLE_RADIUS));
  const [sourceMeta, compactMeta, stateResult] = await Promise.all([
    env.DB.prepare(
      `SELECT SUM(rows) rows, MIN(first_event) first_event, MAX(last_event) last_event
         FROM (SELECT COUNT(*) rows, MIN(event_index) first_event, MAX(event_index) last_event FROM credits
               UNION ALL
               SELECT COUNT(*) rows, MIN(event_index) first_event, MAX(event_index) last_event FROM debits)`,
    ).first<{ rows: number; first_event: number | null; last_event: number | null }>(),
    env.LEDGER_DB.prepare(
      `SELECT COUNT(*) rows, MIN(event_index) first_event, MAX(event_index) last_event FROM ledger_events`,
    ).first<{ rows: number; first_event: number | null; last_event: number | null }>(),
    env.LEDGER_DB.prepare(
      `SELECT key,value FROM ledger_state
        WHERE key IN ('backfill_active','ledger_credit_done','ledger_debit_done','read_cutover')`,
    ).all<StateRow>(),
  ]);

  const sourceRows = Number(sourceMeta?.rows ?? -1);
  const compactRows = Number(compactMeta?.rows ?? -2);
  const sourceFirst = numberOrNull(sourceMeta?.first_event);
  const compactFirst = numberOrNull(compactMeta?.first_event);
  const sourceLast = numberOrNull(sourceMeta?.last_event);
  const compactLast = numberOrNull(compactMeta?.last_event);
  const state: Record<string, string | null> = {
    backfill_active: null,
    ledger_credit_done: null,
    ledger_debit_done: null,
    read_cutover: null,
  };
  for (const row of stateResult.results) state[row.key] = row.value;

  const anchors =
    sourceFirst == null || sourceLast == null
      ? []
      : [sourceFirst, Math.floor((sourceFirst + sourceLast) / 2), sourceLast];
  const ranges = [
    ...new Map(
      anchors.map((anchor) => {
        const from = Math.max(sourceFirst ?? 0, anchor - radius);
        const to = Math.min(sourceLast ?? anchor, anchor + radius);
        return [`${from}:${to}`, { from, to }] as const;
      }),
    ).values(),
  ];

  const samples = await Promise.all(
    ranges.map(async ({ from, to }) => {
      const [sourceRow, compactRow] = await Promise.all([
        env.DB.prepare(
          `SELECT COUNT(*) rows, COALESCE(SUM(event_index),0) event_sum,
                  COALESCE(SUM(block_index),0) block_sum, COALESCE(SUM(direction),0) direction_sum
             FROM (SELECT event_index,block_index,1 direction FROM credits WHERE event_index BETWEEN ? AND ?
                   UNION ALL
                   SELECT event_index,block_index,0 direction FROM debits WHERE event_index BETWEEN ? AND ?)`,
        )
          .bind(from, to, from, to)
          .first<Aggregate>(),
        env.LEDGER_DB.prepare(
          `SELECT COUNT(*) rows, COALESCE(SUM(event_index),0) event_sum,
                  COALESCE(SUM(block_index),0) block_sum, COALESCE(SUM(direction),0) direction_sum
             FROM ledger_events WHERE event_index BETWEEN ? AND ?`,
        )
          .bind(from, to)
          .first<Aggregate>(),
      ]);
      const source = aggregate(sourceRow);
      const compact = aggregate(compactRow);
      return { from, to, source, compact, match: JSON.stringify(source) === JSON.stringify(compact) };
    }),
  );

  const failures = ledgerReadinessFailures({
    state,
    sourceRows,
    compactRows,
    sourceFirst,
    compactFirst,
    sourceLast,
    compactLast,
    sampleMatches: samples.map((sample) => sample.match),
  });
  return {
    ready: failures.length === 0,
    read_only: true,
    state,
    totals: {
      source: sourceRows,
      compact: compactRows,
      match: sourceRows === compactRows,
      first_event: { source: sourceFirst, compact: compactFirst, match: sourceFirst === compactFirst },
      last_event: { source: sourceLast, compact: compactLast, match: sourceLast === compactLast },
    },
    samples,
    failures,
  };
}
