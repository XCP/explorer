import process from "node:process";

const endpoint = process.env.RECOVERY_API_URL;
const token = process.env.RECOVERY_ADMIN_TOKEN;
const attemptLimit = Number(process.env.RECOVERY_ATTEMPT_LIMIT || 100);
const interval = Number(process.env.RECOVERY_ATTEMPT_INTERVAL_MS || 30_000);
if (!endpoint || !token) throw new Error("RECOVERY_API_URL and RECOVERY_ADMIN_TOKEN are required");
if (!Number.isInteger(attemptLimit) || attemptLimit < 1 || attemptLimit > 100)
  throw new Error("RECOVERY_ATTEMPT_LIMIT must be an integer from 1 to 100");
if (!Number.isInteger(interval) || interval < 5_000)
  throw new Error("RECOVERY_ATTEMPT_INTERVAL_MS must be an integer of at least 5000");

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function reconcile() {
  let lastError;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const response = await fetch(`${endpoint}/admin/recovery/reconcile-attempts?attempts=${attemptLimit}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const result = await response.json();
      if (response.ok) return result;
      if (response.status < 500) throw new Error(`attempt reconciliation rejected: ${JSON.stringify(result)}`);
      lastError = new Error(`attempt reconciliation failed: ${JSON.stringify(result)}`);
    } catch (error) {
      lastError = error;
    }
    await delay(Math.min(30_000, 1_000 * 2 ** attempt));
  }
  throw lastError;
}

for (;;) {
  try {
    console.log(JSON.stringify({ at: new Date().toISOString(), ...(await reconcile()) }));
  } catch (error) {
    console.error(
      JSON.stringify({ at: new Date().toISOString(), error: error instanceof Error ? error.message : String(error) }),
    );
  }
  await delay(interval);
}
