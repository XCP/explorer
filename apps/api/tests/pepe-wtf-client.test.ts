import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePepeWtfAssets } from "#api/integrations/pepe-wtf";

test("pepe.wtf parsing accepts collection metadata", () => {
  const assets = [{ name: "RAREPEPE", collection: "rare-pepes", serie: 1, card: 1, artist: { name: "A" } }];
  assert.deepEqual(parsePepeWtfAssets(assets), assets);
});

test("pepe.wtf parsing rejects mixed malformed responses before reconciliation", () => {
  assert.throws(() => parsePepeWtfAssets({ assets: [] }), /must be an array/);
  assert.throws(() => parsePepeWtfAssets([{ name: "OK" }, { name: 2 }]), /name must be a string/);
  assert.throws(() => parsePepeWtfAssets([{ serie: Number.NaN }]), /finite number/);
  assert.throws(() => parsePepeWtfAssets([{ artist: { slug: 2 } }]), /artist slug must be a string/);
});
