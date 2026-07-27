import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
const raw = readFileSync("C:/BitcoinIndex/production-otc.json")
  .toString("utf16le")
  .replace(/^\uFEFF/, "");
const rows = JSON.parse(raw)[0].results;
const d = new DatabaseSync("C:/BitcoinIndex/otc-production-seed.sqlite");
d.exec(
  "DROP TABLE IF EXISTS main.final_admitted; CREATE TABLE main.final_admitted(event_index INTEGER NOT NULL,asset_tx_hash BLOB NOT NULL,asset_block INTEGER NOT NULL,asset_time INTEGER NOT NULL,seller_id INTEGER NOT NULL,buyer_id INTEGER NOT NULL,asset_id INTEGER NOT NULL,quantity REAL NOT NULL,primary_tx_id INTEGER NOT NULL,primary_btc_tx_hash BLOB NOT NULL,btc_block INTEGER NOT NULL,btc_time INTEGER NOT NULL,payment_sats INTEGER NOT NULL,payer_input_count INTEGER NOT NULL,payee_output_count INTEGER NOT NULL,attribution_flags INTEGER NOT NULL,relative_blocks INTEGER NOT NULL,method TEXT NOT NULL,method_version INTEGER NOT NULL,indexed_through_block INTEGER NOT NULL,lane_candidates INTEGER NOT NULL,lane_buyers INTEGER NOT NULL,price_ratio REAL NOT NULL,evidence_note TEXT NOT NULL,payment_json TEXT NOT NULL,PRIMARY KEY(event_index,method)) WITHOUT ROWID;",
);
const ins = d.prepare("INSERT INTO final_admitted VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
rows.forEach((r, i) => {
  const btc = r.ref.split(":")[1],
    sats = Math.round(r.total * 1e8);
  ins.run(
    i + 1,
    Buffer.from(r["hex(tx_hash)"], "hex"),
    r.block_index,
    r.block_time,
    r.seller_id,
    r.buyer_id,
    r.asset_id,
    r.quantity,
    i + 1,
    Buffer.from(btc, "hex"),
    r.block_index,
    r.block_time,
    sats,
    0,
    0,
    0,
    0,
    "production_legacy",
    2,
    r.block_index,
    0,
    0,
    1,
    `Imported production ref ${r.ref}`,
    JSON.stringify([{ tx_hash: btc, block: r.block_index, time: r.block_time, sats }]),
  );
});
console.log(JSON.stringify({ rows: rows.length }));
d.close();
