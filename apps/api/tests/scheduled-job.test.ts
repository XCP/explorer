import { test } from "node:test";
import assert from "node:assert/strict";
import { runScheduledJob } from "#api/scheduler/job";

test("scheduled jobs return successful results and emit a structured outcome", async () => {
  const events: unknown[] = [];
  const original = console.log;
  console.log = (event: unknown) => {
    events.push(event);
  };
  try {
    assert.equal(await runScheduledJob("example", async () => 42), 42);
  } finally {
    console.log = original;
  }

  assert.equal((events[0] as { event: string }).event, "scheduled_job");
  assert.equal((events[0] as { outcome: string }).outcome, "success");
});

test("scheduled jobs log bounded scalar progress without arbitrary strings", async () => {
  const events: unknown[] = [];
  const original = console.log;
  console.log = (event: unknown) => events.push(event);
  try {
    await runScheduledJob("progress", async () => ({
      written: 12,
      done: false,
      cursor: "sensitive-or-high-cardinality",
      rows: [1, 2, 3],
    }));
  } finally {
    console.log = original;
  }
  assert.deepEqual((events[0] as { progress: unknown }).progress, {
    written: 12,
    done: false,
    rows_count: 3,
  });
});

test("scheduled jobs isolate failures and emit safe error details", async () => {
  const events: unknown[] = [];
  const original = console.error;
  console.error = (event: unknown) => {
    events.push(event);
  };
  try {
    const result = await runScheduledJob("broken", async () => {
      throw new Error("provider unavailable");
    });
    assert.equal(result, undefined);
  } finally {
    console.error = original;
  }

  const event = events[0] as { outcome: string; error: { name: string; message: string } };
  assert.equal(event.outcome, "error");
  assert.deepEqual(event.error, { name: "Error", message: "provider unavailable" });
});
