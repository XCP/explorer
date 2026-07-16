#!/usr/bin/env node

/** Freeze one current executable-ask cohort for prospective Dislocations evaluation. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const root = resolve(".analytics/radar/ownership");
const report = JSON.parse(readFileSync(resolve(root, "current-dislocations.json"), "utf8"));
if (report.schema !== "xcp-current-dislocations-audit/1")
  throw new Error(`Unsupported current-dislocations schema: ${report.schema}`);
if (!Array.isArray(report.candidates) || report.candidates.some((row) => !Number.isInteger(row.asset_id)))
  throw new Error("Re-run audit:current-dislocations; the report lacks canonical asset identities");

const measuredAt = Math.floor(Date.parse(report.measured_at) / 1000);
if (!Number.isInteger(measuredAt)) throw new Error("Report measured_at is invalid");
const db = new DatabaseSync(resolve(root, "ownership.sqlite"));
db.exec(`CREATE TABLE IF NOT EXISTS dislocation_observations(
    measured_at INTEGER NOT NULL,asset_id INTEGER NOT NULL,venue TEXT NOT NULL,
    ask_usd REAL NOT NULL,ask_btc REAL,reference_usd REAL NOT NULL,ask_to_reference REAL NOT NULL,
    reference_months INTEGER NOT NULL,reference_sales INTEGER NOT NULL,
    holders INTEGER NOT NULL,supply REAL NOT NULL,top1_pct REAL NOT NULL,
    collection_sources INTEGER NOT NULL,low_quality INTEGER NOT NULL,
    PRIMARY KEY(measured_at,asset_id,venue)) WITHOUT ROWID;
  CREATE INDEX IF NOT EXISTS idx_dislocation_observations_asset_time
    ON dislocation_observations(asset_id,measured_at);`);
const insert = db.prepare(`INSERT OR ABORT INTO dislocation_observations(
    measured_at,asset_id,venue,ask_usd,ask_btc,reference_usd,ask_to_reference,
    reference_months,reference_sales,holders,supply,top1_pct,collection_sources,low_quality)
  VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
db.exec("BEGIN IMMEDIATE");
try {
  for (const row of report.candidates)
    insert.run(
      measuredAt,
      row.asset_id,
      row.venue,
      row.ask_usd,
      row.ask_btc,
      row.reference_usd,
      row.ask_to_reference,
      row.reference_months,
      row.reference_sales,
      row.holders,
      row.supply,
      row.top1_pct,
      row.collection_sources,
      row.low_quality,
    );
  db.exec("COMMIT");
} catch (error) {
  db.exec("ROLLBACK");
  throw error;
}
const total = db.prepare(`SELECT COUNT(*) observations,COUNT(DISTINCT measured_at) cohorts
  FROM dislocation_observations`).get();
db.close();
process.stdout.write(`${JSON.stringify({
  measured_at: report.measured_at,
  recorded: report.candidates.length,
  total_observations: Number(total.observations),
  cohorts: Number(total.cohorts),
}, null, 2)}\n`);
