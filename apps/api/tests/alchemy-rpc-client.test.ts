import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAlchemyRpcResult } from "#api/integrations/alchemy-rpc";

test("Alchemy RPC parsing returns successful results", () => {
  assert.deepEqual(parseAlchemyRpcResult({ jsonrpc: "2.0", id: 1, result: { pageKey: "next" } }), {
    pageKey: "next",
  });
  assert.equal(parseAlchemyRpcResult({ jsonrpc: "2.0", id: 1, result: null }), null);
});

test("Alchemy RPC parsing rejects error and malformed envelopes", () => {
  assert.throws(() => parseAlchemyRpcResult({ error: { message: "rate limited" } }), /rate limited/);
  assert.throws(() => parseAlchemyRpcResult({ jsonrpc: "2.0" }), /has no result/);
  assert.throws(() => parseAlchemyRpcResult([]), /must be an object/);
});
