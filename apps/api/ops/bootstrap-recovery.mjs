import { execFile } from "node:child_process";
import process from "node:process";
import { promisify } from "node:util";

import { runBootstrapPipeline } from "./recovery-bootstrap-pipeline.mjs";

const execFileAsync = promisify(execFile);

const endpoint = process.env.RECOVERY_API_URL;
const token = process.env.RECOVERY_ADMIN_TOKEN;
const importId = process.env.RECOVERY_IMPORT_ID || "api-xcp-io";
const server = process.env.RECOVERY_SOURCE_SSH || "forge@91.99.189.190";
const identity = process.env.RECOVERY_SOURCE_KEY;
const localSource = process.env.RECOVERY_SOURCE_LOCAL === "1";
const exportScript = process.env.RECOVERY_EXPORT_SCRIPT || "/tmp/export-recovery.php";
const sourceRoot = process.env.RECOVERY_SOURCE_ROOT || "/home/forge/api.xcp.io";
const maxPages = Number(process.env.RECOVERY_MAX_PAGES || 0);
const concurrency = Number(process.env.RECOVERY_IMPORT_CONCURRENCY || 3);
if (!endpoint || !token) throw new Error("RECOVERY_API_URL and RECOVERY_ADMIN_TOKEN are required");
if (!Number.isSafeInteger(concurrency) || concurrency < 2 || concurrency > 4) {
  throw new Error("RECOVERY_IMPORT_CONCURRENCY must be an integer from 2 through 4");
}

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function request(path, init = {}) {
  let lastError;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const response = await fetch(`${endpoint}${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${token}`, ...init.headers },
      });
      if (response.ok || response.status === 404 || (response.status >= 400 && response.status < 500)) return response;
      lastError = new Error(`${path} failed with ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(Math.min(30_000, 1_000 * 2 ** attempt));
  }
  throw lastError;
}

async function state() {
  const response = await request(`/admin/recovery/imports/${importId}`);
  if (response.status === 404) return { cursor: "0" };
  if (!response.ok) throw new Error(`failed to read import state: ${response.status}`);
  return response.json();
}

async function exportPage(cursor) {
  if (localSource) {
    const { stdout } = await execFileAsync("php", [exportScript, sourceRoot, String(cursor), "100"], {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    });
    return JSON.parse(stdout);
  }
  const args = ["-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes"];
  if (identity) args.push("-i", identity);
  args.push(server, `php ${exportScript} ${sourceRoot} ${cursor} 100`);
  const { stdout } = await execFileAsync("ssh", args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  return JSON.parse(stdout);
}

async function importPage(cursor, page) {
  const transactions = page.transactions.map((transaction) => ({
    ...transaction,
    outputs: transaction.outputs.map(
      ({
        source_id: _sourceId,
        source_recoverable: _sourceRecoverable,
        source_sign_type: _sourceSignType,
        source_addresses: _sourceAddresses,
        ...output
      }) => output,
    ),
  }));
  const response = await request("/admin/recovery/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ import_id: importId, cursor, next_cursor: page.next_id, transactions }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`recovery import failed: ${JSON.stringify(result)}`);
  return result;
}

const cursor = Number((await state()).cursor || 0);
await runBootstrapPipeline({
  concurrency,
  exportPage,
  importPage,
  logPage: ({ page, cursor: pageCursor, source, result }) =>
    console.log(JSON.stringify({ page, cursor: pageCursor, rows: source.rows, ...result })),
  maxPages,
  startCursor: cursor,
});
