import { Hono } from "hono";
import type {
  BitcoinAddressBalance,
  BitcoinBalanceCoverage,
  BitcoinBlockCoverage,
  BitcoinBlockMetrics,
  BitcoinIndexStateEntry,
  BitcoinIndexStatus,
} from "@xcp/shared/bitcoin";
import type { Env } from "#api/env";
import { q, one } from "#api/db";
import { boundedInteger } from "#api/http/numbers";

export const bitcoinRead = new Hono<{ Bindings: Env }>();

bitcoinRead.get("/v2/bitcoin/status", async (c) => {
  const [state, blocks, balances] = await Promise.all([
    q<BitcoinIndexStateEntry>(c.env.RECOVERY_DB, `SELECT key,value,updated_at FROM btc_index_state ORDER BY key`),
    one<BitcoinBlockCoverage>(
      c.env.RECOVERY_DB,
      `SELECT COUNT(*) blocks,MIN(block_height) first_block,MAX(block_height) last_block,
              MAX(imported_at) imported_at FROM btc_block_metrics`,
    ),
    one<BitcoinBalanceCoverage>(
      c.env.RECOVERY_DB,
      `SELECT COUNT(*) addresses,COALESCE(SUM(balance_sats),0) balance_sats FROM btc_address_balance`,
    ),
  ]);
  const body: BitcoinIndexStatus = { state, blocks, balances };
  return c.json({ result: body }, 200, { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" });
});

bitcoinRead.get("/v2/bitcoin/blocks", async (c) => {
  const limit = boundedInteger(c.req.query("limit"), { defaultValue: 100, min: 1, max: 1000 });
  const to = boundedInteger(c.req.query("to"), { defaultValue: 9_999_999, min: 0, max: 9_999_999 });
  const from = boundedInteger(c.req.query("from"), { defaultValue: 0, min: 0, max: to });
  const rows = await q<BitcoinBlockMetrics>(
    c.env.RECOVERY_DB,
    `SELECT block_height,block_hash,block_time,block_size,transaction_count,total_fees_sats,
            counterparty_transaction_count,counterparty_fee_sats,source,source_version,imported_at
       FROM btc_block_metrics WHERE block_height BETWEEN ? AND ? ORDER BY block_height DESC LIMIT ?`,
    from,
    to,
    limit,
  );
  return c.json({ result: rows, range: { from, to, limit } }, 200, {
    "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
  });
});

bitcoinRead.get("/v2/bitcoin/balances", async (c) => {
  const limit = boundedInteger(c.req.query("limit"), { defaultValue: 100, min: 1, max: 1000 });
  const offset = boundedInteger(c.req.query("offset"), { defaultValue: 0, min: 0, max: 1_000_000 });
  const rows = await q<BitcoinAddressBalance>(
    c.env.RECOVERY_DB,
    `SELECT address,balance_sats,utxo_count,first_block,last_block,source,source_version,imported_at
       FROM btc_address_balance ORDER BY balance_sats DESC,address LIMIT ? OFFSET ?`,
    limit,
    offset,
  );
  return c.json({ result: rows, next_offset: rows.length === limit ? offset + limit : null }, 200, {
    "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
  });
});
