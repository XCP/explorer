import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import process from "node:process";

const endpoint = process.env.RECOVERY_API_URL;
const token = process.env.RECOVERY_ADMIN_TOKEN;
const sourceFile = process.env.BTC_STAMPS_EXPORT;
const pageSize = Number(process.env.STAMP_PROTECTION_PAGE_SIZE || 500);
let cursor = Number(process.env.STAMP_PROTECTION_CURSOR || -1);

if (!endpoint || !token || !sourceFile)
  throw new Error("RECOVERY_API_URL, RECOVERY_ADMIN_TOKEN, and BTC_STAMPS_EXPORT are required");
if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 500)
  throw new Error("STAMP_PROTECTION_PAGE_SIZE must be an integer from 1 through 500");
if (!Number.isSafeInteger(cursor) || cursor < -1) throw new Error("STAMP_PROTECTION_CURSOR must be at least -1");

const bytes = await readFile(sourceFile);
const snapshotSha256 = createHash("sha256").update(bytes).digest("hex");
const text = bytes.toString("utf8").trim();
const parsed = text.startsWith("[")
  ? JSON.parse(text)
  : text
      .split(/\r?\n/u)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
if (!Array.isArray(parsed)) throw new Error("btc_stamps export must be a JSON array or JSON Lines file");

let previousStamp = -1;
const rows = parsed.map((row, index) => {
  const stamp = Number(row?.stamp ?? row?.stamp_number);
  const txid = String(row?.tx_hash ?? row?.txid ?? "").toLowerCase();
  if (!Number.isSafeInteger(stamp) || stamp < 0 || stamp <= previousStamp)
    throw new Error(`row ${index + 1} has a non-increasing or invalid stamp number`);
  if (!/^[0-9a-f]{64}$/u.test(txid)) throw new Error(`row ${index + 1} has an invalid transaction id`);
  previousStamp = stamp;
  return { stamp, txid };
});

const remaining = rows.filter((row) => row.stamp > cursor);
for (let offset = 0; offset < remaining.length; offset += pageSize) {
  const page = remaining.slice(offset, offset + pageSize);
  const finalPage = offset + page.length === remaining.length;
  const nextCursor = finalPage ? null : page.at(-1).stamp;
  const response = await fetch(new URL("/admin/recovery/protections/stamps/official", endpoint), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      cursor,
      next_cursor: nextCursor,
      complete: finalPage,
      snapshot_sha256: snapshotSha256,
      transactions: page.map(({ stamp, txid }) => ({ txid, source_reference: `stamp:${stamp}` })),
    }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`official Stamp bootstrap rejected (${response.status}): ${JSON.stringify(body)}`);
  console.log(JSON.stringify({ cursor, snapshot_sha256: snapshotSha256, ...body }));
  cursor = page.at(-1).stamp;
}

if (remaining.length === 0)
  console.log(JSON.stringify({ complete: true, cursor, snapshot_sha256: snapshotSha256, rows: rows.length }));
