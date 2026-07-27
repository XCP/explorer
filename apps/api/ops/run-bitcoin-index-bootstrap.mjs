import { appendFileSync, unlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
const root = "C:/Users/laptop/Documents/GitHub/xcp-explorer";
const log = "C:/BitcoinIndex/bitcoin-index-bootstrap.log";
const write = (line) => appendFileSync(log, `${new Date().toISOString()} ${line}\n`, "utf8");
const run = (args) => {
  const r = spawnSync(process.execPath, args, { cwd: root, encoding: "utf8", maxBuffer: 50 * 1024 * 1024 });
  appendFileSync(log, r.stdout ?? "", "utf8");
  appendFileSync(log, r.stderr ?? "", "utf8");
  if (r.status !== 0) throw new Error(`exit ${r.status}: ${r.stderr?.slice(-500)}`);
};
const chunkSize = Number(process.env.SIDECAR_CHUNK ?? 5000);
for (let from = Number(process.env.SIDECAR_START ?? 308319), target = 959434; from <= target;) {
  const to = Math.min(target, from + chunkSize - 1);
  const sql = `.codex-tmp/import-bitcoin-index-${from}-${to}.sql`;
  write(`START ${from}-${to}`);
  try {
    run(["apps/api/ops/export-bitcoin-index-sql.mjs", `--from=${from}`, `--to=${to}`, `--output=${sql}`]);
    run(["node_modules/wrangler/bin/wrangler.js", "d1", "execute", "xcpio-btc", "--remote", `--file=${sql}`]);
    write(`COMPLETE ${from}-${to}`);
    try {
      unlinkSync(`${root}/${sql}`);
    } catch {}
  } catch (error) {
    write(`FAILED ${from}-${to} ${error.message}`);
    process.exit(1);
  }
  from = to + 1;
}
write("COMPLETE_ALL");
