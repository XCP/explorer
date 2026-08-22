-- Reclassify Emblem vault contents when their relevant canonical facts change.
-- The prior continuous 61k-vault sweep remains as a slow reconciliation backstop.
CREATE TABLE emblem_vault_contents_dirty (
  contract_id INTEGER NOT NULL,
  token_id TEXT NOT NULL,
  PRIMARY KEY (contract_id, token_id)
) WITHOUT ROWID;

-- Finish any pre-migration work promptly without rewriting already-classified vaults.
INSERT INTO emblem_vault_contents_dirty(contract_id,token_id)
SELECT contract_id,token_id FROM emblem_vaults
 WHERE classified=0 AND btc_address_id IS NOT NULL;

CREATE TRIGGER emblem_vault_contents_dirty_vault_insert AFTER INSERT ON emblem_vaults BEGIN
  INSERT INTO emblem_vault_contents_dirty(contract_id,token_id)
  SELECT NEW.contract_id,NEW.token_id
   WHERE NEW.btc_address_id IS NOT NULL
     AND NOT EXISTS (
     SELECT 1 FROM emblem_vault_contents_dirty
      WHERE contract_id=NEW.contract_id AND token_id=NEW.token_id
   );
END;

CREATE TRIGGER emblem_vault_contents_dirty_vault_update
AFTER UPDATE OF btc_address_id ON emblem_vaults
WHEN OLD.btc_address_id IS NOT NEW.btc_address_id BEGIN
  DELETE FROM emblem_vault_contents_dirty
   WHERE contract_id=NEW.contract_id AND token_id=NEW.token_id;
  INSERT INTO emblem_vault_contents_dirty(contract_id,token_id)
  SELECT NEW.contract_id,NEW.token_id
   WHERE NEW.btc_address_id IS NOT NULL
     AND NOT EXISTS (
     SELECT 1 FROM emblem_vault_contents_dirty
      WHERE contract_id=NEW.contract_id AND token_id=NEW.token_id
   );
END;

CREATE TRIGGER emblem_vault_contents_dirty_vault_delete AFTER DELETE ON emblem_vaults BEGIN
  DELETE FROM emblem_vault_contents_dirty
   WHERE contract_id=OLD.contract_id AND token_id=OLD.token_id;
END;

CREATE TRIGGER emblem_vault_contents_dirty_send_insert AFTER INSERT ON sends BEGIN
  INSERT INTO emblem_vault_contents_dirty(contract_id,token_id)
  SELECT DISTINCT vault.contract_id,vault.token_id FROM emblem_vaults vault
   WHERE vault.btc_address_id IN (
     NEW.source_id,NEW.source_address_id,NEW.destination_id,NEW.destination_address_id
   )
     AND NOT EXISTS (
       SELECT 1 FROM emblem_vault_contents_dirty queued
        WHERE queued.contract_id=vault.contract_id AND queued.token_id=vault.token_id
     );
END;

CREATE TRIGGER emblem_vault_contents_dirty_send_update AFTER UPDATE ON sends
WHEN OLD.source_id IS NOT NEW.source_id
  OR OLD.source_address_id IS NOT NEW.source_address_id
  OR OLD.destination_id IS NOT NEW.destination_id
  OR OLD.destination_address_id IS NOT NEW.destination_address_id
  OR OLD.asset_id IS NOT NEW.asset_id
  OR OLD.quantity IS NOT NEW.quantity
  OR OLD.quantity_normalized IS NOT NEW.quantity_normalized
  OR OLD.block_time IS NOT NEW.block_time BEGIN
  INSERT INTO emblem_vault_contents_dirty(contract_id,token_id)
  SELECT DISTINCT vault.contract_id,vault.token_id FROM emblem_vaults vault
   WHERE vault.btc_address_id IN (
     OLD.source_id,OLD.source_address_id,OLD.destination_id,OLD.destination_address_id,
     NEW.source_id,NEW.source_address_id,NEW.destination_id,NEW.destination_address_id
   )
     AND NOT EXISTS (
       SELECT 1 FROM emblem_vault_contents_dirty queued
        WHERE queued.contract_id=vault.contract_id AND queued.token_id=vault.token_id
     );
END;

CREATE TRIGGER emblem_vault_contents_dirty_send_delete AFTER DELETE ON sends BEGIN
  INSERT INTO emblem_vault_contents_dirty(contract_id,token_id)
  SELECT DISTINCT vault.contract_id,vault.token_id FROM emblem_vaults vault
   WHERE vault.btc_address_id IN (
     OLD.source_id,OLD.source_address_id,OLD.destination_id,OLD.destination_address_id
   )
     AND NOT EXISTS (
       SELECT 1 FROM emblem_vault_contents_dirty queued
        WHERE queued.contract_id=vault.contract_id AND queued.token_id=vault.token_id
     );
END;

CREATE TRIGGER emblem_vault_contents_dirty_balance_insert AFTER INSERT ON balances
WHEN NEW.address_id IS NOT NULL BEGIN
  INSERT INTO emblem_vault_contents_dirty(contract_id,token_id)
  SELECT vault.contract_id,vault.token_id FROM emblem_vaults vault
   WHERE vault.btc_address_id=NEW.address_id
     AND NOT EXISTS (
       SELECT 1 FROM emblem_vault_contents_dirty queued
        WHERE queued.contract_id=vault.contract_id AND queued.token_id=vault.token_id
     );
END;

CREATE TRIGGER emblem_vault_contents_dirty_balance_update AFTER UPDATE ON balances
WHEN (OLD.address_id IS NOT NULL OR NEW.address_id IS NOT NULL)
 AND (OLD.address_id IS NOT NEW.address_id
   OR OLD.asset_id IS NOT NEW.asset_id
   OR OLD.quantity IS NOT NEW.quantity
   OR OLD.quantity_normalized IS NOT NEW.quantity_normalized) BEGIN
  INSERT INTO emblem_vault_contents_dirty(contract_id,token_id)
  SELECT DISTINCT vault.contract_id,vault.token_id FROM emblem_vaults vault
   WHERE vault.btc_address_id IN (OLD.address_id,NEW.address_id)
     AND NOT EXISTS (
       SELECT 1 FROM emblem_vault_contents_dirty queued
        WHERE queued.contract_id=vault.contract_id AND queued.token_id=vault.token_id
     );
END;

CREATE TRIGGER emblem_vault_contents_dirty_balance_delete AFTER DELETE ON balances
WHEN OLD.address_id IS NOT NULL BEGIN
  INSERT INTO emblem_vault_contents_dirty(contract_id,token_id)
  SELECT vault.contract_id,vault.token_id FROM emblem_vaults vault
   WHERE vault.btc_address_id=OLD.address_id
     AND NOT EXISTS (
       SELECT 1 FROM emblem_vault_contents_dirty queued
        WHERE queued.contract_id=vault.contract_id AND queued.token_id=vault.token_id
     );
END;

CREATE TRIGGER emblem_vault_contents_dirty_sweep_insert AFTER INSERT ON sweeps BEGIN
  INSERT INTO emblem_vault_contents_dirty(contract_id,token_id)
  SELECT DISTINCT vault.contract_id,vault.token_id FROM emblem_vaults vault
   WHERE vault.btc_address_id IN (NEW.source_id,NEW.destination_id)
     AND NOT EXISTS (
       SELECT 1 FROM emblem_vault_contents_dirty queued
        WHERE queued.contract_id=vault.contract_id AND queued.token_id=vault.token_id
     );
END;

CREATE TRIGGER emblem_vault_contents_dirty_sweep_update AFTER UPDATE ON sweeps
WHEN OLD.source_id IS NOT NEW.source_id
  OR OLD.destination_id IS NOT NEW.destination_id
  OR OLD.block_time IS NOT NEW.block_time BEGIN
  INSERT INTO emblem_vault_contents_dirty(contract_id,token_id)
  SELECT DISTINCT vault.contract_id,vault.token_id FROM emblem_vaults vault
   WHERE vault.btc_address_id IN (
     OLD.source_id,OLD.destination_id,NEW.source_id,NEW.destination_id
   )
     AND NOT EXISTS (
       SELECT 1 FROM emblem_vault_contents_dirty queued
        WHERE queued.contract_id=vault.contract_id AND queued.token_id=vault.token_id
     );
END;

CREATE TRIGGER emblem_vault_contents_dirty_sweep_delete AFTER DELETE ON sweeps BEGIN
  INSERT INTO emblem_vault_contents_dirty(contract_id,token_id)
  SELECT DISTINCT vault.contract_id,vault.token_id FROM emblem_vaults vault
   WHERE vault.btc_address_id IN (OLD.source_id,OLD.destination_id)
     AND NOT EXISTS (
       SELECT 1 FROM emblem_vault_contents_dirty queued
        WHERE queued.contract_id=vault.contract_id AND queued.token_id=vault.token_id
     );
END;
