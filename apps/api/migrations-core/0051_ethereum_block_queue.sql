-- Materialize the finite set of Emblem sale blocks still missing an authoritative
-- timestamp. The backfill can now read 500 queue keys instead of rediscovering
-- them by joining and deduplicating the full sale history on every cron run.
CREATE TABLE ethereum_block_queue (
  block_number INTEGER PRIMARY KEY
);

INSERT INTO ethereum_block_queue(block_number)
SELECT DISTINCT sale.block_number
FROM emblem_sales sale LEFT JOIN ethereum_blocks block
  ON block.block_number=sale.block_number
WHERE sale.block_number IS NOT NULL AND block.block_number IS NULL;

CREATE TRIGGER ethereum_queue_sale_insert AFTER INSERT ON emblem_sales
WHEN NEW.block_number IS NOT NULL AND
  NOT EXISTS(SELECT 1 FROM ethereum_blocks WHERE block_number=NEW.block_number) BEGIN
  INSERT OR IGNORE INTO ethereum_block_queue(block_number) VALUES(NEW.block_number);
END;

CREATE TRIGGER ethereum_queue_sale_delete AFTER DELETE ON emblem_sales
WHEN OLD.block_number IS NOT NULL AND
  NOT EXISTS(SELECT 1 FROM emblem_sales WHERE block_number=OLD.block_number) BEGIN
  DELETE FROM ethereum_block_queue WHERE block_number=OLD.block_number;
END;

CREATE TRIGGER ethereum_queue_sale_update_old AFTER UPDATE OF block_number ON emblem_sales
WHEN OLD.block_number IS NOT NEW.block_number AND OLD.block_number IS NOT NULL AND
  NOT EXISTS(SELECT 1 FROM emblem_sales WHERE block_number=OLD.block_number) BEGIN
  DELETE FROM ethereum_block_queue WHERE block_number=OLD.block_number;
END;

CREATE TRIGGER ethereum_queue_sale_update_new AFTER UPDATE OF block_number ON emblem_sales
WHEN OLD.block_number IS NOT NEW.block_number AND NEW.block_number IS NOT NULL AND
  NOT EXISTS(SELECT 1 FROM ethereum_blocks WHERE block_number=NEW.block_number) BEGIN
  INSERT OR IGNORE INTO ethereum_block_queue(block_number) VALUES(NEW.block_number);
END;

CREATE TRIGGER ethereum_queue_block_insert AFTER INSERT ON ethereum_blocks BEGIN
  DELETE FROM ethereum_block_queue WHERE block_number=NEW.block_number;
END;

CREATE TRIGGER ethereum_queue_block_delete AFTER DELETE ON ethereum_blocks
WHEN EXISTS(SELECT 1 FROM emblem_sales WHERE block_number=OLD.block_number) BEGIN
  INSERT OR IGNORE INTO ethereum_block_queue(block_number) VALUES(OLD.block_number);
END;
