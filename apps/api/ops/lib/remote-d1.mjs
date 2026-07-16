import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const WRANGLER = fileURLToPath(new URL("../../../../node_modules/wrangler/bin/wrangler.js", import.meta.url));

const stripAnsi = (value) => value.replace(/\u001b\[[0-9;]*m/g, "");

export function parseWranglerResults(stdout) {
  const clean = stripAnsi(stdout);
  const start = clean.indexOf("[\n  {");
  if (start < 0) throw new Error(`Wrangler did not return a JSON result: ${clean.slice(-500)}`);
  const payload = JSON.parse(clean.slice(start));
  const statement = payload[0];
  if (!statement?.success || !Array.isArray(statement.results)) throw new Error("D1 query failed");
  return { rows: statement.results, meta: statement.meta ?? {} };
}

export function executeRemoteD1(sql, database = "xcpio-core") {
  const result = spawnSync(process.execPath, [WRANGLER, "d1", "execute", database, "--remote", "--command", sql], {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.status !== 0)
    throw new Error(result.error?.message || result.stderr || result.stdout || `Wrangler exited ${result.status}`);
  return parseWranglerResults(result.stdout);
}
