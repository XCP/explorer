import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fetchSequenceListingsPage,
  parseSequenceListingsPage,
  requireSequenceListingsPage,
  SequenceUnregisteredCollection,
} from "#api/integrations/sequence";

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

test("an unregistered collection raises its typed condition; other failures stay generic", async () => {
  const originalFetch = globalThis.fetch;
  const respond = (status: number, body: string) => {
    globalThis.fetch = async () => new Response(body, { status });
  };
  try {
    respond(
      400,
      JSON.stringify({ error: "NotFound", code: 2000, cause: "collection not found contractAddress=(0xabc)" }),
    );
    const rejection = async (): Promise<unknown> => {
      let error: unknown = null;
      try {
        await fetchSequenceListingsPage("key", "0xabc", 1);
      } catch (caught) {
        error = caught;
      }
      assert.ok(error !== null, "expected the fetch to reject");
      return error;
    };
    assert.ok((await rejection()) instanceof SequenceUnregisteredCollection);
    respond(400, JSON.stringify({ error: "BadRequest", cause: "page out of range" }));
    assert.match(String(await rejection()), /request failed: 400/);
    respond(503, "upstream down");
    assert.match(String(await rejection()), /request failed: 503/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
