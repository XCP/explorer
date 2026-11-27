-- Keep ingestion and rollback invalidations in the same transaction as their inputs.
-- kind 0 is a directed address flow, 1 an address/asset membership (both directions),
-- and 2 an address whose outbound eligibility changed. An epoch freezes a work list.
CREATE TABLE graph_dirty_pairs (
  epoch INTEGER NOT NULL, kind INTEGER NOT NULL, a INTEGER NOT NULL, b INTEGER NOT NULL,
  PRIMARY KEY(epoch,kind,a,b)
) WITHOUT ROWID;
INSERT INTO core_state(key,value) VALUES ('graph_queue_epoch','1');
CREATE VIEW graph_pair_event AS SELECT kind,a,b FROM graph_dirty_pairs WHERE 0;
CREATE TRIGGER graph_pair_enqueue INSTEAD OF INSERT ON graph_pair_event
WHEN NEW.a IS NOT NULL AND NEW.b IS NOT NULL AND (NEW.kind<>0 OR NEW.a<>NEW.b) BEGIN
  INSERT INTO graph_dirty_pairs(epoch,kind,a,b)
  VALUES ((SELECT CAST(value AS INTEGER) FROM core_state WHERE key='graph_queue_epoch'),NEW.kind,NEW.a,NEW.b)
  ON CONFLICT(epoch,kind,a,b) DO NOTHING;
END;

-- Freeze the visible baseline when cutting over an unfinished source-range comparison.
-- A later revision must never publish a prefix of that discarded comparison.
INSERT INTO core_state(key,value)
SELECT 'graph_abandoned_revision',value FROM core_state WHERE key='graph_diff_revision'
AND CAST(value AS INTEGER)>COALESCE((SELECT CAST(value AS INTEGER) FROM core_state WHERE key='graph_edge_revision'),0)
AND (SELECT value FROM core_state WHERE key='graph_phase')='diff';
DROP VIEW published_graph_edges;
CREATE VIEW published_graph_edges AS
SELECT generation,source_entity_id,destination_entity_id,
  CASE WHEN revision<=published AND revision<>abandoned THEN next_weight ELSE weight END AS weight,
  CASE WHEN revision<=published AND revision<>abandoned THEN next_edge_block ELSE edge_block END AS edge_block
FROM graph_edges CROSS JOIN (SELECT
  COALESCE((SELECT CAST(value AS INTEGER) FROM core_state WHERE key='graph_edge_revision'),0) AS published,
  COALESCE((SELECT CAST(value AS INTEGER) FROM core_state WHERE key='graph_abandoned_revision'),-1) AS abandoned)
WHERE CASE WHEN revision<=published AND revision<>abandoned THEN next_weight ELSE weight END>0;

CREATE TRIGGER graph_dirty_sends_insert AFTER INSERT ON sends BEGIN
  INSERT INTO graph_pair_event(kind,a,b) VALUES(0,NEW.source_id,NEW.destination_id);
END;
CREATE TRIGGER graph_dirty_sends_delete AFTER DELETE ON sends BEGIN
  INSERT INTO graph_pair_event(kind,a,b) VALUES(0,OLD.source_id,OLD.destination_id);
END;
CREATE TRIGGER graph_dirty_sends_update AFTER UPDATE OF source_id,destination_id,block_index ON sends
WHEN OLD.source_id IS NOT NEW.source_id OR OLD.destination_id IS NOT NEW.destination_id OR OLD.block_index IS NOT NEW.block_index BEGIN
  INSERT INTO graph_pair_event(kind,a,b) VALUES(0,OLD.source_id,OLD.destination_id);
  INSERT INTO graph_pair_event(kind,a,b) VALUES(0,NEW.source_id,NEW.destination_id);
END;

CREATE TRIGGER graph_dirty_order_matches_insert AFTER INSERT ON order_matches BEGIN
  INSERT INTO graph_pair_event(kind,a,b) VALUES(0,NEW.tx0_address_id,NEW.tx1_address_id),(0,NEW.tx1_address_id,NEW.tx0_address_id);
END;
CREATE TRIGGER graph_dirty_order_matches_delete AFTER DELETE ON order_matches BEGIN
  INSERT INTO graph_pair_event(kind,a,b) VALUES(0,OLD.tx0_address_id,OLD.tx1_address_id),(0,OLD.tx1_address_id,OLD.tx0_address_id);
END;
CREATE TRIGGER graph_dirty_order_matches_update AFTER UPDATE OF tx0_address_id,tx1_address_id,block_index ON order_matches
WHEN OLD.tx0_address_id IS NOT NEW.tx0_address_id OR OLD.tx1_address_id IS NOT NEW.tx1_address_id OR OLD.block_index IS NOT NEW.block_index BEGIN
  INSERT INTO graph_pair_event(kind,a,b) VALUES(0,OLD.tx0_address_id,OLD.tx1_address_id),(0,OLD.tx1_address_id,OLD.tx0_address_id);
  INSERT INTO graph_pair_event(kind,a,b) VALUES(0,NEW.tx0_address_id,NEW.tx1_address_id),(0,NEW.tx1_address_id,NEW.tx0_address_id);
END;

CREATE TRIGGER graph_dirty_dispenses_insert AFTER INSERT ON dispenses BEGIN
  INSERT INTO graph_pair_event(kind,a,b) VALUES(0,NEW.destination_id,COALESCE((SELECT origin_id FROM dispensers WHERE tx_index=NEW.dispenser_tx_index),NEW.source_id));
END;
CREATE TRIGGER graph_dirty_dispenses_delete AFTER DELETE ON dispenses BEGIN
  INSERT INTO graph_pair_event(kind,a,b) VALUES(0,OLD.destination_id,COALESCE((SELECT origin_id FROM dispensers WHERE tx_index=OLD.dispenser_tx_index),OLD.source_id));
END;
CREATE TRIGGER graph_dirty_dispenses_update AFTER UPDATE OF source_id,destination_id,dispenser_tx_index,block_index ON dispenses
WHEN OLD.source_id IS NOT NEW.source_id OR OLD.destination_id IS NOT NEW.destination_id OR OLD.dispenser_tx_index IS NOT NEW.dispenser_tx_index OR OLD.block_index IS NOT NEW.block_index BEGIN
  INSERT INTO graph_pair_event(kind,a,b) VALUES(0,OLD.destination_id,COALESCE((SELECT origin_id FROM dispensers WHERE tx_index=OLD.dispenser_tx_index),OLD.source_id));
  INSERT INTO graph_pair_event(kind,a,b) VALUES(0,NEW.destination_id,COALESCE((SELECT origin_id FROM dispensers WHERE tx_index=NEW.dispenser_tx_index),NEW.source_id));
END;

CREATE TRIGGER graph_dirty_dispensers_insert AFTER INSERT ON dispensers BEGIN
  INSERT INTO graph_pair_event(kind,a,b) VALUES(0,NEW.origin_id,NEW.source_id);
  INSERT INTO graph_pair_event(kind,a,b) SELECT DISTINCT 0,destination_id,COALESCE(NEW.origin_id,source_id) FROM dispenses WHERE dispenser_tx_index=NEW.tx_index;
  INSERT INTO graph_pair_event(kind,a,b) SELECT DISTINCT 0,destination_id,source_id FROM dispenses WHERE dispenser_tx_index=NEW.tx_index;
END;
CREATE TRIGGER graph_dirty_dispensers_delete AFTER DELETE ON dispensers BEGIN
  INSERT INTO graph_pair_event(kind,a,b) VALUES(0,OLD.origin_id,OLD.source_id);
  INSERT INTO graph_pair_event(kind,a,b) SELECT DISTINCT 0,destination_id,COALESCE(OLD.origin_id,source_id) FROM dispenses WHERE dispenser_tx_index=OLD.tx_index;
  INSERT INTO graph_pair_event(kind,a,b) SELECT DISTINCT 0,destination_id,source_id FROM dispenses WHERE dispenser_tx_index=OLD.tx_index;
END;
CREATE TRIGGER graph_dirty_dispensers_update AFTER UPDATE OF tx_index,source_id,origin_id ON dispensers
WHEN OLD.tx_index IS NOT NEW.tx_index OR OLD.source_id IS NOT NEW.source_id OR OLD.origin_id IS NOT NEW.origin_id BEGIN
  INSERT INTO graph_pair_event(kind,a,b) VALUES(0,OLD.origin_id,OLD.source_id);
  INSERT INTO graph_pair_event(kind,a,b) SELECT DISTINCT 0,destination_id,COALESCE(OLD.origin_id,source_id) FROM dispenses WHERE dispenser_tx_index=OLD.tx_index;
  INSERT INTO graph_pair_event(kind,a,b) SELECT DISTINCT 0,destination_id,source_id FROM dispenses WHERE dispenser_tx_index=OLD.tx_index;
  INSERT INTO graph_pair_event(kind,a,b) VALUES(0,NEW.origin_id,NEW.source_id);
  INSERT INTO graph_pair_event(kind,a,b) SELECT DISTINCT 0,destination_id,COALESCE(NEW.origin_id,source_id) FROM dispenses WHERE dispenser_tx_index=NEW.tx_index;
  INSERT INTO graph_pair_event(kind,a,b) SELECT DISTINCT 0,destination_id,source_id FROM dispenses WHERE dispenser_tx_index=NEW.tx_index;
END;

CREATE TRIGGER graph_dirty_assets_insert AFTER INSERT ON assets BEGIN
  INSERT INTO graph_pair_event(kind,a,b) VALUES(1,NEW.issuer_id,NEW.asset_id);
END;
CREATE TRIGGER graph_dirty_assets_delete AFTER DELETE ON assets BEGIN
  INSERT INTO graph_pair_event(kind,a,b) VALUES(1,OLD.issuer_id,OLD.asset_id);
END;
CREATE TRIGGER graph_dirty_assets_update AFTER UPDATE OF asset_id,issuer_id ON assets
WHEN OLD.asset_id IS NOT NEW.asset_id OR OLD.issuer_id IS NOT NEW.issuer_id BEGIN
  INSERT INTO graph_pair_event(kind,a,b) VALUES(1,OLD.issuer_id,OLD.asset_id);
  INSERT INTO graph_pair_event(kind,a,b) VALUES(1,NEW.issuer_id,NEW.asset_id);
END;

CREATE TRIGGER graph_dirty_balances_insert AFTER INSERT ON balances
WHEN ((SELECT value FROM core_state WHERE key='graph_bipartite')='1'
  OR EXISTS(SELECT 1 FROM core_state WHERE key='graph_holder_end')) AND CAST(NEW.quantity AS INTEGER)>0 BEGIN
  INSERT INTO graph_pair_event(kind,a,b) SELECT 1,NEW.address_id,NEW.asset_id WHERE CAST(NEW.quantity AS INTEGER)>0;
END;
CREATE TRIGGER graph_dirty_balances_delete AFTER DELETE ON balances
WHEN ((SELECT value FROM core_state WHERE key='graph_bipartite')='1'
  OR EXISTS(SELECT 1 FROM core_state WHERE key='graph_holder_end')) AND CAST(OLD.quantity AS INTEGER)>0 BEGIN
  INSERT INTO graph_pair_event(kind,a,b) SELECT 1,OLD.address_id,OLD.asset_id WHERE CAST(OLD.quantity AS INTEGER)>0;
END;
CREATE TRIGGER graph_dirty_balances_update AFTER UPDATE OF address_id,asset_id,quantity ON balances
WHEN ((SELECT value FROM core_state WHERE key='graph_bipartite')='1'
  OR EXISTS(SELECT 1 FROM core_state WHERE key='graph_holder_end')) AND (OLD.address_id IS NOT NEW.address_id OR OLD.asset_id IS NOT NEW.asset_id OR (CAST(OLD.quantity AS INTEGER)>0)<>(CAST(NEW.quantity AS INTEGER)>0)) BEGIN
  INSERT INTO graph_pair_event(kind,a,b) SELECT 1,OLD.address_id,OLD.asset_id WHERE CAST(OLD.quantity AS INTEGER)>0;
  INSERT INTO graph_pair_event(kind,a,b) SELECT 1,NEW.address_id,NEW.asset_id WHERE CAST(NEW.quantity AS INTEGER)>0;
END;

CREATE TRIGGER graph_dirty_address_signals_insert AFTER INSERT ON address_signals
WHEN (NEW.is_exchange=1 OR NEW.is_burn=1 OR NEW.is_deposit=1 OR NEW.is_emblem_vault=1) BEGIN
  INSERT INTO graph_pair_event(kind,a,b) VALUES(2,NEW.address_id,0);
END;
CREATE TRIGGER graph_dirty_address_signals_delete AFTER DELETE ON address_signals
WHEN (OLD.is_exchange=1 OR OLD.is_burn=1 OR OLD.is_deposit=1 OR OLD.is_emblem_vault=1) BEGIN
  INSERT INTO graph_pair_event(kind,a,b) VALUES(2,OLD.address_id,0);
END;
CREATE TRIGGER graph_dirty_address_signals_update AFTER UPDATE OF is_exchange,is_burn,is_deposit,is_emblem_vault ON address_signals
WHEN (NEW.is_exchange=1 OR NEW.is_burn=1 OR NEW.is_deposit=1 OR NEW.is_emblem_vault=1)<>(OLD.is_exchange=1 OR OLD.is_burn=1 OR OLD.is_deposit=1 OR OLD.is_emblem_vault=1) BEGIN
  INSERT INTO graph_pair_event(kind,a,b) VALUES(2,OLD.address_id,0);
  INSERT INTO graph_pair_event(kind,a,b) VALUES(2,NEW.address_id,0);
END;

CREATE TRIGGER graph_dirty_curated_insert AFTER INSERT ON curated BEGIN
  INSERT INTO graph_pair_event(kind,a,b) SELECT 2,address_id,0 FROM address_dictionary WHERE address=NEW.key AND NEW.kind IN ('exchange','burn');
END;
CREATE TRIGGER graph_dirty_curated_delete AFTER DELETE ON curated BEGIN
  INSERT INTO graph_pair_event(kind,a,b) SELECT 2,address_id,0 FROM address_dictionary WHERE address=OLD.key AND OLD.kind IN ('exchange','burn');
END;
CREATE TRIGGER graph_dirty_curated_update AFTER UPDATE OF key,kind ON curated
WHEN OLD.key IS NOT NEW.key OR OLD.kind IS NOT NEW.kind BEGIN
  INSERT INTO graph_pair_event(kind,a,b) SELECT 2,address_id,0 FROM address_dictionary WHERE address=OLD.key AND OLD.kind IN ('exchange','burn');
  INSERT INTO graph_pair_event(kind,a,b) SELECT 2,address_id,0 FROM address_dictionary WHERE address=NEW.key AND NEW.kind IN ('exchange','burn');
END;

-- Only the window before change capture needs historical event discovery.
INSERT INTO core_state(key,value) SELECT 'graph_capture_tip',COALESCE(MAX(block_index),0) FROM blocks;
INSERT INTO core_state(key,value) SELECT 'graph_catchup_cursor',value FROM core_state WHERE key='graph_edges_built_block';
