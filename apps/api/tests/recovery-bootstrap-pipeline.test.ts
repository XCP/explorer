import assert from "node:assert/strict";
import { test } from "node:test";

import { runBootstrapPipeline } from "#ops/recovery-bootstrap-pipeline";

test("bootstrap pipeline bounds imports and logs completed pages in source order", async () => {
  let active = 0;
  let peak = 0;
  const logs: number[] = [];
  const pages = new Map([
    [0, { next_id: 10, rows: 1 }],
    [10, { next_id: 20, rows: 1 }],
    [20, { next_id: 30, rows: 1 }],
    [30, { next_id: null, rows: 1 }],
  ]);

  const result = await runBootstrapPipeline({
    concurrency: 2,
    startCursor: 0,
    exportPage: async (cursor: number) => pages.get(cursor),
    importPage: async (cursor: number) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, cursor === 0 ? 15 : 1));
      active--;
      return { cursor };
    },
    logPage: ({ cursor }: { cursor: number }) => logs.push(cursor),
  });

  assert.equal(result.pages, 4);
  assert.equal(peak, 2);
  assert.deepEqual(logs, [0, 10, 20, 30]);
});

test("bootstrap pipeline honors max pages without requiring a terminal page", async () => {
  const imported: number[] = [];
  const result = await runBootstrapPipeline({
    concurrency: 3,
    maxPages: 2,
    startCursor: 100,
    exportPage: async (cursor: number) => ({ next_id: cursor + 100, rows: 1 }),
    importPage: async (cursor: number) => imported.push(cursor),
    logPage: () => undefined,
  });

  assert.equal(result.pages, 2);
  assert.deepEqual(imported, [100, 200]);
});
