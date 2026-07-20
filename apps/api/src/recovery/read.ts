import { Hono } from "hono";
import { base58check } from "@scure/base";
import { sha256 } from "@noble/hashes/sha2.js";
import type { Env } from "#api/env";
import { boundedInteger } from "#api/http/numbers";
import { parseRecoveryTransaction } from "#api/recovery/raw-transaction";

interface RecoveryOutputRow {
  txid: string;
  vout: number;
  value_sats: number;
  script_pubkey_hex: string;
  layout: string;
  recovery_key_position: number;
  classification: string;
  block_height: number | null;
  verified_at: number;
}

const check = base58check(sha256);

function isP2pkhAddress(address: string): boolean {
  try {
    const payload = check.decode(address);
    return payload.length === 21 && payload[0] === 0;
  } catch {
    return false;
  }
}

function deterministicFeeAddress(address: string, configured: string): string | null {
  const addresses = configured
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (addresses.length === 0) return null;
  let hash = 2166136261;
  for (const character of address) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return addresses[(hash >>> 0) % addresses.length];
}

export const recoveryRead = new Hono<{ Bindings: Env }>();

recoveryRead.use("/addresses/*", async (c, next) => {
  await next();
  c.header("Access-Control-Allow-Origin", "*");
  c.header("Access-Control-Allow-Headers", "Content-Type");
  c.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
});
recoveryRead.options("/addresses/*", (c) => c.body(null, 204));

function chunks<T>(values: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(values.length / size) }, (_, index) =>
    values.slice(index * size, (index + 1) * size),
  );
}

async function recoveryReadsReady(env: Env): Promise<boolean> {
  const state = await env.RECOVERY_DB.prepare(`SELECT value FROM recovery_state WHERE key='read_ready'`).first<{
    value: string;
  }>();
  return state?.value === "1";
}

recoveryRead.get("/v2/recovery/stats", async (c) => {
  const [summary, monthly, recovered, top] = await Promise.all([
    c.env.RECOVERY_DB.prepare(`SELECT * FROM recovery_stats_snapshot WHERE singleton=1`).first(),
    c.env.RECOVERY_DB.prepare(`SELECT * FROM recovery_monthly_stats ORDER BY month`).all(),
    c.env.RECOVERY_DB.prepare(`SELECT * FROM recovery_monthly_recovered ORDER BY month`).all(),
    c.env.RECOVERY_DB.prepare(
      `SELECT * FROM recovery_address_stats WHERE unprotected_sats>0 ORDER BY unprotected_sats DESC,address LIMIT 25`,
    ).all(),
  ]);
  if (!summary)
    return c.json({ error: "recovery statistics are being prepared" }, 503, { "Access-Control-Allow-Origin": "*" });
  return c.json(
    {
      result: {
        summary,
        monthly: monthly.results,
        recovered_monthly: recovered.results,
        top_unprotected_addresses: top.results,
      },
    },
    200,
    {
      "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
      "Access-Control-Allow-Origin": "*",
    },
  );
});

recoveryRead.get("/addresses/:address/recovery", async (c) => {
  if (!(await recoveryReadsReady(c.env))) return c.json({ error: "recovery index is still being verified" }, 503);
  const address = c.req.param("address");
  if (!isP2pkhAddress(address)) return c.json({ error: "invalid P2PKH address" }, 400);
  const page = boundedInteger(c.req.query("page"), { defaultValue: 1, min: 1 });
  const limit = boundedInteger(c.req.query("limit"), { defaultValue: 420, min: 1, max: 420 });
  const includeProtectedStamps = c.req.query("include_protected_stamps") === "true";
  const offset = (page - 1) * limit;
  if (!Number.isSafeInteger(offset)) return c.json({ error: "page is too large" }, 400);

  const db = c.env.RECOVERY_DB as unknown as { withSession?: (mode?: string) => D1Database };
  const session = typeof db.withSession === "function" ? db.withSession("first-unconstrained") : c.env.RECOVERY_DB;
  const protectionFilter = includeProtectedStamps
    ? ""
    : `AND NOT EXISTS (SELECT 1 FROM recovery_protected_transactions p
                        WHERE p.txid=recovery_outputs.txid AND p.protection_kind='stamp')`;
  const [totals, outputResult, pending, protectedTotals] = await Promise.all([
    session
      .prepare(
        `SELECT COUNT(*) output_count, COALESCE(SUM(value_sats),0) value_sats FROM recovery_outputs
        WHERE recovery_address=? AND classification='recoverable'
          ${protectionFilter}
          AND NOT EXISTS (
            SELECT 1 FROM recovery_attempt_inputs i JOIN recovery_attempts a ON a.txid=i.recovery_txid
             WHERE i.input_txid=recovery_outputs.txid AND i.input_vout=recovery_outputs.vout AND a.status='pending'
          )`,
      )
      .bind(address)
      .first<{ output_count: number; value_sats: number }>(),
    session
      .prepare(
        `SELECT txid,vout,value_sats,script_pubkey_hex,layout,recovery_key_position,
              classification,block_height,verified_at
         FROM recovery_outputs WHERE recovery_address=? AND classification='recoverable'
          ${protectionFilter}
          AND NOT EXISTS (
            SELECT 1 FROM recovery_attempt_inputs i JOIN recovery_attempts a ON a.txid=i.recovery_txid
             WHERE i.input_txid=recovery_outputs.txid AND i.input_vout=recovery_outputs.vout AND a.status='pending'
          )
        ORDER BY value_sats DESC,txid,vout LIMIT ? OFFSET ?`,
      )
      .bind(address, limit, offset)
      .all<RecoveryOutputRow>(),
    session
      .prepare(`SELECT COUNT(*) attempts FROM recovery_attempts WHERE address=? AND status='pending'`)
      .bind(address)
      .first<{ attempts: number }>(),
    session
      .prepare(
        `SELECT COUNT(*) output_count,COALESCE(SUM(value_sats),0) value_sats
           FROM recovery_outputs WHERE recovery_address=? AND classification='recoverable'
            AND EXISTS (SELECT 1 FROM recovery_protected_transactions p
                         WHERE p.txid=recovery_outputs.txid AND p.protection_kind='stamp')`,
      )
      .bind(address)
      .first<{ output_count: number; value_sats: number }>(),
  ]);

  const uniqueTxids = [...new Set(outputResult.results.map((row) => row.txid))];
  const transactionEntries = await Promise.all(
    uniqueTxids.map(async (txid) => {
      const object = await c.env.RECOVERY_TRANSACTIONS.get(`transactions/${txid}.hex`);
      return [txid, object ? await object.text() : null] as const;
    }),
  );
  const totalOutputs = Number(totals?.output_count ?? 0);
  const totalValue = Number(totals?.value_sats ?? 0);
  const threshold = Number(c.env.RECOVERY_FEE_EXEMPTION_SATS || 10_000);

  c.header("Cache-Control", "public, max-age=30, stale-while-revalidate=60");
  return c.json({
    address,
    summary: {
      total_outputs: totalOutputs,
      total_value_sats: totalValue,
      pages: Math.ceil(totalOutputs / limit),
      current_page: page,
      outputs_on_page: outputResult.results.length,
    },
    fee: {
      address: deterministicFeeAddress(address, c.env.RECOVERY_FEE_ADDRESSES || ""),
      percent: totalValue < threshold ? 0 : Number(c.env.RECOVERY_FEE_PERCENT || 10),
      exemption_sats: threshold,
    },
    pending_attempts: Number(pending?.attempts ?? 0),
    protection: {
      protected_stamp_outputs: Number(protectedTotals?.output_count ?? 0),
      protected_stamp_value_sats: Number(protectedTotals?.value_sats ?? 0),
      included: includeProtectedStamps,
    },
    outputs: outputResult.results,
    transactions: Object.fromEntries(transactionEntries),
    missing_transactions: transactionEntries.filter(([, raw]) => raw == null).map(([txid]) => txid),
  });
});

interface RecoveryReportBody {
  raw_transaction_hex?: string;
  network_fee_sats?: number;
  service_fee_sats?: number;
  output_value_sats?: number;
  include_protected_stamps?: boolean;
}

interface RecoveryReportInput {
  recovery_address?: string;
  classification?: string;
  spent_by_txid?: string | null;
  protected_stamp?: number;
  pending_txid?: string | null;
}

export function isRecoveryReportInput(
  row: RecoveryReportInput | undefined,
  address: string,
  recoveryTxid: string,
): row is RecoveryReportInput & { recovery_address: string; classification: string } {
  if (row?.recovery_address !== address) return false;
  return row.classification === "recoverable" || (row.classification === "spent" && row.spent_by_txid === recoveryTxid);
}

recoveryRead.post("/addresses/:address/recoveries", async (c) => {
  if (!(await recoveryReadsReady(c.env))) return c.json({ error: "recovery index is still being verified" }, 503);
  const address = c.req.param("address");
  if (!isP2pkhAddress(address)) return c.json({ error: "invalid P2PKH address" }, 400);
  const body = await c.req.json<RecoveryReportBody>().catch(() => null);
  if (!body || typeof body.raw_transaction_hex !== "string")
    return c.json({ error: "raw_transaction_hex is required" }, 400);
  const amounts = [body.network_fee_sats, body.service_fee_sats, body.output_value_sats];
  if (amounts.some((value) => !Number.isSafeInteger(value) || Number(value) < 0))
    return c.json({ error: "fee and output amounts must be non-negative safe integers" }, 400);

  let transaction;
  try {
    transaction = parseRecoveryTransaction(body.raw_transaction_hex);
  } catch {
    return c.json({ error: "invalid recovery transaction" }, 400);
  }
  if (transaction.inputs.length === 0 || transaction.inputs.length > 420)
    return c.json({ error: "recovery must contain 1 to 420 inputs" }, 400);
  const uniqueInputs = new Set(transaction.inputs.map((input) => `${input.txid}:${input.vout}`));
  if (uniqueInputs.size !== transaction.inputs.length)
    return c.json({ error: "recovery contains duplicate inputs" }, 400);

  const lookupStatement = c.env.RECOVERY_DB.prepare(
    `SELECT recovery_address,classification,value_sats,
            spent_by_txid,
            EXISTS(SELECT 1 FROM recovery_protected_transactions p
                    WHERE p.txid=recovery_outputs.txid AND p.protection_kind='stamp') protected_stamp,
            (SELECT a.txid FROM recovery_attempt_inputs i JOIN recovery_attempts a ON a.txid=i.recovery_txid
              WHERE i.input_txid=recovery_outputs.txid AND i.input_vout=recovery_outputs.vout
                AND a.status='pending' LIMIT 1) pending_txid
       FROM recovery_outputs WHERE txid=? AND vout=?`,
  );
  const lookupBatches = await Promise.all(
    chunks(transaction.inputs, 50).map((batch) =>
      c.env.RECOVERY_DB.batch(batch.map((input) => lookupStatement.bind(input.txid, input.vout))),
    ),
  );
  const lookups = lookupBatches.flat();
  for (let index = 0; index < lookups.length; index++) {
    const row = lookups[index].results[0] as
      | {
          recovery_address?: string;
          classification?: string;
          value_sats?: number;
          spent_by_txid?: string | null;
          pending_txid?: string | null;
          protected_stamp?: number;
        }
      | undefined;
    if (!isRecoveryReportInput(row, address, transaction.txid))
      return c.json(
        {
          error: `input is not recoverable by this address: ${transaction.inputs[index].txid}:${transaction.inputs[index].vout}`,
        },
        409,
      );
    if (Number(row.protected_stamp) === 1 && body.include_protected_stamps !== true)
      return c.json({ error: "input belongs to a protected Stamp transaction; explicit opt-in is required" }, 409);
    if (row.pending_txid && row.pending_txid !== transaction.txid)
      return c.json({ error: `input is already pending in recovery ${row.pending_txid}` }, 409);
  }

  const inputValue = lookups.reduce(
    (sum, result) => sum + BigInt((result.results[0] as { value_sats: number }).value_sats),
    0n,
  );
  const outputValue = transaction.outputs.reduce((sum, output) => sum + output.valueSats, 0n);
  const networkFee = inputValue - outputValue;
  if (networkFee < 0n || networkFee !== BigInt(body.network_fee_sats!))
    return c.json({ error: "reported network fee does not match the transaction" }, 400);
  if (outputValue !== BigInt(body.service_fee_sats!) + BigInt(body.output_value_sats!))
    return c.json({ error: "reported service and destination values do not match the transaction" }, 400);

  const now = Math.floor(Date.now() / 1000);
  const attempt = c.env.RECOVERY_DB.prepare(
    `INSERT INTO recovery_attempts
       (txid,address,status,replacement_txid,network_fee_sats,service_fee_sats,output_value_sats,block_height,reported_at,updated_at,
        confirmations,block_hash,block_time,chain_checked_at,status_reason)
     VALUES (?,?,'pending',NULL,?,?,?,NULL,?,?,0,NULL,NULL,NULL,'awaiting-chain-evidence')
     ON CONFLICT(txid) DO UPDATE SET updated_at=excluded.updated_at`,
  ).bind(transaction.txid, address, body.network_fee_sats, body.service_fee_sats, body.output_value_sats, now, now);
  const inputStatements = chunks(transaction.inputs, 25).map((batch) =>
    c.env.RECOVERY_DB.prepare(
      `INSERT INTO recovery_attempt_inputs (recovery_txid,input_txid,input_vout) VALUES
       ${batch.map(() => "(?,?,?)").join(",")}
       ON CONFLICT(recovery_txid,input_txid,input_vout) DO NOTHING`,
    ).bind(...batch.flatMap((input) => [transaction.txid, input.txid, input.vout])),
  );
  await c.env.RECOVERY_DB.batch([attempt, ...inputStatements]);
  await c.env.RECOVERY_TRANSACTIONS.put(`recoveries/${transaction.txid}.hex`, body.raw_transaction_hex.toLowerCase(), {
    httpMetadata: { contentType: "text/plain" },
    customMetadata: { address },
  });
  return c.json({ status: "pending", txid: transaction.txid, inputs: transaction.inputs.length }, 201);
});

recoveryRead.get("/addresses/:address/recoveries", async (c) => {
  if (!(await recoveryReadsReady(c.env))) return c.json({ error: "recovery index is still being verified" }, 503);
  const address = c.req.param("address");
  if (!isP2pkhAddress(address)) return c.json({ error: "invalid P2PKH address" }, 400);
  const limit = boundedInteger(c.req.query("limit"), { defaultValue: 50, min: 1, max: 100 });
  const result = await c.env.RECOVERY_DB.prepare(
    `SELECT a.txid,a.status,a.replacement_txid,a.network_fee_sats,a.service_fee_sats,a.output_value_sats,
            a.block_height,a.block_hash,a.block_time,a.confirmations,a.status_reason,a.chain_checked_at,
            a.reported_at,a.updated_at,COUNT(i.input_txid) input_count
       FROM recovery_attempts a LEFT JOIN recovery_attempt_inputs i ON i.recovery_txid=a.txid
      WHERE a.address=? GROUP BY a.txid ORDER BY a.reported_at DESC LIMIT ?`,
  )
    .bind(address, limit)
    .all();
  c.header("Cache-Control", "private, max-age=10");
  return c.json({ address, recoveries: result.results });
});
