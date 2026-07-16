import type { Env } from "#api/env";

interface CountRow {
  total: number;
  complete: number;
}

interface StateRow {
  key: string;
  value: string;
}

function progress(total: number, complete: number) {
  const boundedComplete = Math.min(total, Math.max(0, complete));
  return {
    total,
    complete: boundedComplete,
    remaining: Math.max(0, total - boundedComplete),
    percent: total === 0 ? 100 : Math.round((boundedComplete / total) * 10_000) / 100,
  };
}

/**
 * Deliberately heavier, operator-only historical progress report. Keep this separate from `/admin/status`,
 * which is suitable for frequent health checks and must never scan multi-million-row partial indexes.
 */
export async function backfillStatus(env: Env) {
  const [fees, blockCounts, ethereumTimes, coreState, maxTransaction, maxEmblemSale, recoveryState] = await Promise.all(
    [
      env.CORE_DB.prepare(`SELECT COUNT(*) total,COUNT(fee) complete FROM transactions`).first<CountRow>(),
      env.CORE_DB.prepare(
        `SELECT COUNT(*) total,COUNT(bitcoin_transaction_count) complete FROM blocks`,
      ).first<CountRow>(),
      env.CORE_DB.prepare(
        `SELECT COUNT(DISTINCT sale.block_number) total,COUNT(DISTINCT block.block_number) complete
           FROM emblem_sales sale LEFT JOIN ethereum_blocks block ON block.block_number=sale.block_number
          WHERE sale.block_number IS NOT NULL`,
      ).first<CountRow>(),
      env.CORE_DB.prepare(
        `SELECT key,value FROM core_state WHERE key IN
          ('last_block_index','trades_cur_dex','trades_cur_dispense_payments','trades_cur_emblem',
           'trades_emblem_reconcile_cursor','bitcoin_block_counts_cursor','vault_contents_cursor',
           'asset_signals_cursor','address_signals_cursor','scarce_cursor')`,
      ).all<StateRow>(),
      env.CORE_DB.prepare(`SELECT COALESCE(MAX(tx_index),-1) value FROM transactions`).first<{ value: number }>(),
      env.CORE_DB.prepare(`SELECT COALESCE(MAX(rowid),0) value FROM emblem_sales`).first<{ value: number }>(),
      env.RECOVERY_DB.prepare(`SELECT value FROM recovery_state WHERE key='recovery_scan_tx_index'`).first<{
        value: string;
      }>(),
    ],
  );

  const state = Object.fromEntries(coreState.results.map((row) => [row.key, Number(row.value)]));
  const transactionTip = Number(maxTransaction?.value ?? -1);
  const emblemTip = Number(maxEmblemSale?.value ?? 0);
  const recoveryCursor = Number(recoveryState?.value ?? -1);
  return {
    generated_at: Math.floor(Date.now() / 1_000),
    bitcoin_fees: progress(Number(fees?.total ?? 0), Number(fees?.complete ?? 0)),
    bitcoin_block_transaction_counts: progress(Number(blockCounts?.total ?? 0), Number(blockCounts?.complete ?? 0)),
    ethereum_block_times: progress(Number(ethereumTimes?.total ?? 0), Number(ethereumTimes?.complete ?? 0)),
    recovery_scan: {
      ...progress(transactionTip + 1, recoveryCursor + 1),
      cursor: recoveryCursor,
      transaction_tip: transactionTip,
    },
    trades: {
      chain_tip: state.last_block_index ?? 0,
      dex_cursor: state.trades_cur_dex ?? 0,
      dispense_cursor: state.trades_cur_dispense_payments ?? 0,
      emblem: progress(emblemTip, state.trades_cur_emblem ?? 0),
      emblem_reconcile_cursor: state.trades_emblem_reconcile_cursor ?? 0,
    },
    recurring_sweeps: {
      asset_signals_cursor: state.asset_signals_cursor ?? 0,
      address_signals_cursor: state.address_signals_cursor ?? 0,
      vault_contents_cursor: state.vault_contents_cursor ?? 0,
      scarce_sales_cursor: state.scarce_cursor ?? 0,
    },
  };
}
