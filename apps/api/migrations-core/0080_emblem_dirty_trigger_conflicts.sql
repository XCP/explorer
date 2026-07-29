-- SQLite strips a trigger body's OR IGNORE whenever the FIRING statement carries its own ON
-- CONFLICT clause: the dirty-queue inserts then run with the outer policy and ABORT on their
-- primary key, failing the whole outer statement. emblem_sales and ethereum_blocks are written as
-- upserts on every crawl overlap (overlap is by design — it is the dedupe), so the Emblem sales
-- and transfer crawls have failed on every re-seen sale since these triggers landed. Rebuild every
-- emblem_trade_dirty trigger with conflict-free bodies — single-row inserts guarded by NOT EXISTS,
-- DISTINCT for the multi-row block sweeps — which no outer conflict policy can subvert.

DROP TRIGGER emblem_trade_dirty_sale_insert;
CREATE TRIGGER emblem_trade_dirty_sale_insert AFTER INSERT ON emblem_sales BEGIN
  INSERT INTO emblem_trade_dirty(contract_id,token_id)
  SELECT NEW.contract_id,NEW.token_id
   WHERE NOT EXISTS (SELECT 1 FROM emblem_trade_dirty
                      WHERE contract_id=NEW.contract_id AND token_id=NEW.token_id);
END;

DROP TRIGGER emblem_trade_dirty_sale_update;
CREATE TRIGGER emblem_trade_dirty_sale_update AFTER UPDATE ON emblem_sales BEGIN
  INSERT INTO emblem_trade_dirty(contract_id,token_id)
  SELECT NEW.contract_id,NEW.token_id
   WHERE NOT EXISTS (SELECT 1 FROM emblem_trade_dirty
                      WHERE contract_id=NEW.contract_id AND token_id=NEW.token_id);
  INSERT INTO emblem_trade_dirty(contract_id,token_id)
  SELECT OLD.contract_id,OLD.token_id
   WHERE (OLD.contract_id IS NOT NEW.contract_id OR OLD.token_id IS NOT NEW.token_id)
     AND NOT EXISTS (SELECT 1 FROM emblem_trade_dirty
                      WHERE contract_id=OLD.contract_id AND token_id=OLD.token_id);
END;

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
  INSERT INTO emblem_trade_dirty(contract_id,token_id)
  SELECT NEW.contract_id,NEW.token_id
   WHERE NOT EXISTS (SELECT 1 FROM emblem_trade_dirty
                      WHERE contract_id=NEW.contract_id AND token_id=NEW.token_id);
END;

DROP TRIGGER emblem_trade_dirty_block_insert;
CREATE TRIGGER emblem_trade_dirty_block_insert AFTER INSERT ON ethereum_blocks BEGIN
  INSERT INTO emblem_trade_dirty(contract_id,token_id)
  SELECT DISTINCT sale.contract_id,sale.token_id FROM emblem_sales sale
   WHERE sale.block_number=NEW.block_number
     AND NOT EXISTS (SELECT 1 FROM emblem_trade_dirty queued
                      WHERE queued.contract_id=sale.contract_id AND queued.token_id=sale.token_id);
END;

DROP TRIGGER emblem_trade_dirty_block_update;
CREATE TRIGGER emblem_trade_dirty_block_update AFTER UPDATE OF block_time ON ethereum_blocks
WHEN OLD.block_time IS NOT NEW.block_time BEGIN
  INSERT INTO emblem_trade_dirty(contract_id,token_id)
  SELECT DISTINCT sale.contract_id,sale.token_id FROM emblem_sales sale
   WHERE sale.block_number=NEW.block_number
     AND NOT EXISTS (SELECT 1 FROM emblem_trade_dirty queued
                      WHERE queued.contract_id=sale.contract_id AND queued.token_id=sale.token_id);
END;
