#!/usr/bin/env node

/** Export validated compact-index projections for bounded import into xcpio-btc. */
import { DatabaseSync } from "node:sqlite";
import { writeFileSync } from "node:fs";

const arg = (name, fallback) =>
  process.argv.find((x) => x.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const input = arg("database", "C:/BitcoinIndex/counterparty-bitcoin.sqlite");
const output = arg("output", ".codex-tmp/import-bitcoin-index.sql");
const from = Number(arg("from", "278319"));
const to = Number(arg("to", "959434"));
const sourceVersion = Number(arg("source-version", "1"));
if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from > to) throw new Error("invalid height range");
const db = new DatabaseSync(input, { readOnly: true });
const q = (s) => `'${String(s).replaceAll("'", "''")}'`;
const n = (v) => (v == null ? "NULL" : String(Number(v)));
const b = (v) => `X'${Buffer.from(v).toString("hex")}'`;
const statements = [`-- Generated from verified compact Bitcoin index projections.`];
const metrics = db
  .prepare(
    `SELECT block_height,block_hash,block_time,block_size_bytes,transaction_count,total_fee_sats,
  counterparty_transaction_count,counterparty_fee_sats FROM btc_block_metrics WHERE block_height BETWEEN ? AND ? ORDER BY block_height`,
  )
  .all(from, to);
for (const row of metrics)
  statements.push(`INSERT INTO btc_block_metrics(block_height,block_hash,block_time,block_size,transaction_count,total_fees_sats,counterparty_transaction_count,counterparty_fee_sats,source,source_version,imported_at)
VALUES(${row.block_height},${q(Buffer.from(row.block_hash).toString("hex"))},${row.block_time},${row.block_size_bytes},${row.transaction_count},${row.total_fee_sats},${row.counterparty_transaction_count},${row.counterparty_fee_sats},'compact-bootstrap',${sourceVersion},unixepoch())
ON CONFLICT(block_height) DO UPDATE SET block_hash=excluded.block_hash,block_time=excluded.block_time,block_size=excluded.block_size,transaction_count=excluded.transaction_count,total_fees_sats=excluded.total_fees_sats,counterparty_transaction_count=excluded.counterparty_transaction_count,counterparty_fee_sats=excluded.counterparty_fee_sats,source_version=excluded.source_version,imported_at=excluded.imported_at;`);
const balances = db
  .prepare(
    `SELECT resolved_owner address,SUM(value_sats) balance_sats,COUNT(*) utxo_count,MIN(t.block_height) first_block,MAX(t.block_height) last_block
  FROM btc_counterparty_utxo u JOIN btc_tx t ON t.tx_id=u.created_tx_id
  WHERE u.spent_by_tx_id IS NULL AND u.resolved_owner IS NOT NULL GROUP BY u.resolved_owner`,
  )
  .all();
for (const row of balances)
  statements.push(`INSERT INTO btc_address_balance(address,balance_sats,utxo_count,first_block,last_block,source,source_version,imported_at)
VALUES(${q(row.address)},${row.balance_sats},${row.utxo_count},${n(row.first_block)},${n(row.last_block)},'compact-bootstrap',${sourceVersion},unixepoch())
ON CONFLICT(address) DO UPDATE SET balance_sats=excluded.balance_sats,utxo_count=excluded.utxo_count,first_block=excluded.first_block,last_block=excluded.last_block,source_version=excluded.source_version,imported_at=excluded.imported_at;`);
const hash = metrics.at(-1)?.block_hash ? Buffer.from(metrics.at(-1).block_hash).toString("hex") : "";
// Historical chunks may be imported out of order; never move the durable coverage cursor backward.
statements.push(
  `INSERT INTO btc_index_state(key,value,updated_at) VALUES('coverage_height',${q(String(metrics.at(-1)?.block_height ?? 0))},unixepoch()),('coverage_hash',${q(hash)},unixepoch()),('source_version',${q(String(sourceVersion))},unixepoch()) ON CONFLICT(key) DO UPDATE SET value=CASE WHEN CAST(excluded.value AS INTEGER)>CAST(btc_index_state.value AS INTEGER) THEN excluded.value ELSE btc_index_state.value END,updated_at=excluded.updated_at;`,
);
writeFileSync(output, `${statements.join("\n")}\n`);
console.log(
  JSON.stringify(
    {
      output,
      from,
      to,
      blocks: metrics.length,
      balances: balances.length,
      coverage_height: metrics.at(-1)?.block_height ?? null,
    },
    null,
    2,
  ),
);
db.close();
