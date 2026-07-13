import type { Env } from "#api/env";

type TransactionMeta = {
  rows: number;
  first_index: number | null;
  last_index: number | null;
};

type TransactionSample = {
  tx_index: number;
  tx_hash: string;
  block_index: number;
  block_time: number | null;
  source: string | null;
  destination: string | null;
  btc_amount: string | null;
  fee: string | null;
  supported: number;
  utxos_info: string | null;
};

export type CoreTransactionReadiness = {
  ready: boolean;
  read_only: true;
  state: { cursor: number | null; done: boolean };
  progress: { source: number; core: number; percent: number };
  extrema: {
    source: { first: number | null; last: number | null };
    core: { first: number | null; last: number | null };
    match: boolean;
  };
  samples: Array<{ tx_index: number; match: boolean }>;
  failures: string[];
};

export function coreTransactionReadinessFailures(input: {
  sourceRows: number;
  coreRows: number;
  sourceFirst: number | null;
  sourceLast: number | null;
  coreFirst: number | null;
  coreLast: number | null;
  done: boolean;
  sampleMatches: boolean[];
}): string[] {
  const failures: string[] = [];
  if (input.sourceRows <= 0) failures.push("source transactions are empty or unreadable");
  if (input.coreRows <= 0) failures.push("core transactions are empty or unreadable");
  if (!input.done) failures.push("transaction backfill is incomplete");
  if (input.sourceRows !== input.coreRows) failures.push("transaction row counts differ");
  if (input.sourceFirst !== input.coreFirst || input.sourceLast !== input.coreLast) {
    failures.push("transaction index extrema differ");
  }
  if (input.sampleMatches.some((match) => !match)) failures.push("one or more decoded transaction samples differ");
  return failures;
}

function sampleIndexes(meta: TransactionMeta): number[] {
  if (meta.first_index == null || meta.last_index == null) return [];
  return [...new Set([meta.first_index, Math.floor((meta.first_index + meta.last_index) / 2), meta.last_index])];
}

/** Read-only evidence for transaction backfill progress. This function cannot change any cutover state. */
export async function auditCoreTransactions(env: Pick<Env, "DB" | "CORE_DB">): Promise<CoreTransactionReadiness> {
  const [sourceMeta, coreMeta, stateRows] = await Promise.all([
    env.DB.prepare(
      `SELECT COUNT(*) rows,MIN(tx_index) first_index,MAX(tx_index) last_index FROM transactions`,
    ).first<TransactionMeta>(),
    env.CORE_DB.prepare(
      `SELECT COUNT(*) rows,MIN(tx_index) first_index,MAX(tx_index) last_index FROM transactions`,
    ).first<TransactionMeta>(),
    env.CORE_DB.prepare(
      `SELECT key,value FROM core_state WHERE key IN ('transactions_cursor','transactions_done')`,
    ).all<{ key: string; value: string }>(),
  ]);
  const source = sourceMeta ?? { rows: 0, first_index: null, last_index: null };
  const core = coreMeta ?? { rows: 0, first_index: null, last_index: null };
  const state = new Map(stateRows.results.map((row) => [row.key, row.value]));
  const anchors = sampleIndexes(core);
  const samples = await Promise.all(
    anchors.map(async (txIndex) => {
      const [sourceRow, coreRow] = await Promise.all([
        env.DB.prepare(
          `SELECT tx_index,LOWER(tx_hash) tx_hash,block_index,block_time,source,destination,
                  btc_amount,fee,supported,utxos_info
             FROM transactions WHERE tx_index=?`,
        )
          .bind(txIndex)
          .first<TransactionSample>(),
        env.CORE_DB.prepare(
          `SELECT t.tx_index,LOWER(HEX(t.tx_hash)) tx_hash,t.block_index,t.block_time,
                  source.address source,destination.address destination,t.btc_amount,t.fee,t.supported,t.utxos_info
             FROM transactions t
             LEFT JOIN address_dictionary source ON source.address_id=t.source_id
             LEFT JOIN address_dictionary destination ON destination.address_id=t.destination_id
            WHERE t.tx_index=?`,
        )
          .bind(txIndex)
          .first<TransactionSample>(),
      ]);
      return { tx_index: txIndex, match: JSON.stringify(sourceRow) === JSON.stringify(coreRow) };
    }),
  );
  const sourceRows = Number(source.rows);
  const coreRows = Number(core.rows);
  const done = state.get("transactions_done") === "1";
  const failures = coreTransactionReadinessFailures({
    sourceRows,
    coreRows,
    sourceFirst: source.first_index,
    sourceLast: source.last_index,
    coreFirst: core.first_index,
    coreLast: core.last_index,
    done,
    sampleMatches: samples.map((sample) => sample.match),
  });
  return {
    ready: failures.length === 0,
    read_only: true,
    state: {
      cursor: state.has("transactions_cursor") ? Number(state.get("transactions_cursor")) : null,
      done,
    },
    progress: {
      source: sourceRows,
      core: coreRows,
      percent: sourceRows > 0 ? Math.round((coreRows / sourceRows) * 10000) / 100 : 0,
    },
    extrema: {
      source: { first: source.first_index, last: source.last_index },
      core: { first: core.first_index, last: core.last_index },
      match: source.first_index === core.first_index && source.last_index === core.last_index,
    },
    samples,
    failures,
  };
}
