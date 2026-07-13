import process from "node:process";

const endpoint = process.env.RECOVERY_API_URL;
const token = process.env.RECOVERY_ADMIN_TOKEN;
const transactionLimit = Number(process.env.RECOVERY_VERIFY_TRANSACTIONS || 100);
const maxBatches = Number(process.env.RECOVERY_MAX_BATCHES || 0);
const followImport = process.env.RECOVERY_FOLLOW_IMPORT === "1";
const autoFinalize = process.env.RECOVERY_AUTO_FINALIZE === "1";
const importId = process.env.RECOVERY_IMPORT_ID || "api-xcp-io";
if (!endpoint || !token) throw new Error("RECOVERY_API_URL and RECOVERY_ADMIN_TOKEN are required");
if (!Number.isInteger(transactionLimit) || transactionLimit < 1 || transactionLimit > 100)
  throw new Error("RECOVERY_VERIFY_TRANSACTIONS must be an integer from 1 to 100");

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function request(path, init = {}) {
  let lastError;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const response = await fetch(`${endpoint}${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${token}`, ...init.headers },
      });
      const result = await response.json();
      if (response.ok || (response.status >= 400 && response.status < 500)) return { response, result };
      lastError = new Error(`${path} failed: ${JSON.stringify(result)}`);
    } catch (error) {
      lastError = error;
    }
    await delay(Math.min(30_000, 1_000 * 2 ** attempt));
  }
  throw lastError;
}

async function post(path) {
  const { response, result } = await request(path, { method: "POST" });
  if (!response.ok) throw new Error(`${path} failed: ${JSON.stringify(result)}`);
  return result;
}

async function importComplete() {
  const { response, result } = await request(`/admin/recovery/imports/${importId}`);
  if (response.status === 404) return false;
  if (!response.ok) throw new Error(`failed to read import state: ${response.status}`);
  return result.completed_at != null;
}

let batches = 0;
let transactions = 0;
let outputs = 0;
while (!maxBatches || batches < maxBatches) {
  const result = await post(`/admin/recovery/verify?transactions=${transactionLimit}`);
  if (result.transactions === 0) {
    if (!followImport || (await importComplete())) break;
    console.log(JSON.stringify({ waiting_for_import: true, batches, transactions, outputs }));
    await delay(30_000);
    continue;
  }
  batches++;
  transactions += result.transactions;
  outputs += result.outputs;
  console.log(JSON.stringify({ batch: batches, transactions, outputs, latest: result }));
}

if (maxBatches && batches >= maxBatches) {
  console.log(JSON.stringify({ complete: false, batches, transactions, outputs }));
} else if (autoFinalize) {
  const result = await post("/admin/recovery/finalize");
  console.log(JSON.stringify({ complete: true, batches, transactions, outputs, ...result }));
} else {
  console.log(JSON.stringify({ complete: true, finalized: false, batches, transactions, outputs }));
}
