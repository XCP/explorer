#!/usr/bin/env node
import { DatabaseSync } from "node:sqlite";
const d = new DatabaseSync("C:/BitcoinIndex/counterparty-bitcoin.sqlite");
d.exec("BEGIN IMMEDIATE");
d.exec(
  `UPDATE btc_block_metrics SET counterparty_fee_sats=coalesce((SELECT sum(fee_sats) FROM counterparty_tx_fee f WHERE f.block_height=btc_block_metrics.block_height),0), counterparty_transaction_count=(SELECT count(*) FROM btc_tx t WHERE t.block_height=btc_block_metrics.block_height AND (t.flags&2)<>0)`,
);
d.prepare(
  "UPDATE fee_coverage SET expected_transactions=?,resolved_transactions=?,missing_transactions=?,checked_at=strftime('%s','now') WHERE singleton=1",
).run(
  d.prepare("SELECT count(*) n FROM counterparty_tx_watch").get().n,
  d.prepare("SELECT count(*) n FROM counterparty_tx_fee").get().n,
  0,
);
d.exec("COMMIT");
console.log(
  JSON.stringify({ event: "counterparty_metrics_refreshed", coverage: d.prepare("SELECT * FROM fee_coverage").get() }),
);
