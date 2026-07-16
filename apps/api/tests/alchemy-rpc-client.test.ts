import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAlchemyRpcResult, parseEthereumBlockTimes } from "#api/integrations/alchemy-rpc";

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

test("Ethereum block batches preserve requested identity despite unordered responses", () => {
  assert.deepEqual(
    parseEthereumBlockTimes(
      [11926764, 11926765],
      [
        { id: 2, result: { number: "0xb5fced", timestamp: "0x6038e010" } },
        { id: 1, result: { number: "0xb5fcec", timestamp: "0x6038dfff" } },
      ],
    ),
    [
      { blockNumber: 11926764, blockTime: 1614340095 },
      { blockNumber: 11926765, blockTime: 1614340112 },
    ],
  );
  assert.throws(
    () => parseEthereumBlockTimes([11926764], [{ id: 1, result: { number: "0xb5fced", timestamp: "0x1" } }]),
    /unexpected block/,
  );
  assert.throws(() => parseEthereumBlockTimes([11926764], []), /incomplete/);
});
