import { test } from "node:test";
import assert from "node:assert/strict";
import type { D1PreparedStatement } from "@cloudflare/workers-types";
import { batchRecoveryStatements } from "#api/recovery/import";

test("recovery imports chunk large Counterparty transactions at the D1 batch ceiling", async () => {
  const batches: D1PreparedStatement[][] = [];
  const db = {
    batch: async (statements: D1PreparedStatement[]) => {
      batches.push(statements);
      return [];
    },
  };
  const statements = Array.from({ length: 172 }, (_, index) => ({ index }) as unknown as D1PreparedStatement);

  await batchRecoveryStatements(db, statements);

  assert.deepEqual(
    batches.map((batch) => batch.length),
    [100, 72],
  );
  assert.equal((batches[0]![0] as unknown as { index: number }).index, 0);
  assert.equal((batches[1]![0] as unknown as { index: number }).index, 100);
});
