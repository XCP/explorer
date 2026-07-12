/**
 * Bitcoin Stamps + BTNS classification tests — pinned against the real on-chain formats observed in our
 * own indexed data (classic PNG stamps, SRC-20 JSON, bt:DEPLOY/MINT broadcasts).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyStamp } from "../src/indexer/events/stamp";
import { classifyBtns } from "../src/indexer/events/btns";

test("classic PNG stamp (raw base64) -> STAMP", () => {
  const r = classifyStamp("stamp:iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFCAYAAAC");
  assert.equal(r?.protocol, "STAMP");
});

test("classic stamp case-insensitive (STAMP:/Stamp:)", () => {
  assert.equal(classifyStamp("STAMP:iVBORw0KGgo")?.protocol, "STAMP");
  assert.equal(classifyStamp("Stamp:iVBORw0KGgo")?.protocol, "STAMP");
});

test("classic stamp with data-URI / escaped quote -> STAMP", () => {
  assert.equal(classifyStamp('stamp:"data:image/png;base64,iVBORw0KGgo')?.protocol, "STAMP");
  assert.equal(classifyStamp('stamp:\\"data:image\\/png;base64,iVBORw0KGgo')?.protocol, "STAMP");
});

test("SRC-20 JSON payload -> SRC-20 with tick + op", () => {
  // base64 of {"p":"src-20","op":"deploy","tick":"KEVIN"}
  const r = classifyStamp("stamp:eyJwIjogInNyYy0yMCIsICJvcCI6ICJkZXBsb3kiLCAidGljayI6ICJLRVZJTiJ9");
  assert.equal(r?.protocol, "SRC-20");
  assert.equal(r?.tick, "kevin"); // tick normalized to lowercase (SRC-20 is case-insensitive)
  assert.equal(r?.op, "deploy");
});

test("SRC-721 JSON payload -> SRC-721", () => {
  // base64 of {"p":"src-721","op":"deploy","tick":"STAMPUNK"}
  const r = classifyStamp("stamp:eyJwIjogInNyYy03MjEiLCAib3AiOiAiZGVwbG95IiwgInRpY2siOiAiU1RBTVBVTksifQ==");
  assert.equal(r?.protocol, "SRC-721");
});

test("non-stamp description -> null (and mid-text 'stamp:' is not a stamp)", () => {
  assert.equal(classifyStamp("Rare Pepe Card #12"), null);
  assert.equal(classifyStamp("this is not a stamp: joke"), null);
  assert.equal(classifyStamp(null), null);
  assert.equal(classifyStamp(""), null);
});

test("JSON without a known protocol -> classic STAMP (cursed/other)", () => {
  // base64 of {"hello":"world"}
  const r = classifyStamp("stamp:eyJoZWxsbyI6ICJ3b3JsZCJ9");
  assert.equal(r?.protocol, "STAMP");
});

test("BTNS bt:DEPLOY / bt:MINT -> op + tick", () => {
  assert.deepEqual(classifyBtns("bt:DEPLOY|JDOG|1000|1|0|http://x/icon.png"), { op: "DEPLOY", tick: "JDOG" });
  assert.deepEqual(classifyBtns("bt:MINT|BRRR|10000000000000"), { op: "MINT", tick: "BRRR" });
});

test("BTNS btns: prefix + case-insensitive", () => {
  assert.equal(classifyBtns("btns:TRANSFER|DANK|5")?.op, "TRANSFER");
  assert.equal(classifyBtns("BT:deploy|FOO|1")?.op, "DEPLOY");
});

test("non-BTNS broadcast -> null", () => {
  assert.equal(classifyBtns("1.000000"), null); // oracle price feed
  assert.equal(classifyBtns("some news headline"), null);
  assert.equal(classifyBtns("bt:"), null); // prefix with no action
  assert.equal(classifyBtns(null), null);
});
