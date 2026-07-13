import { statSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const snapshotPath = process.env.CORE_SNAPSHOT_PATH;
if (!snapshotPath) throw new Error("CORE_SNAPSHOT_PATH is required");

const db = new DatabaseSync(snapshotPath, { readOnly: true });
const states = db
  .prepare(`SELECT table_name,cursor,complete,rows_copied FROM snapshot_state ORDER BY table_name`)
  .all();
const meta = Object.fromEntries(
  db
    .prepare(`SELECT key,value FROM snapshot_meta`)
    .all()
    .map((row) => [row.key, row.value]),
);
const completed = states.filter((state) => Number(state.complete) === 1);
const active = states.find((state) => Number(state.complete) !== 1) ?? null;
const files = [snapshotPath, `${snapshotPath}-wal`]
  .map((path) => {
    try {
      return statSync(path).size;
    } catch {
      return 0;
    }
  })
  .reduce((sum, bytes) => sum + bytes, 0);

process.stdout.write(
  `${JSON.stringify({
    mode: meta.snapshot_mode,
    consistent: meta.snapshot_consistent === "1",
    tables: {
      expected: Number(meta.snapshot_expected_tables ?? states.length),
      started: states.length,
      completed: completed.length,
    },
    rows_copied: states.reduce((sum, state) => sum + Number(state.rows_copied), 0),
    active,
    bytes: files,
  })}\n`,
);
db.close();
