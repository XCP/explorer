import { readFileSync } from "node:fs";

const apiBase = (process.env.CORE_API_BASE ?? "https://xcp-api.me-bbe.workers.dev").replace(/\/$/, "");
const replayEvents = boundedInteger(process.env.CORE_REPLAY_EVENTS ?? "50000", 1, 50_000, "CORE_REPLAY_EVENTS");
const maxReplaySteps = boundedInteger(
  process.env.CORE_REPLAY_MAX_STEPS ?? "10000",
  1,
  100_000,
  "CORE_REPLAY_MAX_STEPS",
);
const maxAttempts = boundedInteger(process.env.CORE_FINALIZE_MAX_ATTEMPTS ?? "8", 1, 20, "CORE_FINALIZE_MAX_ATTEMPTS");
const projectionRows = boundedInteger(process.env.CORE_PROJECTION_ROWS ?? "100", 1, 500, "CORE_PROJECTION_ROWS");
const incrementalProjections = [
  "emblem_listings",
  "emblem_sales",
  "prices",
  "scarce_city_sales",
  "trades",
  "xcp_btc_daily",
];
const token = process.env.ADMIN_TOKEN ?? readLocalAdminToken();

function boundedInteger(value, minimum, maximum, name) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} through ${maximum}`);
  }
  return parsed;
}

function readLocalAdminToken() {
  const vars = readFileSync(new URL("../.dev.vars", import.meta.url), "utf8");
  const line = vars.split(/\r?\n/).find((entry) => entry.startsWith("ADMIN_TOKEN="));
  if (!line) throw new Error("ADMIN_TOKEN is missing from the environment and apps/api/.dev.vars");
  return line
    .slice("ADMIN_TOKEN=".length)
    .trim()
    .replace(/^(?:"(.*)"|'(.*)')$/, "$1$2");
}

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function request(path, method = "GET") {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(`${apiBase}${path}`, {
        method,
        headers: { authorization: `Bearer ${token}` },
      });
      const text = await response.text();
      let body;
      try {
        body = text === "" ? null : JSON.parse(text);
      } catch {
        body = { detail: text };
      }
      if (response.ok) return body;
      const d1Reset = text.includes("D1 DB exceeded its CPU time limit") || text.includes("D1_ERROR");
      if (response.status < 500 && response.status !== 409 && response.status !== 429 && !d1Reset) {
        throw Object.assign(new Error(`${path} failed with ${response.status}: ${text}`), { retryable: false });
      }
      if (response.status === 409) return body;
      if (attempt === maxAttempts) throw new Error(`${path} failed with ${response.status}: ${text}`);
    } catch (error) {
      if (error.retryable === false || attempt === maxAttempts) throw error;
    }
    const delay = Math.min(30_000, 500 * 2 ** (attempt - 1));
    process.stderr.write(`${JSON.stringify({ path, attempt, retry_ms: delay })}\n`);
    await sleep(delay);
  }
  throw new Error(`${path} exhausted retries`);
}

function report(stage, result) {
  process.stdout.write(`${JSON.stringify({ stage, result })}\n`);
}

const initialStatus = await request("/admin/status");
report("status", initialStatus.core);
if (!initialStatus.core?.build_complete || !initialStatus.core?.import_complete) {
  throw new Error("Compact import is not complete; rerun this command after the importer finishes");
}

let replay;
for (let step = 1; step <= maxReplaySteps; step += 1) {
  replay = await request(`/admin/core-replay?events=${replayEvents}`, "POST");
  report("replay", { step, ...replay });
  if (replay.caught_up) break;
  if (replay.skipped) throw new Error(`Compact replay did not advance: ${replay.skipped}`);
}
if (!replay?.caught_up) throw new Error(`Compact replay did not catch up within ${maxReplaySteps} steps`);

for (const table of incrementalProjections) {
  let projection;
  for (let step = 1; step <= maxReplaySteps; step += 1) {
    projection = await request(`/admin/core-projections/reconcile/${table}?rows=${projectionRows}`, "POST");
    report("projection", { step, ...projection });
    if (projection.caught_up) break;
    if (projection.skipped) throw new Error(`${table} reconciliation did not advance: ${projection.skipped}`);
  }
  if (!projection?.caught_up)
    throw new Error(`${table} reconciliation did not catch up within ${maxReplaySteps} steps`);
}

// Reconciliation can take long enough for new Counterparty events to arrive. Close that interval before parity;
// the replay is idempotent and normally applies zero or only a handful of events.
for (let step = 1; step <= maxReplaySteps; step += 1) {
  replay = await request(`/admin/core-replay?events=${replayEvents}`, "POST");
  report("replay_stabilization", { step, ...replay });
  if (replay.caught_up) break;
  if (replay.skipped) throw new Error(`Compact stabilization replay did not advance: ${replay.skipped}`);
}
if (!replay?.caught_up) throw new Error(`Compact stabilization replay did not catch up within ${maxReplaySteps} steps`);

const parity = await request("/admin/core-parity", "POST");
report("parity", parity);
if (!parity?.ok) {
  throw new Error("Compact parity failed; forward writes remain closed. Inspect the reported mismatches.");
}

const activation = await request("/admin/core-forward-writes/activate", "POST");
report("forward_writes", activation);
if (!activation?.ok || !activation.forward_write_ready) {
  throw new Error("Forward-write activation failed; reads remain on the source database");
}

const finalStatus = await request("/admin/status");
report("complete", finalStatus.core);
