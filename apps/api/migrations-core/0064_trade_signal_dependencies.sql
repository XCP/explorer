-- Trade-derived asset signals converge from every trade mutation, including external venue reconciliation.
CREATE TABLE asset_signal_dirty (
  asset_id INTEGER PRIMARY KEY
);

CREATE TRIGGER asset_signal_dirty_trade_insert AFTER INSERT ON trades
WHEN NEW.asset_id IS NOT NULL BEGIN
  INSERT OR IGNORE INTO asset_signal_dirty(asset_id) VALUES(NEW.asset_id);
END;

CREATE TRIGGER asset_signal_dirty_trade_update AFTER UPDATE ON trades
WHEN OLD.asset_id IS NOT NEW.asset_id OR OLD.block_time IS NOT NEW.block_time
  OR OLD.total IS NOT NEW.total OR OLD.usd_value IS NOT NEW.usd_value
  OR OLD.buyer_id IS NOT NEW.buyer_id OR OLD.seller_id IS NOT NEW.seller_id
  OR OLD.sale_class IS NOT NEW.sale_class BEGIN
  INSERT OR IGNORE INTO asset_signal_dirty(asset_id) SELECT OLD.asset_id WHERE OLD.asset_id IS NOT NULL;
  INSERT OR IGNORE INTO asset_signal_dirty(asset_id) SELECT NEW.asset_id WHERE NEW.asset_id IS NOT NULL;
END;

CREATE TRIGGER asset_signal_dirty_trade_delete AFTER DELETE ON trades
WHEN OLD.asset_id IS NOT NULL BEGIN
  INSERT OR IGNORE INTO asset_signal_dirty(asset_id) VALUES(OLD.asset_id);
END;

-- Vault dump classification changes the sale contract just like contents/crack changes do.
DROP TRIGGER emblem_trade_dirty_vault_update;
CREATE TRIGGER emblem_trade_dirty_vault_update
AFTER UPDATE OF btc_address_id,contents_asset_id,contents_qty,vault_kind,cracked_at,is_scam_shell,is_dump ON emblem_vaults
WHEN OLD.btc_address_id IS NOT NEW.btc_address_id
  OR OLD.contents_asset_id IS NOT NEW.contents_asset_id
  OR OLD.contents_qty IS NOT NEW.contents_qty
  OR OLD.vault_kind IS NOT NEW.vault_kind
  OR OLD.cracked_at IS NOT NEW.cracked_at
  OR OLD.is_scam_shell IS NOT NEW.is_scam_shell
  OR OLD.is_dump IS NOT NEW.is_dump BEGIN
  INSERT OR IGNORE INTO emblem_trade_dirty(contract_id,token_id)
  VALUES(NEW.contract_id,NEW.token_id);
END;

-- Reconcile already-classified dump sales under the corrected contract.
INSERT OR IGNORE INTO emblem_trade_dirty(contract_id,token_id)
SELECT contract_id,token_id FROM emblem_vaults WHERE is_dump=1;
