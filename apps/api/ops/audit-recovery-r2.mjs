import { readFile, rename, writeFile } from "node:fs/promises";

const endpoint = process.env.RECOVERY_BOOTSTRAP_URL ?? process.env.RECOVERY_API_URL;
const token = process.env.ADMIN_TOKEN ?? process.env.RECOVERY_ADMIN_TOKEN;
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

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function request(path, init = {}) {
  let lastError;
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      const response = await fetch(new URL(path, endpoint), {
        ...init,
        signal: AbortSignal.timeout(60_000),
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...init.headers },
      });
      if (response.ok) return response.json();

      const error = new Error(`${path} failed (${response.status}): ${await response.text()}`);
      if (response.status < 500 && response.status !== 429) {
        error.retryable = false;
        throw error;
      }
      lastError = error;
    } catch (error) {
      if (error?.retryable === false) throw error;
      lastError = error;
    }
    const wait = Math.min(30_000, 1_000 * 2 ** attempt);
    process.stderr.write(`\nR2 audit request failed; retrying in ${wait / 1000}s (${attempt + 1}/8)\n`);
    await delay(wait);
  }
  throw lastError;
}

const manifest = await request("/admin/recovery/audit/transactions/manifest");
if (!manifest.imports_complete)
  throw new Error(
    `recovery import is incomplete (${manifest.completed_imports}/${manifest.total_imports}); start the full R2 audit after import completion`,
  );

let state = await loadCheckpoint();
if (state.manifest && JSON.stringify(state.manifest) !== JSON.stringify(manifest))
  throw new Error("R2 audit checkpoint belongs to a different recovery import; use a fresh checkpoint path");
if (!state.manifest) {
  state = { ...state, manifest };
  await saveCheckpoint(state);
}
for (;;) {
  const url = new URL("/admin/recovery/audit/transactions", endpoint);
  if (state.cursor) url.searchParams.set("cursor", state.cursor);
  url.searchParams.set("limit", String(limit));
  const page = await request(url.pathname + url.search);
  state = {
    ...state,
    cursor: page.last_cursor ?? state.cursor,
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
if (state.missing.length || state.corrupt.length) {
  process.exitCode = 2;
} else {
  const accepted = await request("/admin/recovery/audit/transactions/accept", {
    method: "POST",
    body: JSON.stringify({
      manifest: state.manifest,
      checked: state.checked,
      last_cursor: state.cursor || null,
      missing: state.missing.length,
      corrupt: state.corrupt.length,
    }),
  });
  console.log(JSON.stringify(accepted));
}
