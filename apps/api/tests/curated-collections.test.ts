import assert from "node:assert/strict";
import { test } from "node:test";
import { CURATED_COLLECTIONS } from "#api/indexer/curated-collections";
import { THE_COUNTERPART_ASSETS } from "#api/indexer/the-counterpart";
import { GREYPEPE_PROJECT_MEMBERS } from "#api/indexer/greypepe-project";

test("RarePenPen's curated membership is unique and includes the announced continuation", () => {
  const collection = CURATED_COLLECTIONS.find(({ tag }) => tag === "rarepenpen");
  if (!collection) throw new Error("RarePenPen collection is missing");
  assert.equal(collection.name, "RarePenPen");
  assert.equal(collection.assets.length, 79);
  assert.equal(new Set(collection.assets).size, collection.assets.length);
  assert.ok(collection.assets.includes("RAREPENPEN"));
  assert.ok(collection.assets.includes("PENPENTOSHI"));
});

test("The CounterpART's official catalogs contain 231 unique assets", () => {
  assert.equal(THE_COUNTERPART_ASSETS.length, 231);
  assert.equal(new Set(THE_COUNTERPART_ASSETS).size, THE_COUNTERPART_ASSETS.length);
  const collection = CURATED_COLLECTIONS.find(({ tag }) => tag === "the-counterpart");
  assert.equal(collection?.site, "https://www.thecounterp.art/");
});

test("The GreyPepe Project roster has unique assets with artist attribution", () => {
  const collection = CURATED_COLLECTIONS.find(({ tag }) => tag === "the-greypepe-project");
  assert.equal(GREYPEPE_PROJECT_MEMBERS.length, 46);
  assert.equal(new Set(GREYPEPE_PROJECT_MEMBERS.map(({ asset }) => asset)).size, 46);
  assert.ok(GREYPEPE_PROJECT_MEMBERS.every(({ artist }) => artist.name && artist.slug));
  assert.equal(collection?.site, "https://greypepeproject.com/");
  assert.equal(collection?.artists?.get("GRAYTEARS")?.name, "TKY");
});
