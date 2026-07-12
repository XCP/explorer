/**
 * Executable schema prototype for the blue-green compact primary. It is deliberately not a numbered
 * migration: production `xcpio` must never build these tables beside 7.66 GB of live data. The same DDL
 * will seed a fresh `xcpio-core` after query coverage is complete.
 */
export const COMPACT_PRIMARY_DDL = `
CREATE TABLE address_dictionary(address_id INTEGER PRIMARY KEY,address TEXT NOT NULL UNIQUE);
CREATE TABLE asset_dictionary(asset_id INTEGER PRIMARY KEY,asset TEXT NOT NULL UNIQUE);

CREATE TABLE transactions(
  tx_index INTEGER PRIMARY KEY,tx_hash BLOB NOT NULL,block_index INTEGER NOT NULL,block_time INTEGER,
  source_id INTEGER,destination_id INTEGER,btc_amount TEXT,fee TEXT,data BLOB,supported INTEGER NOT NULL,utxos_info TEXT
);
CREATE INDEX idx_transactions_hash ON transactions(tx_hash);
CREATE INDEX idx_transactions_block ON transactions(block_index);
CREATE INDEX idx_transactions_source ON transactions(source_id,block_index DESC,tx_index DESC);
CREATE INDEX idx_transactions_destination ON transactions(destination_id,block_index DESC,tx_index DESC);

CREATE TABLE sends(
  event_index INTEGER PRIMARY KEY,tx_index INTEGER NOT NULL,tx_hash BLOB NOT NULL,block_index INTEGER NOT NULL,block_time INTEGER,
  source_id INTEGER,destination_id INTEGER,source_address_id INTEGER,destination_address_id INTEGER,
  asset_id INTEGER,quantity TEXT,quantity_normalized TEXT,memo TEXT,memo_hex TEXT,send_type TEXT,status TEXT,
  fee_paid TEXT,msg_index INTEGER NOT NULL,
  UNIQUE(tx_index,msg_index),UNIQUE(tx_hash,msg_index)
);
CREATE INDEX idx_sends_tx ON sends(tx_index);
CREATE INDEX idx_sends_block ON sends(block_index);
CREATE INDEX idx_sends_source ON sends(source_id,block_index DESC,event_index DESC);
CREATE INDEX idx_sends_destination ON sends(destination_id,block_index DESC,event_index DESC);
CREATE INDEX idx_sends_asset ON sends(asset_id,block_index DESC,event_index DESC);

CREATE TABLE balances(
  balance_id INTEGER PRIMARY KEY,address_id INTEGER,utxo_tx_hash BLOB,utxo_vout INTEGER,asset_id INTEGER NOT NULL,
  quantity TEXT NOT NULL,quantity_normalized TEXT,updated_block_index INTEGER,updated_event_index INTEGER,
  utxo_address_id INTEGER,
  holder_type TEXT GENERATED ALWAYS AS (CASE WHEN address_id IS NOT NULL THEN 'address' ELSE 'utxo' END) VIRTUAL,
  CHECK (
    (address_id IS NOT NULL AND utxo_tx_hash IS NULL AND utxo_vout IS NULL) OR
    (address_id IS NULL AND utxo_tx_hash IS NOT NULL AND utxo_vout IS NOT NULL)
  )
);
CREATE UNIQUE INDEX idx_balances_address_asset ON balances(address_id,asset_id) WHERE address_id IS NOT NULL;
CREATE UNIQUE INDEX idx_balances_utxo_asset ON balances(utxo_tx_hash,utxo_vout,asset_id) WHERE utxo_tx_hash IS NOT NULL;
CREATE INDEX idx_balances_asset_quantity ON balances(asset_id,CAST(quantity AS INTEGER) DESC);

CREATE TABLE orders(
  tx_index INTEGER PRIMARY KEY,tx_hash BLOB NOT NULL UNIQUE,block_index INTEGER NOT NULL,block_time INTEGER,
  source_id INTEGER,give_asset_id INTEGER,give_quantity TEXT,give_remaining TEXT,get_asset_id INTEGER,
  get_quantity TEXT,get_remaining TEXT,expiration INTEGER,expire_index INTEGER,fee_required TEXT,
  fee_required_remaining TEXT,fee_provided TEXT,fee_provided_remaining TEXT,status TEXT,closed_block_index INTEGER
);
CREATE INDEX idx_orders_block ON orders(block_index);
CREATE INDEX idx_orders_source ON orders(source_id,block_index DESC);
CREATE INDEX idx_orders_give ON orders(give_asset_id,status);
CREATE INDEX idx_orders_get ON orders(get_asset_id,status);

CREATE TABLE order_matches(
  tx0_index INTEGER NOT NULL,tx1_index INTEGER NOT NULL,tx0_hash BLOB NOT NULL,tx1_hash BLOB NOT NULL,
  tx0_address_id INTEGER,tx1_address_id INTEGER,forward_asset_id INTEGER,forward_quantity TEXT,
  backward_asset_id INTEGER,backward_quantity TEXT,block_index INTEGER NOT NULL,block_time INTEGER,status TEXT,
  match_expire_index INTEGER,fee_paid TEXT,tx0_block_index INTEGER,tx1_block_index INTEGER,
  tx0_expiration INTEGER,tx1_expiration INTEGER,PRIMARY KEY(tx0_index,tx1_index)
);
CREATE INDEX idx_order_matches_block ON order_matches(block_index);
CREATE INDEX idx_order_matches_tx0_address ON order_matches(tx0_address_id,block_index DESC);
CREATE INDEX idx_order_matches_tx1_address ON order_matches(tx1_address_id,block_index DESC);

CREATE TABLE issuances(
  event_index INTEGER PRIMARY KEY,tx_index INTEGER NOT NULL,tx_hash BLOB NOT NULL,msg_index INTEGER NOT NULL DEFAULT 0,
  block_index INTEGER NOT NULL,block_time INTEGER,asset_id INTEGER,asset_longname TEXT,quantity TEXT,
  quantity_normalized TEXT,source_id INTEGER,issuer_id INTEGER,transfer INTEGER NOT NULL DEFAULT 0,
  divisible INTEGER NOT NULL DEFAULT 0,locked INTEGER NOT NULL DEFAULT 0,description TEXT,fee_paid TEXT,status TEXT,
  asset_events TEXT,mime_type TEXT,reset INTEGER,callable INTEGER,call_date INTEGER,call_price TEXT,
  UNIQUE(tx_index,msg_index),UNIQUE(tx_hash,msg_index)
);
CREATE INDEX idx_issuances_block ON issuances(block_index);
CREATE INDEX idx_issuances_asset ON issuances(asset_id,block_index DESC);
CREATE INDEX idx_issuances_source ON issuances(source_id,block_index DESC);
CREATE INDEX idx_issuances_issuer ON issuances(issuer_id,block_index DESC);
`;

// The application resolves the address string once, then binds its integer id here. All decoding happens
// outside the limited page, avoiding the decoded-view full scan seen in Counterparty Core PR #3450.
export const COMPACT_SENDS_BY_ADDRESS_SQL = `WITH page AS (
  SELECT * FROM sends WHERE source_id=?1 OR destination_id=?1
  ORDER BY block_index DESC,event_index DESC LIMIT ?2 OFFSET ?3
)
SELECT LOWER(HEX(page.tx_hash)) tx_hash,
       page.block_index,page.block_time,src.address source,dst.address destination,assets.asset,
       page.quantity_normalized,page.send_type,page.status
FROM page
LEFT JOIN address_dictionary src ON src.address_id=page.source_id
LEFT JOIN address_dictionary dst ON dst.address_id=page.destination_id
LEFT JOIN asset_dictionary assets ON assets.asset_id=page.asset_id
ORDER BY page.block_index DESC,page.event_index DESC`;

export const COMPACT_BALANCES_BY_ADDRESS_SQL = `WITH page AS (
  SELECT asset_id,quantity,quantity_normalized FROM balances
  WHERE address_id=?1 AND CAST(quantity AS INTEGER)>0
  ORDER BY asset_id LIMIT ?2 OFFSET ?3
)
SELECT assets.asset,page.quantity,page.quantity_normalized
FROM page JOIN asset_dictionary assets ON assets.asset_id=page.asset_id
ORDER BY page.asset_id`;

export const COMPACT_TOTAL_BY_ASSET_SQL = `SELECT COALESCE(SUM(CAST(quantity AS INTEGER)),0) total
FROM balances WHERE asset_id=?1`;

export const ORDER_MATCH_PUBLIC_ID_SQL = `SELECT LOWER(HEX(tx0_hash))||'_'||LOWER(HEX(tx1_hash)) id
FROM order_matches WHERE tx0_index=?1 AND tx1_index=?2`;
