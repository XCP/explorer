-- Projection identities must be derivable from canonical records, not source autoincrement rows.
-- Replay may already have inserted the canonical identity alongside an imported autoincrement identity.
-- Those pairs are byte-for-byte equivalent; retain the canonical row before rewriting the remainder.
DELETE FROM trades
WHERE rowid IN (
  SELECT imported.rowid
  FROM trades imported
  JOIN dispenses dispense ON dispense.dispense_id = CAST(imported.ref AS INTEGER)
  JOIN trades canonical
    ON canonical.venue = 'dispense'
   AND canonical.ref = CAST(dispense.event_index AS TEXT)
  WHERE imported.venue = 'dispense'
    AND imported.ref <> canonical.ref
);

UPDATE trades AS trade
SET
  ref = (
    SELECT
      CAST(dispense.event_index AS TEXT)
    FROM
      dispenses dispense
    WHERE
      dispense.dispense_id = CAST(trade.ref AS INTEGER)
  )
WHERE
  trade.venue = 'dispense'
  AND EXISTS (
    SELECT
      1
    FROM
      dispenses dispense
    WHERE
      dispense.dispense_id = CAST(trade.ref AS INTEGER)
  );

-- The previous Emblem identity omitted contract and token, collapsing bundled marketplace fulfillments.
-- Preserve an imported asset resolution when replay has already inserted the canonical sale identity.
WITH mapped AS (
  SELECT imported.rowid imported_rowid, imported.asset_id,
    (SELECT sale.tx_hash || '_' || sale.log_index || '_' || contract.address || '_' || sale.token_id
     FROM emblem_sales sale
     JOIN address_dictionary contract ON contract.address_id = sale.contract_id
     WHERE sale.tx_hash = substr(imported.ref, 1, instr(imported.ref, '_') - 1)
       AND sale.log_index = CAST(substr(imported.ref, instr(imported.ref, '_') + 1) AS INTEGER)
     ORDER BY contract.address, sale.token_id LIMIT 1) canonical_ref
  FROM trades imported WHERE imported.venue = 'emblem'
)
UPDATE trades AS canonical
SET asset_id = COALESCE(canonical.asset_id, mapped.asset_id)
FROM mapped
WHERE canonical.venue = 'emblem'
  AND canonical.ref = mapped.canonical_ref
  AND canonical.rowid <> mapped.imported_rowid;

WITH mapped AS (
  SELECT imported.rowid imported_rowid,
    (SELECT sale.tx_hash || '_' || sale.log_index || '_' || contract.address || '_' || sale.token_id
     FROM emblem_sales sale
     JOIN address_dictionary contract ON contract.address_id = sale.contract_id
     WHERE sale.tx_hash = substr(imported.ref, 1, instr(imported.ref, '_') - 1)
       AND sale.log_index = CAST(substr(imported.ref, instr(imported.ref, '_') + 1) AS INTEGER)
     ORDER BY contract.address, sale.token_id LIMIT 1) canonical_ref
  FROM trades imported WHERE imported.venue = 'emblem'
)
DELETE FROM trades
WHERE rowid IN (
  SELECT mapped.imported_rowid FROM mapped
  JOIN trades canonical ON canonical.venue = 'emblem' AND canonical.ref = mapped.canonical_ref
  WHERE canonical.rowid <> mapped.imported_rowid
);

UPDATE trades AS trade
SET
  ref = (
    SELECT
      sale.tx_hash || '_' || sale.log_index || '_' || contract.address || '_' || sale.token_id
    FROM
      emblem_sales sale
      JOIN address_dictionary contract ON contract.address_id = sale.contract_id
    WHERE
      sale.tx_hash = substr(trade.ref, 1, instr(trade.ref, '_') - 1)
      AND sale.log_index = CAST(substr(trade.ref, instr(trade.ref, '_') + 1) AS INTEGER)
    ORDER BY
      contract.address,
      sale.token_id
    LIMIT
      1
  )
WHERE
  trade.venue = 'emblem'
  AND EXISTS (
    SELECT
      1
    FROM
      emblem_sales sale
    WHERE
      sale.tx_hash = substr(trade.ref, 1, instr(trade.ref, '_') - 1)
      AND sale.log_index = CAST(substr(trade.ref, instr(trade.ref, '_') + 1) AS INTEGER)
  );
