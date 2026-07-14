-- Projection identities must be derivable from canonical compact records, not source autoincrement rows.
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
