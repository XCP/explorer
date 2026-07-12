import { test } from "node:test";
import assert from "node:assert/strict";
import { getIndexerState, getIndexerStateInt, setIndexerState } from "../src/indexer/state";

function stateDatabase(initial: Record<string, string> = {}): D1Database {
  const values = new Map(Object.entries(initial));

  return {
    prepare(sql: string) {
      let bindings: unknown[] = [];
      return {
        bind(...valuesToBind: unknown[]) {
          bindings = valuesToBind;
          return this;
        },
        async first<T>() {
          if (!sql.startsWith("SELECT value")) throw new Error(`unexpected query: ${sql}`);
          const value = values.get(String(bindings[0]));
          return (value === undefined ? null : { value }) as T | null;
        },
        async run() {
          if (!sql.startsWith("INSERT INTO indexer_state")) throw new Error(`unexpected query: ${sql}`);
          values.set(String(bindings[0]), String(bindings[1]));
          return { success: true };
        },
      };
    },
  } as unknown as D1Database;
}

test("indexer state round-trips strings and numbers through one durable path", async () => {
  const db = stateDatabase();

  await setIndexerState(db, "job_cursor", 42);

  assert.equal(await getIndexerState(db, "job_cursor"), "42");
  assert.equal(await getIndexerStateInt(db, "job_cursor"), 42);
});

test("integer state uses its explicit fallback for absent or malformed values", async () => {
  const db = stateDatabase({ malformed: "not-a-number" });

  assert.equal(await getIndexerStateInt(db, "missing", 7), 7);
  assert.equal(await getIndexerStateInt(db, "malformed", 9), 9);
});
