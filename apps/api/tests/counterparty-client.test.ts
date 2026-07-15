import { test } from "node:test";
import assert from "node:assert/strict";
import { counterpartyJson, parseCounterpartyResponse } from "#api/integrations/counterparty";

test("Counterparty response parsing preserves large integer precision", () => {
  const response = parseCounterpartyResponse<{ result: { quantity: string } }>(
    '{"result":{"quantity":9223372036854775807}}',
  );
  assert.equal(response.result.quantity, "9223372036854775807");
});

test("Counterparty response parsing rejects malformed and error envelopes", () => {
  assert.throws(() => parseCounterpartyResponse("[]"), /must be an object/);
  assert.throws(() => parseCounterpartyResponse('{"error":"rate limited"}'), /rate limited/);
  assert.throws(() => parseCounterpartyResponse("not-json"), /Unexpected token/);
});

test("Counterparty retries respect the total deadline and cap Retry-After", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response("unavailable", { status: 503, headers: { "retry-after": "999" } });
  };
  try {
    let failure: unknown;
    try {
      await counterpartyJson("https://counterparty.invalid", "/events", {
        timeoutMs: 1_000,
        totalTimeoutMs: 10,
        maxRetries: 10,
      });
    } catch (error) {
      failure = error;
    }
    assert.match(String(failure), /request deadline exceeded/);
    assert.ok(calls >= 1 && calls <= 2, `unexpected retry count: ${calls}`);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
