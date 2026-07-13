import { spawnSync } from "node:child_process";
import process from "node:process";

const endpoint = process.env.RECOVERY_API_URL;
const token = process.env.RECOVERY_ADMIN_TOKEN;
const importId = process.env.RECOVERY_IMPORT_ID || "api-xcp-io";
const server = process.env.RECOVERY_SOURCE_SSH || "forge@91.99.189.190";
const identity = process.env.RECOVERY_SOURCE_KEY;
const localSource = process.env.RECOVERY_SOURCE_LOCAL === "1";
const maxPages = Number(process.env.RECOVERY_MAX_PAGES || 0);
if (!endpoint || !token) throw new Error("RECOVERY_API_URL and RECOVERY_ADMIN_TOKEN are required");

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

function exportPage(cursor) {
  if (localSource) {
    const result = spawnSync("php", ["/tmp/export-recovery.php", "/home/forge/api.xcp.io", String(cursor), "100"], {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    });
    if (result.status !== 0) throw new Error(result.stderr || `recovery export exited ${result.status}`);
    return JSON.parse(result.stdout);
  }
  const args = ["-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes"];
  if (identity) args.push("-i", identity);
  args.push(server, `php /tmp/export-recovery.php /home/forge/api.xcp.io ${cursor} 100`);
  const result = spawnSync("ssh", args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(result.stderr || `recovery export exited ${result.status}`);
  return JSON.parse(result.stdout);
}

let cursor = Number((await state()).cursor || 0);
let pages = 0;
while (!maxPages || pages < maxPages) {
  const page = exportPage(cursor);
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
  pages++;
  console.log(JSON.stringify({ page: pages, cursor, rows: page.rows, ...result }));
  if (page.next_id == null) break;
  cursor = page.next_id;
}
