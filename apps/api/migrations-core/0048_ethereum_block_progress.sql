-- Exact O(1) progress for authoritative Ethereum block timestamps.
INSERT OR REPLACE INTO core_state(key,value)
SELECT 'ethereum_block_times_total',CAST(COUNT(DISTINCT block_number) AS TEXT)
FROM emblem_sales WHERE block_number IS NOT NULL;

INSERT OR REPLACE INTO core_state(key,value)
SELECT 'ethereum_block_times_remaining',CAST(COUNT(*) AS TEXT) FROM (
  SELECT DISTINCT sale.block_number FROM emblem_sales sale
  LEFT JOIN ethereum_blocks block ON block.block_number=sale.block_number
  WHERE sale.block_number IS NOT NULL AND block.block_number IS NULL
);

CREATE TRIGGER ethereum_progress_sale_insert AFTER INSERT ON emblem_sales
WHEN NEW.block_number IS NOT NULL AND
  (SELECT COUNT(*) FROM emblem_sales WHERE block_number=NEW.block_number)=1 BEGIN
  UPDATE core_state SET value=CAST(CAST(value AS INTEGER)+1 AS TEXT)
  WHERE key='ethereum_block_times_total';
  UPDATE core_state SET value=CAST(CAST(value AS INTEGER)+
    CASE WHEN EXISTS(SELECT 1 FROM ethereum_blocks WHERE block_number=NEW.block_number) THEN 0 ELSE 1 END AS TEXT)
  WHERE key='ethereum_block_times_remaining';
END;

CREATE TRIGGER ethereum_progress_sale_delete AFTER DELETE ON emblem_sales
WHEN OLD.block_number IS NOT NULL AND
  NOT EXISTS(SELECT 1 FROM emblem_sales WHERE block_number=OLD.block_number) BEGIN
  UPDATE core_state SET value=CAST(MAX(0,CAST(value AS INTEGER)-1) AS TEXT)
  WHERE key='ethereum_block_times_total';
  UPDATE core_state SET value=CAST(MAX(0,CAST(value AS INTEGER)-
    CASE WHEN EXISTS(SELECT 1 FROM ethereum_blocks WHERE block_number=OLD.block_number) THEN 0 ELSE 1 END) AS TEXT)
  WHERE key='ethereum_block_times_remaining';
END;

CREATE TRIGGER ethereum_progress_sale_update_old AFTER UPDATE OF block_number ON emblem_sales
WHEN OLD.block_number IS NOT NEW.block_number AND OLD.block_number IS NOT NULL AND
  NOT EXISTS(SELECT 1 FROM emblem_sales WHERE block_number=OLD.block_number) BEGIN
  UPDATE core_state SET value=CAST(MAX(0,CAST(value AS INTEGER)-1) AS TEXT)
  WHERE key='ethereum_block_times_total';
  UPDATE core_state SET value=CAST(MAX(0,CAST(value AS INTEGER)-
    CASE WHEN EXISTS(SELECT 1 FROM ethereum_blocks WHERE block_number=OLD.block_number) THEN 0 ELSE 1 END) AS TEXT)
  WHERE key='ethereum_block_times_remaining';
END;

CREATE TRIGGER ethereum_progress_sale_update_new AFTER UPDATE OF block_number ON emblem_sales
WHEN OLD.block_number IS NOT NEW.block_number AND NEW.block_number IS NOT NULL AND
  (SELECT COUNT(*) FROM emblem_sales WHERE block_number=NEW.block_number)=1 BEGIN
  UPDATE core_state SET value=CAST(CAST(value AS INTEGER)+1 AS TEXT)
  WHERE key='ethereum_block_times_total';
  UPDATE core_state SET value=CAST(CAST(value AS INTEGER)+
    CASE WHEN EXISTS(SELECT 1 FROM ethereum_blocks WHERE block_number=NEW.block_number) THEN 0 ELSE 1 END AS TEXT)
  WHERE key='ethereum_block_times_remaining';
END;

CREATE TRIGGER ethereum_progress_block_insert AFTER INSERT ON ethereum_blocks
WHEN EXISTS(SELECT 1 FROM emblem_sales WHERE block_number=NEW.block_number) BEGIN
  UPDATE core_state SET value=CAST(MAX(0,CAST(value AS INTEGER)-1) AS TEXT)
  WHERE key='ethereum_block_times_remaining';
END;

CREATE TRIGGER ethereum_progress_block_delete AFTER DELETE ON ethereum_blocks
WHEN EXISTS(SELECT 1 FROM emblem_sales WHERE block_number=OLD.block_number) BEGIN
  UPDATE core_state SET value=CAST(CAST(value AS INTEGER)+1 AS TEXT)
  WHERE key='ethereum_block_times_remaining';
END;
