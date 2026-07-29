import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAlchemyNftSalesPage } from "#api/integrations/alchemy-sales";

test("Alchemy sales parsing validates pages before cursor use", () => {
  const page = { nftSales: [{ transactionHash: "0x1", logIndex: 1, tokenId: "42" }], pageKey: "next" };
  assert.deepEqual(parseAlchemyNftSalesPage(page), page);
  assert.throws(() => parseAlchemyNftSalesPage({ error: "limited" }), /nftSales array/);
  assert.throws(() => parseAlchemyNftSalesPage({ nftSales: [{ logIndex: 1, tokenId: "42" }] }), /invalid identity/);
  assert.throws(() => parseAlchemyNftSalesPage({ nftSales: [], pageKey: 2 }), /pageKey/);
  // Terminal pages arrive with pageKey:null (Alchemy's 2026-07 shape) — "no more pages", not an error.
  assert.deepEqual(parseAlchemyNftSalesPage({ nftSales: [], pageKey: null }), { nftSales: [], pageKey: null });
});
