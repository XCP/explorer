import { readFileSync } from "node:fs";
import { setTimeout as wait } from "node:timers/promises";

const base = process.env.CORE_BACKFILL_BASE ?? "http://127.0.0.1:8790";
const table = process.env.CORE_BACKFILL_TABLE ?? "transactions";
if (!new Set(["transactions", "blocks", "assets", "issuances"]).has(table))
  throw new Error(`unsupported core table: ${table}`);
const maxRows = table === "assets" || table === "issuances" ? 100 : 500;
const rows = Math.max(1, Math.min(Number(process.env.CORE_BACKFILL_ROWS ?? maxRows), maxRows));
const vars = readFileSync(new URL("../.dev.vars", import.meta.url), "utf8");
const tokenLine = vars.split(/\r?\n/).find((line) => line.startsWith("ADMIN_TOKEN="));
if (!tokenLine) throw new Error("ADMIN_TOKEN is missing from apps/api/.dev.vars");
const token = tokenLine
  .slice("ADMIN_TOKEN=".length)
  .trim()
  .replace(/^(?:"(.*)"|'(.*)')$/, "$1$2");

let pages = 0;
let processed = 0;
for (;;) {
  try {
    const response = await fetch(`${base}/admin/backfill-core/${table}?rows=${rows}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error(`backfill request failed: ${response.status}`);
    const result = await response.json();
    pages++;
    processed += Number(result.processed ?? 0);
    if (pages === 1 || pages % 100 === 0 || result.caught_up) {
      process.stdout.write(
        `${JSON.stringify({ table, pages, processed, cursor: result.cursor, caught_up: result.caught_up })}\n`,
      );
    }
    if (result.caught_up) break;
    await wait(100);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    await wait(5_000);
  }
}
