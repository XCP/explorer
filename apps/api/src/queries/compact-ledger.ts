export const ADDRESS_LEDGER_SQL = `WITH page AS (
  SELECT direction,block_index,tx_hash,asset_id,quantity,calling_function,event_index
    FROM ledger_events
   WHERE address_id=(SELECT address_id FROM address_dictionary WHERE address=?1)
   ORDER BY block_index DESC,tx_hash,event_index LIMIT ?2 OFFSET ?3
)
SELECT CASE page.direction WHEN 1 THEN 'in' ELSE 'out' END direction,
       page.block_index,CASE WHEN page.tx_hash IS NULL THEN NULL ELSE LOWER(HEX(page.tx_hash)) END tx_hash,
       assets.asset,page.quantity,page.calling_function
  FROM page JOIN asset_dictionary assets ON assets.asset_id=page.asset_id
 ORDER BY page.block_index DESC,page.tx_hash,page.event_index`;
