import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(apiRoot, "../..");
const wrangler = join(repositoryRoot, "node_modules/wrangler/bin/wrangler.js");
const config = join(apiRoot, "wrangler.toml");
const migrations = readdirSync(join(apiRoot, "migrations-recovery"))
  .filter((name) => /^\d{4}_.+\.sql$/.test(name))
  .sort();

function execute(database, ...arguments_) {
  return execFileSync(
    process.execPath,
    [
      wrangler,
      "d1",
      "execute",
      "xcpio-btc",
      "--config",
      config,
      "--local",
      "--persist-to",
      database,
      ...arguments_,
      "--json",
    ],
    { cwd: apiRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
}

function migrationSql(names) {
  return names.map((name) => readFileSync(join(apiRoot, "migrations-recovery", name), "utf8")).join("\n");
}

function query(database, sql) {
  const response = JSON.parse(execute(database, "--command", sql));
  for (const result of response) assert.equal(result.success, true);
  return response.map((result) => result.results).filter((results) => results.length > 0);
}

function applySql(database, fixtureName, sql) {
  const fixture = join(temporaryRoot, fixtureName);
  writeFileSync(fixture, sql);
  const response = JSON.parse(execute(database, "--file", fixture));
  for (const result of response) assert.equal(result.success, true);
}

function assertFinalSchema(database) {
  const schema = query(
    database,
    `SELECT
       (SELECT COUNT(*) FROM pragma_table_info('recovery_outputs') WHERE name='chain_checked_at') output_chain_column,
       (SELECT COUNT(*) FROM pragma_table_info('recovery_attempts')
         WHERE name IN ('confirmations','block_hash','block_time','chain_checked_at','status_reason')) attempt_lifecycle_columns,
       (SELECT COUNT(*) FROM pragma_table_info('recovery_attempts')
         WHERE name='settlement_pending') settlement_queue_column,
       (SELECT COUNT(*) FROM sqlite_master
         WHERE type='table' AND name='recovery_import_receipts') receipt_table,
       (SELECT COUNT(*) FROM sqlite_master
         WHERE type='index' AND name='recovery_attempts_reconciliation') reconciliation_index,
       (SELECT COUNT(*) FROM sqlite_master
         WHERE type='index' AND name='recovery_attempts_work_queue') settlement_queue_index,
       (SELECT COUNT(*) FROM sqlite_master
         WHERE type='table' AND name='recovery_fee_addresses') fee_address_table,
       (SELECT COUNT(*) FROM pragma_table_info('recovery_attempts')
         WHERE name IN ('fee_address_id','fee_vout')) attempt_fee_columns`,
  )[0][0];
  assert.deepEqual(schema, {
    output_chain_column: 1,
    attempt_lifecycle_columns: 5,
    settlement_queue_column: 1,
    receipt_table: 1,
    reconciliation_index: 1,
    settlement_queue_index: 1,
    fee_address_table: 1,
    attempt_fee_columns: 2,
  });
}

function rehearseFresh(database) {
  applySql(database, "fresh.sql", migrationSql(migrations));
  assertFinalSchema(database);

  const [state, baseline] = query(
    database,
    `SELECT value FROM recovery_state WHERE key='read_ready';
     INSERT INTO recovery_imports
      (id,source,cursor,rows_seen,rows_written,started_at)
     VALUES ('fresh','fixture','0',0,0,1);
     SELECT receipt_base_cursor,receipt_base_rows_seen,receipt_base_rows_written
     FROM recovery_imports WHERE id='fresh'`,
  );
  assert.equal(state[0]?.value, "0");
  assert.deepEqual(baseline[0], {
    receipt_base_cursor: null,
    receipt_base_rows_seen: 0,
    receipt_base_rows_written: 0,
  });
}

function rehearseMidImport(database) {
  applySql(
    database,
    "mid-import.sql",
    `${migrationSql([migrations[0]])}
     INSERT INTO recovery_imports
      (id,source,cursor,rows_seen,rows_written,started_at)
     VALUES ('bootstrap','mysql','45600',45600,45123,1000);
     ${migrationSql(migrations.slice(1))}`,
  );
  assertFinalSchema(database);

  const [progressRows, advancedRows] = query(
    database,
    `SELECT cursor,rows_seen,rows_written,receipt_base_cursor,
            receipt_base_rows_seen,receipt_base_rows_written
     FROM recovery_imports WHERE id='bootstrap';
     INSERT INTO recovery_import_receipts
      (import_id,page_cursor,next_cursor,rows_seen,rows_written,received_at)
     VALUES ('bootstrap',45600,45700,100,98,2000);
     UPDATE recovery_imports SET
       cursor='45700',
       rows_seen=receipt_base_rows_seen+
         (SELECT COALESCE(SUM(rows_seen),0) FROM recovery_import_receipts WHERE import_id='bootstrap'),
       rows_written=receipt_base_rows_written+
         (SELECT COALESCE(SUM(rows_written),0) FROM recovery_import_receipts WHERE import_id='bootstrap')
     WHERE id='bootstrap';
     SELECT cursor,rows_seen,rows_written FROM recovery_imports WHERE id='bootstrap'`,
  );
  const progress = progressRows[0];
  assert.deepEqual(progress, {
    cursor: "45600",
    rows_seen: 45600,
    rows_written: 45123,
    receipt_base_cursor: 45600,
    receipt_base_rows_seen: 45600,
    receipt_base_rows_written: 45123,
  });
  const advanced = advancedRows[0];
  assert.deepEqual(advanced, { cursor: "45700", rows_seen: 45700, rows_written: 45221 });
}

const temporaryRoot = mkdtempSync(join(tmpdir(), "xcp-recovery-migrations-"));
try {
  rehearseFresh(join(temporaryRoot, "fresh"));
  rehearseMidImport(join(temporaryRoot, "mid-import"));
  console.log("Recovery migrations pass fresh and mid-import rehearsals.");
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
