-- One marketplace fulfillment log can sell multiple vault tokens. Preserve each token sale.
DROP INDEX idx_emblem_sales_token;

ALTER TABLE emblem_sales
RENAME TO emblem_sales_previous;

CREATE TABLE emblem_sales (
  tx_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  contract_id INTEGER NOT NULL,
  token_id TEXT NOT NULL,
  price_raw TEXT,
  token_address_id INTEGER,
  marketplace TEXT,
  buyer_id INTEGER,
  seller_id INTEGER,
  block_number INTEGER,
  PRIMARY KEY (tx_hash, log_index, contract_id, token_id)
);

INSERT INTO
  emblem_sales (tx_hash, log_index, contract_id, token_id, price_raw, token_address_id, marketplace, buyer_id, seller_id, block_number)
SELECT
  tx_hash,
  log_index,
  contract_id,
  token_id,
  price_raw,
  token_address_id,
  marketplace,
  buyer_id,
  seller_id,
  block_number
FROM
  emblem_sales_previous
WHERE
  contract_id IS NOT NULL
  AND token_id IS NOT NULL;

DROP TABLE emblem_sales_previous;

CREATE INDEX idx_emblem_sales_token ON emblem_sales (contract_id, token_id, block_number DESC);
