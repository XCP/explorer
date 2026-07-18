-- Counterparty's canonical order-match ID is tx0_hash || '_' || tx1_hash. The compact snapshot imported that
-- public identity, but the first native trade builder omitted the separator and created a second row per match.
-- Materialize every source match under the canonical identity before removing only proven alternate counterparts.
INSERT INTO trades(
  venue,ref,asset_id,block_time,block_index,quantity,currency,total,buyer_id,seller_id,tx_hash
)
SELECT 'dex',lower(hex(match.tx0_hash)) || '_' || lower(hex(match.tx1_hash)),
  CASE WHEN forward_asset.asset IN ('XCP','BTC') THEN match.backward_asset_id ELSE match.forward_asset_id END,
  match.block_time,match.block_index,
  CAST(CASE WHEN forward_asset.asset IN ('XCP','BTC') THEN match.backward_quantity ELSE match.forward_quantity END AS REAL)
    / CASE WHEN sold_asset.divisible=1 THEN 1e8 ELSE 1 END,
  CASE WHEN forward_asset.asset IN ('XCP','BTC') THEN forward_asset.asset ELSE backward_asset.asset END,
  CAST(CASE WHEN forward_asset.asset IN ('XCP','BTC') THEN match.forward_quantity ELSE match.backward_quantity END AS REAL)
    / 1e8,
  CASE WHEN forward_asset.asset IN ('XCP','BTC') THEN match.tx0_address_id ELSE match.tx1_address_id END,
  CASE WHEN forward_asset.asset IN ('XCP','BTC') THEN match.tx1_address_id ELSE match.tx0_address_id END,
  match.tx1_hash
FROM order_matches match
JOIN asset_dictionary forward_asset ON forward_asset.asset_id=match.forward_asset_id
JOIN asset_dictionary backward_asset ON backward_asset.asset_id=match.backward_asset_id
LEFT JOIN assets sold_asset ON sold_asset.asset_id=CASE
  WHEN forward_asset.asset IN ('XCP','BTC') THEN match.backward_asset_id ELSE match.forward_asset_id END
WHERE match.status='completed'
  AND (forward_asset.asset IN ('XCP','BTC') OR backward_asset.asset IN ('XCP','BTC'))
ON CONFLICT(venue,ref) DO UPDATE SET
  asset_id=excluded.asset_id,block_time=excluded.block_time,block_index=excluded.block_index,
  quantity=excluded.quantity,currency=excluded.currency,total=excluded.total,
  buyer_id=excluded.buyer_id,seller_id=excluded.seller_id,tx_hash=excluded.tx_hash
WHERE trades.asset_id IS NOT excluded.asset_id OR trades.block_time IS NOT excluded.block_time
  OR trades.block_index IS NOT excluded.block_index OR trades.quantity IS NOT excluded.quantity
  OR trades.currency IS NOT excluded.currency OR trades.total IS NOT excluded.total
  OR trades.buyer_id IS NOT excluded.buyer_id OR trades.seller_id IS NOT excluded.seller_id
  OR trades.tx_hash IS NOT excluded.tx_hash;

DELETE FROM trades AS alternate
WHERE alternate.venue='dex' AND length(alternate.ref)=128 AND instr(alternate.ref,'_')=0
  AND alternate.ref NOT GLOB '*[^0-9a-f]*'
  AND EXISTS(
    SELECT 1 FROM trades canonical
    WHERE canonical.venue='dex'
      AND canonical.ref=substr(alternate.ref,1,64) || '_' || substr(alternate.ref,65,64)
  );

-- Trade triggers enqueue every affected asset. Keep the published Rating projection stale until that queue is
-- completely drained; maybeRefreshAssetRatings now enforces the queue-empty precondition.
INSERT INTO core_state(key,value) VALUES('asset_ratings_refreshed_at','0')
ON CONFLICT(key) DO UPDATE SET value='0';
