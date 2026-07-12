import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAlchemyContractNftsPage } from "#api/integrations/alchemy-nfts";

test("Alchemy NFT parsing accepts token and address metadata", () => {
  const page = {
    nfts: [{ tokenId: "42", raw: { metadata: { addresses: [{ coin: "BTC", address: "1abc" }] } } }],
    pageKey: "next",
  };
  assert.deepEqual(parseAlchemyContractNftsPage(page), page);
});

test("Alchemy NFT parsing rejects error envelopes and provider drift", () => {
  assert.throws(() => parseAlchemyContractNftsPage({ error: "rate limited" }), /nfts array/);
  assert.throws(() => parseAlchemyContractNftsPage({ nfts: [{ tokenId: 42 }] }), /string tokenId/);
  assert.throws(() => parseAlchemyContractNftsPage({ nfts: [], pageKey: 2 }), /pageKey must be a string/);
  assert.throws(() => parseAlchemyContractNftsPage({ nfts: [{ tokenId: "1", raw: [] }] }), /raw metadata/);
});
