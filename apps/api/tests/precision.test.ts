/**
 * Round-trip precision tests for parseCounterpartyJson — guards the worst bug class we've hit: Counterparty
 * serializes integer quantities as BARE JSON numbers that can exceed 2^53, so naive JSON.parse rounds
 * them and produces off-by-a-few-units sums → tiny negative balances. parseCounterpartyJson must quote those
 * integers (as strings) BEFORE parsing so they survive into exact BigInt math.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCounterpartyJson } from "#api/indexer/codec";

// the BigInt extraction the ingestion path uses (mirror of bi() in sync.ts for string inputs)
const bi = (v: any) => BigInt(String(v).split(".")[0]);

const BIG = [
  "9007199254740993", // 2^53 + 1 — first integer JS Number can't represent exactly
  "21000000000000000", // ~PEPECASH-scale supply in minor units (> 2^53)
  "9223372036854775807", // max int64 (Counterparty's quantity domain ceiling)
  "12345678901234567", // arbitrary 17-digit
];

test("preserves > 2^53 quantity as an exact string, not a rounded number", () => {
  for (const v of BIG) {
    const parsed = parseCounterpartyJson(`{"quantity": ${v}}`) as { quantity: unknown };
    assert.equal(typeof parsed.quantity, "string", `${v} should be quoted to a string`);
    assert.equal(parsed.quantity, v, `${v} must survive verbatim`);
    assert.equal(bi(parsed.quantity).toString(), v, `${v} -> BigInt must be exact`);
  }
});

test("naive JSON.parse WOULD have lost precision (proves the fix is load-bearing)", () => {
  // Demonstrate the bug parseCounterpartyJson prevents: the naive path rounds the value.
  const v = "9223372036854775807";
  const naive = JSON.parse(`{"quantity": ${v}}`).quantity; // number -> rounded
  assert.notEqual(String(naive), v, "sanity: naive parse loses precision here");
  assert.equal(
    (parseCounterpartyJson(`{"quantity": ${v}}`) as { quantity: unknown }).quantity,
    v,
    "parseCounterpartyJson keeps it exact",
  );
});

test("preserves large NEGATIVE integers", () => {
  const parsed = parseCounterpartyJson(`{"delta": -9223372036854775807}`) as { delta: unknown };
  assert.equal(parsed.delta, "-9223372036854775807");
  assert.equal(bi(parsed.delta).toString(), "-9223372036854775807");
});

test("does NOT quote small/safe integers (block/tx/event indexes, timestamps stay numbers)", () => {
  const parsed = parseCounterpartyJson(
    `{"block_index": 871234, "event_index": 12345678, "ts": 1718900000, "n15": 999999999999999}`,
  ) as Record<string, number>;
  assert.equal(typeof parsed.block_index, "number");
  assert.equal(parsed.block_index, 871234);
  assert.equal(typeof parsed.event_index, "number");
  assert.equal(typeof parsed.ts, "number");
  // 15-digit value is < 2^53 (~9.007e15, 16 digits) so it's still exact as a JS number — fine to leave numeric
  assert.equal(typeof parsed.n15, "number");
  assert.equal(parsed.n15, 999999999999999);
});

test("works inside a realistic CP events envelope (nested objects in result array)", () => {
  const wire = `{"result":[{"event":"CREDIT","params":{"asset":"PEPECASH","quantity":21000000000000000,"block_index":800000}},{"event":"DEBIT","params":{"asset":"XCP","quantity":250000000}}]}`;
  const p = parseCounterpartyJson(wire) as { result: Array<{ params: { quantity: unknown; block_index?: number } }> };
  assert.equal(p.result[0].params.quantity, "21000000000000000"); // big -> string
  assert.equal(bi(p.result[0].params.quantity).toString(), "21000000000000000");
  assert.equal(p.result[0].params.block_index, 800000); // small -> number
  assert.equal(p.result[1].params.quantity, 250000000); // small -> number, still exact
});

test("full round-trip: parse -> BigInt -> re-serialize -> parse is stable for big values", () => {
  for (const v of BIG) {
    const once = (parseCounterpartyJson(`{"quantity": ${v}}`) as { quantity: unknown }).quantity;
    const reSerialized = `{"quantity": ${bi(once).toString()}}`;
    const twice = (parseCounterpartyJson(reSerialized) as { quantity: unknown }).quantity;
    assert.equal(twice, v, `${v} must be stable across a parse/serialize round-trip`);
  }
});

// KNOWN LIMITATION (documented as a guard): parseCounterpartyJson only quotes object-VALUE integers (those
// preceded by `:`). A large integer as a bare ARRAY ELEMENT is NOT quoted. No CP quantity field is
// array-positioned today, so this is theoretical — this test pins the current behavior so any future
// change (or a CP shape that puts quantities in arrays) is caught deliberately.
test("documents the array-element blind spot (pin current behavior)", () => {
  const parsed = parseCounterpartyJson(`{"vals": [9223372036854775807]}`) as { vals: number[] };
  assert.equal(typeof parsed.vals[0], "number", "array elements are currently NOT quoted (known limitation)");
});
