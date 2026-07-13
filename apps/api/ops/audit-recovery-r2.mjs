import { readFile, rename, writeFile } from "node:fs/promises";

const endpoint = process.env.RECOVERY_BOOTSTRAP_URL;
const token = process.env.ADMIN_TOKEN;
const checkpointPath = process.env.RECOVERY_R2_AUDIT_CHECKPOINT ?? "recovery-r2-audit.json";
const limit = Number(process.env.RECOVERY_R2_AUDIT_PAGE_SIZE ?? 50);

if (!endpoint || !token) throw new Error("RECOVERY_BOOTSTRAP_URL and ADMIN_TOKEN are required");
if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error("page size must be 1 to 100");

async function loadCheckpoint() {
  try {
    return JSON.parse(await readFile(checkpointPath, "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return { cursor: "", checked: 0, missing: [], corrupt: [], started_at: new Date().toISOString() };
  }
}

async function saveCheckpoint(checkpoint) {
  const temporaryPath = `${checkpointPath}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(checkpoint, null, 2)}\n`, "utf8");
  await rename(temporaryPath, checkpointPath);
}

let state = await loadCheckpoint();
for (;;) {
  const url = new URL("/admin/recovery/audit/transactions", endpoint);
  if (state.cursor) url.searchParams.set("cursor", state.cursor);
  url.searchParams.set("limit", String(limit));
  const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`audit request failed (${response.status}): ${await response.text()}`);
  const page = await response.json();
  state = {
    ...state,
    cursor: page.next_cursor ?? state.cursor,
    checked: state.checked + page.checked,
    missing: [...new Set([...state.missing, ...page.missing])].sort(),
    corrupt: [...state.corrupt, ...page.corrupt],
    updated_at: new Date().toISOString(),
    complete: page.next_cursor === null,
  };
  await saveCheckpoint(state);
  process.stdout.write(
    `\rchecked=${state.checked} missing=${state.missing.length} corrupt=${state.corrupt.length} cursor=${state.cursor.slice(0, 12)}`,
  );
  if (page.next_cursor === null) break;
}
process.stdout.write("\n");
console.log(`R2 audit complete; report written to ${checkpointPath}`);
if (state.missing.length || state.corrupt.length) process.exitCode = 2;
