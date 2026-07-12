import { test } from "node:test";
import assert from "node:assert/strict";
import { HTTPException } from "hono/http-exception";
import { describeHttpError, requestId } from "#api/http/errors";

test("expected HTTP errors retain their status and safe public message", () => {
  const failure = describeHttpError(new HTTPException(404, { message: "asset not found" }));

  assert.equal(failure.status, 404);
  assert.equal(failure.publicMessage, "asset not found");
});

test("unexpected errors never expose their internal message", () => {
  const failure = describeHttpError(new Error("SELECT secret FROM internal_table"));

  assert.equal(failure.status, 500);
  assert.equal(failure.publicMessage, "Internal Server Error");
  assert.equal(failure.internal.message, "SELECT secret FROM internal_table");
});

test("request IDs preserve valid upstream correlation and reject unsafe values", () => {
  assert.equal(requestId("edge:abc-123"), "edge:abc-123");
  assert.match(requestId("contains spaces and\nnewlines"), /^[0-9a-f-]{36}$/);
});
