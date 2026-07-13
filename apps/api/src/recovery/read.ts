import { Hono } from "hono";
import { base58check } from "@scure/base";
import { sha256 } from "@noble/hashes/sha2.js";
import type { Env } from "#api/env";
import { boundedInteger } from "#api/http/numbers";

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
  const addresses = configured.split(",").map((value) => value.trim()).filter(Boolean);
  if (addresses.length === 0) return null;
  let hash = 2166136261;
  for (const character of address) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return addresses[(hash >>> 0) % addresses.length];
}

export const recoveryRead = new Hono<{ Bindings: Env }>();

recoveryRead.get("/addresses/:address/recovery", async (c) => {
  const address = c.req.param("address");
  if (!isP2pkhAddress(address)) return c.json({ error: "invalid P2PKH address" }, 400);
  const page = boundedInteger(c.req.query("page"), { defaultValue: 1, min: 1 });
  const limit = boundedInteger(c.req.query("limit"), { defaultValue: 420, min: 1, max: 420 });
  const offset = (page - 1) * limit;
  if (!Number.isSafeInteger(offset)) return c.json({ error: "page is too large" }, 400);

  const db = c.env.RECOVERY_DB as unknown as { withSession?: (mode?: string) => D1Database };
  const session = typeof db.withSession === "function" ? db.withSession("first-unconstrained") : c.env.RECOVERY_DB;
  const [totals, outputResult, pending] = await Promise.all([
    session.prepare(
      `SELECT COUNT(*) output_count, COALESCE(SUM(value_sats),0) value_sats FROM recovery_outputs
        WHERE recovery_address=? AND classification='recoverable'`,
    ).bind(address).first<{ output_count: number; value_sats: number }>(),
    session.prepare(
      `SELECT txid,vout,value_sats,script_pubkey_hex,layout,recovery_key_position,
              classification,block_height,verified_at
         FROM recovery_outputs WHERE recovery_address=? AND classification='recoverable'
        ORDER BY value_sats DESC,txid,vout LIMIT ? OFFSET ?`,
    ).bind(address, limit, offset).all<RecoveryOutputRow>(),
    session.prepare(`SELECT COUNT(*) attempts FROM recovery_attempts WHERE address=? AND status='pending'`)
      .bind(address).first<{ attempts: number }>(),
  ]);

  const uniqueTxids = [...new Set(outputResult.results.map((row) => row.txid))];
  const transactionEntries = await Promise.all(uniqueTxids.map(async (txid) => {
    const object = await c.env.RECOVERY_TRANSACTIONS.get(`transactions/${txid}.hex`);
    return [txid, object ? await object.text() : null] as const;
  }));
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
    outputs: outputResult.results,
    transactions: Object.fromEntries(transactionEntries),
    missing_transactions: transactionEntries.filter(([, raw]) => raw == null).map(([txid]) => txid),
  });
});
