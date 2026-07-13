import process from "node:process";

const endpoint = process.env.RECOVERY_API_URL;
const token = process.env.RECOVERY_ADMIN_TOKEN;
const transactionLimit = Number(process.env.RECOVERY_VERIFY_TRANSACTIONS || 100);
const maxBatches = Number(process.env.RECOVERY_MAX_BATCHES || 0);
if (!endpoint || !token) throw new Error("RECOVERY_API_URL and RECOVERY_ADMIN_TOKEN are required");
if (!Number.isInteger(transactionLimit) || transactionLimit < 1 || transactionLimit > 100)
  throw new Error("RECOVERY_VERIFY_TRANSACTIONS must be an integer from 1 to 100");

async function post(path) {
  const response = await fetch(`${endpoint}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`${path} failed: ${JSON.stringify(result)}`);
  return result;
}

let batches = 0;
let transactions = 0;
let outputs = 0;
while (!maxBatches || batches < maxBatches) {
  const result = await post(`/admin/recovery/verify?transactions=${transactionLimit}`);
  if (result.transactions === 0) break;
  batches++;
  transactions += result.transactions;
  outputs += result.outputs;
  console.log(JSON.stringify({ batch: batches, transactions, outputs, latest: result }));
}

if (maxBatches && batches >= maxBatches) {
  console.log(JSON.stringify({ complete: false, batches, transactions, outputs }));
} else {
  const result = await post("/admin/recovery/finalize");
  console.log(JSON.stringify({ complete: true, batches, transactions, outputs, ...result }));
}
