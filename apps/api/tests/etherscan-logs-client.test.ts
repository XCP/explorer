import { test } from "node:test";
import assert from "node:assert/strict";
import { parseEtherscanLogs } from "#api/integrations/etherscan-logs";

test("Etherscan log parsing accepts the consumed mint-log shape", () => {
  const result = [{ blockNumber: "0x10", data: "0x00ff" }];
  assert.deepEqual(parseEtherscanLogs({ status: "1", result }), result);
});

test("Etherscan log parsing rejects provider errors and malformed logs", () => {
  assert.throws(() => parseEtherscanLogs({ status: "0", result: "Max rate limit reached" }), /result array/);
  assert.throws(() => parseEtherscanLogs({ result: [{ blockNumber: 10 }] }), /invalid blockNumber/);
  assert.throws(() => parseEtherscanLogs({ result: [{ blockNumber: "10" }] }), /invalid blockNumber/);
  assert.throws(() => parseEtherscanLogs({ result: [{ blockNumber: "0x10", data: "xyz" }] }), /invalid data/);
});
