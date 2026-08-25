#!/usr/bin/env node
/**
 * What is writing to D1, and will it fit inside the monthly allowance.
 *
 * The Workers Paid plan includes 50 million written rows a month. That is the
 * number this exists to keep an eye on, and it is easy to blow through without
 * noticing: on 2026-07-29 and 2026-08-04 this account wrote 225 MILLION rows in
 * a day each (see the D1 billing incident report), which is four and a half
 * months of allowance in forty-eight hours.
 *
 * Reads the same numbers the Cloudflare dashboard shows, through the GraphQL
 * analytics API, so it can be run from a terminal and diffed over time:
 *
 *   node ops/d1-writes.mjs            # 30-day daily series + forecast
 *   node ops/d1-writes.mjs --queries  # per-statement attribution, last 24h
 *
 * DAILY, not monthly. A monthly total tells you that you are over; a daily
 * series tells you whether the cause is the baseline (a structural problem) or
 * a handful of spikes (an operational one), and those want opposite fixes. It
 * also separates a finite backfill — which ends on its own — from steady load,
 * which does not.
 *
 * Auth comes from the wrangler OAuth token already on this machine, so there is
 * nothing to configure and no second credential to leak. It is read-only.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const LIMIT = 50_000_000;
const DAILY_BUDGET = LIMIT / 30;

function token() {
  const candidates = [
    path.join(os.homedir(), ".wrangler", "config", "default.toml"),
    path.join(process.env.APPDATA ?? "", "xdg.config", ".wrangler", "config", "default.toml"),
    path.join(os.homedir(), ".config", ".wrangler", "config", "default.toml"),
  ];
  for (const p of candidates) {
    if (!p || !fs.existsSync(p)) continue;
    const m = /oauth_token\s*=\s*"([^"]+)"/.exec(fs.readFileSync(p, "utf8"));
    if (m) return m[1];
  }
  throw new Error("no wrangler oauth token found — run `wrangler login` first");
}

async function gql(query) {
  const res = await fetch("https://api.cloudflare.com/client/v4/graphql", {
    method: "POST",
    headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const body = await res.json();
  if (body.errors?.length) throw new Error(JSON.stringify(body.errors).slice(0, 300));
  return body.data;
}

const accountId = async () => {
  const res = await fetch("https://api.cloudflare.com/client/v4/accounts", {
    headers: { Authorization: `Bearer ${token()}` },
  });
  const body = await res.json();
  if (!body.success) throw new Error("could not list accounts");
  return body.result[0].id;
};

const n = (x) => Math.round(x).toLocaleString("en-US");
const med = (a) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : 0);

async function databases(acc) {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${acc}/d1/database?per_page=100`, {
    headers: { Authorization: `Bearer ${token()}` },
  });
  const body = await res.json();
  return Object.fromEntries((body.result ?? []).map((d) => [d.uuid, d.name]));
}

async function daily(acc, names) {
  const from = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const to = new Date().toISOString().slice(0, 10);
  const data = await gql(`query{viewer{accounts(filter:{accountTag:"${acc}"}){
    d1AnalyticsAdaptiveGroups(limit:2000,filter:{date_geq:"${from}",date_leq:"${to}"},orderBy:[date_ASC]){
      dimensions{date databaseId} sum{rowsWritten}}}}}`);
  const rows = data.viewer.accounts[0].d1AnalyticsAdaptiveGroups;

  const byDate = new Map();
  const byDb = new Map();
  for (const r of rows) {
    const d = r.dimensions.date;
    const db = names[r.dimensions.databaseId] ?? r.dimensions.databaseId.slice(0, 8);
    byDate.set(d, (byDate.get(d) ?? 0) + r.sum.rowsWritten);
    if (!byDb.has(db)) byDb.set(db, new Map());
    byDb.get(db).set(d, (byDb.get(db).get(d) ?? 0) + r.sum.rowsWritten);
  }
  const dates = [...byDate.keys()].sort();
  // Today is partial and would drag any average down.
  const closed = dates.slice(0, -1);

  console.log(`ROWS WRITTEN PER DAY   (budget ${n(DAILY_BUDGET)}/day for ${n(LIMIT)}/month)\n`);
  for (const d of dates) {
    const t = byDate.get(d);
    const bar = "#".repeat(Math.min(40, Math.round((t / DAILY_BUDGET) * 10)));
    const flag = t > DAILY_BUDGET ? " OVER" : "";
    console.log(`  ${d}  ${n(t).padStart(12)}  ${bar}${flag}${d === dates.at(-1) ? "  (partial)" : ""}`);
  }

  // Forecast from a TRAILING window, not the whole month. A fix that landed
  // three weeks ago is still inside the 30-day series, and averaging across it
  // forecasts the system as it used to be. Fourteen days is long enough to
  // cover a weekly cycle and short enough to drop a superseded regime.
  const recent = closed.slice(-14);
  const vals = recent.map((d) => byDate.get(d));
  const m = med(vals);
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  console.log(`\n  TRAILING 14 DAYS   median/day ${n(m)}   mean/day ${n(mean)}`);
  console.log(
    `  30-day forecast at median ${n(m * 30)} (${(((m * 30) / LIMIT) * 100).toFixed(0)}%)` +
      `   at mean ${n(mean * 30)} (${(((mean * 30) / LIMIT) * 100).toFixed(0)}%)`,
  );
  if (mean > m * 1.3) {
    console.log("  NOTE: mean far above median — the cost is spikes, not baseline. Look for the OVER days.");
    console.log("  Baseline fixes and spike fixes are different work; the median tells you which you need.");
  }

  console.log("\nBY DATABASE (median/day, trailing 14 days)");
  [...byDb.entries()]
    .map(([db, mm]) => [db, med(recent.map((d) => mm.get(d) ?? 0)), Math.max(...recent.map((d) => mm.get(d) ?? 0))])
    .sort((a, b) => b[1] - a[1])
    .filter(([, mm, peak]) => mm > 0 || peak > 0)
    .forEach(([db, mm, peak]) =>
      console.log(
        `  ${db.padEnd(22)} ${n(mm).padStart(10)}/day   peak ${n(peak).padStart(11)}   30d ${n(mm * 30).padStart(11)}`,
      ),
    );
}

async function queries(acc, names) {
  const from = new Date(Date.now() - 864e5).toISOString().replace(/\.\d+/, "");
  const to = new Date().toISOString().replace(/\.\d+/, "");
  console.log("TOP WRITING STATEMENTS, LAST 24H\n");
  for (const [id, name] of Object.entries(names)) {
    const data = await gql(`query{viewer{accounts(filter:{accountTag:"${acc}"}){
      d1QueriesAdaptiveGroups(limit:8,filter:{databaseId:"${id}",datetime_geq:"${from}",datetime_leq:"${to}"},
        orderBy:[sum_rowsWritten_DESC]){dimensions{query} sum{rowsWritten} count}}}}`);
    const g = data.viewer.accounts[0].d1QueriesAdaptiveGroups.filter((x) => x.sum.rowsWritten > 0);
    if (!g.length) continue;
    console.log(`  ${name}`);
    for (const x of g) {
      const per = (x.sum.rowsWritten / x.count).toFixed(1);
      console.log(
        `    ${n(x.sum.rowsWritten).padStart(9)}  x${String(x.count).padStart(6)}  ${per.padStart(7)}/run  ` +
          x.dimensions.query.replace(/\s+/g, " ").slice(0, 78),
      );
    }
    console.log("");
  }
  console.log("  A statement writing many rows per run against a table that barely changed");
  console.log("  is an unguarded upsert. See the delta-write rule in CLAUDE.md.");
}

const acc = await accountId();
const names = await databases(acc);
if (process.argv.includes("--queries")) await queries(acc, names);
else await daily(acc, names);
