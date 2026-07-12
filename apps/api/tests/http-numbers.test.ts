import { test } from "node:test";
import assert from "node:assert/strict";
import { boundedInteger, optionalBoundedInteger } from "#api/http/numbers";

test("bounded integers accept whole decimals and enforce both bounds", () => {
  const bounds = { defaultValue: 50, min: 1, max: 100 };
  assert.equal(boundedInteger("20", bounds), 20);
  assert.equal(boundedInteger("0", bounds), 1);
  assert.equal(boundedInteger("1000", bounds), 100);
});

test("bounded integers reject partial, fractional, unsafe, and absent values", () => {
  const bounds = { defaultValue: 50, min: 1, max: 100 };
  assert.equal(boundedInteger("20rows", bounds), 50);
  assert.equal(boundedInteger("1.5", bounds), 50);
  assert.equal(boundedInteger("9007199254740993", bounds), 50);
  assert.equal(boundedInteger(undefined, bounds), 50);
});

test("optional integers distinguish missing or malformed input from bounded zero", () => {
  assert.equal(optionalBoundedInteger(undefined, { min: 1, max: 40 }), undefined);
  assert.equal(optionalBoundedInteger("bad", { min: 1, max: 40 }), undefined);
  assert.equal(optionalBoundedInteger("0", { min: 1, max: 40 }), 1);
});
