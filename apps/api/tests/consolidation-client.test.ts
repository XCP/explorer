import assert from "node:assert/strict";
import { test } from "node:test";
import { requestConsolidation } from "#api/integrations/consolidation";

test("consolidation client preserves the extension path, query, method, and body", async () => {
  const originalFetch = globalThis.fetch;
  const forwarded: Request[] = [];
  try {
    globalThis.fetch = async (input, init) => {
      forwarded.push(new Request(input, init));
      return Response.json({ ok: true });
    };

    const response = await requestConsolidation(
      "https://consolidation.example/base/",
      new Request("https://api.example/api/v1/address/abc/consolidation/prepare?include=all", {
        method: "POST",
        body: JSON.stringify({ selected: [1, 2] }),
      }),
    );

    assert.equal(response.status, 200);
    const captured = forwarded[0];
    if (!captured) throw new Error("request was not forwarded");
    assert.equal(captured.url, "https://consolidation.example/api/v1/address/abc/consolidation/prepare?include=all");
    assert.equal(captured.method, "POST");
    assert.equal(captured.headers.get("accept"), "application/json");
    assert.deepEqual(await captured.json(), { selected: [1, 2] });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
