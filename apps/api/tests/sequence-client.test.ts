import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSequenceListingsPage, requireSequenceListingsPage } from "#api/integrations/sequence";

test("Sequence listings parsing accepts the consumed provider shape", () => {
  const response = {
    collectibles: [
      {
        metadata: { tokenId: "42" },
        listing: { orderId: "order", priceUSD: 12.5, marketplace: "opensea" },
      },
    ],
    page: { more: true },
  };
  assert.deepEqual(parseSequenceListingsPage(response), response);
});

test("Sequence listings parsing accepts provider error envelopes", () => {
  assert.deepEqual(parseSequenceListingsPage({ error: "not found", msg: "missing" }), {
    error: "not found",
    msg: "missing",
  });
  assert.throws(() => requireSequenceListingsPage({ error: "upstream unavailable" }), /upstream unavailable/);
});

test("Sequence listings parsing rejects provider drift", () => {
  assert.throws(() => parseSequenceListingsPage([]), /must be an object/);
  assert.throws(() => parseSequenceListingsPage({ collectibles: {} }), /must be an array/);
  assert.throws(() => parseSequenceListingsPage({ page: { more: "yes" } }), /invalid page/);
  assert.throws(
    () => parseSequenceListingsPage({ collectibles: [{ listing: { priceUSD: "12.5" } }] }),
    /invalid listing/,
  );
});
