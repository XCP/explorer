import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCounterpartyResponse } from "#api/integrations/counterparty";

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
