/**
 * Executable schema prototype for the blue-green compact primary. It is deliberately not a numbered
 * migration: production `xcpio` must never build these tables beside 7.66 GB of live data. The same DDL
 * will seed a fresh `xcpio-core-v2` after query coverage is complete.
 */
export const COMPACT_PRIMARY_DDL = `
CREATE TABLE address_dictionary(address_id INTEGER PRIMARY KEY,address TEXT NOT NULL UNIQUE);
CREATE TABLE asset_dictionary(asset_id INTEGER PRIMARY KEY,asset TEXT NOT NULL UNIQUE);

CREATE TABLE transactions_v2(
  tx_index INTEGER PRIMARY KEY,tx_hash BLOB NOT NULL,block_index INTEGER NOT NULL,block_time INTEGER,
  source_id INTEGER,destination_id INTEGER,btc_amount TEXT,fee TEXT,data TEXT,supported INTEGER NOT NULL,utxos_info TEXT
);
CREATE INDEX idx_tx2_hash ON transactions_v2(tx_hash);
CREATE INDEX idx_tx2_block ON transactions_v2(block_index);
CREATE INDEX idx_tx2_source ON transactions_v2(source_id,block_index DESC,tx_index DESC);
CREATE INDEX idx_tx2_destination ON transactions_v2(destination_id,block_index DESC,tx_index DESC);

CREATE TABLE sends_v2(
  event_index INTEGER PRIMARY KEY,tx_index INTEGER NOT NULL,block_index INTEGER NOT NULL,block_time INTEGER,
  source_id INTEGER,destination_id INTEGER,source_address_id INTEGER,destination_address_id INTEGER,
  asset_id INTEGER,quantity TEXT,quantity_normalized TEXT,memo TEXT,memo_hex TEXT,send_type TEXT,status TEXT,
  fee_paid TEXT,msg_index INTEGER
);
CREATE INDEX idx_send2_tx ON sends_v2(tx_index);
CREATE INDEX idx_send2_block ON sends_v2(block_index);
CREATE INDEX idx_send2_source ON sends_v2(source_id,block_index DESC,event_index DESC);
CREATE INDEX idx_send2_destination ON sends_v2(destination_id,block_index DESC,event_index DESC);
CREATE INDEX idx_send2_asset ON sends_v2(asset_id,block_index DESC,event_index DESC);

CREATE TABLE balances_v2(
  balance_id INTEGER PRIMARY KEY,address_id INTEGER,utxo_tx_hash BLOB,utxo_vout INTEGER,asset_id INTEGER NOT NULL,
  quantity TEXT NOT NULL,quantity_normalized TEXT,updated_block_index INTEGER,updated_event_index INTEGER,
  utxo_address_id INTEGER,
  CHECK ((address_id IS NOT NULL) <> (utxo_tx_hash IS NOT NULL AND utxo_vout IS NOT NULL))
);
CREATE UNIQUE INDEX idx_bal2_address_asset ON balances_v2(address_id,asset_id) WHERE address_id IS NOT NULL;
CREATE UNIQUE INDEX idx_bal2_utxo_asset ON balances_v2(utxo_tx_hash,utxo_vout,asset_id) WHERE utxo_tx_hash IS NOT NULL;
CREATE INDEX idx_bal2_asset_quantity ON balances_v2(asset_id,CAST(quantity AS INTEGER) DESC);
`;

// The application resolves the address string once, then binds its integer id here. All decoding happens
// outside the limited page, avoiding the decoded-view full scan seen in Counterparty Core PR #3450.
export const COMPACT_SENDS_BY_ADDRESS_SQL = `WITH page AS (
  SELECT * FROM sends_v2 WHERE source_id=?1 OR destination_id=?1
  ORDER BY block_index DESC,event_index DESC LIMIT ?2 OFFSET ?3
)
SELECT CASE WHEN tx.tx_hash IS NULL THEN NULL ELSE LOWER(HEX(tx.tx_hash)) END tx_hash,
       page.block_index,page.block_time,src.address source,dst.address destination,assets.asset,
       page.quantity_normalized,page.send_type,page.status
FROM page
LEFT JOIN transactions_v2 tx ON tx.tx_index=page.tx_index
LEFT JOIN address_dictionary src ON src.address_id=page.source_id
LEFT JOIN address_dictionary dst ON dst.address_id=page.destination_id
LEFT JOIN asset_dictionary assets ON assets.asset_id=page.asset_id
ORDER BY page.block_index DESC,page.event_index DESC`;

export const COMPACT_BALANCES_BY_ADDRESS_SQL = `WITH page AS (
  SELECT asset_id,quantity,quantity_normalized FROM balances_v2
  WHERE address_id=?1 AND CAST(quantity AS INTEGER)>0
  ORDER BY asset_id LIMIT ?2 OFFSET ?3
)
SELECT assets.asset,page.quantity,page.quantity_normalized
FROM page JOIN asset_dictionary assets ON assets.asset_id=page.asset_id
ORDER BY page.asset_id`;
