// Windows-safe runner for the live wire-contract checks: sets LIVE_API in the child env (no shell-specific
// `VAR=x` prefix, which cmd.exe/PowerShell don't understand) and runs ONLY the compiled contract test.
// `npm run test:contract` compiles first (tsc), then invokes this. Pass a custom origin through unchanged:
//     LIVE_API=http://127.0.0.1:8787 npm run test:contract -w xcpdex-api
import { spawnSync } from "node:child_process";

const r = spawnSync(process.execPath, ["--test", ".test-dist/tests/contract.test.js"], {
  stdio: "inherit",
  env: { ...process.env, LIVE_API: process.env.LIVE_API || "1" },
});
process.exit(r.status ?? 1);
