import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTokenscanDirectoryScript } from "#api/integrations/tokenscan-directory";

test("Tokenscan directory parsing extracts usable collections", () => {
  assert.deepEqual(
    parseTokenscanDirectoryScript(
      'const NFT_DATA = [{"name":"Rare Pepe","site":"https://example.test","cards":["RAREPEPE.png"]}];',
    ),
    [{ name: "Rare Pepe", site: "https://example.test", cards: ["RAREPEPE.png"] }],
  );
});

test("Tokenscan directory parsing rejects destructive provider drift", () => {
  assert.throws(() => parseTokenscanDirectoryScript("const NFT_DATA = {};"), /array not found/);
  assert.throws(() => parseTokenscanDirectoryScript("const NFT_DATA = [{}];"), /no usable collections/);
  assert.throws(() => parseTokenscanDirectoryScript('const NFT_DATA = [{"name":"x","cards":[1]}];'), /string array/);
  assert.throws(
    () => parseTokenscanDirectoryScript('const NFT_DATA = [{"name":1,"cards":[]}];'),
    /name must be a string/,
  );
});
