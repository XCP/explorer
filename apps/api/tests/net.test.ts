import assert from "node:assert/strict";
import { test } from "node:test";
import { discard, mapWithLimit } from "#api/lib/net";

/**
 * These helpers exist because of a production failure shape: unbounded
 * `Promise.all` over a data-driven list, and response bodies abandoned on error
 * paths. Together they exhaust a Worker's six connection slots and R2's
 * per-object concurrency, and the runtime answers by cancelling responses that
 * belong to unrelated requests. The tests pin the two properties that failure
 * depended on.
 */

test("mapWithLimit returns results in input order, not completion order", async () => {
  const out = await mapWithLimit([30, 0, 20, 10], async (ms, i) => {
    await new Promise((r) => setTimeout(r, ms));
    return `${i}:${ms}`;
  });
  assert.deepEqual(out, ["0:30", "1:0", "2:20", "3:10"]);
});

test("mapWithLimit never runs more than the ceiling at once", async () => {
  let inFlight = 0;
  let peak = 0;
  await mapWithLimit(
    Array.from({ length: 40 }, (_, i) => i),
    async (n) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight -= 1;
      return n;
    },
    5,
  );
  assert.equal(peak, 5);
});

test("mapWithLimit defaults below the platform's six connections", async () => {
  let inFlight = 0;
  let peak = 0;
  await mapWithLimit(
    Array.from({ length: 20 }, (_, i) => i),
    async (n) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight -= 1;
      return n;
    },
  );
  assert.equal(peak, 5);
});

test("mapWithLimit starts no more workers than there are items", async () => {
  let starts = 0;
  await mapWithLimit(
    [1, 2],
    async (n) => {
      starts += 1;
      return n;
    },
    10,
  );
  assert.equal(starts, 2);
});

test("mapWithLimit handles an empty list without calling the mapper", async () => {
  let called = false;
  const out = await mapWithLimit([], async () => {
    called = true;
    return 1;
  });
  assert.deepEqual(out, []);
  assert.equal(called, false);
});

test("mapWithLimit treats a zero ceiling as one at a time, not none", async () => {
  let inFlight = 0;
  let peak = 0;
  const out = await mapWithLimit(
    [1, 2, 3],
    async (n) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight -= 1;
      return n * 2;
    },
    0,
  );
  assert.equal(peak, 1);
  assert.deepEqual(out, [2, 4, 6]);
});

test("mapWithLimit propagates a rejection, as Promise.all would", async () => {
  let caught: unknown;
  try {
    await mapWithLimit([1, 2, 3], async (n) => {
      if (n === 2) throw new Error("element two");
      return n;
    });
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof Error);
  assert.equal((caught as Error).message, "element two");
});

test("discard cancels the body of a response being abandoned", async () => {
  let cancelled = false;
  const response = {
    body: {
      cancel: async () => {
        cancelled = true;
      },
    },
  } as unknown as Response;
  await discard(response);
  assert.equal(cancelled, true);
});

test("discard tolerates a bodyless response, null and undefined", async () => {
  await discard(new Response(null));
  await discard(null);
  await discard(undefined);
});

test("discard never throws, because it runs on an already-failed path", async () => {
  const exploding = {
    body: { cancel: () => Promise.reject(new Error("already disturbed")) },
  } as unknown as Response;
  await discard(exploding);
});

test("discard does not throw when the body was already consumed", async () => {
  const response = new Response("read me");
  await response.text();
  await discard(response);
});
