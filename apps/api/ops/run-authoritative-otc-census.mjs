#!/usr/bin/env node

import { DatabaseSync } from "node:sqlite";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const root = "C:/Users/laptop/Documents/GitHub/xcp-explorer";
const stamp = new Date().toISOString().slice(0, 10).replaceAll("-", "");
const census = `C:/BitcoinIndex/otc-census-authoritative-${stamp}.sqlite`;
const final = `C:/BitcoinIndex/otc-authoritative-${stamp}.sqlite`;
const seed = process.env.OTC_PRIOR ?? "C:/BitcoinIndex/otc-production-seed.sqlite";
const summary = `.codex-tmp/otc-authoritative-${stamp}.json`;
const sql = `.codex-tmp/import-authoritative-otc-${stamp}.sql`;
const oneoff = `C:/BitcoinIndex/otc-oneoff-authoritative-${stamp}.sqlite`;
const importProduction = process.argv.includes("--import");
if (!existsSync(seed)) throw new Error(`Missing durable production-level OTC seed: ${seed}`);
const check = new DatabaseSync(seed);
const seedRows = check.prepare("SELECT count(*) n FROM final_admitted").get().n;
check.close();
if (Number(seedRows) < 5000)
  throw new Error(`Refusing strict-only seed (${seedRows} rows); restore the production-level seed first`);
function run(args) {
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
run(["apps/api/ops/build-local-otc-census.mjs", `--database=${census}`]);
run([
  "apps/api/ops/analyze-local-otc-one-offs.mjs",
  `--census-database=${census}`,
  `--final-database=${seed}`,
  `--database=${oneoff}`,
  `--output=.codex-tmp/otc-oneoff-authoritative-${stamp}.json`,
]);
run([
  "apps/api/ops/build-local-otc-final.mjs",
  `--final=${final}`,
  `--prior=${seed}`,
  `--baseline=${census}`,
  `--oneoff=${oneoff}`,
  `--summary=${summary}`,
]);
run(["apps/api/ops/export-local-otc-admitted-sql.mjs", `--database=${final}`, `--output=${sql}`]);
if (importProduction) {
  run(["node_modules/wrangler/bin/wrangler.js", "d1", "execute", "xcpio-core", "--remote", `--file=${sql}`]);
}
const db = new DatabaseSync(final);
const result = db
  .prepare("SELECT count(*) total, max(indexed_through_block) indexed_through FROM final_admitted")
  .get();
db.close();
console.log(
  JSON.stringify(
    {
      event: "authoritative_otc_complete",
      ...result,
      final,
      census,
      summary,
      sql,
      production_imported: importProduction,
    },
    null,
    2,
  ),
);
