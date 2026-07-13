import { test } from "node:test";
import assert from "node:assert/strict";
import { parseElectrsOutspends } from "#api/integrations/electrs";

test("Electrs outspend parsing preserves confirmed spending evidence", () => {
  assert.deepEqual(parseElectrsOutspends([
    { spent: false },
    { spent: true, txid: "ab".repeat(32), vin: 2, status: { confirmed: true, block_height: 900_000 } },
  ]), [
    { spent: false, txid: null, block_height: null },
    { spent: true, txid: "ab".repeat(32), block_height: 900_000 },
  ]);
});

test("Electrs outspend parsing rejects provider drift", () => {
  assert.throws(() => parseElectrsOutspends({}), /must be an array/);
  assert.throws(() => parseElectrsOutspends([{ spent: "false" }]), /missing spent state/);
});
