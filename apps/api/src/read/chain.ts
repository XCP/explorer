/** Chain primitives (blocks, transaction detail) + the recent-first record feeds. SQL lives in
 *  queries/chain.ts (blocks/tx) and queries/records.ts (the 21 per-kind feeds). */
import { RECORD_KINDS } from "@xcp/shared/records";
import { router, J, lim, off } from "./respond";
import { listBlocks, getBlock, blockTransactions, getTransaction } from "../queries/chain";
import { listRecords } from "../queries/records";

export const chain = router();

/* ---------- blocks ---------- */
chain.get("/v2/blocks", async (c) => {
  const l = lim(c), o = off(c);
  const rows = await listBlocks(c.env.DB, l, o);
  return J(c, { result: rows, next_offset: o + l }, 15);
});

chain.get("/v2/blocks/:n", async (c) => {
  const n = parseInt(c.req.param("n"), 10);
  const b = await getBlock(c.env.DB, n);
  if (!b) return c.json({ error: "Block not found" }, 404);
  const transactions = await blockTransactions(c.env.DB, n);
  return J(c, { result: { ...b, transactions } });
});

/* ---------- transactions ---------- */
chain.get("/v2/transactions/:hash", async (c) => {
  const t = await getTransaction(c.env.DB, c.req.param("hash"));
  if (!t) return c.json({ error: "Transaction not found" }, 404);
  return J(c, { result: t });
});

/* ---------- index lists (recent-first feeds; one per Counterparty record kind) ----------
   Offset pagination only — next_offset is null at the end (a short page), so the UI gets correct
   Prev/Next without an expensive COUNT(*) over millions of rows. Each kind maps to GET /v2/<kind>;
   the per-kind SELECT lives in queries/records.ts. */
for (const kind of RECORD_KINDS) {
  chain.get(`/v2/${kind}`, async (c) => {
    const l = lim(c), o = off(c);
    const rows = await listRecords(c.env.DB, kind, l, o);
    return J(c, { result: rows, next_offset: rows.length === l ? o + l : null });
  });
}
