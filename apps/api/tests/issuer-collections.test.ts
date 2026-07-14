import assert from "node:assert/strict";
import { test } from "node:test";
import { issuerCollection, issuerCollectionMeta } from "#api/indexer/issuer-collections";

test("explicit issuer collections classify new issuances immediately", () => {
  const collection = issuerCollection("bc1qv9zuv6ycly3gvnt2qrrw7ve9f3vlyjapmefrym");
  assert.equal(collection?.tag, "corruptionaires");
  assert.deepEqual(JSON.parse(issuerCollectionMeta(collection!)), {
    collection: "Corruptionaires",
    site: "https://corruptionaires.neocities.org/",
  });
  assert.equal(issuerCollection("unrelated"), null);
  assert.equal(issuerCollection(null), null);
});
