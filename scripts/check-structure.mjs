// Structure gate — mechanical enforcement of CLAUDE.md rules that neither tsc nor eslint express.
// Fails loudly; run via `npm run check`, the edit hook, and CI.
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["apps/api/src", "apps/web/src", "packages/shared/src"];
const failures = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      walk(p);
    } else if (/^index\.(ts|tsx)$/.test(name)) {
      // CLAUDE.md rule 1: no barrel files. apps/api/src/index.ts is the Worker entrypoint
      // (wrangler main), not a barrel — the one allowed exception.
      if (p.replaceAll("\\", "/") !== "apps/api/src/index.ts") {
        failures.push(`barrel file: ${p} — import files directly instead (CLAUDE.md rule 1)`);
      }
    }
  }
}

for (const root of ROOTS) walk(root);

if (failures.length) {
  console.error("STRUCTURE CHECK FAILED:\n" + failures.map((f) => `  - ${f}`).join("\n"));
  process.exit(1);
}
console.log("structure ok");
