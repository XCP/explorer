import process from "node:process";

const endpoint = process.env.RECOVERY_API_URL;
const token = process.env.RECOVERY_ADMIN_TOKEN;
const limit = Number(process.env.STAMP_PROTECTION_PAGE_SIZE || 500);
let cursor = Number(process.env.STAMP_PROTECTION_CURSOR || -1);

if (!endpoint || !token) throw new Error("RECOVERY_API_URL and RECOVERY_ADMIN_TOKEN are required");
if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000)
  throw new Error("STAMP_PROTECTION_PAGE_SIZE must be an integer from 1 through 1000");
if (!Number.isSafeInteger(cursor) || cursor < -1) throw new Error("STAMP_PROTECTION_CURSOR must be at least -1");

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function bootstrapPage(pageCursor) {
  let lastError;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const url = new URL("/admin/recovery/protections/stamps/bootstrap", endpoint);
      url.searchParams.set("cursor", String(pageCursor));
      url.searchParams.set("limit", String(limit));
      const response = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await response.json();
      if (response.ok) return body;
      if (response.status >= 400 && response.status < 500) {
        const error = new Error(`Stamp protection bootstrap rejected: ${JSON.stringify(body)}`);
        error.nonRetryable = true;
        throw error;
      }
      lastError = new Error(`Stamp protection bootstrap failed with ${response.status}`);
    } catch (error) {
      if (error?.nonRetryable) throw error;
      lastError = error;
    }
    await delay(Math.min(30_000, 1_000 * 2 ** attempt));
  }
  throw lastError;
}

for (;;) {
  const result = await bootstrapPage(cursor);
  console.log(JSON.stringify({ cursor, ...result }));
  if (result.next_cursor == null) break;
  if (!Number.isSafeInteger(result.next_cursor) || result.next_cursor <= cursor) {
    throw new Error(`Stamp protection cursor did not advance from ${cursor}`);
  }
  cursor = result.next_cursor;
}
