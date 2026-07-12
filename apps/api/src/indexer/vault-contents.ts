/**
 * Emblem vault CONTENTS + CRACK classification — the derived facts that separate a real Emblem sale
 * from a scam. A vault is a BTC address wrapping a Counterparty card; a sale on Ethereum is only real
 * if the card was still IN the vault at sale time. Rebuildable entirely from the raw mirror
 * (sends + balances), so it lives here, not in the mirror (CLAUDE.md rule 7).
 *
 * Per vault we compute, purely from on-chain history:
 *   - funded / vault_kind  — did a COUNTERPARTY card ever arrive, and was it one card (single), several
 *                            different cards (multi = a bundle), or none? None ⇒ 'foreign': Emblem is
 *                            multi-chain, so an empty-to-us BTC address usually means the value lives on
 *                            another chain (Namecoin, Ordinals, BTC, LTC, …) — NOT a scam, just out of our
 *                            Counterparty scope (Emblem's own /meta values/fraud fields are the tiebreaker).
 *   - contents_asset/_qty  — the wrapped card and its ACTUAL normalized quantity (kills the qty=1
 *                            hardcode; a vault can hold N units of one card).
 *   - cracked_at           — block_time the card was first sent OR SWEPT back out (the vault went empty).
 *   - cracker_address      — the BTC address that received it: the value-puller, our bad-actor lead.
 *
 * Bounded + resumable (rowid cursor, wraps to re-sweep — vaults get cracked long after they're minted,
 * so a single pass is never final). Cron / admin driven, like the other Emblem sidecars.
 */
import type { Env } from "../env";
import { getIndexerState as getState, setIndexerState as setState } from "./state";

const BATCH = 400; // vaults per step; aggregates join sends/balances on a vault ROWID RANGE (2 bound params,
                   // not an IN-list — D1 caps bound params at 100, so IN-lists can't scale the batch)

interface VaultRow { rowid: number; token_id: string; contract: string; btc_address: string }
interface Classification {
  vault_kind: "single" | "multi" | "foreign";
  funded: number;
  contents_asset: string | null;
  contents_qty: number | null;
  cracked_at: number | null;
  cracker_address: string | null;
}

const qn = (v: string | null): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/** One bounded, resumable step: classify the next BATCH of resolved vaults from their send/balance history. */
export async function classifyVaults(env: Env): Promise<Record<string, unknown>> {
  const cursor = parseInt((await getState(env.DB, "vault_contents_cursor")) || "0", 10);
  const rows = (await env.DB.prepare(
    `SELECT rowid, token_id, contract, btc_address FROM emblem_vaults
      WHERE btc_address IS NOT NULL AND rowid > ? ORDER BY rowid LIMIT ?`
  ).bind(cursor, BATCH).all<VaultRow>()).results || [];

  const out: Record<string, unknown> = { from: cursor, classified: 0, single: 0, multi: 0, foreign: 0, cracked: 0 };
  if (!rows.length) { // wrapped — re-sweep from the top next tick (vaults crack after minting)
    await setState(env.DB, "vault_contents_cursor", "0");
    out.wrapped = true;
    out.total = (await env.DB.prepare(`SELECT COUNT(*) c FROM emblem_vaults WHERE classified=1`).first<{ c: number }>())?.c ?? 0;
    return out;
  }
  // The selected vaults occupy the rowid range (cursor, hi] — aggregate by JOINing the raw tables to that
  // range (2 bound params) rather than an IN-list of addresses (D1's 100-param cap would bound the batch).
  const hi = rows[rows.length - 1].rowid;

  // NOTE ON SCOPE: "funded" here means funded with a COUNTERPARTY asset (a send-in or a live balance names
  // the asset). Emblem is multi-chain — a vault can wrap Namecoin, Ordinals, BTC, LTC, etc., which never
  // touch Counterparty, so its BTC address reads empty to us. Those are classified 'foreign' (out of our
  // scope), NOT scams. Only Counterparty-funded vaults get single/multi + a crack timeline.

  // Inbound funding: every non-XCP card that ever ARRIVED, summed (gross — what the vault was filled with).
  const fundRows = (await env.DB.prepare(
    `SELECT s.destination address, s.asset, SUM(COALESCE(CAST(s.quantity_normalized AS REAL), CAST(s.quantity AS REAL))) qn
       FROM emblem_vaults ev JOIN sends s ON s.destination = ev.btc_address
      WHERE ev.rowid > ? AND ev.rowid <= ? AND ev.btc_address IS NOT NULL AND s.asset IS NOT NULL AND s.asset <> 'XCP'
      GROUP BY s.destination, s.asset`
  ).bind(cursor, hi).all<{ address: string; asset: string; qn: number }>()).results || [];

  // Still-held balances: authoritative "the card is right there now" (best contents_qty for un-cracked vaults).
  const balRows = (await env.DB.prepare(
    `SELECT b.holder address, b.asset, CAST(b.quantity_normalized AS REAL) qn
       FROM emblem_vaults ev JOIN balances b ON b.holder = ev.btc_address
      WHERE ev.rowid > ? AND ev.rowid <= ? AND ev.btc_address IS NOT NULL AND b.asset <> 'XCP' AND CAST(b.quantity AS REAL) > 0`
  ).bind(cursor, hi).all<{ address: string; asset: string; qn: number }>()).results || [];

  // Outbound sends: a crack — a non-XCP card sent back out, and who received it.
  const outRows = (await env.DB.prepare(
    `SELECT s.source address, s.block_time, s.destination FROM emblem_vaults ev JOIN sends s ON s.source = ev.btc_address
      WHERE ev.rowid > ? AND ev.rowid <= ? AND ev.btc_address IS NOT NULL AND s.asset IS NOT NULL AND s.asset <> 'XCP'
      ORDER BY s.source, s.block_time ASC, s.id ASC`
  ).bind(cursor, hi).all<{ address: string; block_time: number; destination: string }>()).results || [];

  // Outbound SWEEPS are ALSO a crack — a sweep moves EVERYTHING out of the address at once (no per-asset
  // row), so any outbound sweep from a funded vault empties it. Merge with sends; earliest wins.
  const sweepRows = (await env.DB.prepare(
    `SELECT sw.source address, sw.block_time, sw.destination FROM emblem_vaults ev JOIN sweeps sw ON sw.source = ev.btc_address
      WHERE ev.rowid > ? AND ev.rowid <= ? AND ev.btc_address IS NOT NULL
      ORDER BY sw.source, sw.block_time ASC`
  ).bind(cursor, hi).all<{ address: string; block_time: number; destination: string }>()).results || [];

  // Fold per address.
  const funded = new Map<string, Map<string, number>>();
  for (const r of fundRows) { const m = funded.get(r.address) ?? new Map(); m.set(r.asset, (m.get(r.asset) ?? 0) + qn(r.qn as unknown as string)); funded.set(r.address, m); }
  const held = new Map<string, Map<string, number>>();
  for (const r of balRows) { const m = held.get(r.address) ?? new Map(); m.set(r.asset, qn(r.qn as unknown as string)); held.set(r.address, m); }
  // Earliest outbound event (send OR sweep) per address = the crack moment.
  const firstCrack = new Map<string, { at: number; to: string }>();
  const noteCrack = (address: string, at: number, to: string) => {
    const cur = firstCrack.get(address);
    if (!cur || at < cur.at) firstCrack.set(address, { at, to });
  };
  for (const r of outRows) noteCrack(r.address, r.block_time, r.destination);
  for (const r of sweepRows) noteCrack(r.address, r.block_time, r.destination);

  const classify = (address: string): Classification => {
    const inb = funded.get(address);
    const bal = held.get(address);
    // Universe of COUNTERPARTY cards ever associated with this vault (funded in OR still held).
    const assets = new Set<string>([...(inb?.keys() ?? []), ...(bal?.keys() ?? [])]);
    const crack = firstCrack.get(address) ?? null;
    // No Counterparty asset ever ⇒ 'foreign' (value, if any, is on another chain — Namecoin/Ordinals/BTC/…;
    // or a genuinely empty shell — indistinguishable from here). NOT a scam; a crack timeline is meaningless.
    if (assets.size === 0) return { vault_kind: "foreign", funded: 0, contents_asset: null, contents_qty: null, cracked_at: null, cracker_address: null };
    if (assets.size > 1) return { vault_kind: "multi", funded: 1, contents_asset: null, contents_qty: null, cracked_at: crack?.at ?? null, cracker_address: crack?.to ?? null };
    const asset = [...assets][0];
    // Prefer the still-held quantity (vault full now); fall back to what was funded in (cracked/empty now).
    const qty = (bal?.get(asset) ?? 0) > 0 ? (bal?.get(asset) as number) : (inb?.get(asset) ?? 0);
    return { vault_kind: "single", funded: 1, contents_asset: asset, contents_qty: qty || null, cracked_at: crack?.at ?? null, cracker_address: crack?.to ?? null };
  };

  const stmts = rows.map((r) => {
    const c = classify(r.btc_address);
    out[c.vault_kind] = (out[c.vault_kind] as number) + 1;
    if (c.cracked_at != null) out.cracked = (out.cracked as number) + 1;
    return env.DB.prepare(
      `UPDATE emblem_vaults SET contents_asset=?, contents_qty=?, vault_kind=?, funded=?, cracked_at=?, cracker_address=?, classified=1 WHERE token_id=?`
    ).bind(c.contents_asset, c.contents_qty, c.vault_kind, c.funded, c.cracked_at, c.cracker_address, r.token_id);
  });
  for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
  out.classified = stmts.length;

  await setState(env.DB, "vault_contents_cursor", String(hi));
  out.to = hi;
  return out;
}
