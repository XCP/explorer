/**
 * Emblem vault METADATA capture — what each vault CLAIMS to hold and what it ACTUALLY holds, from
 * Emblem's own /meta API (the same v2.emblemvault.io/meta/{token_id} emblem.ts uses to resolve the BTC
 * address — NOT Alchemy). We only re-fetch the fields we discarded the first time: name, values, fraud.
 *
 * This targets the 'foreign' vaults (empty to our Counterparty-only on-chain view) to split them:
 *   - claimed_name/claimed_asset — the leading token of the vault name, resolved against our assets table.
 *     A vault named "PEPECASH | Series 1 #78" CLAIMS the real card PEPECASH.
 *   - content_coins / has_contents — what's actually inside per Emblem (ordinalsbtc, btc, nmc, …). A vault
 *     that claims a CP card but holds nothing on any chain is an empty Counterparty SCAM; one holding
 *     Namecoin/Ordinals is a legit foreign vault we simply can't see from Counterparty.
 * The verdict is combined into trades.sale_class at fold time (indexer/trades.ts). Bounded + self-draining
 * (marks meta_crawled=1); cron / admin driven.
 */
import type { Env } from "../env";

const META = (id: string) => `https://v2.emblemvault.io/meta/${encodeURIComponent(id)}`;
const PER_RUN = 80;   // vaults per step (bounded under the Worker subrequest/CPU budget)
const CONCURRENCY = 5;

interface MetaValue { coin?: string; balance?: string | number }
interface VaultMeta { name?: string; values?: MetaValue[]; fraud?: boolean }

/** The card a vault CLAIMS: the leading alphanumeric token of its name, uppercased. Emblem CP vaults lead
 *  with the ticker ("PEPECASH | Series 1 #78" → PEPECASH; "PepeonMusk" → PEPEONMUSK). Resolved against the
 *  assets table downstream, so a non-asset leading word (e.g. "Blockhead") simply resolves to NULL. */
function claimedName(name: string | undefined): string | null {
  const m = (name || "").trim().match(/[A-Za-z0-9]+/);
  return m ? m[0].toUpperCase() : null;
}

interface Parsed { id: string; claimed: string | null; coins: string | null; has: number; fraud: number }
async function fetchMeta(id: string): Promise<Parsed> {
  try {
    const r = await fetch(META(id), { headers: { accept: "application/json" }, signal: AbortSignal.timeout(20000) });
    if (!r.ok) return { id, claimed: null, coins: null, has: 0, fraud: 0 };
    const j = (await r.json()) as VaultMeta;
    const vals = Array.isArray(j.values) ? j.values : [];
    const coins = [...new Set(vals.filter((v) => Number(v.balance) > 0).map((v) => String(v.coin || "").toLowerCase()).filter(Boolean))];
    return { id, claimed: claimedName(j.name), coins: coins.join(",") || null, has: coins.length ? 1 : 0, fraud: j.fraud === true ? 1 : 0 };
  } catch { return { id, claimed: null, coins: null, has: 0, fraud: 0 }; }
}

/** One bounded, self-draining step: capture Emblem /meta for the next PER_RUN un-crawled 'foreign' vaults. */
export async function crawlEmblemMeta(env: Env): Promise<Record<string, unknown>> {
  const rows = (await env.DB.prepare(
    `SELECT token_id FROM emblem_vaults WHERE vault_kind='foreign' AND meta_crawled=0 ORDER BY rowid LIMIT ?`
  ).bind(PER_RUN).all<{ token_id: string }>()).results || [];

  const out: Record<string, unknown> = { fetched: rows.length, claims_cp: 0, has_contents: 0, fraud: 0 };
  if (!rows.length) {
    out.done = true;
    return out;
  }

  const parsed: Parsed[] = [];
  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    parsed.push(...await Promise.all(rows.slice(i, i + CONCURRENCY).map((r) => fetchMeta(r.token_id))));
  }

  // Per row: store the claim + contents, and RESOLVE claimed_asset inline (the leading token bound twice —
  // once as the stored name, once to seek a matching real Counterparty asset; NULL if it isn't one).
  const stmts = parsed.map((p) => {
    if (p.claimed) out.claims_cp = (out.claims_cp as number) + 1;
    if (p.has) out.has_contents = (out.has_contents as number) + 1;
    if (p.fraud) out.fraud = (out.fraud as number) + 1;
    return env.DB.prepare(
      `UPDATE emblem_vaults SET claimed_name=?, claimed_asset=(SELECT a.asset FROM assets a WHERE a.asset=?),
         content_coins=?, has_contents=?, emblem_fraud=?, meta_crawled=1 WHERE token_id=?`
    ).bind(p.claimed, p.claimed, p.coins, p.has, p.fraud, p.id);
  });
  for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
  return out;
}
