import { Hono } from "hono";
import type { Env } from "#api/env";
import { boundedInteger } from "#api/http/numbers";

export const bitcoinSidecarRead = new Hono<{ Bindings: Env }>();

bitcoinSidecarRead.get("/v2/bitcoin/sidecar/status", async (c) => {
  const [state, blocks, balances] = await Promise.all([
    c.env.RECOVERY_DB.prepare(`SELECT key,value,updated_at FROM btc_sidecar_state ORDER BY key`).all(),
    c.env.RECOVERY_DB.prepare(
      `SELECT COUNT(*) blocks,MIN(block_height) first_block,MAX(block_height) last_block,
              MAX(imported_at) imported_at FROM btc_block_metrics`,
    ).first(),
    c.env.RECOVERY_DB.prepare(
      `SELECT COUNT(*) addresses,COALESCE(SUM(balance_sats),0) balance_sats FROM btc_sidecar_address_balance`,
    ).first(),
  ]);
  return c.json({ result: { state: state.results, blocks, balances } }, 200, {
    "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
  });
});

bitcoinSidecarRead.get("/v2/bitcoin/blocks", async (c) => {
  const limit = boundedInteger(c.req.query("limit"), { defaultValue: 100, min: 1, max: 1000 });
  const to = boundedInteger(c.req.query("to"), { defaultValue: 9_999_999, min: 0, max: 9_999_999 });
  const from = boundedInteger(c.req.query("from"), { defaultValue: 0, min: 0, max: to });
  const rows = await c.env.RECOVERY_DB.prepare(
    `SELECT block_height,block_hash,block_time,block_size,transaction_count,total_fees_sats,
            counterparty_transaction_count,counterparty_fee_sats,source,source_version,imported_at
       FROM btc_block_metrics WHERE block_height BETWEEN ? AND ? ORDER BY block_height DESC LIMIT ?`,
  )
    .bind(from, to, limit)
    .all();
  return c.json({ result: rows.results, range: { from, to, limit } }, 200, {
    "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
  });
});

bitcoinSidecarRead.get("/v2/bitcoin/balances", async (c) => {
  const limit = boundedInteger(c.req.query("limit"), { defaultValue: 100, min: 1, max: 1000 });
  const offset = boundedInteger(c.req.query("offset"), { defaultValue: 0, min: 0, max: 1_000_000 });
  const rows = await c.env.RECOVERY_DB.prepare(
    `SELECT address,balance_sats,utxo_count,first_block,last_block,source,source_version,imported_at
       FROM btc_sidecar_address_balance ORDER BY balance_sats DESC,address LIMIT ? OFFSET ?`,
  )
    .bind(limit, offset)
    .all();
  return c.json({ result: rows.results, next_offset: rows.results.length === limit ? offset + limit : null }, 200, {
    "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
  });
});
