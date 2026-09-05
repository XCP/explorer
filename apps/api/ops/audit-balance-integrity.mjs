#!/usr/bin/env node
/** Explicit, bounded, read-only address audit. Never scheduled. No repair writes.
 * npm exec tsc -- -p tsconfig.test.json
 * node ops/audit-balance-integrity.mjs ADDRESS [ADDRESS ...]
 * Receipts include complete evidence and measured D1 reads in outputs/. */
import { mkdirSync, writeFileSync } from "node:fs";
import { executeRemoteD1 } from "./lib/remote-d1.mjs";
import { parseCounterpartyJson, balanceQuantity } from "#api/indexer/codec";

const addresses = [...new Set(process.argv.slice(2))];
if (!addresses.length || addresses.length > 10 || addresses.some((address) => !/^[a-zA-Z0-9]{26,90}$/.test(address))) {
  throw new Error("Supply 1 to 10 explicit Bitcoin addresses");
}
const api = "https://api.counterparty.io:4000/v2";
let reads = 0;
let requests = 0;
let lastRequest = 0;
const run = (sql) => {
  if (reads > 1000000) throw new Error("D1 audit read budget exhausted");
  const result = executeRemoteD1(sql);
  if (result.meta.rows_written) throw new Error("Audit unexpectedly wrote rows");
  reads += result.meta.rows_read ?? 0;
  return result.rows;
};
async function source(path) {
  const delay = 1500 - (Date.now() - lastRequest);
  if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
  lastRequest = Date.now();
  requests++;
  const response = await fetch(`${api}${path}`, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Core ${response.status}; stop and resume later, do not retry-loop`);
  const data = parseCounterpartyJson(await response.text());
  if (!data || data.error || !data.result) throw new Error("Invalid Core envelope");
  return data;
}
async function pages(path, key) {
  const all = [];
  const seen = new Set();
  let cursor;
  let total;
  do {
    const page = await source(
      `${path}${path.includes("?") ? "&" : "?"}limit=1000${cursor === undefined ? "" : `&cursor=${cursor}`}`,
    );
    if (!Array.isArray(page.result) || (total === undefined && !Number.isSafeInteger(page.result_count))) {
      throw new Error("Invalid pagination");
    }
    // Core deliberately omits result_count on cursor pages.
    if (page.result_count != null) {
      if (total !== undefined && total !== page.result_count) throw new Error("History changed during pagination");
      total = page.result_count;
    }
    for (const row of page.result) {
      const identity = key(row);
      if (seen.has(identity)) throw new Error("Duplicate Core history row");
      seen.add(identity);
      all.push(row);
    }
    if (all.length > 50000) throw new Error("Address history exceeds audit bound");
    if (page.next_cursor != null && page.next_cursor === cursor) throw new Error("Repeated cursor");
    cursor = page.next_cursor;
  } while (cursor != null);
  if (all.length !== total) throw new Error("Incomplete Core history");
  return all;
}
const state = () =>
  Object.fromEntries(
    run(
      "SELECT key,value FROM core_state WHERE key IN ('last_event_index','last_block_index','last_block_hash','rollback_to')",
    ).map((row) => [row.key, row.value]),
  );
const net = (rows) => {
  const quantities = new Map();
  for (const row of rows) {
    const key = row.asset;
    quantities.set(key, (quantities.get(key) ?? 0n) + (row.direction === 1 ? 1n : -1n) * balanceQuantity(row.quantity));
  }
  return quantities;
};
const blockTotals = (rows) => {
  const totals = new Map();
  for (const row of rows) {
    const key = `${row.block_index}:${row.asset}:${row.direction}`;
    const quantity = balanceQuantity(row.quantity);
    if (quantity !== 0n) totals.set(key, (totals.get(key) ?? 0n) + quantity);
  }
  return [...totals].map(([key, value]) => [key, value.toString()]).sort(([a], [b]) => a.localeCompare(b));
};
mkdirSync("outputs/balance-integrity", { recursive: true });
for (const address of addresses) {
  const before = state();
  if (before.rollback_to !== undefined) throw new Error("Rollback pending; audit later");
  const tip = (await source("/events?limit=1")).result[0].event_index;
  const hash = (await source(`/blocks/${before.last_block_index}`)).result.block_hash;
  if (hash !== before.last_block_hash) throw new Error("Local checkpoint hash differs from Core");
  const ledger = run(`SELECT e.event_index,e.block_index,e.direction,e.quantity,d.asset
    FROM ledger_events e JOIN asset_dictionary d ON d.asset_id=e.asset_id
    WHERE e.address_id=(SELECT address_id FROM address_dictionary WHERE address='${address}')
    ORDER BY e.event_index LIMIT 50001`);
  const balances = run(`SELECT b.balance_id,d.asset,b.quantity,b.updated_event_index,b.updated_block_index,
    CASE WHEN d.asset IN ('BTC','XCP') THEN 1 ELSE coalesce(a.divisible,0) END divisible
    FROM balances b JOIN asset_dictionary d ON d.asset_id=b.asset_id LEFT JOIN assets a ON a.asset_id=b.asset_id
    WHERE b.address_id=(SELECT address_id FROM address_dictionary WHERE address='${address}') LIMIT 50001`);
  const snapshots = run(`SELECT s.snapshot_id,d.asset,s.block_index,s.quantity,s.updated_event_index
    FROM balance_snapshots s JOIN asset_dictionary d ON d.asset_id=s.asset_id
    WHERE s.address_id=(SELECT address_id FROM address_dictionary WHERE address='${address}') LIMIT 50001`);
  if ([ledger, balances, snapshots].some((rows) => rows.length > 50000)) throw new Error("D1 address bound exceeded");
  const credits = await pages(`/addresses/${address}/credits`, (row) => row.credit_index);
  const debits = await pages(`/addresses/${address}/debits`, (row) => row.debit_index);
  const current = await pages(`/addresses/${address}/balances?type=address`, (row) => row.asset);
  const history = [
    ...credits.map((row) => ({ ...row, direction: 1 })),
    ...debits.map((row) => ({ ...row, direction: 0 })),
  ].filter((row) => !row.utxo && row.address === address);
  const after = state();
  const tipAfter = (await source("/events?limit=1")).result[0].event_index;
  const hashAfter = (await source(`/blocks/${before.last_block_index}`)).result.block_hash;
  if (JSON.stringify(before) !== JSON.stringify(after) || tip !== tipAfter || hash !== hashAfter) {
    throw new Error("Checkpoint moved during audit; no repair proof produced");
  }
  // Requiring a quiet address avoids projecting a current Core value onto an older local cursor.
  if (
    history.some((row) => row.block_index >= Number(before.last_block_index)) ||
    ledger.some((row) => row.event_index > Number(before.last_event_index))
  ) {
    throw new Error("Address touches an unsettled checkpoint; audit after the next closed block");
  }
  const expected = net(history);
  const currentMap = new Map(current.map((row) => [row.asset, balanceQuantity(row.quantity)]));
  const allAssets = new Set([...expected.keys(), ...currentMap.keys(), ...balances.map((row) => row.asset)]);
  for (const asset of allAssets) {
    if ((expected.get(asset) ?? 0n) !== (currentMap.get(asset) ?? 0n))
      throw new Error(`Core history/current mismatch: ${asset}`);
  }
  const ledgerTotals = new Map(blockTotals(ledger));
  const historyTotals = new Map(blockTotals(history));
  const historyDifferences = [...new Set([...ledgerTotals.keys(), ...historyTotals.keys()])].flatMap((key) =>
    ledgerTotals.get(key) === historyTotals.get(key)
      ? []
      : [{ key, ledger: ledgerTotals.get(key) ?? "0", core: historyTotals.get(key) ?? "0" }],
  );
  const stored = new Map(balances.map((row) => [row.asset, row]));
  const differences = [...allAssets].flatMap((asset) => {
    const row = stored.get(asset);
    const correct = (expected.get(asset) ?? 0n).toString();
    return (row?.quantity ?? "0") === correct
      ? []
      : [{ asset, stored: row?.quantity ?? null, expected: correct, balance_id: row?.balance_id ?? null }];
  });
  const snapshotDifferences = snapshots.flatMap((row) => {
    if (historyDifferences.some((difference) => difference.key.split(":")[1] === row.asset)) return [];
    const correct = (
      net(ledger.filter((event) => event.event_index <= row.updated_event_index)).get(row.asset) ?? 0n
    ).toString();
    return row.quantity === correct ? [] : [{ ...row, expected: correct }];
  });
  const receipt = {
    address,
    checkedAt: new Date().toISOString(),
    checkpoint: before,
    coreTip: tip,
    ledger,
    balances,
    snapshots,
    credits,
    debits,
    current,
    differences,
    snapshotDifferences,
    historyDifferences,
    reads,
    requests,
  };
  writeFileSync(`outputs/balance-integrity/${address}.json`, JSON.stringify(receipt, null, 2));
  console.log(
    JSON.stringify({
      address,
      assets: allAssets.size,
      ledgerEvents: ledger.length,
      differences,
      snapshotDifferences,
      historyDifferences,
      reads,
      requests,
    }),
  );
}
