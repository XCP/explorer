-- Ethereum token identity is contract + token_id. A token number alone is not globally unique.
DROP INDEX idx_emblem_vaults_btc_address;

DROP INDEX idx_emblem_vaults_asset;

DROP INDEX idx_emblem_vaults_recent;

DROP INDEX idx_emblem_vaults_unresolved;

DROP INDEX idx_emblem_vaults_meta_queue;

ALTER TABLE emblem_vaults
RENAME TO emblem_vaults_previous;

CREATE TABLE emblem_vaults (
  contract_id INTEGER NOT NULL,
  token_id TEXT NOT NULL,
  btc_address_id INTEGER,
  resolved INTEGER NOT NULL DEFAULT 0,
  first_seen INTEGER,
  contents_asset_id INTEGER,
  contents_qty REAL,
  vault_kind TEXT,
  funded INTEGER NOT NULL DEFAULT 0,
  cracked_at INTEGER,
  cracker_address_id INTEGER,
  classified INTEGER NOT NULL DEFAULT 0,
  claimed_name TEXT,
  claimed_asset_id INTEGER,
  content_coins TEXT,
  has_contents INTEGER,
  emblem_fraud INTEGER,
  meta_crawled INTEGER NOT NULL DEFAULT 0,
  is_scam_shell INTEGER NOT NULL DEFAULT 0,
  is_dump INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (contract_id, token_id)
);

INSERT INTO
  emblem_vaults (
    contract_id,
    token_id,
    btc_address_id,
    resolved,
    first_seen,
    contents_asset_id,
    contents_qty,
    vault_kind,
    funded,
    cracked_at,
    cracker_address_id,
    classified,
    claimed_name,
    claimed_asset_id,
    content_coins,
    has_contents,
    emblem_fraud,
    meta_crawled,
    is_scam_shell,
    is_dump
  )
SELECT
  contract_id,
  token_id,
  btc_address_id,
  resolved,
  first_seen,
  contents_asset_id,
  contents_qty,
  vault_kind,
  funded,
  cracked_at,
  cracker_address_id,
  classified,
  claimed_name,
  claimed_asset_id,
  content_coins,
  has_contents,
  emblem_fraud,
  meta_crawled,
  is_scam_shell,
  is_dump
FROM
  emblem_vaults_previous
WHERE
  contract_id IS NOT NULL;

DROP TABLE emblem_vaults_previous;

CREATE INDEX idx_emblem_vaults_btc_address ON emblem_vaults (btc_address_id);

CREATE INDEX idx_emblem_vaults_asset ON emblem_vaults (contents_asset_id);

CREATE INDEX idx_emblem_vaults_recent ON emblem_vaults (first_seen DESC, contract_id, token_id DESC);

CREATE INDEX idx_emblem_vaults_unresolved ON emblem_vaults (resolved, contract_id, token_id)
WHERE
  resolved = 0;

CREATE INDEX idx_emblem_vaults_meta_queue ON emblem_vaults (meta_crawled, vault_kind, contract_id, token_id)
WHERE
  meta_crawled = 0;

-- Re-enumerate every contract so rows previously collapsed by token_id are recovered.
UPDATE core_state
SET
  value = '0'
WHERE
  KEY = 'emblem_contract_idx';

DELETE FROM core_state
WHERE
  KEY LIKE 'emblem_cur_%';

INSERT INTO
  core_state (KEY, value)
VALUES
  ('vault_contents_cursor', '0')
ON CONFLICT (KEY) DO UPDATE
SET
  value = '0';
