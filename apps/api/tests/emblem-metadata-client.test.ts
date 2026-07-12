import { test } from "node:test";
import assert from "node:assert/strict";
import { parseEmblemMetadata } from "#api/integrations/emblem-metadata";

test("Emblem metadata parsing accepts consumed fields", () => {
  const metadata = {
    name: "RAREPEPE | Series 1",
    values: [
      { coin: "btc", balance: "1" },
      { coin: "ordinalsbtc", balance: 2 },
    ],
    addresses: [{ coin: "BTC", address: "1abc" }],
    fraud: false,
  };
  assert.deepEqual(parseEmblemMetadata(metadata), metadata);
});

test("Emblem metadata parsing rejects provider drift", () => {
  assert.throws(() => parseEmblemMetadata([]), /must be an object/);
  assert.throws(() => parseEmblemMetadata({ name: 42 }), /name must be a string/);
  assert.throws(() => parseEmblemMetadata({ values: {} }), /values must be an array/);
  assert.throws(() => parseEmblemMetadata({ values: [{ balance: null }] }), /balance must be a string or number/);
  assert.throws(() => parseEmblemMetadata({ fraud: 1 }), /fraud must be a boolean/);
  assert.throws(() => parseEmblemMetadata({ addresses: [{ address: 1 }] }), /address must be a string/);
});
