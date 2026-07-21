import { performance } from "node:perf_hooks";

const base = (process.env.API_BASE || "https://api.xcp.io").replace(/\/$/, "");
const samples = Math.max(1, Math.min(10, Number.parseInt(process.env.BENCH_SAMPLES || "3", 10) || 3));
const address = "1CounterpartyXXXXXXXXXXXXXXXUWLpVr";
const paths = [
  "/v2/status",
  "/v2/blocks?limit=25",
  "/v2/assets?limit=50",
  "/v2/assets/RAREPEPE",
  "/v2/sends?limit=50",
  "/v2/orders?limit=50",
  "/v2/mempool",
  `/v2/addresses/${address}/summary`,
  `/v2/addresses/${address}/reputation`,
];

const quantile = (values, q) => values[Math.min(values.length - 1, Math.floor(values.length * q))];
let failed = false;

console.log(`API benchmark: ${base} (${samples} samples per route)`);
console.log("status\tmedian\tp95\tbytes\troute");

for (const path of paths) {
  const timings = [];
  let status = 0;
  let bytes = 0;
  for (let i = 0; i < samples; i++) {
    const started = performance.now();
    const response = await fetch(base + path, { signal: AbortSignal.timeout(20_000) });
    const body = await response.arrayBuffer();
    timings.push(performance.now() - started);
    status = response.status;
    bytes = body.byteLength;
    if (!response.ok) failed = true;
  }
  timings.sort((a, b) => a - b);
  console.log(
    `${status}\t${quantile(timings, 0.5).toFixed(0)}ms\t${quantile(timings, 0.95).toFixed(0)}ms\t${bytes}\t${path}`,
  );
}

if (failed) process.exitCode = 1;
