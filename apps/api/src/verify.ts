/**
 * /admin/verify — evaluate the D1 mirror against the live Counterparty API.
 * D1 counts are local (cheap); Counterparty result_counts are fetched in parallel and diffed. Run once the
 * backfill is caught up (tip parity) — see VERIFICATION.md for methodology + thresholds.
 */
import { Hono } from "hono";
import type { Env } from "./index";
import { parseCounterpartyJson } from "./indexer/codec";

export const verify = new Hono<{ Bindings: Env }>();

// our table -> Counterparty /v2 list endpoint (result_count = Counterparty's total for that model)
const MODELS: { table: string; cp: string }[] = [
  { table: "assets", cp: "assets" },
  { table: "blocks", cp: "blocks" },
  { table: "transactions", cp: "transactions" },
  { table: "sends", cp: "sends" },
  { table: "issuances", cp: "issuances" },
  { table: "dispensers", cp: "dispensers" },
  { table: "dispenses", cp: "dispenses" },
  { table: "orders", cp: "orders" },
  { table: "order_matches", cp: "order_matches" },
  { table: "sweeps", cp: "sweeps" },
  { table: "broadcasts", cp: "broadcasts" },
  { table: "burns", cp: "burns" },
  { table: "dividends", cp: "dividends" },
  { table: "destructions", cp: "destructions" },
  { table: "fairminters", cp: "fairminters" },
  { table: "fairmints", cp: "fairmints" },
  { table: "btcpays", cp: "btcpays" },
  { table: "bets", cp: "bets" },
];
const SUPPLY_ASSETS = ["XCP", "PEPECASH", "RAREPEPE"];

async function counterpartyJson<T = unknown>(base: string, path: string): Promise<T | null> {
  try {
    const r = await fetch(`${base}/${path}`, { signal: AbortSignal.timeout(20000) });
    return r.ok ? (parseCounterpartyJson(await r.text()) as T) : null; // preserve >2^53 integers (supply parity)
  } catch { return null; }
}

// /admin/diag — localize row drops: sample N blocks in [from,to], compare our per-block row counts
// to Counterparty's per-block event counts (NEW_TRANSACTION->transactions, ASSET_ISSUANCE->issuances,
// NEW_FAIRMINT->fairmints). Returns blocks where ours < Counterparty so we can scope the rescue.
verify.get("/admin/diag", async (c) => {
  if (c.req.query("token") !== c.env.ADMIN_TOKEN) return c.json({ error: "forbidden" }, 403);
  const base = c.env.COUNTERPARTY_API_BASE;
  const explicit = (c.req.query("blocks") || "").split(",").map((s) => parseInt(s, 10)).filter(Number.isFinite);
  const from = parseInt(c.req.query("from") || "280000", 10);
  const to = parseInt(c.req.query("to") || "955000", 10);
  const n = Math.min(40, Math.max(2, parseInt(c.req.query("n") || "15", 10)));
  const step = Math.max(1, Math.floor((to - from) / (n - 1)));
  const blocks: number[] = explicit.length ? explicit.slice(0, 40) : [];
  if (!blocks.length) for (let b = from; b <= to && blocks.length < n; b += step) blocks.push(b);

  const out: Array<{ block: number; tx: number[]; iss: number[]; fm: number[]; short: boolean }> = [];
  for (const b of blocks) {
    const cnt = await counterpartyJson<{ result?: Array<{ event: string; event_count: number }> }>(base, `blocks/${b}/events/counts`);
    const m: Record<string, number> = {};
    (cnt?.result || []).forEach((e) => (m[e.event] = e.event_count));
    const our = (await c.env.DB.prepare(
      `SELECT (SELECT COUNT(*) FROM transactions WHERE block_index=?) tx,
              (SELECT COUNT(*) FROM issuances WHERE block_index=?) iss,
              (SELECT COUNT(*) FROM fairmints WHERE block_index=?) fm`
    ).bind(b, b, b).first<{ tx: number; iss: number; fm: number }>())!;
    const cpTx = m.NEW_TRANSACTION || 0, cpIss = m.ASSET_ISSUANCE || 0, cpFm = m.NEW_FAIRMINT || 0;
    out.push({
      block: b,
      tx: [our.tx, cpTx], iss: [our.iss, cpIss], fm: [our.fm, cpFm],
      short: our.tx < cpTx || our.iss < cpIss || our.fm < cpFm,
    });
  }
  return c.json({ from, to, step, short_blocks: out.filter((x) => x.short).map((x) => x.block), samples: out });
});

// /admin/shortblocks — self-contained drop localizer: blocks.transaction_count is Counterparty's reported
// tx-count per block (from BLOCK_PARSED); compare to our actual transactions rows per block.
// Any block where actual < reported lost rows. No Counterparty calls, no sampling — finds ALL of them.
verify.get("/admin/shortblocks", async (c) => {
  if (c.req.query("token") !== c.env.ADMIN_TOKEN) return c.json({ error: "forbidden" }, 403);
  const totals = (await c.env.DB.prepare(
    `SELECT COALESCE(SUM(d),0) deficit, COUNT(*) blocks FROM (
       SELECT b.transaction_count - COUNT(t.tx_index) d
       FROM blocks b LEFT JOIN transactions t ON t.block_index = b.block_index
       WHERE b.transaction_count > 0
       GROUP BY b.block_index HAVING d > 0)`
  ).first<{ deficit: number; blocks: number }>())!;
  const top = await c.env.DB.prepare(
    `SELECT b.block_index, b.transaction_count reported, COUNT(t.tx_index) actual,
            b.transaction_count - COUNT(t.tx_index) missing
     FROM blocks b LEFT JOIN transactions t ON t.block_index = b.block_index
     WHERE b.transaction_count > 0
     GROUP BY b.block_index HAVING missing > 0
     ORDER BY missing DESC LIMIT 40`
  ).all();
  return c.json({ tx_deficit_total: totals.deficit, short_block_count: totals.blocks, top: top.results });
});

verify.get("/admin/verify", async (c) => {
  if (c.req.query("token") !== c.env.ADMIN_TOKEN) return c.json({ error: "forbidden" }, 403);
  const base = c.env.COUNTERPARTY_API_BASE;

  // 1) our counts (single query) + invariants
  const sel = MODELS.map((m) => `(SELECT COUNT(*) FROM ${m.table}) "${m.table}"`).join(",\n    ");
  const ours = (await c.env.DB.prepare(`SELECT\n    ${sel}`).first<Record<string, number>>())!;
  const inv = (await c.env.DB.prepare(
    `SELECT (SELECT MAX(block_index) FROM blocks) tip,
            (SELECT COUNT(*) FROM blocks WHERE block_hash IS NULL) null_block_hash,
            (SELECT COUNT(*) FROM balances WHERE CAST(quantity AS INTEGER) < 0) negative_balances`
  ).first<{ tip: number | null; null_block_hash: number; negative_balances: number }>())!;

  // 2) Counterparty counts (parallel) + Counterparty tip
  const cpCounts: Record<string, number | null> = {};
  await Promise.all(
    MODELS.map(async (m) => {
      const j = await counterpartyJson<{ result_count?: number }>(base, `${m.cp}?limit=1`);
      cpCounts[m.table] = j?.result_count ?? null;
    })
  );
  const cpTip = (await counterpartyJson<{ result?: Array<{ block_index?: number }> }>(base, `blocks?limit=1`))?.result?.[0]?.block_index ?? null;

  // 3) diffs (ours - cp). Small +/- near tip is fine (Counterparty may be a few blocks ahead until caught up).
  const counts = MODELS.map((m) => {
    const o = Number(ours[m.table] ?? 0), cp = cpCounts[m.table];
    return { model: m.table, ours: o, cp, diff: cp == null ? null : o - cp, pct: cp ? +(o / cp * 100).toFixed(2) : null };
  });

  // 4) sample-asset supply parity (cheap: our assets row vs Counterparty asset detail)
  const supply = await Promise.all(
    SUPPLY_ASSETS.map(async (a) => {
      const our = await c.env.DB.prepare(`SELECT supply_normalized FROM assets WHERE asset=?`).bind(a).first<{ supply_normalized: string | null }>();
      const cp = await counterpartyJson<{ result?: { supply_normalized?: string | null } }>(base, `assets/${a}?verbose=true`);
      return { asset: a, ours: our?.supply_normalized ?? null, cp: cp?.result?.supply_normalized ?? null };
    })
  );

  const behind = cpTip != null && inv.tip != null ? cpTip - inv.tip : null;
  return c.json({
    tip: { ours: inv.tip, cp: cpTip, blocks_behind: behind, caught_up: behind != null && behind <= 2 },
    invariants: { null_block_hash: inv.null_block_hash, negative_balances: inv.negative_balances },
    counts,
    supply,
  });
});
