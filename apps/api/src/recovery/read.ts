import { Hono } from "hono";
import { base58check } from "@scure/base";
import { sha256 } from "@noble/hashes/sha2.js";
import type { Env } from "#api/env";
import { boundedInteger } from "#api/http/numbers";
import { allocateRecoveryFeeAddress, legacyFeeScriptsHex, RecoveryFeeKeyError } from "#api/recovery/fee-address";
import { parseRecoveryTransaction, type RecoveryTransactionOutput } from "#api/recovery/raw-transaction";
import { requestAddressReverification } from "#api/recovery/verify";
import type { Context } from "hono";

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

/**
 * Outputs a single recovery transaction may consume. A wallet spending 420 bare-multisig inputs is
 * already near Bitcoin's standard transaction size limit, so this is a protocol bound rather than a
 * tuning knob, and it is reported on every page so clients need not carry their own copy of it.
 */
export const RECOVERY_MAX_OUTPUTS_PER_PAGE = 420;

/**
 * Never hand back an output some reported recovery already consumed. Keying this on a *pending*
 * attempt was backwards: it hid inputs while the spend was uncertain and released them the moment it
 * became certain, so every completed recovery was re-offered to its owner and failed to broadcast with
 * bad-txns-inputs-missingorspent. Every terminal attempt status means the inputs were consumed
 * (`confirmed` by the attempt, `replaced` by its replacement, `failed` by several conflicting spends).
 *
 * Membership alone was still too broad in one direction. An attempt the network never saw consumed
 * nothing, and `transaction-not-seen-inputs-unspent` is not terminal, so a wallet that signed without
 * broadcasting hid its owner's own outputs from them permanently — four July 2026 attempts held 196
 * outputs that way. `inputs_released` is the attempt's own verdict on whether it consumed anything;
 * reconciliation sets it when the abandonment window expires. `recovery_attempt_inputs_output` finds
 * the membership row and the attempt joins by primary key, so the probe stays bounded per output.
 */
export const CONSUMED_BY_ATTEMPT_FILTER = `AND NOT EXISTS (SELECT 1 FROM recovery_attempt_inputs i
    JOIN recovery_attempts a ON a.txid=i.recovery_txid AND a.inputs_released=0
    WHERE i.input_txid=recovery_outputs.txid AND i.input_vout=recovery_outputs.vout)`;

/**
 * Run work after the response without ever letting it affect the response. Tests and any non-Worker
 * host reach this without an execution context, where awaiting inline would be wrong and throwing
 * would be worse, so the work is simply dropped.
 */
function scheduleBackgroundWork(c: Context<{ Bindings: Env }>, work: () => Promise<void>): void {
  try {
    c.executionCtx.waitUntil(work());
  } catch {
    /* no execution context: verification still happens on the maintenance lane */
  }
}

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

/**
 * Which address this batch pays its service fee to. With the account xpub configured, the database
 * allocates one derivation index per batch: the scope is the batch's first output as the page orders
 * it, so a retry or an RBF replacement of the same batch lands on the same address while every
 * distinct batch gets a fresh one. Nothing is allocated when no fee is due — browsing a dust address
 * must not consume indexes. The static list stays as the fallback until the xpub is configured.
 */
async function recoveryFeeAddress(
  env: Env,
  address: string,
  firstOutput: { txid: string; vout: number } | undefined,
  feeDue: boolean,
): Promise<string | null> {
  if (!env.RECOVERY_FEE_XPUB) return deterministicFeeAddress(address, env.RECOVERY_FEE_ADDRESSES || "");
  if (!feeDue || !firstOutput) return null;
  const allocation = await allocateRecoveryFeeAddress(
    env.RECOVERY_DB,
    env.RECOVERY_FEE_XPUB,
    `recovery:${firstOutput.txid}:${firstOutput.vout}`,
    Math.floor(Date.now() / 1000),
  );
  return allocation.address;
}

/**
 * The outputs of a reported recovery that pay a fee address this service issued — a derived one from
 * the allocation table, or one of the legacy static list while that is still configured. The
 * client's `service_fee_sats` used to be taken on faith; the raw transaction is already parsed here,
 * so the fee it actually pays is one lookup away.
 */
async function recoveryFeeOutputs(
  env: Env,
  outputs: RecoveryTransactionOutput[],
): Promise<Array<{ vout: number; valueSats: bigint; feeAddressId: number | null }>> {
  const legacyScripts = new Set(legacyFeeScriptsHex(env.RECOVERY_FEE_ADDRESSES || ""));
  const derived = new Map<string, number>();
  for (const batch of chunks(outputs, 50)) {
    const rows = await env.RECOVERY_DB.prepare(
      `SELECT id,script_pubkey_hex FROM recovery_fee_addresses
        WHERE script_pubkey_hex IN (${batch.map(() => "?").join(",")})`,
    )
      .bind(...batch.map((output) => output.scriptPubkeyHex))
      .all<{ id: number; script_pubkey_hex: string }>();
    for (const row of rows.results) derived.set(row.script_pubkey_hex, row.id);
  }
  return outputs.flatMap((output, vout) => {
    const feeAddressId = derived.get(output.scriptPubkeyHex);
    if (feeAddressId === undefined && !legacyScripts.has(output.scriptPubkeyHex)) return [];
    return [{ vout, valueSats: output.valueSats, feeAddressId: feeAddressId ?? null }];
  });
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
  const limit = boundedInteger(c.req.query("limit"), {
    defaultValue: RECOVERY_MAX_OUTPUTS_PER_PAGE,
    min: 1,
    max: RECOVERY_MAX_OUTPUTS_PER_PAGE,
  });
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
          ${CONSUMED_BY_ATTEMPT_FILTER}`,
      )
      .bind(address)
      .first<{ output_count: number; value_sats: number }>(),
    session
      .prepare(
        `SELECT txid,vout,value_sats,script_pubkey_hex,layout,recovery_key_position,
              classification,block_height,verified_at
         FROM recovery_outputs WHERE recovery_address=? AND classification='recoverable'
          ${protectionFilter}
          ${CONSUMED_BY_ATTEMPT_FILTER}
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
  const feePercent = totalValue < threshold ? 0 : Number(c.env.RECOVERY_FEE_PERCENT || 10);
  let feeAddress: string | null;
  try {
    feeAddress = await recoveryFeeAddress(c.env, address, outputResult.results[0], feePercent > 0);
  } catch (error) {
    if (error instanceof RecoveryFeeKeyError) return c.json({ error: "recovery fee configuration is invalid" }, 503);
    throw error;
  }

  // Somebody is about to spend these outputs, which makes this the moment their chain state matters
  // most. Ask for a re-check behind the response rather than inside it; the request is self-limiting,
  // so a reader refreshing the page cannot turn this into load.
  scheduleBackgroundWork(c, () => requestAddressReverification(c.env, address, limit));

  c.header("Cache-Control", "public, max-age=30, stale-while-revalidate=60");
  return c.json({
    address,
    summary: {
      total_outputs: totalOutputs,
      total_value_sats: totalValue,
      pages: Math.ceil(totalOutputs / limit),
      current_page: page,
      outputs_on_page: outputResult.results.length,
      // Clients batch by this rather than hardcoding their own copy, which would silently break
      // pagination the day the two numbers disagree.
      max_outputs_per_page: RECOVERY_MAX_OUTPUTS_PER_PAGE,
    },
    fee: { address: feeAddress, percent: feePercent, exemption_sats: threshold },
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
  if (transaction.inputs.length === 0 || transaction.inputs.length > RECOVERY_MAX_OUTPUTS_PER_PAGE)
    return c.json({ error: `recovery must contain 1 to ${RECOVERY_MAX_OUTPUTS_PER_PAGE} inputs` }, 400);
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
  const feeOutputs = await recoveryFeeOutputs(c.env, transaction.outputs);
  if (feeOutputs.length > 1) return c.json({ error: "recovery pays more than one fee output" }, 400);
  const feeOutput = feeOutputs[0] ?? null;
  if (feeOutput && feeOutput.valueSats !== BigInt(body.service_fee_sats!))
    return c.json({ error: "reported service fee does not match the fee output" }, 400);
  if (!feeOutput && body.service_fee_sats! > 0)
    return c.json({ error: "reported service fee does not pay a recovery fee address" }, 400);

  const now = Math.floor(Date.now() / 1000);
  const attempt = c.env.RECOVERY_DB.prepare(
    `INSERT INTO recovery_attempts
       (txid,address,status,replacement_txid,network_fee_sats,service_fee_sats,output_value_sats,fee_address_id,fee_vout,
        block_height,reported_at,updated_at,confirmations,block_hash,block_time,chain_checked_at,status_reason)
     VALUES (?,?,'pending',NULL,?,?,?,?,?,NULL,?,?,0,NULL,NULL,NULL,'awaiting-chain-evidence')
     ON CONFLICT(txid) DO UPDATE SET updated_at=excluded.updated_at`,
  ).bind(
    transaction.txid,
    address,
    body.network_fee_sats,
    body.service_fee_sats,
    body.output_value_sats,
    feeOutput?.feeAddressId ?? null,
    feeOutput?.vout ?? null,
    now,
    now,
  );
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
