/**
 * Emblem empty-shell SCAM attribution → reputation. Ties genuine empty-shell vaults (which name a real
 * Counterparty card but hold nothing) to an on-chain BTC identity, and docks that identity's reputation.
 *
 * The bridge: a shell's SELLER is an ETH address (out of our BTC scoring domain). But a scammer who mints
 * empty shells is usually the same person who minted REAL vaults — and a real vault's card was deposited
 * from the creator's own BTC wallet. So the BTC address that CONSISTENTLY funds a scam-seller's real vaults
 * (≥2 of them — a lone shared funder rules out resellers, who touch many unrelated owners) is that scammer's
 * Counterparty identity. We sum each identity's genuine-shell count into address_signals.shell_scams and let
 * the (negative, log-scaled) reputation factor dock them: a dedicated scammer is hit hard, a prolific creator
 * with one stray shell gets a nudge their real work outweighs. Nothing is excluded by fiat — magnitude does
 * the discriminating (see docs/reputation.md; the collision filter is is_scam_shell, set below).
 *
 * Rebuildable from the mirror + Emblem metadata. Periodic (daily gate) — the whole cohort is tiny & stable.
 */
import type { Env } from "../env";
import { getIndexerState as getState, setIndexerState as setState } from "./state";

const HEAVY_DAILY = 144; // ~1 day of Counterparty blocks
const HIGH_SUPPLY_DUMP = 1_000_000; // a card whose supply is ≥ this: one unit is a fungible fraction, not a collectible

interface Edge { sel: string; scams: number; funder: string; nv: number }

/** Full rebuild of the shell-scam attribution. Gated to ~daily unless force=true (admin). */
export async function buildScamAttribution(env: Env, force = false): Promise<Record<string, unknown>> {
  const tip = Number((await env.DB.prepare(`SELECT MAX(block_index) m FROM blocks`).first<{ m: number }>())?.m) || 0;
  const last = parseInt((await getState(env.DB, "scam_attrib_block")) || "0", 10);
  if (!force && tip - last < HEAVY_DAILY) return { skipped: "not due", tip, last };

  // 1) is_scam_shell = genuine empty shell: foreign + claims a card + holds nothing + the claimed card is
  //    ACTUALLY wrapped by ≥1 real vault (collision filter — kills the Ordinals/name-collision false positives).
  await env.DB.prepare(`UPDATE emblem_vaults SET is_scam_shell=0 WHERE is_scam_shell=1`).run();
  await env.DB.prepare(
    `UPDATE emblem_vaults SET is_scam_shell=1
      WHERE vault_kind='foreign' AND claimed_asset IS NOT NULL AND COALESCE(has_contents,0)=0
        AND claimed_asset IN (SELECT contents_asset FROM emblem_vaults WHERE vault_kind='single' AND contents_asset IS NOT NULL)`
  ).run();

  // 2) Rebuild the scam-seller rollup off the flag (indexed; no correlated EXISTS).
  await env.DB.prepare(`DELETE FROM emblem_scam_sellers`).run();
  await env.DB.prepare(
    `INSERT INTO emblem_scam_sellers (seller, scams)
     SELECT es.seller, COUNT(DISTINCT ev.token_id) FROM emblem_sales es
       JOIN emblem_vaults ev ON ev.token_id=es.token_id AND ev.contract=es.contract
      WHERE ev.is_scam_shell=1 AND es.seller IS NOT NULL GROUP BY es.seller`
  ).run();

  // 3) (seller, funder, #real-vaults-funded) edges off the small rollup table.
  const edges = (await env.DB.prepare(
    `SELECT ss.seller sel, ss.scams scams, s.source funder, COUNT(DISTINCT ev.btc_address) nv
       FROM emblem_scam_sellers ss
       JOIN emblem_sales es ON es.seller = ss.seller
       JOIN emblem_vaults ev ON ev.token_id=es.token_id AND ev.contract=es.contract AND ev.vault_kind='single' AND ev.btc_address IS NOT NULL
       JOIN sends s ON s.destination = ev.btc_address AND s.asset <> 'XCP'
      GROUP BY ss.seller, s.source`
  ).all<Edge>()).results || [];

  // 4) Dominant funder (≥2) per seller ⇒ their BTC identity; sum shell counts to it.
  const bySeller = new Map<string, { scams: number; best: string | null; bestN: number }>();
  for (const e of edges) {
    const cur = bySeller.get(e.sel) ?? { scams: e.scams, best: null, bestN: 0 };
    if (e.nv > cur.bestN) { cur.best = e.funder; cur.bestN = e.nv; }
    bySeller.set(e.sel, cur);
  }
  const attrib = new Map<string, number>();
  for (const { scams, best, bestN } of bySeller.values()) {
    if (bestN >= 2 && best) attrib.set(best, (attrib.get(best) ?? 0) + scams);
  }

  // 5) Reset then write shell_scams on the BTC identities.
  await env.DB.prepare(`UPDATE address_signals SET shell_scams=0 WHERE shell_scams>0`).run();
  const stmts = [...attrib.entries()].map(([address, n]) =>
    env.DB.prepare(`INSERT INTO address_signals (address, shell_scams) VALUES (?,?) ON CONFLICT(address) DO UPDATE SET shell_scams=excluded.shell_scams`).bind(address, n));
  for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));

  // 6) DUMP scams: a SOLD single-unit vault of a very-high-supply card (one fungible unit of a $0.0004 token
  //    sold as a $40 "collectible" NFT). The BTC funder who deposited the unit to dump it IS the actor —
  //    direct attribution, no consistency test needed. Count-scaled so the 300-dump factories get crushed and
  //    a one-off memento sale is a rounding error.
  await env.DB.prepare(`UPDATE emblem_vaults SET is_dump=0 WHERE is_dump=1`).run();
  await env.DB.prepare(
    `UPDATE emblem_vaults SET is_dump=1
      WHERE vault_kind='single' AND COALESCE(contents_qty,1)<=1
        AND contents_asset IN (SELECT asset FROM asset_signals WHERE supply>=${HIGH_SUPPLY_DUMP})
        AND EXISTS (SELECT 1 FROM emblem_sales es WHERE es.token_id=emblem_vaults.token_id AND es.contract=emblem_vaults.contract)`
  ).run();
  await env.DB.prepare(`UPDATE address_signals SET dump_scams=0 WHERE dump_scams>0`).run();
  const dumps = (await env.DB.prepare(
    `SELECT s.source address, COUNT(DISTINCT ev.token_id) n FROM emblem_vaults ev
       JOIN sends s ON s.destination=ev.btc_address AND s.asset=ev.contents_asset AND s.asset<>'XCP'
      WHERE ev.is_dump=1 AND s.source IS NOT NULL GROUP BY s.source`
  ).all<{ address: string; n: number }>()).results || [];
  const dumpStmts = dumps.map((r) =>
    env.DB.prepare(`INSERT INTO address_signals (address, dump_scams) VALUES (?,?) ON CONFLICT(address) DO UPDATE SET dump_scams=excluded.dump_scams`).bind(r.address, r.n));
  for (let i = 0; i < dumpStmts.length; i += 50) await env.DB.batch(dumpStmts.slice(i, i + 50));

  await setState(env.DB, "scam_attrib_block", String(tip));
  const shells = (await env.DB.prepare(`SELECT COUNT(*) c FROM emblem_vaults WHERE is_scam_shell=1`).first<{ c: number }>())?.c ?? 0;
  const dumpVaults = (await env.DB.prepare(`SELECT COUNT(*) c FROM emblem_vaults WHERE is_dump=1`).first<{ c: number }>())?.c ?? 0;
  return {
    tip, genuine_shells: shells, scam_sellers: bySeller.size, btc_identities: attrib.size,
    attributed_shells: [...attrib.values()].reduce((a, b) => a + b, 0),
    dump_vaults: dumpVaults, dump_actors: dumps.length, attributed_dumps: dumps.reduce((a, r) => a + r.n, 0),
  };
}
