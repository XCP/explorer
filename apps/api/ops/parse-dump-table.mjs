#!/usr/bin/env node
/**
 * Table-scoped streaming extractor for gzipped mysqldump files. Reads the .sql.gz ONCE, decompresses
 * on the fly, and emits ONLY the rows of one named table — stopping as soon as that table's INSERT
 * block ends (the next `CREATE TABLE`), so a 500MB dump costs one partial pass, not a full scan per query.
 *
 *   node parse-dump-table.mjs <dump.sql.gz> <table> [--cols c1,c2,...] [--jsonl out.jsonl]
 *
 * Prints a source-type histogram + a couple of sample rows by default (recon). With --jsonl it
 * streams every row as JSON objects keyed by the dump's own column list (parsed from the INSERT header).
 */
import { createReadStream, createWriteStream } from "node:fs";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";

const [file, table] = process.argv.slice(2);
const arg = (n) => { const h = process.argv.find((a) => a.startsWith(`--${n}`)); return h ? (h.includes("=") ? h.split("=")[1] : process.argv[process.argv.indexOf(h) + 1]) : undefined; };
if (!file || !table) { console.error("usage: node parse-dump-table.mjs <dump.sql.gz> <table> [--jsonl out.jsonl]"); process.exit(1); }
const jsonlPath = arg("jsonl");

// Split a mysqldump VALUES tuple `(a,'b,c',NULL,3.14)` into fields, honoring single-quoted strings
// (with '' and \' escapes) so embedded commas don't split. Returns strings; NULL -> null.
function splitTuple(s) {
  const out = []; let cur = ""; let inStr = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (ch === "\\") { cur += s[i + 1] ?? ""; i++; continue; }
      if (ch === "'") { if (s[i + 1] === "'") { cur += "'"; i++; continue; } inStr = false; continue; }
      cur += ch;
    } else if (ch === "'") { inStr = true; }
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((v) => (v === "NULL" ? null : v));
}

const rl = createInterface({ input: createReadStream(file).pipe(createGunzip()), crlfDelay: Infinity });
const out = jsonlPath ? createWriteStream(jsonlPath) : null;
let inBlock = false, cols = null, rows = 0;
const typeHist = {};
const samples = [];
const insertRe = new RegExp("^INSERT INTO [`\"]?" + table + "[`\"]? \\(([^)]+)\\) VALUES");
const stopRe = /^(CREATE TABLE|INSERT INTO)/;

rl.on("line", (line) => {
  if (!inBlock) {
    const m = line.match(insertRe);
    if (m) { inBlock = true; cols = m[1].split(",").map((c) => c.replace(/[`"\s]/g, "")); }
    return;
  }
  // a following statement for a different table (or DDL) ends our block
  if (stopRe.test(line) && !insertRe.test(line)) { rl.close(); return; }
  // each line is `(...),(...),...;` — pull top-level tuples
  let depth = 0, start = -1;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "(" && depth++ === 0) start = i + 1;
    else if (ch === ")" && --depth === 0 && start >= 0) {
      const fields = splitTuple(line.slice(start, i));
      const row = Object.fromEntries(cols.map((c, k) => [c, fields[k]]));
      rows++;
      if (row.type != null) typeHist[row.type] = (typeHist[row.type] || 0) + 1;
      if (samples.length < 2) samples.push(row);
      if (out) out.write(JSON.stringify(row) + "\n");
      start = -1;
    }
  }
});
rl.on("close", () => {
  if (out) out.end();
  console.log(`table ${table}: ${rows} rows`);
  if (Object.keys(typeHist).length) {
    console.log("source/type histogram:");
    for (const [t, n] of Object.entries(typeHist).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(8)}  ${t}`);
  }
  if (samples.length) console.log("sample:", JSON.stringify(samples[0]).slice(0, 300));
  if (jsonlPath) console.log(`wrote ${rows} rows -> ${jsonlPath}`);
});
