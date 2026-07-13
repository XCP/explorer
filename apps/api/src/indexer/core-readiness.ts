import type { Env } from "#api/env";
import { hashToBytes } from "#api/indexer/compact-codec";

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

type AssetMeta = {
  rows: number;
  first_asset: string | null;
  last_asset: string | null;
};

type AssetSample = {
  asset: string;
  asset_longname: string | null;
  numeric_asset_id: string | null;
  type: string;
  issuer: string | null;
  owner: string | null;
  divisible: number;
  locked: number;
  description_locked: number;
  supply: string | null;
  supply_normalized: string | null;
  description: string | null;
  mime_type: string | null;
  first_issuance_block_index: number | null;
  last_issuance_block_index: number | null;
  first_issuance_block_time: number | null;
  last_issuance_block_time: number | null;
  updated_at: number;
};

type BlockSample = {
  block_index: number;
  block_hash: string | null;
  block_time: number | null;
  previous_block_hash: string | null;
  difficulty: string | null;
  ledger_hash: string | null;
  txlist_hash: string | null;
  messages_hash: string | null;
  transaction_count: number | null;
};

type IssuanceMeta = {
  rows: number;
  first_index: number | null;
  last_index: number | null;
};

type IssuanceSample = {
  event_index: number;
  tx_index: number;
  tx_hash: string;
  msg_index: number;
  block_index: number;
  block_time: number | null;
  asset: string | null;
  asset_longname: string | null;
  quantity: string | null;
  quantity_normalized: string | null;
  source: string | null;
  issuer: string | null;
  transfer: number;
  divisible: number;
  locked: number;
  description: string | null;
  fee_paid: string | null;
  status: string | null;
  asset_events: string | null;
  mime_type: string | null;
  reset: number | null;
  callable: number | null;
  call_date: number | null;
  call_price: string | null;
};

type BalanceSample = {
  holder: string;
  asset: string;
  holder_type: string;
  quantity: string;
  quantity_normalized: string | null;
  updated_block_index: number | null;
  updated_event_index: number;
  utxo_address: string | null;
};

type SendSample = {
  event_index: number;
  tx_index: number;
  tx_hash: string;
  block_index: number;
  block_time: number | null;
  source: string | null;
  destination: string | null;
  source_address: string | null;
  destination_address: string | null;
  asset: string | null;
  quantity: string | null;
  quantity_normalized: string | null;
  memo: string | null;
  memo_hex: string | null;
  send_type: string | null;
  status: string | null;
  fee_paid: string | null;
  msg_index: number;
};

type OrderSample = {
  tx_index: number;
  tx_hash: string;
  block_index: number;
  block_time: number | null;
  source: string | null;
  give_asset: string | null;
  give_quantity: string | null;
  give_remaining: string | null;
  get_asset: string | null;
  get_quantity: string | null;
  get_remaining: string | null;
  expiration: number | null;
  expire_index: number | null;
  fee_required: string | null;
  fee_required_remaining: string | null;
  fee_provided: string | null;
  fee_provided_remaining: string | null;
  status: string | null;
  closed_block_index: number | null;
};

type OrderMatchMeta = { rows: number; first_id: string | null; last_id: string | null };

type OrderMatchSample = {
  id: string;
  tx0_index: number;
  tx1_index: number;
  tx0_hash: string;
  tx1_hash: string;
  tx0_address: string | null;
  tx1_address: string | null;
  forward_asset: string | null;
  forward_quantity: string | null;
  backward_asset: string | null;
  backward_quantity: string | null;
  block_index: number;
  block_time: number | null;
  status: string | null;
  match_expire_index: number | null;
  fee_paid: string | null;
  tx0_block_index: number | null;
  tx1_block_index: number | null;
  tx0_expiration: number | null;
  tx1_expiration: number | null;
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

export type CoreAssetReadiness = {
  ready: boolean;
  read_only: true;
  state: { cursor: string | null; done: boolean };
  progress: { source: number; core: number; percent: number };
  extrema: {
    source: { first: string | null; last: string | null };
    core: { first: string | null; last: string | null };
    match: boolean;
  };
  samples: Array<{ asset: string; match: boolean }>;
  failures: string[];
};

export type CoreBlockReadiness = {
  ready: boolean;
  read_only: true;
  state: { cursor: number | null; done: boolean };
  progress: { source: number; core: number; percent: number };
  extrema: {
    source: { first: number | null; last: number | null };
    core: { first: number | null; last: number | null };
    match: boolean;
  };
  samples: Array<{ block_index: number; match: boolean }>;
  failures: string[];
};

export type CoreIssuanceReadiness = {
  ready: boolean;
  read_only: true;
  state: { cursor: number | null; done: boolean };
  progress: { source: number; core: number; percent: number };
  extrema: {
    source: { first: number | null; last: number | null };
    core: { first: number | null; last: number | null };
    match: boolean;
  };
  samples: Array<{ event_index: number; match: boolean }>;
  failures: string[];
};

export type CoreBalanceReadiness = {
  ready: boolean;
  read_only: true;
  state: { cursor: { holder: string; asset: string } | null; done: boolean };
  progress: { source: number; core: number; percent: number };
  frontier: {
    source: { holder: string; asset: string } | null;
    core: { holder: string; asset: string } | null;
    match: boolean;
  };
  samples: Array<{ holder: string; asset: string; match: boolean }>;
  failures: string[];
};

export type CoreSendReadiness = {
  ready: boolean;
  read_only: true;
  state: { cursor: number | null; done: boolean };
  progress: { source: number; core: number; percent: number };
  extrema: {
    source: { first: number | null; last: number | null };
    core: { first: number | null; last: number | null };
    match: boolean;
  };
  samples: Array<{ event_index: number; match: boolean }>;
  failures: string[];
};

export type CoreOrderReadiness = {
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

export type CoreOrderMatchReadiness = {
  ready: boolean;
  read_only: true;
  state: { cursor: string | null; done: boolean };
  progress: { source: number; core: number; percent: number };
  extrema: {
    source: { first: string | null; last: string | null };
    core: { first: string | null; last: string | null };
    match: boolean;
  };
  samples: Array<{ id: string; match: boolean }>;
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

export function coreAssetReadinessFailures(input: {
  sourceRows: number;
  coreRows: number;
  sourceFirst: string | null;
  sourceLast: string | null;
  coreFirst: string | null;
  coreLast: string | null;
  done: boolean;
  sampleMatches: boolean[];
}): string[] {
  const failures: string[] = [];
  if (input.sourceRows <= 0) failures.push("source assets are empty or unreadable");
  if (input.coreRows <= 0) failures.push("core assets are empty or unreadable");
  if (!input.done) failures.push("asset backfill is incomplete");
  if (input.sourceRows !== input.coreRows) failures.push("asset row counts differ");
  if (input.sourceFirst !== input.coreFirst || input.sourceLast !== input.coreLast) {
    failures.push("asset name extrema differ");
  }
  if (input.sampleMatches.some((match) => !match)) failures.push("one or more decoded asset samples differ");
  return failures;
}

export function coreBlockReadinessFailures(input: {
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
  if (input.sourceRows <= 0) failures.push("source blocks are empty or unreadable");
  if (input.coreRows <= 0) failures.push("core blocks are empty or unreadable");
  if (!input.done) failures.push("block backfill is incomplete");
  if (input.sourceRows !== input.coreRows) failures.push("block row counts differ");
  if (input.sourceFirst !== input.coreFirst || input.sourceLast !== input.coreLast) {
    failures.push("block index extrema differ");
  }
  if (input.sampleMatches.some((match) => !match)) failures.push("one or more decoded block samples differ");
  return failures;
}

export function coreIssuanceReadinessFailures(input: {
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
  if (input.sourceRows <= 0) failures.push("source issuances are empty or unreadable");
  if (input.coreRows <= 0) failures.push("core issuances are empty or unreadable");
  if (!input.done) failures.push("issuance backfill is incomplete");
  if (input.sourceRows !== input.coreRows) failures.push("issuance row counts differ");
  if (input.sourceFirst !== input.coreFirst || input.sourceLast !== input.coreLast) {
    failures.push("issuance event extrema differ");
  }
  if (input.sampleMatches.some((match) => !match)) failures.push("one or more decoded issuance samples differ");
  return failures;
}

export function coreBalanceReadinessFailures(input: {
  sourceRows: number;
  coreRows: number;
  sourceFrontier: { holder: string; asset: string } | null;
  coreFrontier: { holder: string; asset: string } | null;
  done: boolean;
  sampleMatches: boolean[];
}): string[] {
  const failures: string[] = [];
  if (input.sourceRows <= 0) failures.push("source balances are empty or unreadable");
  if (input.coreRows <= 0) failures.push("core balances are empty or unreadable");
  if (!input.done) failures.push("balance backfill is incomplete");
  if (input.sourceRows !== input.coreRows) failures.push("balance row counts differ");
  if (JSON.stringify(input.sourceFrontier) !== JSON.stringify(input.coreFrontier)) {
    failures.push("balance composite frontiers differ");
  }
  if (input.sampleMatches.some((match) => !match)) failures.push("one or more decoded balance samples differ");
  return failures;
}

export function coreSendReadinessFailures(input: {
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
  if (input.sourceRows <= 0) failures.push("source sends are empty or unreadable");
  if (input.coreRows <= 0) failures.push("core sends are empty or unreadable");
  if (!input.done) failures.push("send backfill is incomplete");
  if (input.sourceRows !== input.coreRows) failures.push("send row counts differ");
  if (input.sourceFirst !== input.coreFirst || input.sourceLast !== input.coreLast) {
    failures.push("send event extrema differ");
  }
  if (input.sampleMatches.some((match) => !match)) failures.push("one or more decoded send samples differ");
  return failures;
}

export function coreOrderReadinessFailures(input: {
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
  if (input.sourceRows <= 0) failures.push("source orders are empty or unreadable");
  if (input.coreRows <= 0) failures.push("core orders are empty or unreadable");
  if (!input.done) failures.push("order backfill is incomplete");
  if (input.sourceRows !== input.coreRows) failures.push("order row counts differ");
  if (input.sourceFirst !== input.coreFirst || input.sourceLast !== input.coreLast) {
    failures.push("order transaction extrema differ");
  }
  if (input.sampleMatches.some((match) => !match)) failures.push("one or more decoded order samples differ");
  return failures;
}

export function coreOrderMatchReadinessFailures(input: {
  sourceRows: number;
  coreRows: number;
  sourceFirst: string | null;
  sourceLast: string | null;
  coreFirst: string | null;
  coreLast: string | null;
  done: boolean;
  sampleMatches: boolean[];
}): string[] {
  const failures: string[] = [];
  if (input.sourceRows <= 0) failures.push("source order matches are empty or unreadable");
  if (input.coreRows <= 0) failures.push("core order matches are empty or unreadable");
  if (!input.done) failures.push("order match backfill is incomplete");
  if (input.sourceRows !== input.coreRows) failures.push("order match row counts differ");
  if (input.sourceFirst !== input.coreFirst || input.sourceLast !== input.coreLast) {
    failures.push("order match id extrema differ");
  }
  if (input.sampleMatches.some((match) => !match)) failures.push("one or more decoded order match samples differ");
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

/** Read-only count, frontier, and decoded-row parity evidence for the current asset projection. */
export async function auditCoreAssets(env: Pick<Env, "DB" | "CORE_DB">): Promise<CoreAssetReadiness> {
  const [sourceMeta, coreMeta, stateRows] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) rows,MIN(asset) first_asset,MAX(asset) last_asset FROM assets`).first<AssetMeta>(),
    env.CORE_DB.prepare(
      `SELECT COUNT(*) rows,MIN(d.asset) first_asset,MAX(d.asset) last_asset
         FROM assets a JOIN asset_dictionary d ON d.asset_id=a.asset_id`,
    ).first<AssetMeta>(),
    env.CORE_DB.prepare(`SELECT key,value FROM core_state WHERE key IN ('assets_cursor','assets_done')`).all<{
      key: string;
      value: string;
    }>(),
  ]);
  const source = sourceMeta ?? { rows: 0, first_asset: null, last_asset: null };
  const core = coreMeta ?? { rows: 0, first_asset: null, last_asset: null };
  const state = new Map(stateRows.results.map((row) => [row.key, row.value]));
  const middle =
    source.rows > 0
      ? await env.DB.prepare(`SELECT asset FROM assets ORDER BY asset LIMIT 1 OFFSET ?`)
          .bind(Math.floor(Number(source.rows) / 2))
          .first<{ asset: string }>()
      : null;
  const anchors = [source.first_asset, middle?.asset, source.last_asset].filter(
    (asset, index, values): asset is string => asset != null && values.indexOf(asset) === index,
  );
  const samples = await Promise.all(
    anchors.map(async (asset) => {
      const [sourceRow, coreRow] = await Promise.all([
        env.DB.prepare(
          `SELECT asset,asset_longname,asset_id numeric_asset_id,type,issuer,owner,divisible,locked,
                  description_locked,supply,supply_normalized,description,mime_type,first_issuance_block_index,
                  last_issuance_block_index,first_issuance_block_time,last_issuance_block_time,updated_at
             FROM assets WHERE asset=?`,
        )
          .bind(asset)
          .first<AssetSample>(),
        env.CORE_DB.prepare(
          `SELECT d.asset,a.asset_longname,a.numeric_asset_id,a.type,issuer.address issuer,owner.address owner,
                  a.divisible,a.locked,a.description_locked,a.supply,a.supply_normalized,a.description,a.mime_type,
                  a.first_issuance_block_index,a.last_issuance_block_index,a.first_issuance_block_time,
                  a.last_issuance_block_time,a.updated_at
             FROM assets a
             JOIN asset_dictionary d ON d.asset_id=a.asset_id
             LEFT JOIN address_dictionary issuer ON issuer.address_id=a.issuer_id
             LEFT JOIN address_dictionary owner ON owner.address_id=a.owner_id
            WHERE d.asset=?`,
        )
          .bind(asset)
          .first<AssetSample>(),
      ]);
      return { asset, match: JSON.stringify(sourceRow) === JSON.stringify(coreRow) };
    }),
  );
  const sourceRows = Number(source.rows);
  const coreRows = Number(core.rows);
  const done = state.get("assets_done") === "1";
  const failures = coreAssetReadinessFailures({
    sourceRows,
    coreRows,
    sourceFirst: source.first_asset,
    sourceLast: source.last_asset,
    coreFirst: core.first_asset,
    coreLast: core.last_asset,
    done,
    sampleMatches: samples.map((sample) => sample.match),
  });
  return {
    ready: failures.length === 0,
    read_only: true,
    state: { cursor: state.get("assets_cursor") ?? null, done },
    progress: {
      source: sourceRows,
      core: coreRows,
      percent: sourceRows > 0 ? Math.round((coreRows / sourceRows) * 10000) / 100 : 0,
    },
    extrema: {
      source: { first: source.first_asset, last: source.last_asset },
      core: { first: core.first_asset, last: core.last_asset },
      match: source.first_asset === core.first_asset && source.last_asset === core.last_asset,
    },
    samples,
    failures,
  };
}

/** Read-only count, frontier, and decoded-row parity evidence for compact block headers. */
export async function auditCoreBlocks(env: Pick<Env, "DB" | "CORE_DB">): Promise<CoreBlockReadiness> {
  const [sourceMeta, coreMeta, stateRows] = await Promise.all([
    env.DB.prepare(
      `SELECT COUNT(*) rows,MIN(block_index) first_index,MAX(block_index) last_index FROM blocks`,
    ).first<TransactionMeta>(),
    env.CORE_DB.prepare(
      `SELECT COUNT(*) rows,MIN(block_index) first_index,MAX(block_index) last_index FROM blocks`,
    ).first<TransactionMeta>(),
    env.CORE_DB.prepare(`SELECT key,value FROM core_state WHERE key IN ('blocks_cursor','blocks_done')`).all<{
      key: string;
      value: string;
    }>(),
  ]);
  const source = sourceMeta ?? { rows: 0, first_index: null, last_index: null };
  const core = coreMeta ?? { rows: 0, first_index: null, last_index: null };
  const state = new Map(stateRows.results.map((row) => [row.key, row.value]));
  const samples = await Promise.all(
    sampleIndexes(core).map(async (blockIndex) => {
      const [sourceRow, coreRow] = await Promise.all([
        env.DB.prepare(
          `SELECT block_index,LOWER(block_hash) block_hash,block_time,
                  LOWER(previous_block_hash) previous_block_hash,difficulty,LOWER(ledger_hash) ledger_hash,
                  LOWER(txlist_hash) txlist_hash,LOWER(messages_hash) messages_hash,transaction_count
             FROM blocks WHERE block_index=?`,
        )
          .bind(blockIndex)
          .first<BlockSample>(),
        env.CORE_DB.prepare(
          `SELECT block_index,
                  CASE WHEN block_hash IS NULL THEN NULL ELSE LOWER(HEX(block_hash)) END block_hash,
                  block_time,
                  CASE WHEN previous_block_hash IS NULL THEN NULL ELSE LOWER(HEX(previous_block_hash)) END previous_block_hash,
                  difficulty,
                  CASE WHEN ledger_hash IS NULL THEN NULL ELSE LOWER(HEX(ledger_hash)) END ledger_hash,
                  CASE WHEN txlist_hash IS NULL THEN NULL ELSE LOWER(HEX(txlist_hash)) END txlist_hash,
                  CASE WHEN messages_hash IS NULL THEN NULL ELSE LOWER(HEX(messages_hash)) END messages_hash,
                  transaction_count
             FROM blocks WHERE block_index=?`,
        )
          .bind(blockIndex)
          .first<BlockSample>(),
      ]);
      return { block_index: blockIndex, match: JSON.stringify(sourceRow) === JSON.stringify(coreRow) };
    }),
  );
  const sourceRows = Number(source.rows);
  const coreRows = Number(core.rows);
  const done = state.get("blocks_done") === "1";
  const failures = coreBlockReadinessFailures({
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
      cursor: state.has("blocks_cursor") ? Number(state.get("blocks_cursor")) : null,
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

/** Read-only count, event frontier, and decoded-row parity evidence for canonical issuances. */
export async function auditCoreIssuances(env: Pick<Env, "DB" | "CORE_DB">): Promise<CoreIssuanceReadiness> {
  const [sourceMeta, coreMeta, stateRows] = await Promise.all([
    env.DB.prepare(
      `SELECT COUNT(*) rows,MIN(event_index) first_index,MAX(event_index) last_index FROM issuances`,
    ).first<IssuanceMeta>(),
    env.CORE_DB.prepare(
      `SELECT COUNT(*) rows,MIN(event_index) first_index,MAX(event_index) last_index FROM issuances`,
    ).first<IssuanceMeta>(),
    env.CORE_DB.prepare(`SELECT key,value FROM core_state WHERE key IN ('issuances_cursor','issuances_done')`).all<{
      key: string;
      value: string;
    }>(),
  ]);
  const source = sourceMeta ?? { rows: 0, first_index: null, last_index: null };
  const core = coreMeta ?? { rows: 0, first_index: null, last_index: null };
  const state = new Map(stateRows.results.map((row) => [row.key, row.value]));
  const samples = await Promise.all(
    sampleIndexes(core).map(async (eventIndex) => {
      const [sourceRow, coreRow] = await Promise.all([
        env.DB.prepare(
          `SELECT event_index,tx_index,LOWER(tx_hash) tx_hash,COALESCE(msg_index,0) msg_index,
                  block_index,block_time,asset,asset_longname,quantity,quantity_normalized,source,issuer,
                  transfer,divisible,locked,description,fee_paid,status,asset_events,mime_type,reset,
                  callable,call_date,call_price
             FROM issuances WHERE event_index=?`,
        )
          .bind(eventIndex)
          .first<IssuanceSample>(),
        env.CORE_DB.prepare(
          `SELECT i.event_index,i.tx_index,LOWER(HEX(i.tx_hash)) tx_hash,i.msg_index,i.block_index,i.block_time,
                  asset.asset,i.asset_longname,i.quantity,i.quantity_normalized,source.address source,
                  issuer.address issuer,i.transfer,i.divisible,i.locked,i.description,i.fee_paid,i.status,
                  i.asset_events,i.mime_type,i.reset,i.callable,i.call_date,i.call_price
             FROM issuances i
             LEFT JOIN asset_dictionary asset ON asset.asset_id=i.asset_id
             LEFT JOIN address_dictionary source ON source.address_id=i.source_id
             LEFT JOIN address_dictionary issuer ON issuer.address_id=i.issuer_id
            WHERE i.event_index=?`,
        )
          .bind(eventIndex)
          .first<IssuanceSample>(),
      ]);
      return { event_index: eventIndex, match: JSON.stringify(sourceRow) === JSON.stringify(coreRow) };
    }),
  );
  const sourceRows = Number(source.rows);
  const coreRows = Number(core.rows);
  const done = state.get("issuances_done") === "1";
  const failures = coreIssuanceReadinessFailures({
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
      cursor: state.has("issuances_cursor") ? Number(state.get("issuances_cursor")) : null,
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

/** Read-only count, composite frontier, and decoded address/UTXO parity evidence for current balances. */
export async function auditCoreBalances(env: Pick<Env, "DB" | "CORE_DB">): Promise<CoreBalanceReadiness> {
  const sourceSampleSql = `SELECT holder,asset,holder_type,quantity,quantity_normalized,updated_block_index,
                                  updated_event_index,utxo_address FROM balances`;
  const [sourceMeta, coreMeta, firstSource, lastSource, addressSource, stateRows] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) rows FROM balances`).first<{ rows: number }>(),
    env.CORE_DB.prepare(`SELECT COUNT(*) rows FROM balances`).first<{ rows: number }>(),
    env.DB.prepare(`${sourceSampleSql} ORDER BY holder,asset LIMIT 1`).first<BalanceSample>(),
    env.DB.prepare(`${sourceSampleSql} ORDER BY holder DESC,asset DESC LIMIT 1`).first<BalanceSample>(),
    env.DB.prepare(`${sourceSampleSql} WHERE holder_type='address' LIMIT 1`).first<BalanceSample>(),
    env.CORE_DB.prepare(
      `SELECT key,value FROM core_state
        WHERE key IN ('balances_holder_cursor','balances_asset_cursor','balances_done')`,
    ).all<{ key: string; value: string }>(),
  ]);
  const anchors = [firstSource, addressSource, lastSource].filter(
    (row, index, rows): row is BalanceSample =>
      row != null &&
      rows.findIndex((candidate) => candidate?.holder === row.holder && candidate.asset === row.asset) === index,
  );
  const samples = await Promise.all(
    anchors.map(async (sourceRow) => {
      let coreRow: BalanceSample | null;
      if (sourceRow.holder_type === "address") {
        coreRow = await env.CORE_DB.prepare(
          `SELECT holder.address holder,asset.asset,b.holder_type,b.quantity,b.quantity_normalized,
                  b.updated_block_index,b.updated_event_index,utxo_address.address utxo_address
             FROM balances b
             JOIN address_dictionary holder ON holder.address_id=b.address_id
             JOIN asset_dictionary asset ON asset.asset_id=b.asset_id
             LEFT JOIN address_dictionary utxo_address ON utxo_address.address_id=b.utxo_address_id
            WHERE b.address_id=(SELECT address_id FROM address_dictionary WHERE address=?)
              AND b.asset_id=(SELECT asset_id FROM asset_dictionary WHERE asset=?)`,
        )
          .bind(sourceRow.holder, sourceRow.asset)
          .first<BalanceSample>();
      } else {
        const match = /^([0-9a-f]{64}):(\d+)$/i.exec(sourceRow.holder);
        const txHash = match ? hashToBytes(match[1]) : null;
        const vout = match ? Number(match[2]) : -1;
        coreRow =
          txHash == null
            ? null
            : await env.CORE_DB.prepare(
                `SELECT LOWER(HEX(b.utxo_tx_hash))||':'||b.utxo_vout holder,asset.asset,b.holder_type,
                        b.quantity,b.quantity_normalized,b.updated_block_index,b.updated_event_index,
                        utxo_address.address utxo_address
                   FROM balances b
                   JOIN asset_dictionary asset ON asset.asset_id=b.asset_id
                   LEFT JOIN address_dictionary utxo_address ON utxo_address.address_id=b.utxo_address_id
                  WHERE b.utxo_tx_hash=? AND b.utxo_vout=?
                    AND b.asset_id=(SELECT asset_id FROM asset_dictionary WHERE asset=?)`,
              )
                .bind(txHash, vout, sourceRow.asset)
                .first<BalanceSample>();
      }
      return {
        holder: sourceRow.holder,
        asset: sourceRow.asset,
        match: JSON.stringify(sourceRow) === JSON.stringify(coreRow),
      };
    }),
  );
  const state = new Map(stateRows.results.map((row) => [row.key, row.value]));
  const sourceRows = Number(sourceMeta?.rows ?? 0);
  const coreRows = Number(coreMeta?.rows ?? 0);
  const sourceFrontier = lastSource == null ? null : { holder: lastSource.holder, asset: lastSource.asset };
  const coreFrontier = state.has("balances_holder_cursor")
    ? { holder: state.get("balances_holder_cursor")!, asset: state.get("balances_asset_cursor") ?? "" }
    : null;
  const done = state.get("balances_done") === "1";
  const failures = coreBalanceReadinessFailures({
    sourceRows,
    coreRows,
    sourceFrontier,
    coreFrontier,
    done,
    sampleMatches: samples.map((sample) => sample.match),
  });
  return {
    ready: failures.length === 0,
    read_only: true,
    state: { cursor: coreFrontier, done },
    progress: {
      source: sourceRows,
      core: coreRows,
      percent: sourceRows > 0 ? Math.round((coreRows / sourceRows) * 10000) / 100 : 0,
    },
    frontier: {
      source: sourceFrontier,
      core: coreFrontier,
      match: failures.indexOf("balance composite frontiers differ") < 0,
    },
    samples,
    failures,
  };
}

/** Read-only count, event frontier, and decoded-row parity evidence for canonical sends. */
export async function auditCoreSends(env: Pick<Env, "DB" | "CORE_DB">): Promise<CoreSendReadiness> {
  const [sourceMeta, coreMeta, stateRows] = await Promise.all([
    env.DB.prepare(
      `SELECT COUNT(*) rows,MIN(event_index) first_index,MAX(event_index) last_index FROM sends`,
    ).first<IssuanceMeta>(),
    env.CORE_DB.prepare(
      `SELECT COUNT(*) rows,MIN(event_index) first_index,MAX(event_index) last_index FROM sends`,
    ).first<IssuanceMeta>(),
    env.CORE_DB.prepare(`SELECT key,value FROM core_state WHERE key IN ('sends_cursor','sends_done')`).all<{
      key: string;
      value: string;
    }>(),
  ]);
  const source = sourceMeta ?? { rows: 0, first_index: null, last_index: null };
  const core = coreMeta ?? { rows: 0, first_index: null, last_index: null };
  const state = new Map(stateRows.results.map((row) => [row.key, row.value]));
  const samples = await Promise.all(
    sampleIndexes(core).map(async (eventIndex) => {
      const [sourceRow, coreRow] = await Promise.all([
        env.DB.prepare(
          `SELECT event_index,tx_index,LOWER(tx_hash) tx_hash,block_index,block_time,source,destination,
                  source_address,destination_address,asset,quantity,quantity_normalized,memo,memo_hex,
                  send_type,status,fee_paid,msg_index
             FROM sends WHERE event_index=?`,
        )
          .bind(eventIndex)
          .first<SendSample>(),
        env.CORE_DB.prepare(
          `SELECT s.event_index,s.tx_index,LOWER(HEX(s.tx_hash)) tx_hash,s.block_index,s.block_time,
                  source.address source,destination.address destination,source_address.address source_address,
                  destination_address.address destination_address,asset.asset,s.quantity,s.quantity_normalized,
                  s.memo,s.memo_hex,s.send_type,s.status,s.fee_paid,s.msg_index
             FROM sends s
             LEFT JOIN address_dictionary source ON source.address_id=s.source_id
             LEFT JOIN address_dictionary destination ON destination.address_id=s.destination_id
             LEFT JOIN address_dictionary source_address ON source_address.address_id=s.source_address_id
             LEFT JOIN address_dictionary destination_address
                    ON destination_address.address_id=s.destination_address_id
             LEFT JOIN asset_dictionary asset ON asset.asset_id=s.asset_id
            WHERE s.event_index=?`,
        )
          .bind(eventIndex)
          .first<SendSample>(),
      ]);
      return { event_index: eventIndex, match: JSON.stringify(sourceRow) === JSON.stringify(coreRow) };
    }),
  );
  const sourceRows = Number(source.rows);
  const coreRows = Number(core.rows);
  const done = state.get("sends_done") === "1";
  const failures = coreSendReadinessFailures({
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
    state: { cursor: state.has("sends_cursor") ? Number(state.get("sends_cursor")) : null, done },
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

/** Read-only count, canonical transaction frontier, and decoded parity evidence for current orders. */
export async function auditCoreOrders(env: Pick<Env, "DB" | "CORE_DB">): Promise<CoreOrderReadiness> {
  const [sourceMeta, coreMeta, stateRows] = await Promise.all([
    env.DB.prepare(
      `SELECT COUNT(*) rows,MIN(t.tx_index) first_index,MAX(t.tx_index) last_index
         FROM transactions t JOIN orders o ON o.tx_hash=t.tx_hash`,
    ).first<IssuanceMeta>(),
    env.CORE_DB.prepare(
      `SELECT COUNT(*) rows,MIN(tx_index) first_index,MAX(tx_index) last_index FROM orders`,
    ).first<IssuanceMeta>(),
    env.CORE_DB.prepare(`SELECT key,value FROM core_state WHERE key IN ('orders_cursor','orders_done')`).all<{
      key: string;
      value: string;
    }>(),
  ]);
  const source = sourceMeta ?? { rows: 0, first_index: null, last_index: null };
  const core = coreMeta ?? { rows: 0, first_index: null, last_index: null };
  const state = new Map(stateRows.results.map((row) => [row.key, row.value]));
  const samples = await Promise.all(
    sampleIndexes(core).map(async (txIndex) => {
      const [sourceRow, coreRow] = await Promise.all([
        env.DB.prepare(
          `SELECT t.tx_index,LOWER(o.tx_hash) tx_hash,o.block_index,o.block_time,o.source,o.give_asset,
                  o.give_quantity,o.give_remaining,o.get_asset,o.get_quantity,o.get_remaining,o.expiration,
                  o.expire_index,o.fee_required,o.fee_required_remaining,o.fee_provided,
                  o.fee_provided_remaining,o.status,o.closed_block_index
             FROM transactions t JOIN orders o ON o.tx_hash=t.tx_hash WHERE t.tx_index=?`,
        )
          .bind(txIndex)
          .first<OrderSample>(),
        env.CORE_DB.prepare(
          `SELECT o.tx_index,LOWER(HEX(o.tx_hash)) tx_hash,o.block_index,o.block_time,source.address source,
                  give_asset.asset give_asset,o.give_quantity,o.give_remaining,get_asset.asset get_asset,
                  o.get_quantity,o.get_remaining,o.expiration,o.expire_index,o.fee_required,
                  o.fee_required_remaining,o.fee_provided,o.fee_provided_remaining,o.status,o.closed_block_index
             FROM orders o
             LEFT JOIN address_dictionary source ON source.address_id=o.source_id
             LEFT JOIN asset_dictionary give_asset ON give_asset.asset_id=o.give_asset_id
             LEFT JOIN asset_dictionary get_asset ON get_asset.asset_id=o.get_asset_id
            WHERE o.tx_index=?`,
        )
          .bind(txIndex)
          .first<OrderSample>(),
      ]);
      return { tx_index: txIndex, match: JSON.stringify(sourceRow) === JSON.stringify(coreRow) };
    }),
  );
  const sourceRows = Number(source.rows);
  const coreRows = Number(core.rows);
  const done = state.get("orders_done") === "1";
  const failures = coreOrderReadinessFailures({
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
    state: { cursor: state.has("orders_cursor") ? Number(state.get("orders_cursor")) : null, done },
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

/** Read-only count, reconstructed public-id frontier, and decoded parity evidence for order matches. */
export async function auditCoreOrderMatches(env: Pick<Env, "DB" | "CORE_DB">): Promise<CoreOrderMatchReadiness> {
  const publicId = `LOWER(HEX(tx0_hash))||'_'||LOWER(HEX(tx1_hash))`;
  const sourceSampleSql = `SELECT id,tx0_index,tx1_index,LOWER(tx0_hash) tx0_hash,LOWER(tx1_hash) tx1_hash,
                                  tx0_address,tx1_address,forward_asset,forward_quantity,backward_asset,
                                  backward_quantity,block_index,block_time,status,match_expire_index,fee_paid,
                                  tx0_block_index,tx1_block_index,tx0_expiration,tx1_expiration FROM order_matches`;
  const [sourceMeta, coreMeta, firstSource, lastSource, stateRows] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) rows,MIN(id) first_id,MAX(id) last_id FROM order_matches`).first<OrderMatchMeta>(),
    env.CORE_DB.prepare(
      `SELECT COUNT(*) rows,MIN(${publicId}) first_id,MAX(${publicId}) last_id FROM order_matches`,
    ).first<OrderMatchMeta>(),
    env.DB.prepare(`${sourceSampleSql} ORDER BY id LIMIT 1`).first<OrderMatchSample>(),
    env.DB.prepare(`${sourceSampleSql} ORDER BY id DESC LIMIT 1`).first<OrderMatchSample>(),
    env.CORE_DB.prepare(
      `SELECT key,value FROM core_state WHERE key IN ('order_matches_cursor','order_matches_done')`,
    ).all<{ key: string; value: string }>(),
  ]);
  const source = sourceMeta ?? { rows: 0, first_id: null, last_id: null };
  const core = coreMeta ?? { rows: 0, first_id: null, last_id: null };
  const sampleRows = [firstSource, lastSource].filter(
    (row, index, rows): row is OrderMatchSample =>
      row != null && rows.findIndex((value) => value?.id === row.id) === index,
  );
  const samples = await Promise.all(
    sampleRows.map(async (sourceRow) => {
      const coreRow = await env.CORE_DB.prepare(
        `SELECT ${publicId} id,m.tx0_index,m.tx1_index,LOWER(HEX(m.tx0_hash)) tx0_hash,
                LOWER(HEX(m.tx1_hash)) tx1_hash,tx0.address tx0_address,tx1.address tx1_address,
                forward_asset.asset forward_asset,m.forward_quantity,backward_asset.asset backward_asset,
                m.backward_quantity,m.block_index,m.block_time,m.status,m.match_expire_index,m.fee_paid,
                m.tx0_block_index,m.tx1_block_index,m.tx0_expiration,m.tx1_expiration
           FROM order_matches m
           LEFT JOIN address_dictionary tx0 ON tx0.address_id=m.tx0_address_id
           LEFT JOIN address_dictionary tx1 ON tx1.address_id=m.tx1_address_id
           LEFT JOIN asset_dictionary forward_asset ON forward_asset.asset_id=m.forward_asset_id
           LEFT JOIN asset_dictionary backward_asset ON backward_asset.asset_id=m.backward_asset_id
          WHERE m.tx0_index=? AND m.tx1_index=?`,
      )
        .bind(sourceRow.tx0_index, sourceRow.tx1_index)
        .first<OrderMatchSample>();
      return { id: sourceRow.id, match: JSON.stringify(sourceRow) === JSON.stringify(coreRow) };
    }),
  );
  const state = new Map(stateRows.results.map((row) => [row.key, row.value]));
  const sourceRows = Number(source.rows);
  const coreRows = Number(core.rows);
  const done = state.get("order_matches_done") === "1";
  const failures = coreOrderMatchReadinessFailures({
    sourceRows,
    coreRows,
    sourceFirst: source.first_id,
    sourceLast: source.last_id,
    coreFirst: core.first_id,
    coreLast: core.last_id,
    done,
    sampleMatches: samples.map((sample) => sample.match),
  });
  return {
    ready: failures.length === 0,
    read_only: true,
    state: { cursor: state.get("order_matches_cursor") ?? null, done },
    progress: {
      source: sourceRows,
      core: coreRows,
      percent: sourceRows > 0 ? Math.round((coreRows / sourceRows) * 10000) / 100 : 0,
    },
    extrema: {
      source: { first: source.first_id, last: source.last_id },
      core: { first: core.first_id, last: core.last_id },
      match: source.first_id === core.first_id && source.last_id === core.last_id,
    },
    samples,
    failures,
  };
}
