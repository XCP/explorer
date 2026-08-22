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
 * Event-touched vaults are repaired first from a durable dirty queue. A slower rowid-cursor sweep remains
 * as a reconciliation backstop because vaults can crack long after minting and derived state must self-heal.
 */
import type { Env } from "#api/env";
import {
  completeVaultContentBatch,
  restoreVaultContentBatch,
  selectVaultContentBatch,
  type VaultContentRow,
} from "#api/indexer/vault-content-queue";

interface Classification {
  vault_kind: "single" | "multi" | "foreign";
  funded: number;
  contents_asset: string | null;
  contents_qty: number | null;
  cracked_at: number | null;
  cracker_address: string | null;
}

const qn = (v: string | null): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const selectedVaultsCte = (rows: VaultContentRow[]): string => {
  const rowids = rows.map(({ rowid }) => {
    if (!Number.isSafeInteger(rowid) || rowid <= 0) throw new Error("invalid Emblem vault rowid");
    return rowid;
  });
  if (!rowids.length) throw new Error("cannot classify an empty Emblem vault selection");
  return `selected AS (
    SELECT rowid,contract_id,token_id,btc_address_id FROM emblem_vaults
     WHERE rowid IN (${rowids.join(",")})
  )`;
};

/** Repair event-touched vaults, or advance the slower full reconciliation when the dirty queue is empty. */
export async function classifyVaults(env: Env): Promise<Record<string, unknown>> {
  const selection = await selectVaultContentBatch(env.CORE_DB);
  if (!selection) return { classified: 0, single: 0, multi: 0, foreign: 0, cracked: 0, idle: true };

  const { rows, source, cursor } = selection;
  const out: Record<string, unknown> = {
    source,
    from: cursor,
    classified: 0,
    single: 0,
    multi: 0,
    foreign: 0,
    cracked: 0,
  };
  if (!rows.length) {
    await completeVaultContentBatch(env.CORE_DB, selection);
    out.wrapped = true;
    out.total =
      (await env.CORE_DB.prepare(`SELECT COUNT(*) c FROM emblem_vaults WHERE classified=1`).first<{ c: number }>())
        ?.c ?? 0;
    return out;
  }
  const selected = selectedVaultsCte(rows);
  try {
    // NOTE ON SCOPE: "funded" here means funded with a COUNTERPARTY asset (a send-in or a live balance names
    // the asset). Emblem is multi-chain — a vault can wrap Namecoin, Ordinals, BTC, LTC, etc., which never
    // touch Counterparty, so its BTC address reads empty to us. Those are classified 'foreign' (out of our
    // scope), NOT scams. Only Counterparty-funded vaults get single/multi + a crack timeline.

    // Inbound funding: every non-XCP card that ever ARRIVED, summed (gross — what the vault was filled with).
    const fundRows =
      (
        await env.CORE_DB.prepare(
          `WITH ${selected}, inbound AS (
           SELECT send.event_index,vault.btc_address_id address_id,send.asset_id,send.quantity,send.quantity_normalized
           FROM selected vault
           CROSS JOIN sends send INDEXED BY idx_sends_destination
             ON send.destination_id=vault.btc_address_id
           UNION
           SELECT send.event_index,vault.btc_address_id,send.asset_id,send.quantity,send.quantity_normalized
           FROM selected vault
           CROSS JOIN sends send INDEXED BY idx_sends_destination_address
             ON send.destination_address_id=vault.btc_address_id
         )
         SELECT destination.address,asset.asset,
           SUM(COALESCE(CAST(inbound.quantity_normalized AS REAL),CAST(inbound.quantity AS REAL))) qn
         FROM inbound
         JOIN address_dictionary destination ON destination.address_id=inbound.address_id
         JOIN asset_dictionary asset ON asset.asset_id=inbound.asset_id
         WHERE asset.asset<>'XCP'
         GROUP BY inbound.address_id,inbound.asset_id`,
        ).all<{ address: string; asset: string; qn: number }>()
      ).results || [];

    // Still-held balances: authoritative "the card is right there now" (best contents_qty for un-cracked vaults).
    const balRows =
      (
        await env.CORE_DB.prepare(
          `WITH ${selected}
         SELECT holder.address,asset.asset,CAST(balance.quantity_normalized AS REAL) qn
         FROM selected vault
         JOIN balances balance ON balance.address_id=vault.btc_address_id
         JOIN address_dictionary holder ON holder.address_id=balance.address_id
         JOIN asset_dictionary asset ON asset.asset_id=balance.asset_id
         WHERE asset.asset<>'XCP' AND CAST(balance.quantity AS INTEGER)>0`,
        ).all<{ address: string; asset: string; qn: number }>()
      ).results || [];

    // Outbound sends: a crack — a non-XCP card sent back out, and who received it.
    const outRows =
      (
        await env.CORE_DB.prepare(
          `WITH ${selected}, outbound AS (
           SELECT send.event_index,vault.btc_address_id address_id,
             COALESCE(send.destination_address_id,send.destination_id) destination_id,
             send.asset_id,send.block_time
           FROM selected vault
           CROSS JOIN sends send INDEXED BY idx_sends_source ON send.source_id=vault.btc_address_id
           UNION
           SELECT send.event_index,vault.btc_address_id,
             COALESCE(send.destination_address_id,send.destination_id),send.asset_id,send.block_time
           FROM selected vault
           CROSS JOIN sends send INDEXED BY idx_sends_source_address
             ON send.source_address_id=vault.btc_address_id
         )
         SELECT source.address,outbound.block_time,destination.address destination
         FROM outbound
         JOIN address_dictionary source ON source.address_id=outbound.address_id
         JOIN address_dictionary destination ON destination.address_id=outbound.destination_id
         JOIN asset_dictionary asset ON asset.asset_id=outbound.asset_id
         WHERE asset.asset<>'XCP'
         ORDER BY outbound.address_id,outbound.block_time,outbound.event_index`,
        ).all<{ address: string; block_time: number; destination: string }>()
      ).results || [];

    // Outbound SWEEPS are ALSO a crack — a sweep moves EVERYTHING out of the address at once (no per-asset
    // row), so any outbound sweep from a funded vault empties it. Merge with sends; earliest wins.
    const sweepRows =
      (
        await env.CORE_DB.prepare(
          `WITH ${selected}
         SELECT source.address,sweep.block_time,destination.address destination
         FROM selected vault
         JOIN sweeps sweep ON sweep.source_id=vault.btc_address_id
         JOIN address_dictionary source ON source.address_id=sweep.source_id
         JOIN address_dictionary destination ON destination.address_id=sweep.destination_id
         ORDER BY sweep.source_id,sweep.block_time`,
        ).all<{ address: string; block_time: number; destination: string }>()
      ).results || [];

    // Fold per address.
    const funded = new Map<string, Map<string, number>>();
    for (const r of fundRows) {
      const m = funded.get(r.address) ?? new Map();
      m.set(r.asset, (m.get(r.asset) ?? 0) + qn(r.qn as unknown as string));
      funded.set(r.address, m);
    }
    const held = new Map<string, Map<string, number>>();
    for (const r of balRows) {
      const m = held.get(r.address) ?? new Map();
      m.set(r.asset, qn(r.qn as unknown as string));
      held.set(r.address, m);
    }
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
      if (assets.size === 0)
        return {
          vault_kind: "foreign",
          funded: 0,
          contents_asset: null,
          contents_qty: null,
          cracked_at: null,
          cracker_address: null,
        };
      if (assets.size > 1)
        return {
          vault_kind: "multi",
          funded: 1,
          contents_asset: null,
          contents_qty: null,
          cracked_at: crack?.at ?? null,
          cracker_address: crack?.to ?? null,
        };
      const asset = [...assets][0];
      // Prefer the still-held quantity (vault full now); fall back to what was funded in (cracked/empty now).
      const qty = (bal?.get(asset) ?? 0) > 0 ? (bal?.get(asset) as number) : (inb?.get(asset) ?? 0);
      return {
        vault_kind: "single",
        funded: 1,
        contents_asset: asset,
        contents_qty: qty || null,
        cracked_at: crack?.at ?? null,
        cracker_address: crack?.to ?? null,
      };
    };

    const stmts = rows.map((r) => {
      const c = classify(r.btc_address);
      out[c.vault_kind] = (out[c.vault_kind] as number) + 1;
      if (c.cracked_at != null) out.cracked = (out.cracked as number) + 1;
      // The WHERE tail skips the write entirely when the classification is unchanged — this sweep
      // recycles the full vault population, and rows almost never change between passes.
      return env.CORE_DB.prepare(
        `UPDATE emblem_vaults SET
         contents_asset_id=(SELECT asset_id FROM asset_dictionary WHERE asset=?1),contents_qty=?2,vault_kind=?3,
         funded=?4,cracked_at=?5,cracker_address_id=(SELECT address_id FROM address_dictionary WHERE address=?6),
         classified=1 WHERE contract_id=?7 AND token_id=?8 AND (classified=0
           OR contents_asset_id IS NOT (SELECT asset_id FROM asset_dictionary WHERE asset=?1)
           OR contents_qty IS NOT ?2 OR vault_kind IS NOT ?3 OR funded IS NOT ?4 OR cracked_at IS NOT ?5
           OR cracker_address_id IS NOT (SELECT address_id FROM address_dictionary WHERE address=?6))`,
      ).bind(
        c.contents_asset,
        c.contents_qty,
        c.vault_kind,
        c.funded,
        c.cracked_at,
        c.cracker_address,
        r.contract_id,
        r.token_id,
      );
    });
    for (let i = 0; i < stmts.length; i += 50) await env.CORE_DB.batch(stmts.slice(i, i + 50));
    out.classified = stmts.length;

    await completeVaultContentBatch(env.CORE_DB, selection);
    if (source === "reconcile") out.to = rows[rows.length - 1].rowid;
    return out;
  } catch (error) {
    await restoreVaultContentBatch(env.CORE_DB, selection);
    throw error;
  }
}
