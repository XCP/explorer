-- Reconcile Emblem trades only when their sale, timestamp, or vault classification
-- changes. Seed every historical sale identity once, then converge to an empty queue.
CREATE TABLE emblem_trade_dirty (
  contract_id INTEGER NOT NULL,
  token_id TEXT NOT NULL,
  PRIMARY KEY(contract_id,token_id)
);

INSERT OR IGNORE INTO emblem_trade_dirty(contract_id,token_id)
SELECT contract_id,token_id FROM emblem_sales;

CREATE TRIGGER emblem_trade_dirty_sale_insert AFTER INSERT ON emblem_sales BEGIN
  INSERT OR IGNORE INTO emblem_trade_dirty(contract_id,token_id)
  VALUES(NEW.contract_id,NEW.token_id);
END;

CREATE TRIGGER emblem_trade_dirty_sale_update AFTER UPDATE ON emblem_sales BEGIN
  INSERT OR IGNORE INTO emblem_trade_dirty(contract_id,token_id)
  VALUES(OLD.contract_id,OLD.token_id),(NEW.contract_id,NEW.token_id);
END;

CREATE TRIGGER emblem_trade_sale_delete AFTER DELETE ON emblem_sales BEGIN
  DELETE FROM trades
   WHERE venue='emblem'
     AND ref=OLD.tx_hash || '_' || OLD.log_index || '_' ||
       (SELECT address FROM address_dictionary WHERE address_id=OLD.contract_id) || '_' || OLD.token_id;
END;

CREATE TRIGGER emblem_trade_dirty_vault_update
AFTER UPDATE OF btc_address_id,contents_asset_id,contents_qty,vault_kind,cracked_at,is_scam_shell ON emblem_vaults
WHEN OLD.btc_address_id IS NOT NEW.btc_address_id
  OR OLD.contents_asset_id IS NOT NEW.contents_asset_id
  OR OLD.contents_qty IS NOT NEW.contents_qty
  OR OLD.vault_kind IS NOT NEW.vault_kind
  OR OLD.cracked_at IS NOT NEW.cracked_at
  OR OLD.is_scam_shell IS NOT NEW.is_scam_shell BEGIN
  INSERT OR IGNORE INTO emblem_trade_dirty(contract_id,token_id)
  VALUES(NEW.contract_id,NEW.token_id);
END;

CREATE TRIGGER emblem_trade_dirty_block_insert AFTER INSERT ON ethereum_blocks BEGIN
  INSERT OR IGNORE INTO emblem_trade_dirty(contract_id,token_id)
  SELECT contract_id,token_id FROM emblem_sales WHERE block_number=NEW.block_number;
END;

CREATE TRIGGER emblem_trade_dirty_block_update AFTER UPDATE OF block_time ON ethereum_blocks
WHEN OLD.block_time IS NOT NEW.block_time BEGIN
  INSERT OR IGNORE INTO emblem_trade_dirty(contract_id,token_id)
  SELECT contract_id,token_id FROM emblem_sales WHERE block_number=NEW.block_number;
END;

DELETE FROM core_state WHERE key='trades_emblem_reconcile_cursor';
