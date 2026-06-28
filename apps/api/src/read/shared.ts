/**
 * Shared building blocks for the read API route modules: the JSON envelope helper, pagination,
 * reusable SQL fragments, formatting, and the reputation scoring config. Single source of truth so
 * the per-domain routers (assets / addresses / chain / stats) stay thin and consistent.
 */
import { Hono } from "hono";
import type { Env } from "../index";

export type ReadApp = Hono<{ Bindings: Env }>;
export const router = (): ReadApp => new Hono<{ Bindings: Env }>();

/* ---------- response + pagination ---------- */
// Envelope: { result, result_count?, next_offset? }. Cached at the edge via cache-control.
export const J = (c: any, body: unknown, ttl = 30) =>
  c.json(body, 200, { "cache-control": `public, max-age=${ttl}`, "access-control-allow-origin": "*" });
export const lim = (c: any, def = 50, max = 100) =>
  Math.min(max, Math.max(1, parseInt(c.req.query("limit") || String(def), 10)));
export const off = (c: any) => Math.max(0, parseInt(c.req.query("offset") || "0", 10));

/* ---------- reusable SQL fragments ---------- */
// orders with normalized give/get quantities (divisibility via join; XCP/BTC are always divisible even
// though they have no assets row). Powers the base/quote price math on the client.
export const ORDER_SELECT = `SELECT o.tx_hash,o.block_index,o.block_time,o.source,o.give_asset,o.get_asset,o.status,
  CAST(o.give_quantity AS REAL)/(CASE WHEN o.give_asset IN ('XCP','BTC') OR ga.divisible THEN 100000000.0 ELSE 1 END) give_quantity_normalized,
  CAST(o.get_quantity AS REAL)/(CASE WHEN o.get_asset IN ('XCP','BTC') OR gb.divisible THEN 100000000.0 ELSE 1 END) get_quantity_normalized
  FROM orders o LEFT JOIN assets ga ON ga.asset=o.give_asset LEFT JOIN assets gb ON gb.asset=o.get_asset`;
// the "real, non-dust address holder" filter. Pass a table alias (e.g. "b.") when balances is aliased.
export const activeBalance = (p = "") => `${p}holder_type='address' AND CAST(${p}quantity AS INTEGER)>0`;
// XCP destroyed (deflation): issuance/sweep/dividend fees + explicit XCP destructions. `extra` prefixes
// each SELECT (e.g. "block_time, ") for the time-series variant. Shared by /stats and /metrics.
export const xcpDestroyed = (extra = "") => `
  SELECT ${extra}fee_paid amt FROM issuances WHERE status LIKE 'valid%' AND fee_paid IS NOT NULL
  UNION ALL SELECT ${extra}fee_paid FROM sweeps WHERE fee_paid IS NOT NULL
  UNION ALL SELECT ${extra}fee_paid FROM dividends WHERE fee_paid IS NOT NULL
  UNION ALL SELECT ${extra}quantity FROM destructions WHERE asset='XCP' AND status LIKE 'valid%'`;

/* ---------- formatting ---------- */
// single JS rounding strategy (replaces the per-endpoint num()/Math.round mix).
export const round = (v: any, dp = 1) => { const p = 10 ** dp; return Math.round((Number(v) || 0) * p) / p; };

// Reputation/quality scoring moved to src/reputation/ — config.ts (the tuning surface) + score.ts (engine).
