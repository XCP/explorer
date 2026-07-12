import { test } from "node:test";
import assert from "node:assert/strict";
import { parseEmblemCuratedCollections } from "#api/integrations/emblem-curated";

test("Emblem curated parsing accepts collection discovery fields", () => {
  const collections = [
    { nativeAssets: ["XCP"], collectionChain: "xcp", addressChain: "BTC", contracts: { "1": "0xabc" } },
  ];
  assert.deepEqual(parseEmblemCuratedCollections(collections), collections);
});

test("Emblem curated parsing rejects partial provider drift", () => {
  assert.throws(() => parseEmblemCuratedCollections({ collections: [] }), /must be an array/);
  assert.throws(() => parseEmblemCuratedCollections([{ nativeAssets: [1] }]), /string array/);
  assert.throws(() => parseEmblemCuratedCollections([{ contracts: { "1": 2 } }]), /contain strings/);
});
